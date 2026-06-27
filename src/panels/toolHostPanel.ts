import * as vscode from "vscode";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import { ToolManager } from "../managers/toolManager";

/**
 * Manages the WebviewPanel that hosts the React tool browser / host UI.
 */
export class ToolHostPanel {
  private static currentPanel: ToolHostPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly toolRegistryManager: ToolRegistryManager;
  private readonly toolManager: ToolManager;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    toolRegistryManager: ToolRegistryManager,
    toolManager: ToolManager
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.toolRegistryManager = toolRegistryManager;
    this.toolManager = toolManager;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: { type: string; [key: string]: unknown }) => {
        this.handleMessage(message).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("ToolHostPanel message handler error:", msg);
        });
      },
      null,
      this.disposables
    );
  }

  /**
   * Open (or reveal) the tool host panel.
   */
  static open(
    extensionUri: vscode.Uri,
    toolRegistryManager: ToolRegistryManager,
    toolManager: ToolManager
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
        ],
        retainContextWhenHidden: true,
      }
    );

    ToolHostPanel.currentPanel = new ToolHostPanel(
      panel,
      extensionUri,
      toolRegistryManager,
      toolManager
    );
  }

  dispose(): void {
    ToolHostPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleMessage(message: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (message.type) {
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

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "toolHost.js")
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
