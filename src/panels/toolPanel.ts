import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";
import type { Connection, ConnectionsManager } from "../managers/connectionsManager";
import type { DataverseManager } from "../managers/dataverseManager";
import type { PowerPlatformManager } from "../managers/powerPlatformManager";
import { TerminalManager } from "../managers/terminalManager";
import { ToolManager } from "../managers/toolManager";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import { logger } from "../utils/logger";

type ApiMessage = {
    type: string;
    source?: string;
    requestId?: string;
    namespace?: string;
    method?: string;
    args?: unknown[];
    [key: string]: unknown;
};

type ToolContext = {
    toolId: string | null;
    instanceId?: string | null;
    connectionUrl: string | null;
    connectionId?: string | null;
    secondaryConnectionUrl?: string | null;
    secondaryConnectionId?: string | null;
};

type ToolBoxEventPayload = {
    event: string;
    data: unknown;
    timestamp: string;
};

type ToolSafeConnection = {
    id: string;
    name: string;
    url: string;
    environment: "Dev" | "Test" | "UAT" | "Production";
    category?: string;
    environmentColor?: string;
    categoryColor?: string;
    enabledForPowerPlatformAPI?: boolean;
    scopesForPowerPlatformAPI?: string[];
    createdAt?: string;
    lastUsedAt?: string;
};

type OpenManagers = {
    connectionsManager?: ConnectionsManager;
    dataverseManager?: DataverseManager;
    powerPlatformManager?: PowerPlatformManager;
};

/**
 * Manages a WebviewPanel that hosts a single tool's UI.
 * Multiple instances may be open simultaneously (one per tool).
 */
export class ToolPanel {
    private static readonly panels = new Map<string, ToolPanel>();

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly toolManager: ToolManager;
    private readonly toolRegistryManager: ToolRegistryManager;
    private readonly connectionsManager?: ConnectionsManager;
    private readonly dataverseManager?: DataverseManager;
    private readonly powerPlatformManager?: PowerPlatformManager;

    private toolContext: ToolContext;

    private readonly toolSettings = new Map<string, Record<string, unknown>>();
    private readonly terminalManager = new TerminalManager();
    private readonly eventHistory: ToolBoxEventPayload[] = [];
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        toolId: string,
        toolManager: ToolManager,
        toolRegistryManager: ToolRegistryManager,
        managers?: OpenManagers,
        initialContext?: Partial<Pick<ToolContext, "connectionId" | "connectionUrl" | "secondaryConnectionId" | "secondaryConnectionUrl">>,
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.toolManager = toolManager;
        this.toolRegistryManager = toolRegistryManager;
        this.connectionsManager = managers?.connectionsManager;
        this.dataverseManager = managers?.dataverseManager;
        this.powerPlatformManager = managers?.powerPlatformManager;

        this.toolContext = {
            toolId,
            connectionUrl: initialContext?.connectionUrl ?? null,
            connectionId: initialContext?.connectionId ?? null,
            secondaryConnectionUrl: initialContext?.secondaryConnectionUrl ?? null,
            secondaryConnectionId: initialContext?.secondaryConnectionId ?? null,
        };

        const toolForHtml = this.toolManager.getById(toolId);
        this.panel.webview.html = toolForHtml ? (this.loadToolHtml(toolForHtml) ?? this.getNoUiHtml(toolForHtml)) : this.getNoUiHtml(null);

