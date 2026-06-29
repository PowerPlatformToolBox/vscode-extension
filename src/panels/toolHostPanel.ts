import * as vscode from "vscode";
import type { ConnectionsManager } from "../managers/connectionsManager";
import type { DataverseManager } from "../managers/dataverseManager";
import type { PowerPlatformManager } from "../managers/powerPlatformManager";
import { ToolManager } from "../managers/toolManager";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import { logger } from "../utils/logger";
import { getNonce } from "../utils/webview";
import { ToolPanel } from "./toolPanel";

type OpenManagers = {
    connectionsManager?: ConnectionsManager;
    dataverseManager?: DataverseManager;
    powerPlatformManager?: PowerPlatformManager;
};

export type ToolHostView = "installed" | "marketplace";

/**
 * Manages the WebviewPanel that shows the "PPTB Tool List".
 * Handles listing installed tools, the marketplace, and launching individual tool panels.
 */
export class ToolHostPanel {
    private static currentPanel: ToolHostPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly toolManager: ToolManager;
    private readonly toolRegistryManager: ToolRegistryManager;
    private readonly managers?: OpenManagers;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, toolRegistryManager: ToolRegistryManager, toolManager: ToolManager, initialView: ToolHostView, managers?: OpenManagers) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.toolManager = toolManager;
        this.toolRegistryManager = toolRegistryManager;
        this.managers = managers;

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, initialView);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            (message: { type: string; toolId?: string; search?: string; page?: number }) => {
                this.handleMessage(message).catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error("ToolHostPanel message handler error:", msg);
                });
            },
            null,
            this.disposables,
        );
    }

    /**
     * Open (or reveal) the tool list panel, switching to the requested view.
     */
    static open(extensionUri: vscode.Uri, toolRegistryManager: ToolRegistryManager, toolManager: ToolManager, initialView: ToolHostView = "installed", managers?: OpenManagers): void {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;

        if (ToolHostPanel.currentPanel) {
            ToolHostPanel.currentPanel.panel.reveal(column ?? vscode.ViewColumn.One);
            // Switch to the requested tab in the already-open panel
            void ToolHostPanel.currentPanel.panel.webview.postMessage({ type: "set-active-view", view: initialView });
            return;
        }

        const panel = vscode.window.createWebviewPanel("pptb.toolHostPanel", "PPTB Tool List", column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webviews")],
            retainContextWhenHidden: true,
        });

        ToolHostPanel.currentPanel = new ToolHostPanel(panel, extensionUri, toolRegistryManager, toolManager, initialView, managers);
    }

    dispose(): void {
        ToolHostPanel.currentPanel = undefined;
        this.panel.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    private async handleMessage(message: { type: string; toolId?: string; search?: string; page?: number }): Promise<void> {
        switch (message.type) {
            case "get-installed-tools": {
                const installedTools = this.toolManager.getAll();
                this.panel.webview.postMessage({
                    type: "installed-tools",
                    tools: installedTools,
                });
                break;
            }
            case "get-marketplace-tools": {
                try {
                    const result = await this.toolRegistryManager.getTools({
                        search: message.search,
                        page: message.page ?? 1,
                    });
                    const installedIds = new Set(this.toolManager.getAll().map((t) => t.id));
                    this.panel.webview.postMessage({
                        type: "marketplace-tools",
                        tools: result.tools,
                        total: result.total,
                        installedIds: [...installedIds],
                    });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error("ToolHostPanel get-marketplace-tools error:", msg);
                    this.panel.webview.postMessage({ type: "marketplace-error", message: msg });
                }
                break;
            }
            case "launch-tool": {
                const toolId = message.toolId;
                if (toolId) {
                    ToolPanel.open(this.extensionUri, toolId, this.toolManager, this.toolRegistryManager, this.managers);
                }
                break;
            }
            case "install-tool": {
                const toolId = message.toolId;
                if (!toolId) {
                    break;
                }
                const registryTool = await this.toolRegistryManager.getToolById(toolId).catch(() => null);
                if (!registryTool) {
                    this.panel.webview.postMessage({ type: "install-error", toolId, message: "Tool not found in registry." });
                    break;
                }
                try {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installing "${registryTool.name}"…`, cancellable: false }, (progress) =>
                        this.toolManager.install(registryTool, (msg) => progress.report({ message: msg })),
                    );
                    vscode.window.showInformationMessage(`"${registryTool.name}" installed successfully.`);
                    this.panel.webview.postMessage({ type: "install-done", toolId });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`Install failed: ${msg}`);
                    this.panel.webview.postMessage({ type: "install-error", toolId, message: msg });
                }
                break;
            }
            case "uninstall-tool": {
                const toolId = message.toolId;
                if (!toolId) {
                    break;
                }
                const tool = this.toolManager.getAll().find((t) => t.id === toolId);
                const name = tool?.name ?? toolId;
                const confirm = await vscode.window.showWarningMessage(`Uninstall "${name}"? This cannot be undone.`, { modal: true }, "Uninstall");
                if (confirm === "Uninstall") {
                    await this.toolManager.uninstall(toolId);
                    vscode.window.showInformationMessage(`"${name}" uninstalled.`);
                    this.panel.webview.postMessage({ type: "uninstall-done", toolId });
                }
                break;
            }
            default:
                logger.warn("ToolHostPanel: unrecognised message type:", message.type);
                break;
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, initialView: ToolHostView): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "toolHost.js"));

        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data: blob:; font-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https:;">
  <title>PPTB Tool List</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__pptbInitialView = "${initialView}";</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
