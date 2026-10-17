import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";
import { TOOL_SETTINGS_KEY_PREFIX } from "../constants";
import type { Connection, ConnectionsManager } from "../managers/connectionsManager";
import { CspConsentManager } from "../managers/cspConsentManager";
import type { DataverseManager, DataverseUser } from "../managers/dataverseManager";
import type { PowerPlatformManager } from "../managers/powerPlatformManager";
import { TerminalManager } from "../managers/terminalManager";
import { ToolManager } from "../managers/toolManager";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import { buildToolCsp, type CspExceptions } from "../utils/csp";
import { connectionTargetLabel, normalizeConnectionTarget, resolveConnectionSlots, type ConnectionIds, type ConnectionTarget, type ToolConnectionFeatures } from "../utils/connectionSlots";
import { createImpersonationPickerItems, formatConnectionStatus, resolveImpersonationPickerSelection, type ImpersonationPickerItem } from "../utils/impersonation";
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
    connectionIds?: ConnectionIds;
    connectionUrls?: Array<string | null>;
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

type ToolLaunchMode = "impersonated";

/**
 * Manages a WebviewPanel that hosts a single tool's UI.
 * Multiple instances may be open simultaneously (one per tool).
 */
export class ToolPanel {
    private static readonly panels = new Map<string, ToolPanel>();

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly context: vscode.ExtensionContext;
    private readonly toolManager: ToolManager;
    private readonly toolRegistryManager: ToolRegistryManager;
    private readonly connectionSlots: { min: number; max: number };
    private readonly requirePowerPlatformApi: boolean;
    private readonly connectionsManager?: ConnectionsManager;
    private readonly dataverseManager?: DataverseManager;
    private readonly powerPlatformManager?: PowerPlatformManager;
    private readonly connectionStatusBar?: vscode.StatusBarItem;
    private readonly impersonatedUsers: Partial<Record<number, DataverseUser>> = {};

    private toolContext: ToolContext;

    private readonly terminalManager = new TerminalManager();
    private readonly eventHistory: ToolBoxEventPayload[] = [];
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        toolId: string,
        toolManager: ToolManager,
        toolRegistryManager: ToolRegistryManager,
        managers?: OpenManagers,
        connectionSlots: { min: number; max: number } = { min: 1, max: 1 },
        requirePowerPlatformApi = false,
        initialContext?: Partial<ToolContext>,
        initialImpersonatedUsers?: Partial<Record<number, DataverseUser>>,
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.context = context;
        this.toolManager = toolManager;
        this.toolRegistryManager = toolRegistryManager;
        this.connectionSlots = connectionSlots;
        this.requirePowerPlatformApi = requirePowerPlatformApi;
        this.connectionsManager = managers?.connectionsManager;
        this.dataverseManager = managers?.dataverseManager;
        this.powerPlatformManager = managers?.powerPlatformManager;
        Object.assign(this.impersonatedUsers, initialImpersonatedUsers);

        this.toolContext = {
            toolId,
            connectionIds: Array.from({ length: connectionSlots.max }, (_, index) => initialContext?.connectionIds?.[index] ?? (index === 0 ? initialContext?.connectionId : index === 1 ? initialContext?.secondaryConnectionId : null) ?? null),
            connectionUrls: Array.from({ length: connectionSlots.max }, (_, index) => initialContext?.connectionUrls?.[index] ?? (index === 0 ? initialContext?.connectionUrl : index === 1 ? initialContext?.secondaryConnectionUrl : null) ?? null),
            connectionUrl: initialContext?.connectionUrl ?? null,
            connectionId: initialContext?.connectionId ?? null,
            secondaryConnectionUrl: initialContext?.secondaryConnectionUrl ?? null,
            secondaryConnectionId: initialContext?.secondaryConnectionId ?? null,
        };

