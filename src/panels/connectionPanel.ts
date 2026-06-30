import * as vscode from "vscode";
import type { Connection, ConnectionsManager } from "../managers/connectionsManager";
import { getNonce } from "../utils/webview";

/**
 * Manages the WebviewPanel that hosts the React connection wizard.
 */
export class ConnectionPanel {
    private static currentPanel: ConnectionPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly connectionsManager: ConnectionsManager;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        connectionsManager: ConnectionsManager,
        connection: Connection | undefined,
        categories: string[],
        categoryColors: Record<string, string>,
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.connectionsManager = connectionsManager;

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            (message: { type: string; connection?: Connection; category?: string }) => {
                this.handleMessage(message);
            },
            null,
            this.disposables,
        );

        // Send initial data once the webview signals it is ready
        // We use a short delay to allow React to mount
        setTimeout(() => {
            this.panel.webview.postMessage({
                type: "pptb:init",
                connection,
                categories,
                categoryColors,
            });
        }, 300);
    }

    /**
     * Open (or reveal) the connection panel.
     * Pass undefined for a new connection, or a Connection object to edit.
     * Secrets are loaded from SecretStorage so the form is fully pre-populated.
     */
    static async open(extensionUri: vscode.Uri, connectionsManager: ConnectionsManager, connection?: Connection): Promise<void> {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;

        // Load full connection with secrets for editing
        let connectionWithSecrets = connection;
        if (connection?.id) {
            connectionWithSecrets = (await connectionsManager.getWithSecrets(connection.id)) ?? connection;
        }
        const categories = connectionsManager.getCategories();
        const categoryColors = connectionsManager.getCategoryColors();

        if (ConnectionPanel.currentPanel) {
            ConnectionPanel.currentPanel.panel.reveal(column ?? vscode.ViewColumn.One);
            ConnectionPanel.currentPanel.panel.webview.postMessage({
                type: "pptb:init",
                connection: connectionWithSecrets,
                categories,
                categoryColors,
            });
            return;
        }

        const panel = vscode.window.createWebviewPanel("pptb.connectionPanel", connection ? `Edit Connection — ${connection.name}` : "Add Connection", column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webviews")],
            retainContextWhenHidden: true,
        });

        ConnectionPanel.currentPanel = new ConnectionPanel(panel, extensionUri, connectionsManager, connectionWithSecrets, categories, categoryColors);
    }

    dispose(): void {
        ConnectionPanel.currentPanel = undefined;
        this.panel.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    // ---------------------------------------------------------------------------
    // Message handling
    // ---------------------------------------------------------------------------

    private handleMessage(message: { type: string; connection?: Connection; category?: string }): void {
        switch (message.type) {
            case "pptb:save":
                if (message.connection) {
                    void this.handleSave(message.connection);
                }
                break;
            case "pptb:test":
                if (message.connection) {
                    void this.handleTest(message.connection);
                }
                break;
            case "pptb:cancel":
                this.dispose();
                break;
        }
    }

    private async handleSave(connection: Connection): Promise<void> {
        try {
            // Persist the category (and its color) so it is available for future connections
            if (connection.category) {
                await this.connectionsManager.saveCategory(connection.category, connection.categoryColor);
            }

            const existing = this.connectionsManager.getById(connection.id);
            if (existing) {
                await this.connectionsManager.update(connection);
            } else {
                await this.connectionsManager.add(connection);
            }
            vscode.window.showInformationMessage(`Connection "${connection.name}" saved.`);
            this.dispose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to save connection: ${message}`);
        }
    }

    private async handleTest(connection: Connection): Promise<void> {
        try {
            const success = await this.connectionsManager.testConnection(connection);
            this.panel.webview.postMessage({
                type: "pptb:testResult",
                success,
                error: success ? undefined : "Connection test failed",
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.panel.webview.postMessage({
                type: "pptb:testResult",
                success: false,
                error: message,
            });
        }
    }

    // ---------------------------------------------------------------------------
    // HTML generation
    // ---------------------------------------------------------------------------

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "connection.js"));

        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; connect-src ${webview.cspSource};">
  <title>Connection</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
