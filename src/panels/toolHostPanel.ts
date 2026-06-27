import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import { ToolManager } from "../managers/toolManager";
import { TerminalManager } from "../managers/terminalManager";
import type { ConnectionsManager, Connection } from "../managers/connectionsManager";
import type { DataverseManager } from "../managers/dataverseManager";
import type { PowerPlatformManager } from "../managers/powerPlatformManager";
import { getNonce } from "../utils/webview";

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
 * Manages the WebviewPanel that hosts the React tool browser / host UI.
 */
export class ToolHostPanel {
  private static currentPanel: ToolHostPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly toolRegistryManager: ToolRegistryManager;
  private readonly toolManager: ToolManager;
  private readonly connectionsManager?: ConnectionsManager;
  private readonly dataverseManager?: DataverseManager;
  private readonly powerPlatformManager?: PowerPlatformManager;

  private toolContext: ToolContext = {
    toolId: null,
    connectionUrl: null,
    connectionId: null,
    secondaryConnectionUrl: null,
    secondaryConnectionId: null,
  };

  private readonly toolSettings = new Map<string, Record<string, unknown>>();
  private readonly terminalManager = new TerminalManager();
  private readonly eventHistory: ToolBoxEventPayload[] = [];
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    toolRegistryManager: ToolRegistryManager,
    toolManager: ToolManager,
    managers?: OpenManagers
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.toolRegistryManager = toolRegistryManager;
    this.toolManager = toolManager;
    this.connectionsManager = managers?.connectionsManager;
    this.dataverseManager = managers?.dataverseManager;
    this.powerPlatformManager = managers?.powerPlatformManager;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage((message: ApiMessage) => {
      this.handleMessage(message).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("ToolHostPanel message handler error:", msg);
      });
    }, null, this.disposables);

    if (this.connectionsManager) {
      this.disposables.push(
        this.connectionsManager.onConnectionsChanged.event(() => {
          this.pushEvent("connection:updated", {});
        })
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
      })
    );
  }

  /**
   * Open (or reveal) the tool host panel.
   */
  static open(
    extensionUri: vscode.Uri,
    toolRegistryManager: ToolRegistryManager,
    toolManager: ToolManager,
    managers?: OpenManagers
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (ToolHostPanel.currentPanel) {
      ToolHostPanel.currentPanel.panel.reveal(column ?? vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "pptb.toolHostPanel",
      "PPTB Tools",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist", "webviews"),
          vscode.Uri.joinPath(extensionUri, "src", "polyfill"),
        ],
        retainContextWhenHidden: true,
      }
    );

    ToolHostPanel.currentPanel = new ToolHostPanel(
      panel,
      extensionUri,
      toolRegistryManager,
      toolManager,
      managers
    );
  }

  dispose(): void {
    ToolHostPanel.currentPanel = undefined;
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
      case "get-known-capability-tags": {
        const tags = await this.toolRegistryManager.getKnownCapabilityTags();
        this.panel.webview.postMessage({
          type: "known-capability-tags",
          tags,
        });
        break;
      }
      case "get-tools": {
        const result = await this.toolRegistryManager.getTools({
          search: typeof message.search === "string" ? message.search : undefined,
          category:
            typeof message.category === "string" ? message.category : undefined,
          page: typeof message.page === "number" ? message.page : undefined,
        });
        this.panel.webview.postMessage({
          type: "tools",
          tools: result.tools,
          total: result.total,
        });
        break;
      }
      case "get-installed-tools": {
        const installedTools = this.toolManager.getAll();
        this.panel.webview.postMessage({
          type: "installed-tools",
          tools: installedTools,
        });
        break;
      }
      default:
        console.warn("ToolHostPanel: unrecognised message type:", message.type);
        break;
    }
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

  private postApiResponse(
    requestId: string,
    success: boolean,
    data?: unknown,
    error?: string
  ): void {
    this.panel.webview.postMessage({
      source: "pptb-host",
      type: "pptb:response",
      requestId,
      success,
      data,
      error,
    });
  }

  private async dispatch(
    namespace: string,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
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
          type:
            stat.type === vscode.FileType.Directory ? "directory" : "file",
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
          ? (args[2] as Array<{ name: string; extensions: string[] }>).reduce<
              Record<string, string[]>
            >((acc, filter) => {
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
          defaultUri: options.defaultPath
            ? vscode.Uri.file(options.defaultPath)
            : undefined,
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
        const value =
          args[0] && typeof args[0] === "object"
            ? (args[0] as Record<string, unknown>)
            : {};
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
        const toolInstanceId =
          this.toolContext.instanceId ?? uuidv4();
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
      const limit =
        typeof limitValue === "number" && Number.isFinite(limitValue)
          ? Math.max(0, Math.floor(limitValue))
          : this.eventHistory.length;
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

  private async dispatchDataverse(
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    if (!this.dataverseManager) {
      throw new Error("Dataverse API is unavailable in this host.");
    }

    if (method === "buildLabel" || method === "getAttributeODataType") {
      const fn = (this.dataverseManager as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") {
        throw new Error(`Unsupported dataverse method: ${method}`);
      }
      return (fn as (...params: unknown[]) => unknown).apply(
        this.dataverseManager,
        args
      );
    }

    const fn = (this.dataverseManager as unknown as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      throw new Error(`Unsupported dataverse method: ${method}`);
    }

    const hasConnectionTargetArg = this.hasConnectionTargetArg(args);
    const connectionTarget = hasConnectionTargetArg
      ? (args[args.length - 1] as "primary" | "secondary")
      : "primary";
    const trimmedArgs = hasConnectionTargetArg ? args.slice(0, -1) : args;

    const connection = await this.getConnection(connectionTarget);
    if (!connection) {
      throw new Error(`No ${connectionTarget} connection available.`);
    }

    return (fn as (...params: unknown[]) => unknown).apply(this.dataverseManager, [
      connection,
      ...trimmedArgs,
    ]);
  }

  private hasConnectionTargetArg(args: unknown[]): boolean {
    if (args.length === 0) {
      return false;
    }

    const lastArg = args[args.length - 1];
    return lastArg === "primary" || lastArg === "secondary";
  }

  private async dispatchPowerPlatform(
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    if (method !== "request") {
      throw new Error(`Unsupported powerplatform method: ${method}`);
    }

    if (!this.powerPlatformManager) {
      throw new Error("Power Platform API is unavailable in this host.");
    }

    const [namespace, httpMethod, path, body, connectionTarget, headers] = args;

    if (typeof namespace !== "string") {
      throw new Error("Power Platform namespace is required.");
    }
    if (
      httpMethod !== "GET" &&
      httpMethod !== "POST" &&
      httpMethod !== "PUT" &&
      httpMethod !== "PATCH" &&
      httpMethod !== "DELETE"
    ) {
      throw new Error("Invalid Power Platform HTTP method.");
    }

    const target =
      connectionTarget === "secondary" ? "secondary" : "primary";

    return this.powerPlatformManager.request(
      namespace,
      httpMethod,
      typeof path === "string" ? path : "",
      body,
      target,
      (headers as Record<string, string>) ?? {}
    );
  }

  private async getToolContext(): Promise<ToolContext> {
    const primary = await this.getConnection("primary");
    const secondary = await this.getConnection("secondary");

    const nextContext: ToolContext = {
      ...this.toolContext,
      connectionId: primary?.id ?? this.toolContext.connectionId ?? null,
      connectionUrl: primary?.url ?? this.toolContext.connectionUrl ?? null,
      secondaryConnectionId:
        secondary?.id ?? this.toolContext.secondaryConnectionId ?? null,
      secondaryConnectionUrl:
        secondary?.url ?? this.toolContext.secondaryConnectionUrl ?? null,
    };

    this.toolContext = nextContext;
    return nextContext;
  }

  private async getConnection(
    target: "primary" | "secondary"
  ): Promise<Connection | undefined> {
    if (!this.connectionsManager) {
      return undefined;
    }

    const id =
      target === "primary"
        ? this.toolContext.connectionId
        : this.toolContext.secondaryConnectionId;

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

  private toToolSafeConnection(
    connection: Connection | undefined
  ): ToolSafeConnection | null {
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
      toolId:
        typeof next?.toolId === "string" || next?.toolId === null
          ? next.toolId
          : this.toolContext.toolId,
      connectionUrl:
        typeof next?.connectionUrl === "string" || next?.connectionUrl === null
          ? next.connectionUrl
          : this.toolContext.connectionUrl,
      connectionId:
        typeof next?.connectionId === "string" || next?.connectionId === null
          ? next.connectionId
          : this.toolContext.connectionId,
      secondaryConnectionUrl:
        typeof next?.secondaryConnectionUrl === "string" ||
        next?.secondaryConnectionUrl === null
          ? next.secondaryConnectionUrl
          : this.toolContext.secondaryConnectionUrl,
      secondaryConnectionId:
        typeof next?.secondaryConnectionId === "string" ||
        next?.secondaryConnectionId === null
          ? next.secondaryConnectionId
          : this.toolContext.secondaryConnectionId,
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

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "toolHost.js")
    );

    const polyfillUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "polyfill", "toolboxAPI.js")
    );

    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <title>PPTB Tools</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${polyfillUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
