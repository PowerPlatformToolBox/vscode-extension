import * as vscode from "vscode";
import type { CspConsentManager } from "../managers/cspConsentManager";
import type { IconCacheManager } from "../managers/iconCacheManager";
import type { InstalledTool, ToolManager } from "../managers/toolManager";
import type { CspExceptions } from "../utils/csp";
import { getNonce } from "../utils/webview";

export interface ToolCspPermissionState {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    contributors?: string[] | string;
    isVerified?: boolean;
    icon?: string | { light: string; dark: string };
    cspExceptions?: CspExceptions;
    hasExceptions: boolean;
    status: "granted" | "pending" | "none";
}

/**
 * Manages the WebviewPanel that displays all tool CSP permissions & consents.
 */
export class CspPermissionsPanel {
    private static currentPanel: CspPermissionsPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly toolManager: ToolManager;
    private readonly cspConsentManager: CspConsentManager;
    private readonly iconCacheManager: IconCacheManager;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, toolManager: ToolManager, cspConsentManager: CspConsentManager, iconCacheManager: IconCacheManager) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.toolManager = toolManager;
        this.cspConsentManager = cspConsentManager;
        this.iconCacheManager = iconCacheManager;

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            (message: { type: string; toolId?: string }) => {
                this.handleMessage(message);
            },
            null,
            this.disposables,
        );

        this.disposables.push(this.iconCacheManager.onIconsCached(() => this.postState()));
        this.disposables.push(this.toolManager.onToolsChanged(() => this.postState()));

        setTimeout(() => {
            this.postState();
        }, 300);
    }

    static open(extensionUri: vscode.Uri, toolManager: ToolManager, cspConsentManager: CspConsentManager, iconCacheManager: IconCacheManager): void {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;

        if (CspPermissionsPanel.currentPanel) {
            CspPermissionsPanel.currentPanel.panel.reveal(column ?? vscode.ViewColumn.One);
            CspPermissionsPanel.currentPanel.postState();
            return;
        }

        const panel = vscode.window.createWebviewPanel("pptb.cspPermissionsPanel", "PPTB — CSP Permissions Review", column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webviews"), vscode.Uri.file(iconCacheManager.cacheDir)],
            retainContextWhenHidden: true,
        });

        CspPermissionsPanel.currentPanel = new CspPermissionsPanel(panel, extensionUri, toolManager, cspConsentManager, iconCacheManager);
    }

    dispose(): void {
        CspPermissionsPanel.currentPanel = undefined;
        this.panel.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    private resolveIconForWebview(iconUrl: string | undefined): string | { light: string; dark: string } | undefined {
        const local = this.iconCacheManager.getLocalUri(iconUrl);
        if (!local) {
            return iconUrl;
        }
        if ("light" in local) {
            return {
                light: this.panel.webview.asWebviewUri(local.light).toString(),
                dark: this.panel.webview.asWebviewUri(local.dark).toString(),
            };
        }
        return this.panel.webview.asWebviewUri(local).toString();
    }

    private getPermissionStates(): ToolCspPermissionState[] {
        const installed = this.toolManager.getAll();

        return installed
            .filter((tool: InstalledTool) => Boolean(tool.cspExceptions && Object.keys(tool.cspExceptions).length > 0))
            .map((tool: InstalledTool): ToolCspPermissionState => {
                const stored = this.cspConsentManager.getConsent(tool.id);
                const status: "granted" | "pending" | "none" = stored ? "granted" : "pending";

                return {
                    id: tool.id,
                    name: tool.name,
                    version: tool.version,
                    description: tool.description,
                    publisher: tool.publisher,
                    contributors: tool.contributors,
                    isVerified: tool.isVerified,
                    icon: this.resolveIconForWebview(tool.icon),
                    cspExceptions: tool.cspExceptions,
                    hasExceptions: true,
                    status,
                };
            });
    }

    private postState(): void {
        const tools = this.getPermissionStates();
        void this.panel.webview.postMessage({
            type: "pptb:csp-state",
            tools,
        });
    }

    private async handleMessage(message: { type: string; toolId?: string }): Promise<void> {
        switch (message.type) {
            case "get-state": {
                this.postState();
                break;
            }
            case "grant-consent": {
                if (message.toolId) {
                    const tool = this.toolManager.getById(message.toolId);
                    if (tool?.cspExceptions) {
                        await this.cspConsentManager.grant(message.toolId, tool.cspExceptions);
                        this.postState();
                    }
                }
                break;
            }
            case "revoke-consent": {
                if (message.toolId) {
                    await this.cspConsentManager.revoke(message.toolId);
                    this.postState();
                }
                break;
            }
            case "revoke-all": {
                await this.cspConsentManager.revokeAll();
                this.postState();
                break;
            }
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "cspPermissions.js"));
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data: blob:; font-src ${webview.cspSource} https: data:;">
  <title>CSP Permissions Review</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