        if (this.connectionsManager && this.connectionSlots.max > 0) {
            this.connectionStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
            this.connectionStatusBar.command = `pptb.toolPanel.manageConnections.${toolId}`;
            this.disposables.push(
                vscode.commands.registerCommand(`pptb.toolPanel.manageConnections.${toolId}`, () => this.showConnectionSlotPicker()),
                this.panel.onDidChangeViewState(() => this.updateConnectionStatusBar()),
            );
            this.updateConnectionStatusBar();
        }

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
                    this.updateConnectionStatusBar();
                    this.pushEvent("connection:updated", {});
                }),
            );
        }

        this.updateImpersonationBanner();

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
     * Resolves the declared connection range and prompts for required and optional slots.
     */
    static open(
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        toolId: string,
        toolManager: ToolManager,
        toolRegistryManager: ToolRegistryManager,
        cspConsentManager: CspConsentManager,
        managers?: OpenManagers,
        launchMode?: ToolLaunchMode,
    ): void {
        ToolPanel.openAsync(extensionUri, context, toolId, toolManager, toolRegistryManager, cspConsentManager, managers, launchMode).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("ToolPanel.open error:", msg);
        });
    }

    private static async openAsync(
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        toolId: string,
        toolManager: ToolManager,
        toolRegistryManager: ToolRegistryManager,
        cspConsentManager: CspConsentManager,
        managers?: OpenManagers,
        launchMode?: ToolLaunchMode,
    ): Promise<void> {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
        const existing = ToolPanel.panels.get(toolId);
        if (existing) {
            if (launchMode === "impersonated") {
                await existing.configureImpersonation(true);
            }
            existing.panel.reveal(column ?? vscode.ViewColumn.One);
            return;
        }

        const tool = toolManager.getById(toolId);
        if (tool?.cspExceptions) {
            const consented = await cspConsentManager.ensureConsent(toolId, tool.name, tool.cspExceptions);
            if (!consented) {
                return;
            }
        }

        let connectionSlots = resolveConnectionSlots(tool?.features ?? (tool ? { multiConnection: tool.multiConnection, connectionRequirement: tool.connectionRequirement } : undefined));
        let requirePowerPlatformApi = tool?.features?.enabledForPowerPlatformAPI === true || tool?.enabledForPowerPlatformAPI === true;
        if (tool) {
            const registryTool = await toolRegistryManager.getToolById(toolId);
            const registryFeatures: ToolConnectionFeatures | undefined = registryTool?.features ?? (registryTool?.connections !== undefined
                ? { connections: registryTool.connections }
                : registryTool?.multiConnection || registryTool?.connectionRequirement
                  ? { multiConnection: registryTool.multiConnection, connectionRequirement: registryTool.connectionRequirement }
                  : undefined);
            const localFeatures: ToolConnectionFeatures | undefined = tool.features?.connections !== undefined
                ? { connections: tool.features.connections }
                : tool.features?.multiConnection || tool.features?.connectionRequirement
                  ? { multiConnection: tool.features.multiConnection, connectionRequirement: tool.features.connectionRequirement }
                  : { multiConnection: tool.multiConnection, connectionRequirement: tool.connectionRequirement };
            connectionSlots = resolveConnectionSlots(registryFeatures ?? localFeatures);
            requirePowerPlatformApi ||= registryTool?.features?.enabledForPowerPlatformAPI === true || registryTool?.enabledForPowerPlatformAPI === true;
        }

        if (managers?.connectionsManager) {
            const activeConnection = managers.connectionsManager.getActiveConnection();
            const connectionIds = connectionSlots.max > 0 ? await ToolPanel.promptConnectionSlots(managers.connectionsManager, connectionSlots, activeConnection?.id, requirePowerPlatformApi) : [];
            if (!connectionIds || connectionIds.slice(0, connectionSlots.min).some((id) => !id)) return;

            const selectedConnections = await Promise.all(connectionIds.map((id) => (id ? managers.connectionsManager!.getById(id) : undefined)));
        const impersonatedUsers: Partial<Record<number, DataverseUser>> = {};
        if (launchMode === "impersonated") {
            for (let index = 0; index < selectedConnections.length; index++) {
                const connection = selectedConnections[index];
                if (!connection) continue;
                const withSecrets = await managers.connectionsManager.getWithSecrets(connection.id);
                const user = withSecrets ? await ToolPanel.promptImpersonationUser(managers.dataverseManager, withSecrets, index) : undefined;
                if (user) impersonatedUsers[index] = user;
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

            const initialContext: Partial<ToolContext> = {
                connectionIds,
                connectionUrls: selectedConnections.map((connection) => connection?.url ?? null),
                connectionId: connectionIds[0] ?? null,
                connectionUrl: selectedConnections[0]?.url ?? null,
                secondaryConnectionId: connectionIds[1] ?? null,
                secondaryConnectionUrl: selectedConnections[1]?.url ?? null,
            };
            ToolPanel.panels.set(toolId, new ToolPanel(panel, extensionUri, context, toolId, toolManager, toolRegistryManager, managers, connectionSlots, requirePowerPlatformApi, initialContext, impersonatedUsers));
            return;
        }

        // No connection manager present — launch directly
        const title = tool ? `PPTB Tool — ${tool.name}` : "PPTB Tool";

        const toolPathUri = vscode.Uri.file(toolManager.getToolPath(toolId));
        const panel = vscode.window.createWebviewPanel("pptb.toolPanel", title, column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [toolPathUri],
            retainContextWhenHidden: true,
        });

        ToolPanel.panels.set(toolId, new ToolPanel(panel, extensionUri, context, toolId, toolManager, toolRegistryManager, managers, connectionSlots, requirePowerPlatformApi));
    }

    private async configureImpersonation(enabled: boolean): Promise<void> {
        for (const index of Object.keys(this.impersonatedUsers)) delete this.impersonatedUsers[Number(index)];
        this.updateImpersonationBanner();
        this.updateConnectionStatusBar();
        if (!enabled || !this.connectionsManager) {
            return;
        }

        for (let index = 0; index < (this.toolContext.connectionIds?.length ?? 0); index++) {
            const connection = await this.getConnection(index);
            if (!connection) continue;
            const user = await ToolPanel.promptImpersonationUser(this.dataverseManager, connection, index);
            if (user) this.impersonatedUsers[index] = user;
        }
        this.updateImpersonationBanner();
        this.updateConnectionStatusBar();
    }

    private static async promptConnectionSlots(connectionsManager: ConnectionsManager, range: { min: number; max: number }, activeConnectionId?: string, requirePowerPlatformApi = false): Promise<ConnectionIds | undefined> {
        const candidates = connectionsManager.getAll().filter((connection) => !connection.hasIncompleteCredentials && (!requirePowerPlatformApi || connection.enabledForPowerPlatformAPI));
        const ids: ConnectionIds = Array.from({ length: range.max }, (_, index) => (range.min > 0 && index === 0 && candidates.some((connection) => connection.id === activeConnectionId) ? activeConnectionId! : null));
        if (range.min > 0 && candidates.length === 0) {
            const action = await vscode.window.showErrorMessage("This tool requires a connection, but no complete connections are configured.", "Add Connection");
            if (action === "Add Connection") await vscode.commands.executeCommand("pptb.connections.add");
            return undefined;
        }

        type PickItem = vscode.QuickPickItem & { connectionId?: string; skip?: boolean; done?: boolean };
        const pickSlot = async (index: number, required: boolean): Promise<string | null | "done" | undefined> => {
            const items: PickItem[] = candidates.map((connection) => ({
                label: connection.name,
                description: connection.url,
                detail: [connection.id === ids[index] ? "Current selection" : undefined, connection.environment, connection.category].filter(Boolean).join(" · "),
                connectionId: connection.id,
            }));
            if (!required) {
                items.push({ label: "$(close) Skip this slot", description: "Leave this connection slot empty", skip: true });
                items.push({ label: "$(check) Finish connection selection", description: "Continue with the selected slots", done: true });
            }
            const picked = await vscode.window.showQuickPick(items, {
                title: `Select ${connectionTargetLabel(index)} connection${required ? " (required)" : " (optional)"} · Slot ${index + 1}/${range.max}`,
                placeHolder: "Choose an environment connection",
            });
            if (!picked) return undefined;
            if (picked.done) return "done";
            if (picked.skip) return null;
            return picked.connectionId;
        };

        const preselectedPrimary = ids[0];
        if (preselectedPrimary) {
            const action = await vscode.window.showQuickPick(["Keep active connection", "Choose a different connection"], {
                title: `Select ${connectionTargetLabel(0)} connection · Slot 1/${range.max}`,
            });
            if (action === undefined) return undefined;
            if (action === "Choose a different connection") {
                const selected = await pickSlot(0, range.min > 0);
                if (selected === undefined || selected === "done" || (range.min > 0 && selected === null)) return undefined;
                ids[0] = selected;
            }
        }

        for (let index = 0; index < range.min; index++) {
            if (ids[index]) continue;
            const selected = await pickSlot(index, true);
            if (!selected || selected === "done") return undefined;
            ids[index] = selected;
        }
        for (let index = range.min; index < range.max; index++) {
            const selected = await pickSlot(index, false);
            if (selected === undefined || selected === "done") break;
            ids[index] = selected;
        }
        return ids;
    }

    private static async promptImpersonationUser(dataverseManager: DataverseManager | undefined, connection: Connection, target: number): Promise<DataverseUser | null | undefined> {
        if (!dataverseManager) {
            return undefined;
        }

        type UserPickItem = vscode.QuickPickItem & ImpersonationPickerItem<DataverseUser>;
        const quickPick = vscode.window.createQuickPick<UserPickItem>();
        quickPick.title = `Impersonation (Slot ${target + 1}) - ${connection.name}`;
        quickPick.placeholder = "Type a name or email to search Dataverse users";
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        return new Promise<DataverseUser | null | undefined>((resolve) => {
            let users: DataverseUser[] = [];
            let nextLink: string | null = null;
            let currentSearch = "";
            let requestId = 0;
            let debounce: ReturnType<typeof setTimeout> | undefined;
            let resolved = false;

            const finish = (user?: DataverseUser | null): void => {
                if (resolved) return;
                resolved = true;
                if (debounce) clearTimeout(debounce);
                quickPick.dispose();
                resolve(user);
            };

            const updateItems = (): void => {
                quickPick.items = createImpersonationPickerItems(users, Boolean(nextLink));
            };

            const loadUsers = async (search: string, append: boolean, cursor?: string): Promise<void> => {
                const activeRequestId = ++requestId;
                if (!append) {
                    currentSearch = search;
                    users = [];
                    nextLink = null;
                    updateItems();
                }
                quickPick.busy = true;
                try {
                    const page = await dataverseManager.searchSystemUsers(connection, search, cursor);
                    if (resolved || activeRequestId !== requestId) return;
                    users = append ? [...users, ...page.users] : page.users;
                    nextLink = page.nextLink;
                    updateItems();
                    if (users.length === 0) {
                        quickPick.placeholder = "No matching users; change the search text to try again";
                    } else {
                        quickPick.placeholder = "Type a name or email to refine the search, or select a user";
                    }
                } catch (error: unknown) {
                    if (resolved || activeRequestId !== requestId) return;
                    const message = error instanceof Error ? error.message : String(error);
                    quickPick.items = createImpersonationPickerItems(users, false, message);
                    quickPick.placeholder = "Change the search text to try again";
                } finally {
                    if (activeRequestId === requestId) quickPick.busy = false;
                }
            };

            quickPick.onDidChangeValue((value): void => {
                if (debounce) clearTimeout(debounce);
                debounce = setTimeout(() => void loadUsers(value.trim(), false), 300);
            });

            quickPick.onDidAccept((): void => {
                const selection = resolveImpersonationPickerSelection(quickPick.selectedItems[0], Boolean(nextLink));
                if (selection.type === "user") {
                    finish(selection.user);
                } else if (selection.type === "skip") {
                    finish(null);
                } else if (selection.type === "loadMore" && nextLink) {
                    void loadUsers(currentSearch, true, nextLink);
                }
            });

            quickPick.onDidHide((): void => finish());
            quickPick.show();
            void loadUsers("", false);
        });
    }

    dispose(toolId: string): void {
        ToolPanel.panels.delete(toolId);
        this.connectionStatusBar?.dispose();
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

    private loadToolHtml(tool: { toolPath: string; executableRelativePath?: string; name: string; cspExceptions?: CspExceptions; features?: ToolConnectionFeatures }): string | null {
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

                const polyfillPath = path.join(this.extensionUri.fsPath, "dist", "polyfill", "toolboxAPI.js");
                const polyfillContent = fs.existsSync(polyfillPath) ? fs.readFileSync(polyfillPath, "utf8") : "";

                let html = fs.readFileSync(candidate, "utf8");

                // Rewrite absolute-path src/href attributes to proper webview URIs.
                // Bundlers like Vite emit paths such as src="/assets/index-xxx.js" which
                // resolve against the webview origin root (not the tool's dist dir),
                // producing URLs with no real filesystem path that the service worker
                // rejects as 401 Unauthorized.  Converting them to explicit webview URIs
                // (which include the full filesystem path) fixes this for any dist layout.
                html = html.replace(/\b(src|href)=(["'])(\/[^/"#?\s][^"']*)\2/gi, (_, attr, quote, assetPath) => {
                    const absPath = path.join(toolDir, assetPath);
                    const uri = this.panel.webview.asWebviewUri(vscode.Uri.file(absPath));
                    return `${attr}=${quote}${uri.toString()}${quote}`;
                });

                // Strip any existing CSP meta so ours takes precedence
                html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");

                const cspSource = this.panel.webview.cspSource;
                const csp = buildToolCsp(cspSource, tool.cspExceptions);

                const features = JSON.stringify(tool.features ?? {}).replace(/</g, "\\u003c");
                const injection =
                    `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` +
                    `<base href="${baseUri}/">\n` +
                    `<style>${this.getImpersonationBannerStyles()}</style>\n` +
                    `<script>window.TOOLBOX_FEATURES = ${features};</script>\n` +
                    `<script>\n${polyfillContent}\n${this.getImpersonationBannerScript()}\n</script>`;

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

    private getImpersonationBannerStyles(): string {
        return `
            #pptb-impersonation-banner {
                display: flex;
                align-items: center;
                min-height: 32px;
                box-sizing: border-box;
                padding: 6px 12px;
                background: var(--vscode-statusBar-background, var(--vscode-button-background, #742774));
                color: var(--vscode-statusBar-foreground, var(--vscode-button-foreground, #fff));
                font: 500 12px/20px var(--vscode-font-family, sans-serif);
                overflow-wrap: anywhere;
            }
            #pptb-impersonation-banner[hidden] {
                display: none;
            }
        `;
    }

    private getImpersonationBannerScript(): string {
        const initialUsers = JSON.stringify(Object.fromEntries(Object.entries(this.impersonatedUsers).map(([index, user]) => [index, user?.fullname ?? null]))).replace(/</g, "\\u003c");

        return `
            (() => {
                const bannerId = "pptb-impersonation-banner";
                let currentUsers = ${initialUsers};
                const updateBanner = (users) => {
                    currentUsers = users || {};
                    const banner = document.getElementById(bannerId);
                    const labels = Object.entries(currentUsers)
                        .filter((entry) => typeof entry[1] === "string" && entry[1])
                        .map(([index, name]) => "Slot " + (Number(index) + 1) + ": " + name);
                    if (!banner) return;
                    banner.textContent = labels.length ? "Dataverse impersonation active - " + labels.join(", ") : "";
                    banner.hidden = labels.length === 0;
                };
                const addBanner = () => {
                    if (!document.body || document.getElementById(bannerId)) return;
                    const banner = document.createElement("div");
                    banner.id = bannerId;
                    banner.setAttribute("role", "status");
                    banner.setAttribute("aria-live", "polite");
                    banner.hidden = true;
                    document.body.insertBefore(banner, document.body.firstChild);
                    updateBanner(currentUsers);
                };
                const receive = (event) => {
                    if (event.data?.source === "pptb-host" && event.data.type === "pptb:impersonation") {
                        addBanner();
                        updateBanner(event.data.users);
                    }
                };
                window.addEventListener("message", receive);
                if (document.readyState === "loading") {
                    document.addEventListener("DOMContentLoaded", addBanner, { once: true });
                } else {
                    addBanner();
                }
            })();
        `;
    }

    private updateImpersonationBanner(): void {
        void this.panel.webview.postMessage({
            source: "pptb-host",
            type: "pptb:impersonation",
            users: Object.fromEntries(Object.entries(this.impersonatedUsers).map(([index, user]) => [index, user?.fullname ?? null])),
        });
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
        void this.panel.webview.postMessage({
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
                return this.dispatchConnections(method, args);
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

    private async dispatchConnections(method: string, args: unknown[] = []): Promise<unknown> {
        if (method === "getConnections") {
            return Promise.all(Array.from({ length: this.connectionSlots.max }, async (_id, index) => this.toToolSafeConnection(await this.getConnection(index))));
        }

        if (method === "getConnection") {
            const target = normalizeConnectionTarget((args[0] ?? "primary") as ConnectionTarget);
            if (target >= this.connectionSlots.max) throw new Error(`Connection slot ${target + 1} is outside this tool's declared connection range.`);
            return this.toToolSafeConnection(await this.getConnection(target));
        }

        if (method === "getActiveConnection") {
            const connection = await this.getConnection(0);
            return this.toToolSafeConnection(connection);
        }

        if (method === "getSecondaryConnection") {
            const connection = await this.getConnection(1);
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
            case "openInConnectionBrowser":
            case "openExternal": {
                const urlText = typeof args[0] === "string" ? args[0] : "";
                const parsed = vscode.Uri.parse(urlText);
                if (!["http", "https"].includes(parsed.scheme)) {
                    throw new Error("Only http/https URLs are supported.");
                }
                if (method === "openInConnectionBrowser") {
                    const target = normalizeConnectionTarget((args[1] ?? "primary") as ConnectionTarget);
                    if (target >= this.connectionSlots.max) throw new Error(`Connection slot ${target + 1} is outside this tool's declared connection range.`);
                    if (!(await this.getConnection(target))) throw new Error(`No connection available for ${connectionTargetLabel(target)}.`);
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

    private toolSettingsKey(): string {
        const toolId = this.toolContext.toolId ?? "unknown-tool";
        return `${TOOL_SETTINGS_KEY_PREFIX}${toolId}`;
    }

    private async dispatchSettings(method: string, args: unknown[]): Promise<unknown> {
        const toolId = this.toolContext.toolId ?? "unknown-tool";
        const existing = this.context.globalState.get<Record<string, unknown>>(this.toolSettingsKey(), {});

        switch (method) {
            case "getAll":
                return { ...existing };
            case "get":
                return existing[String(args[0])];
            case "set": {
                const key = String(args[0]);
                const value = args[1];
                await this.context.globalState.update(this.toolSettingsKey(), { ...existing, [key]: value });
                this.pushEvent("settings:updated", { toolId, key });
                return;
            }
            case "setAll": {
                const value = args[0] && typeof args[0] === "object" ? (args[0] as Record<string, unknown>) : {};
                await this.context.globalState.update(this.toolSettingsKey(), value);
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
        const connectionTarget = normalizeConnectionTarget(hasConnectionTargetArg ? (args[args.length - 1] as ConnectionTarget) : "primary");
        if (connectionTarget >= this.connectionSlots.max) throw new Error(`Connection slot ${connectionTarget + 1} is outside this tool's declared connection range.`);
        const trimmedArgs = hasConnectionTargetArg ? args.slice(0, -1) : args;
        const callerObjectId = this.impersonatedUsers[connectionTarget]?.azureactivedirectoryobjectid;

        const connection = await this.getConnection(connectionTarget);
        if (!connection) {
            throw new Error(`No connection available for ${connectionTargetLabel(connectionTarget)}.`);
        }

        return this.dataverseManager.withImpersonation(callerObjectId, () => Promise.resolve((fn as (...params: unknown[]) => unknown).apply(this.dataverseManager, [connection, ...trimmedArgs])));
    }

    private hasConnectionTargetArg(args: unknown[]): boolean {
        if (args.length === 0) {
            return false;
        }

        const lastArg = args[args.length - 1];
        return lastArg === "primary" || lastArg === "secondary" || (typeof lastArg === "number" && Number.isInteger(lastArg) && lastArg >= 0);
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

        const target = normalizeConnectionTarget((connectionTarget ?? "primary") as ConnectionTarget);
        if (target >= this.connectionSlots.max) throw new Error(`Connection slot ${target + 1} is outside this tool's declared connection range.`);
        const connection = await this.getConnection(target);
        if (!connection) throw new Error(`No connection available for ${connectionTargetLabel(target)}.`);

        return this.powerPlatformManager.requestWithConnection(connection, namespace, httpMethod, typeof pathArg === "string" ? pathArg : "", body, (headers as Record<string, string>) ?? {});
    }

    private async getToolContext(): Promise<ToolContext> {
        const connections = await Promise.all((this.toolContext.connectionIds ?? []).map((_id, index) => this.getConnection(index)));
        const connectionIds = this.toolContext.connectionIds ?? [];
        while (connections.length < this.connectionSlots.max) connections.push(undefined);

        const nextContext: ToolContext = {
            ...this.toolContext,
            connectionIds: connections.map((connection, index) => connection?.id ?? connectionIds[index] ?? null),
            connectionUrls: connections.map((connection, index) => connection?.url ?? this.toolContext.connectionUrls?.[index] ?? null),
            connectionId: connections[0]?.id ?? null,
            connectionUrl: connections[0]?.url ?? null,
            secondaryConnectionId: connections[1]?.id ?? null,
            secondaryConnectionUrl: connections[1]?.url ?? null,
        };

        this.toolContext = nextContext;
        return nextContext;
    }

    private async getConnection(target: ConnectionTarget): Promise<Connection | undefined> {
        if (!this.connectionsManager) {
            return undefined;
        }

        const index = normalizeConnectionTarget(target);
        const ids = this.toolContext.connectionIds;
        const id = ids ? (ids[index] ?? null) : index === 0 ? this.toolContext.connectionId : index === 1 ? this.toolContext.secondaryConnectionId : null;

        if (typeof id === "string" && id.length > 0) {
            return this.connectionsManager.getWithSecrets(id);
        }

        if (index === 0 && !ids) {
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
        if (!next?.connectionIds) {
            if (next?.connectionId !== undefined && next.connectionId !== this.toolContext.connectionId) delete this.impersonatedUsers[0];
            if (next?.secondaryConnectionId !== undefined && next.secondaryConnectionId !== this.toolContext.secondaryConnectionId) delete this.impersonatedUsers[1];
        }

        const connectionIds: ConnectionIds = next?.connectionIds
            ? Array.from({ length: this.connectionSlots.max }, (_, index) => next.connectionIds![index] ?? null)
            : Array.from({ length: this.connectionSlots.max }, (_, index) => this.toolContext.connectionIds?.[index] ?? (index === 0 ? this.toolContext.connectionId : index === 1 ? this.toolContext.secondaryConnectionId : null) ?? null);
        if (next?.connectionIds) {
            for (let index = 0; index < connectionIds.length; index++) {
                if (connectionIds[index] !== (this.toolContext.connectionIds?.[index] ?? null)) delete this.impersonatedUsers[index];
            }
        }
        const connectionUrls: Array<string | null> = next?.connectionUrls
            ? Array.from({ length: this.connectionSlots.max }, (_, index) => next.connectionUrls![index] ?? null)
            : Array.from({ length: this.connectionSlots.max }, (_, index) => {
                  const connectionChanged = next?.connectionIds && next.connectionIds[index] !== this.toolContext.connectionIds?.[index];
                  if (connectionChanged) return null;
                  return this.toolContext.connectionUrls?.[index] ?? (index === 0 ? this.toolContext.connectionUrl : index === 1 ? this.toolContext.secondaryConnectionUrl : null) ?? null;
              });
        if (next?.connectionId !== undefined && !next.connectionIds) connectionIds[0] = next.connectionId;
        if (next?.secondaryConnectionId !== undefined && !next.connectionIds) connectionIds[1] = next.secondaryConnectionId;
        if (next?.connectionUrl !== undefined && !next.connectionUrls) connectionUrls[0] = next.connectionUrl;
        if (next?.secondaryConnectionUrl !== undefined && !next.connectionUrls) connectionUrls[1] = next.secondaryConnectionUrl;

        this.toolContext = {
            ...this.toolContext,
            ...(next ?? {}),
            connectionIds: connectionIds.slice(0, this.connectionSlots.max),
            connectionUrls: connectionUrls.slice(0, this.connectionSlots.max),
            toolId: typeof next?.toolId === "string" || next?.toolId === null ? next.toolId : this.toolContext.toolId,
            connectionUrl: typeof next?.connectionUrl === "string" || next?.connectionUrl === null ? next.connectionUrl : this.toolContext.connectionUrl,
            connectionId: typeof next?.connectionId === "string" || next?.connectionId === null ? next.connectionId : this.toolContext.connectionId,
            secondaryConnectionUrl: typeof next?.secondaryConnectionUrl === "string" || next?.secondaryConnectionUrl === null ? next.secondaryConnectionUrl : this.toolContext.secondaryConnectionUrl,
            secondaryConnectionId: typeof next?.secondaryConnectionId === "string" || next?.secondaryConnectionId === null ? next.secondaryConnectionId : this.toolContext.secondaryConnectionId,
        };

        this.toolContext.connectionId = this.toolContext.connectionIds?.[0] ?? null;
        this.toolContext.connectionUrl = this.toolContext.connectionUrls?.[0] ?? null;
        this.toolContext.secondaryConnectionId = this.toolContext.connectionIds?.[1] ?? null;
        this.toolContext.secondaryConnectionUrl = this.toolContext.connectionUrls?.[1] ?? null;

        this.updateConnectionStatusBar();
        this.updateImpersonationBanner();

        void this.panel.webview.postMessage({
            source: "pptb-host",
            type: "pptb:context",
            context: this.toolContext,
        });
    }

    private updateConnectionStatusBar(): void {
        const statusBar = this.connectionStatusBar;
        if (!statusBar) return;

        if (!this.panel.active || !this.connectionsManager) {
            statusBar.hide();
            return;
        }

        const slots = Array.from({ length: this.connectionSlots.max }, (_, index) => {
            const id = this.toolContext.connectionIds?.[index] ?? null;
            const connection = id ? this.connectionsManager!.getById(id) : undefined;
            return {
                index,
                connectionId: id,
                connectionName: connection?.name,
                impersonatedUserName: this.impersonatedUsers[index]?.fullname,
            };
        });
        const summary = formatConnectionStatus(slots, this.connectionSlots.max);
        statusBar.text = summary.text;
        statusBar.tooltip = summary.tooltip;
        statusBar.show();
    }

    private async showConnectionSlotPicker(): Promise<void> {
        if (!this.connectionsManager || this.connectionSlots.max === 0) return;

        const items: Array<vscode.QuickPickItem & { slotIndex: number }> = Array.from({ length: this.connectionSlots.max }, (_, index) => {
            const id = this.toolContext.connectionIds?.[index];
            const connection = id ? this.connectionsManager!.getById(id) : undefined;
            return {
                label: `${connectionTargetLabel(index)}: ${connection?.name ?? "Not set"}`,
                description: `Slot ${index + 1}${index < this.connectionSlots.min ? " · required" : " · optional"}`,
                detail: connection?.url ?? "Choose a connection",
                slotIndex: index,
            };
        });
        const impersonationItems = (this.toolContext.connectionIds ?? []).flatMap((id, index) => id ? [{
            label: `$(person) ${connectionTargetLabel(index)} impersonation: ${this.impersonatedUsers[index]?.fullname ?? "No impersonation"}`,
            description: `Manage Dataverse impersonation for ${connectionTargetLabel(index)}`,
            slotIndex: index,
            impersonation: true as const,
        }] : []);
        const addSlotItem = this.connectionSlots.max > 0 && this.connectionSlots.min === 0 && !this.toolContext.connectionIds?.some(Boolean)
            ? [{ label: "$(add) Assign a connection", description: "Choose a connection for this optional tool", slotIndex: 0, addSlot: true as const }]
            : [];
        const picked = await vscode.window.showQuickPick([...items, ...impersonationItems, ...addSlotItem], { title: "Manage Tool Connections", placeHolder: "Select a slot to change, clear, or manage impersonation" });
        if (!picked) return;
        const index = picked.slotIndex;
        if ("addSlot" in picked) {
            const candidates = this.connectionsManager.getAll().filter((connection) => !connection.hasIncompleteCredentials && (!this.requirePowerPlatformApi || connection.enabledForPowerPlatformAPI));
            const selected = await vscode.window.showQuickPick(candidates.map((connection) => ({ label: connection.name, description: connection.url, connectionId: connection.id })), {
                title: `Select ${connectionTargetLabel(index)} connection`,
                placeHolder: "Choose an environment connection",
            });
            if (!selected) return;
            const connectionIds: ConnectionIds = Array.from({ length: this.connectionSlots.max }, (_, slotIndex) => this.toolContext.connectionIds?.[slotIndex] ?? null);
            connectionIds[index] = selected.connectionId;
            const connectionUrls = await Promise.all(connectionIds.map(async (id) => (id ? this.connectionsManager!.getById(id)?.url ?? null : null)));
            this.setToolContext({ connectionIds, connectionUrls });
            this.pushEvent("connection:updated", {});
            return;
        }
        if ("impersonation" in picked) {
            const connection = await this.getConnection(index);
            if (!connection || !this.dataverseManager) return;
            const action = await vscode.window.showQuickPick(["Set or change impersonated user", "Clear impersonation"], { title: `${connectionTargetLabel(index)} Dataverse impersonation` });
            if (action === "Clear impersonation") delete this.impersonatedUsers[index];
            else if (action === "Set or change impersonated user") {
                const user = await ToolPanel.promptImpersonationUser(this.dataverseManager, connection, index);
                if (user) this.impersonatedUsers[index] = user;
                else if (user === null) delete this.impersonatedUsers[index];
            } else return;
            this.updateImpersonationBanner();
            this.updateConnectionStatusBar();
            return;
        }
        const currentId = this.toolContext.connectionIds?.[index] ?? null;
        const candidates = this.connectionsManager.getAll().filter((connection) => !connection.hasIncompleteCredentials && (!this.requirePowerPlatformApi || connection.enabledForPowerPlatformAPI));
        const slotItems: Array<vscode.QuickPickItem & { connectionId?: string | null }> = candidates.map((connection) => ({
            label: connection.name,
            description: connection.url,
            detail: [connection.id === currentId ? "Current selection" : undefined, connection.environment, connection.category].filter(Boolean).join(" · "),
            connectionId: connection.id,
        }));
        if (index >= this.connectionSlots.min) slotItems.push({ label: "$(close) Clear this slot", description: "Leave this optional slot empty", connectionId: null });
        const selected = await vscode.window.showQuickPick(slotItems, {
            title: `Select ${connectionTargetLabel(index)} connection`,
            placeHolder: "Choose an environment connection",
        });
        if (!selected || selected.connectionId === undefined) return;

        const connectionIds: ConnectionIds = Array.from({ length: this.connectionSlots.max }, (_, slotIndex) => this.toolContext.connectionIds?.[slotIndex] ?? null);
        connectionIds[index] = selected.connectionId;
        const connectionUrls = await Promise.all(connectionIds.map(async (id) => (id ? this.connectionsManager!.getById(id)?.url ?? null : null)));
        this.setToolContext({ connectionIds, connectionUrls });
        this.pushEvent("connection:updated", {});
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

        void this.panel.webview.postMessage({
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