        this.panel.onDidDispose(() => this.dispose(toolId), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            (message: ApiMessage) => {
                this.handleMessage(message).catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error("ToolPanel message handler error:", msg);
                });
            },
            null,
            this.disposables,
        );

        if (this.connectionsManager) {
            this.disposables.push(
                this.connectionsManager.onConnectionsChanged.event(() => {
                    this.pushEvent("connection:updated", {});
                }),
            );
        }

        this.disposables.push(
            this.terminalManager.onTerminalOutput(({ terminalId, data }) => {
                this.pushEvent("terminal:output", { terminalId, data });
            }),
            this.terminalManager.onTerminalClosed(({ terminalId }) => {
                this.pushEvent("terminal:closed", { terminalId });
            }),
            this.terminalManager.onTerminalCommandCompleted(({ terminalId, exitCode }) => {
                this.pushEvent("terminal:command:completed", { terminalId, exitCode });
            }),
        );
    }

    /**
     * Open (or reveal) a tool panel for the given toolId.
     * Each tool gets its own panel; launching the same tool again reveals it.
     * Validates the active connection and prompts for a secondary connection when
     * the tool's package.json declares `features.multiConnection`.
     */
    static open(extensionUri: vscode.Uri, toolId: string, toolManager: ToolManager, toolRegistryManager: ToolRegistryManager, managers?: OpenManagers): void {
        ToolPanel.openAsync(extensionUri, toolId, toolManager, toolRegistryManager, managers).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("ToolPanel.open error:", msg);
        });
    }

    private static async openAsync(extensionUri: vscode.Uri, toolId: string, toolManager: ToolManager, toolRegistryManager: ToolRegistryManager, managers?: OpenManagers): Promise<void> {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;

        const existing = ToolPanel.panels.get(toolId);
        if (existing) {
            existing.panel.reveal(column ?? vscode.ViewColumn.One);
            return;
        }

        // Validate primary connection before launching
        if (managers?.connectionsManager) {
            const activeConnection = managers.connectionsManager.getActiveConnection();
            if (!activeConnection) {
                const action = await vscode.window.showErrorMessage("No active connection. Please connect to an environment before launching a tool.", "Add Connection");
                if (action === "Add Connection") {
                    await vscode.commands.executeCommand("pptb.connections.add");
                }
                return;
            }

            // Determine secondary connection requirement from the tool manifest
            const tool = toolManager.getById(toolId);
            let secondaryConnectionId: string | null = null;
            let secondaryConnectionUrl: string | null = null;

            if (tool) {
                const multiConnection = ToolPanel.readToolMultiConnectionFeature(tool.toolPath);

                if (multiConnection === "required" || multiConnection === "optional") {
                    const selected = await ToolPanel.promptSecondaryConnection(managers.connectionsManager, activeConnection.id, multiConnection);

                    if (selected === undefined && multiConnection === "required") {
                        // User cancelled — required secondary connection not provided
                        return;
                    }

                    if (selected) {
                        secondaryConnectionId = selected.id;
                        secondaryConnectionUrl = selected.url;
                    }
                }
            }

            const title = tool ? `PPTB Tool — ${tool.name}` : "PPTB Tool";

            // Build an explicit file: URI for localResourceRoots so that the webview
            // service worker can match the resource path regardless of the scheme
            // used by context.globalStorageUri (which may not be file: on all builds).
            const toolPathUri = vscode.Uri.file(toolManager.getToolPath(toolId));

            const panel = vscode.window.createWebviewPanel("pptb.toolPanel", title, column ?? vscode.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [toolPathUri],
                retainContextWhenHidden: true,
            });

            const initialContext: Partial<ToolContext> = { secondaryConnectionId, secondaryConnectionUrl };
            ToolPanel.panels.set(toolId, new ToolPanel(panel, extensionUri, toolId, toolManager, toolRegistryManager, managers, initialContext));
            return;
        }

        // No connection manager present — launch directly
        const tool = toolManager.getById(toolId);
        const title = tool ? `PPTB Tool — ${tool.name}` : "PPTB Tool";

        const toolPathUri = vscode.Uri.file(toolManager.getToolPath(toolId));
        const panel = vscode.window.createWebviewPanel("pptb.toolPanel", title, column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [toolPathUri],
            retainContextWhenHidden: true,
        });

        ToolPanel.panels.set(toolId, new ToolPanel(panel, extensionUri, toolId, toolManager, toolRegistryManager, managers));
    }

    /**
     * Read the `features.multiConnection` value from the tool's package.json.
     * Returns "required", "optional", or undefined if not declared / unreadable.
     */
    private static readToolMultiConnectionFeature(toolPath: string): "required" | "optional" | undefined {
        try {
            const pkgPath = path.join(toolPath, "package.json");
            if (!fs.existsSync(pkgPath)) {
                return undefined;
            }
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { features?: { multiConnection?: string } };
            const value = pkg?.features?.multiConnection;
            if (value === "required" || value === "optional") {
                return value;
            }
        } catch {
            // Ignore read/parse errors
        }
        return undefined;
    }

    /**
     * Show a quick-pick for the user to select a secondary connection.
     * - Returns the selected connection's id/url on success.
     * - Returns null when the user skips (optional mode).
     * - Returns undefined when the user dismisses the picker or no candidates exist (required mode).
     */
    private static async promptSecondaryConnection(
        connectionsManager: ConnectionsManager,
        primaryConnectionId: string,
        mode: "required" | "optional",
    ): Promise<{ id: string; url: string } | null | undefined> {
        const candidates = connectionsManager.getAll().filter((c) => c.id !== primaryConnectionId);

        if (candidates.length === 0) {
            if (mode === "required") {
                await vscode.window.showErrorMessage("This tool requires a secondary connection but no other connections are configured. Please add another connection first.");
                return undefined;
            }
            return null; // optional — no candidates, proceed without
        }

        type PickItem = vscode.QuickPickItem & { connectionId?: string; connectionUrl?: string };

        const items: PickItem[] = candidates.map((c) => ({
            label: c.name,
            description: c.url,
            detail: [c.environment, c.category].filter(Boolean).join(" · "),
            connectionId: c.id,
            connectionUrl: c.url,
        }));

        if (mode === "optional") {
            items.push({ label: "$(close) Skip", description: "Launch without a secondary connection" });
        }

        const picked = await vscode.window.showQuickPick<PickItem>(items, {
            title: mode === "required" ? "Select Secondary Connection (required)" : "Select Secondary Connection (optional)",
            placeHolder: "Choose a secondary environment connection",
        });

        if (!picked) {
            return undefined; // picker dismissed
        }

        if (!picked.connectionId) {
            return null; // "Skip" chosen
        }

        return { id: picked.connectionId, url: picked.connectionUrl! };
    }

    dispose(toolId: string): void {
        ToolPanel.panels.delete(toolId);
        this.panel.dispose();
        this.terminalManager.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    private async handleMessage(message: ApiMessage): Promise<void> {
        if (message.type === "pptb:request") {
            await this.handleApiRequest(message);
            return;
        }

        switch (message.type) {
            case "set-tool-context": {
                this.setToolContext(message.context as Partial<ToolContext>);
                break;
            }
            case "push-event": {
                const eventName = typeof message.event === "string" ? message.event : "tool:loaded";
                this.pushEvent(eventName, message.payload ?? {});
                break;
            }
            default:
                logger.warn("ToolPanel: unrecognised message type:", message.type);
                break;
        }
    }

    private loadToolHtml(tool: { toolPath: string; executableRelativePath?: string; name: string }): string | null {
        const candidates: string[] = [];
        if (tool.executableRelativePath) {
            candidates.push(path.join(tool.toolPath, tool.executableRelativePath));
        }
        candidates.push(path.join(tool.toolPath, "dist", "index.html"), path.join(tool.toolPath, "index.html"));

        for (const candidate of candidates) {
            if (!candidate.endsWith(".html") || !fs.existsSync(candidate)) {
                continue;
            }
            try {
                const toolDir = path.dirname(candidate);
                const baseUri = this.panel.webview.asWebviewUri(vscode.Uri.file(toolDir)).toString();

                const polyfillPath = path.join(this.extensionUri.fsPath, "src", "polyfill", "toolboxAPI.js");
                const polyfillContent = fs.existsSync(polyfillPath) ? fs.readFileSync(polyfillPath, "utf8") : "";

                let html = fs.readFileSync(candidate, "utf8");

                // Strip any existing CSP meta so ours takes precedence
                html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");

                const cspSource = this.panel.webview.cspSource;
                const csp = [
                    `default-src 'none'`,
                    `script-src ${cspSource} 'unsafe-inline'`,
                    `style-src ${cspSource} 'unsafe-inline'`,
                    `img-src ${cspSource} https: data: blob:`,
                    `font-src ${cspSource} https: data:`,
                    `connect-src ${cspSource} https:`,
                ].join("; ");

                const injection = `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` + `<base href="${baseUri}/">\n` + `<script>\n${polyfillContent}\n</script>`;

                if (/<head[^>]*>/i.test(html)) {
                    html = html.replace(/(<head[^>]*>)/i, `$1\n${injection}`);
                } else {
                    html = `<!DOCTYPE html><html><head>${injection}</head><body>${html}</body></html>`;
                }

                return html;
            } catch {
                // ignore — try next candidate
            }
            break;
        }

        return null;
    }

    private getNoUiHtml(tool: { name: string } | null): string {
        const name = tool?.name ?? "Tool";
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>${name}</title>
</head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--vscode-font-family);color:var(--vscode-foreground);">
  <div style="text-align:center;opacity:0.6;">
    <div style="font-size:48px;">&#9881;</div>
    <div style="font-weight:600;margin-top:8px;">${name}</div>
    <div style="font-size:11px;margin-top:6px;color:var(--vscode-descriptionForeground);">This tool does not have a web interface.</div>
  </div>
</body>
</html>`;
    }

    private async handleApiRequest(message: ApiMessage): Promise<void> {
        const requestId = typeof message.requestId === "string" ? message.requestId : "";
        const namespace = typeof message.namespace === "string" ? message.namespace : "";
        const method = typeof message.method === "string" ? message.method : "";
        const args = Array.isArray(message.args) ? message.args : [];

        try {
            const data = await this.dispatch(namespace, method, args);
            this.postApiResponse(requestId, true, data);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.postApiResponse(requestId, false, undefined, errorMessage);
        }
    }

    private postApiResponse(requestId: string, success: boolean, data?: unknown, error?: string): void {
        this.panel.webview.postMessage({
            source: "pptb-host",
            type: "pptb:response",
            requestId,
            success,
            data,
            error,
        });
    }

    private async dispatch(namespace: string, method: string, args: unknown[]): Promise<unknown> {
        switch (namespace) {
            case "toolbox":
                return this.dispatchToolbox(method);
            case "connections":
                return this.dispatchConnections(method);
            case "utils":
                return this.dispatchUtils(method, args);
            case "fileSystem":
                return this.dispatchFileSystem(method, args);
            case "settings":
                return this.dispatchSettings(method, args);
            case "terminal":
                return this.dispatchTerminal(method, args);
            case "events":
                return this.dispatchEvents(method, args);
            case "invocation":
                return this.dispatchInvocation(method, args);
            case "dataverse":
                return this.dispatchDataverse(method, args);
            case "powerplatform":
                return this.dispatchPowerPlatform(method, args);
            default:
                throw new Error(`Unsupported namespace: ${namespace}`);
        }
    }

    private async dispatchToolbox(method: string): Promise<unknown> {
        if (method !== "getToolContext") {
            throw new Error(`Unsupported toolbox method: ${method}`);
        }
        return this.getToolContext();
    }

    private async dispatchConnections(method: string): Promise<unknown> {
        if (method === "getActiveConnection") {
            const connection = await this.getConnection("primary");
            return this.toToolSafeConnection(connection);
        }

        if (method === "getSecondaryConnection") {
            const connection = await this.getConnection("secondary");
            return this.toToolSafeConnection(connection);
        }

        throw new Error(`Unsupported connections method: ${method}`);
    }

    private async dispatchUtils(method: string, args: unknown[]): Promise<unknown> {
        switch (method) {
            case "showNotification": {
                const options = (args[0] ?? {}) as {
                    title?: string;
                    body?: string;
                    type?: "info" | "success" | "warning" | "error";
                };
                const text = [options.title, options.body].filter(Boolean).join("\n");

                switch (options.type) {
                    case "warning":
                        await vscode.window.showWarningMessage(text);
                        break;
                    case "error":
                        await vscode.window.showErrorMessage(text);
                        break;
                    default:
                        await vscode.window.showInformationMessage(text);
                        break;
                }

                this.pushEvent("notification:shown", options);
                return;
            }
            case "copyToClipboard": {
                const text = typeof args[0] === "string" ? args[0] : "";
                await vscode.env.clipboard.writeText(text);
                return;
            }
            case "getCurrentTheme": {
                const kind = vscode.window.activeColorTheme.kind;
                return kind === vscode.ColorThemeKind.Light ? "light" : "dark";
            }
            case "openInConnectionBrowser": {
                const urlText = typeof args[0] === "string" ? args[0] : "";
                const parsed = vscode.Uri.parse(urlText);
                if (!["http", "https"].includes(parsed.scheme)) {
                    throw new Error("Only http/https URLs are supported.");
                }
                await vscode.env.openExternal(parsed);
                return;
            }
            default:
                throw new Error(`Unsupported utils method: ${method}`);
        }
    }

    private async dispatchFileSystem(method: string, args: unknown[]): Promise<unknown> {
        const asUri = (value: unknown): vscode.Uri => {
            if (typeof value !== "string" || value.trim().length === 0) {
                throw new Error("A valid path is required.");
            }
            return vscode.Uri.file(value);
        };

        switch (method) {
            case "readText": {
                const uri = asUri(args[0]);
                const bytes = await vscode.workspace.fs.readFile(uri);
                return new TextDecoder().decode(bytes);
            }
            case "readBinary": {
                const uri = asUri(args[0]);
                const bytes = await vscode.workspace.fs.readFile(uri);
                return Array.from(bytes);
            }
            case "exists": {
                const uri = asUri(args[0]);
                try {
                    await vscode.workspace.fs.stat(uri);
                    return true;
                } catch {
                    return false;
                }
            }
            case "stat": {
                const uri = asUri(args[0]);
                const stat = await vscode.workspace.fs.stat(uri);
                return {
                    type: stat.type === vscode.FileType.Directory ? "directory" : "file",
                    size: stat.size,
                    mtime: new Date(stat.mtime).toISOString(),
                };
            }
            case "readDirectory": {
                const uri = asUri(args[0]);
                const entries = await vscode.workspace.fs.readDirectory(uri);
                return entries.map(([name, fileType]) => ({
                    name,
                    type: fileType === vscode.FileType.Directory ? "directory" : "file",
                }));
            }
            case "writeText": {
                const uri = asUri(args[0]);
                const content = typeof args[1] === "string" ? args[1] : "";
                await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
                return;
            }
            case "createDirectory": {
                const uri = asUri(args[0]);
                await vscode.workspace.fs.createDirectory(uri);
                return;
            }
            case "saveFile": {
                const defaultPath = typeof args[0] === "string" ? args[0] : "";
                const content = args[1];
                const filters = Array.isArray(args[2])
                    ? (args[2] as Array<{ name: string; extensions: string[] }>).reduce<Record<string, string[]>>((acc, filter) => {
                          acc[filter.name] = filter.extensions;
                          return acc;
                      }, {})
                    : undefined;

                const targetUri = await vscode.window.showSaveDialog({
                    defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
                    filters,
                });

                if (!targetUri) {
                    return null;
                }

                const bytes = this.toBytes(content);
                await vscode.workspace.fs.writeFile(targetUri, bytes);
                return targetUri.fsPath;
            }
            case "selectPath": {
                const options = (args[0] ?? {}) as {
                    type?: "file" | "folder";
                    title?: string;
                    buttonLabel?: string;
                    defaultPath?: string;
                    filters?: Array<{ name: string; extensions: string[] }>;
                };

                const selected = await vscode.window.showOpenDialog({
                    canSelectFiles: options.type !== "folder",
                    canSelectFolders: options.type === "folder",
                    canSelectMany: false,
                    title: options.title,
                    openLabel: options.buttonLabel,
                    defaultUri: options.defaultPath ? vscode.Uri.file(options.defaultPath) : undefined,
                    filters: options.filters
                        ? options.filters.reduce<Record<string, string[]>>((acc, filter) => {
                              acc[filter.name] = filter.extensions;
                              return acc;
                          }, {})
                        : undefined,
                });

                return selected && selected.length > 0 ? selected[0].fsPath : null;
            }
            default:
                throw new Error(`Unsupported fileSystem method: ${method}`);
        }
    }

    private async dispatchSettings(method: string, args: unknown[]): Promise<unknown> {
        const toolId = this.toolContext.toolId ?? "unknown-tool";
        const existing = this.toolSettings.get(toolId) ?? {};

        switch (method) {
            case "getAll":
                return { ...existing };
            case "get":
                return existing[String(args[0])];
            case "set": {
                const key = String(args[0]);
                const value = args[1];
                this.toolSettings.set(toolId, { ...existing, [key]: value });
                this.pushEvent("settings:updated", { toolId, key });
                return;
            }
            case "setAll": {
                const value = args[0] && typeof args[0] === "object" ? (args[0] as Record<string, unknown>) : {};
                this.toolSettings.set(toolId, value);
                this.pushEvent("settings:updated", { toolId });
                return;
            }
            default:
                throw new Error(`Unsupported settings method: ${method}`);
        }
    }

    private async dispatchTerminal(method: string, args: unknown[]): Promise<unknown> {
        switch (method) {
            case "create": {
                const options = (args[0] ?? {}) as {
                    name?: string;
                    shell?: string;
                    cwd?: string;
                    env?: Record<string, string>;
                    visible?: boolean;
                };
                const toolId = this.toolContext.toolId ?? "unknown-tool";
                const toolInstanceId = this.toolContext.instanceId ?? uuidv4();
                const info = this.terminalManager.create(options, toolId, toolInstanceId);
                this.pushEvent("terminal:created", info);
                return info;
            }
            case "execute": {
                const terminalId = String(args[0]);
                const command = String(args[1] ?? "");
                return this.terminalManager.execute(terminalId, command);
            }
            case "close": {
                const terminalId = String(args[0]);
                this.terminalManager.close(terminalId);
                return;
            }
            case "get": {
                const terminalId = String(args[0]);
                return this.terminalManager.get(terminalId);
            }
            case "list": {
                return this.terminalManager.list();
            }
            case "setVisibility": {
                const terminalId = String(args[0]);
                const visible = Boolean(args[1]);
                this.terminalManager.setVisibility(terminalId, visible);
                return;
            }
            default:
                throw new Error(`Unsupported terminal method: ${method}`);
        }
    }

    private async dispatchEvents(method: string, args: unknown[]): Promise<unknown> {
        if (method === "getHistory") {
            const limitValue = args[0];
            const limit = typeof limitValue === "number" && Number.isFinite(limitValue) ? Math.max(0, Math.floor(limitValue)) : this.eventHistory.length;
            return this.eventHistory.slice(-limit);
        }

        if (method === "on" || method === "off") {
            return;
        }

        throw new Error(`Unsupported events method: ${method}`);
    }

    private async dispatchInvocation(method: string, args: unknown[]): Promise<unknown> {
        switch (method) {
            case "getLaunchContext":
                return null;
            case "returnData":
                this.pushEvent("tool:unloaded", args[0] ?? {});
                return;
            case "launchTool":
                throw new Error("Tool invocation is not yet available in VS Code host.");
            case "findToolsByCapability": {
                const tag = String(args[0] ?? "");
                return this.toolRegistryManager.getTools({ category: tag });
            }
            case "getKnownCapabilityTags":
                return this.toolRegistryManager.getKnownCapabilityTags();
            default:
                throw new Error(`Unsupported invocation method: ${method}`);
        }
    }

    private async dispatchDataverse(method: string, args: unknown[]): Promise<unknown> {
        if (!this.dataverseManager) {
            throw new Error("Dataverse API is unavailable in this host.");
        }

        if (method === "buildLabel" || method === "getAttributeODataType") {
            const fn = (this.dataverseManager as unknown as Record<string, unknown>)[method];
            if (typeof fn !== "function") {
                throw new Error(`Unsupported dataverse method: ${method}`);
            }
            return (fn as (...params: unknown[]) => unknown).apply(this.dataverseManager, args);
        }

        const fn = (this.dataverseManager as unknown as Record<string, unknown>)[method];
        if (typeof fn !== "function") {
            throw new Error(`Unsupported dataverse method: ${method}`);
        }

        const hasConnectionTargetArg = this.hasConnectionTargetArg(args);
        const connectionTarget = hasConnectionTargetArg ? (args[args.length - 1] as "primary" | "secondary") : "primary";
        const trimmedArgs = hasConnectionTargetArg ? args.slice(0, -1) : args;

        const connection = await this.getConnection(connectionTarget);
        if (!connection) {
            throw new Error(`No ${connectionTarget} connection available.`);
        }

        return (fn as (...params: unknown[]) => unknown).apply(this.dataverseManager, [connection, ...trimmedArgs]);
    }

    private hasConnectionTargetArg(args: unknown[]): boolean {
        if (args.length === 0) {
            return false;
        }

        const lastArg = args[args.length - 1];
        return lastArg === "primary" || lastArg === "secondary";
    }

    private async dispatchPowerPlatform(method: string, args: unknown[]): Promise<unknown> {
        if (method !== "request") {
            throw new Error(`Unsupported powerplatform method: ${method}`);
        }

        if (!this.powerPlatformManager) {
            throw new Error("Power Platform API is unavailable in this host.");
        }

        const [namespace, httpMethod, pathArg, body, connectionTarget, headers] = args;

        if (typeof namespace !== "string") {
            throw new Error("Power Platform namespace is required.");
        }
        if (httpMethod !== "GET" && httpMethod !== "POST" && httpMethod !== "PUT" && httpMethod !== "PATCH" && httpMethod !== "DELETE") {
            throw new Error("Invalid Power Platform HTTP method.");
        }

        const target = connectionTarget === "secondary" ? "secondary" : "primary";

        return this.powerPlatformManager.request(namespace, httpMethod, typeof pathArg === "string" ? pathArg : "", body, target, (headers as Record<string, string>) ?? {});
    }

    private async getToolContext(): Promise<ToolContext> {
        const primary = await this.getConnection("primary");
        const secondary = await this.getConnection("secondary");

        const nextContext: ToolContext = {
            ...this.toolContext,
            connectionId: primary?.id ?? this.toolContext.connectionId ?? null,
            connectionUrl: primary?.url ?? this.toolContext.connectionUrl ?? null,
            secondaryConnectionId: secondary?.id ?? this.toolContext.secondaryConnectionId ?? null,
            secondaryConnectionUrl: secondary?.url ?? this.toolContext.secondaryConnectionUrl ?? null,
        };

        this.toolContext = nextContext;
        return nextContext;
    }

    private async getConnection(target: "primary" | "secondary"): Promise<Connection | undefined> {
        if (!this.connectionsManager) {
            return undefined;
        }

        const id = target === "primary" ? this.toolContext.connectionId : this.toolContext.secondaryConnectionId;

        if (typeof id === "string" && id.length > 0) {
            const byId = await this.connectionsManager.getWithSecrets(id);
            if (byId) {
                return byId;
            }
        }

        if (target === "primary") {
            const active = this.connectionsManager.getActiveConnection();
            if (active) {
                return this.connectionsManager.getWithSecrets(active.id);
            }
        }

        return undefined;
    }

    private toToolSafeConnection(connection: Connection | undefined): ToolSafeConnection | null {
        if (!connection) {
            return null;
        }

        const source = connection as Connection & {
            enabledForPowerPlatformAPI?: boolean;
            scopesForPowerPlatformAPI?: string[];
        };

        return {
            id: source.id,
            name: source.name,
            url: source.url,
            environment: source.environment,
            category: source.category,
            environmentColor: source.environmentColor,
            categoryColor: source.categoryColor,
            enabledForPowerPlatformAPI: source.enabledForPowerPlatformAPI,
            scopesForPowerPlatformAPI: source.scopesForPowerPlatformAPI,
            createdAt: source.createdAt,
            lastUsedAt: source.lastUsedAt,
        };
    }

    private setToolContext(next: Partial<ToolContext> | undefined): void {
        this.toolContext = {
            ...this.toolContext,
            ...(next ?? {}),
            toolId: typeof next?.toolId === "string" || next?.toolId === null ? next.toolId : this.toolContext.toolId,
            connectionUrl: typeof next?.connectionUrl === "string" || next?.connectionUrl === null ? next.connectionUrl : this.toolContext.connectionUrl,
            connectionId: typeof next?.connectionId === "string" || next?.connectionId === null ? next.connectionId : this.toolContext.connectionId,
            secondaryConnectionUrl: typeof next?.secondaryConnectionUrl === "string" || next?.secondaryConnectionUrl === null ? next.secondaryConnectionUrl : this.toolContext.secondaryConnectionUrl,
            secondaryConnectionId: typeof next?.secondaryConnectionId === "string" || next?.secondaryConnectionId === null ? next.secondaryConnectionId : this.toolContext.secondaryConnectionId,
        };

        this.panel.webview.postMessage({
            source: "pptb-host",
            type: "pptb:context",
            context: this.toolContext,
        });
    }

    private pushEvent(event: string, data: unknown): void {
        const payload: ToolBoxEventPayload = {
            event,
            data,
            timestamp: new Date().toISOString(),
        };

        this.eventHistory.push(payload);
        if (this.eventHistory.length > 200) {
            this.eventHistory.splice(0, this.eventHistory.length - 200);
        }

        this.panel.webview.postMessage({
            source: "pptb-host",
            type: "pptb:event",
            event,
            payload,
        });
    }

    private toBytes(content: unknown): Uint8Array {
        if (typeof content === "string") {
            return new TextEncoder().encode(content);
        }

        if (content instanceof Uint8Array) {
            return content;
        }

        if (Array.isArray(content) && content.every((item) => typeof item === "number")) {
            return Uint8Array.from(content);
        }

        return new TextEncoder().encode(JSON.stringify(content ?? {}));
    }
}
