import * as vscode from "vscode";
import type { ConnectionsManager } from "../managers/connectionsManager";
import type { CspConsentManager } from "../managers/cspConsentManager";
import type { DataverseManager } from "../managers/dataverseManager";
import type { IconCacheManager } from "../managers/iconCacheManager";
import type { PowerPlatformManager } from "../managers/powerPlatformManager";
import { ToolManager } from "../managers/toolManager";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import type { InstalledToolsFilterState, InstalledToolsSortOption, InstalledToolsTreeDataProvider } from "../providers/installedToolsTreeDataProvider";
import type { MarketplaceFilterState, MarketplaceSortOption, MarketplaceTreeDataProvider } from "../providers/marketplaceTreeDataProvider";
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
    private readonly context: vscode.ExtensionContext;
    private readonly toolManager: ToolManager;
    private readonly toolRegistryManager: ToolRegistryManager;
    private readonly installedToolsProvider: InstalledToolsTreeDataProvider;
    private readonly marketplaceProvider: MarketplaceTreeDataProvider;
    private readonly iconCacheManager: IconCacheManager;
    private readonly cspConsentManager: CspConsentManager;
    private readonly managers?: OpenManagers;
    private disposables: vscode.Disposable[] = [];
    private lastMarketplaceSearch: string | undefined;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        toolRegistryManager: ToolRegistryManager,
        toolManager: ToolManager,
        installedToolsProvider: InstalledToolsTreeDataProvider,
        marketplaceProvider: MarketplaceTreeDataProvider,
        iconCacheManager: IconCacheManager,
        cspConsentManager: CspConsentManager,
        initialView: ToolHostView,
        managers?: OpenManagers,
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.context = context;
        this.toolManager = toolManager;
        this.toolRegistryManager = toolRegistryManager;
        this.installedToolsProvider = installedToolsProvider;
        this.marketplaceProvider = marketplaceProvider;
        this.iconCacheManager = iconCacheManager;
        this.cspConsentManager = cspConsentManager;
        this.managers = managers;

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, initialView);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            (message: { type: string; toolId?: string; search?: string; page?: number; sort?: string; filter?: unknown }) => {
                this.handleMessage(message).catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error("ToolHostPanel message handler error:", msg);
                });
            },
            null,
            this.disposables,
        );

        // Re-push tool lists once newly downloaded icons are theme-aware and ready on disk.
        this.disposables.push(this.iconCacheManager.onIconsCached(() => this.refreshIcons()));

        // Keep the webview in sync with sort/filter/favorite changes made from the tree views (and vice versa).
        this.disposables.push(this.installedToolsProvider.onDidChangeTreeData(() => this.postInstalledTools()));
        this.disposables.push(
            this.marketplaceProvider.onDidChangeTreeData(() => {
                if (this.lastMarketplaceSearch !== undefined) {
                    void this.postMarketplaceTools(this.lastMarketplaceSearch || undefined, 1);
                }
            }),
        );
    }

    /**
     * Open (or reveal) the tool list panel, switching to the requested view.
     */
    static open(
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        toolRegistryManager: ToolRegistryManager,
        toolManager: ToolManager,
        installedToolsProvider: InstalledToolsTreeDataProvider,
        marketplaceProvider: MarketplaceTreeDataProvider,
        iconCacheManager: IconCacheManager,
        cspConsentManager: CspConsentManager,
        initialView: ToolHostView = "installed",
        managers?: OpenManagers,
    ): void {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;

        if (ToolHostPanel.currentPanel) {
            ToolHostPanel.currentPanel.panel.reveal(column ?? vscode.ViewColumn.One);
            // Switch to the requested tab in the already-open panel
            void ToolHostPanel.currentPanel.panel.webview.postMessage({ type: "set-active-view", view: initialView });
            return;
        }

        const panel = vscode.window.createWebviewPanel("pptb.toolHostPanel", "PPTB Tool List", column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webviews"), vscode.Uri.file(iconCacheManager.cacheDir)],
            retainContextWhenHidden: true,
        });

        ToolHostPanel.currentPanel = new ToolHostPanel(
            panel,
            extensionUri,
            context,
            toolRegistryManager,
            toolManager,
            installedToolsProvider,
            marketplaceProvider,
            iconCacheManager,
            cspConsentManager,
            initialView,
            managers,
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

    private async handleMessage(message: { type: string; toolId?: string; search?: string; page?: number; sort?: string; filter?: unknown }): Promise<void> {
        switch (message.type) {
            case "get-installed-tools": {
                this.postInstalledTools();
                break;
            }
            case "get-marketplace-tools": {
                this.lastMarketplaceSearch = message.search ?? "";
                await this.postMarketplaceTools(message.search, message.page ?? 1);
                break;
            }
            case "set-installed-sort": {
                await this.installedToolsProvider.setSortOption(message.sort as InstalledToolsSortOption);
                break;
            }
            case "set-installed-filter": {
                await this.installedToolsProvider.setFilterState((message.filter as InstalledToolsFilterState) ?? {});
                break;
            }
            case "set-marketplace-sort": {
                await this.marketplaceProvider.setSortOption(message.sort as MarketplaceSortOption);
                break;
            }
            case "set-marketplace-filter": {
                await this.marketplaceProvider.setFilterState((message.filter as MarketplaceFilterState) ?? {});
                break;
            }
            case "toggle-favorite": {
                const toolId = message.toolId;
                if (toolId) {
                    await this.toolManager.toggleFavorite(toolId);
                }
                break;
            }
            case "launch-tool": {
                const toolId = message.toolId;
                if (toolId) {
                    ToolPanel.open(this.extensionUri, this.context, toolId, this.toolManager, this.toolRegistryManager, this.cspConsentManager, this.managers);
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

    private postInstalledTools(): void {
        const installedTools = this.installedToolsProvider.applyFilterAndSort(this.toolManager.getAll());
        const favorites = this.toolManager.getFavorites();
        this.panel.webview.postMessage({
            type: "installed-tools",
            tools: installedTools.map((t) => ({ ...t, icon: this.resolveIconForWebview(t.icon) })),
            categories: this.installedToolsProvider.getAvailableCategories(),
            sort: this.installedToolsProvider.getSortOption(),
            filter: this.installedToolsProvider.getFilterState(),
            favorites,
        });
    }

    private async postMarketplaceTools(search: string | undefined, page: number): Promise<void> {
        try {
            const result = await this.toolRegistryManager.getTools({ search, page });
            const filteredSorted = this.marketplaceProvider.applyFilterAndSort(result.tools);
            const installedIds = new Set(this.toolManager.getAll().map((t) => t.id));
            this.panel.webview.postMessage({
                type: "marketplace-tools",
                tools: filteredSorted.map((t) => ({ ...t, icon: this.resolveIconForWebview(t.icon) })),
                total: result.total,
                installedIds: [...installedIds],
                categories: this.marketplaceProvider.getAvailableCategories(),
                sort: this.marketplaceProvider.getSortOption(),
                filter: this.marketplaceProvider.getFilterState(),
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("ToolHostPanel get-marketplace-tools error:", msg);
            this.panel.webview.postMessage({ type: "marketplace-error", message: msg });
        }
    }

    /**
     * Re-sends the currently visible tool lists once the icon cache finishes downloading/theming
     * icons, so the webview swaps in theme-aware icons the same way the tree views do.
     */
    private refreshIcons(): void {
        this.postInstalledTools();
        if (this.lastMarketplaceSearch !== undefined) {
            void this.postMarketplaceTools(this.lastMarketplaceSearch || undefined, 1);
        }
    }

    /**
     * Resolves a tool's raw icon URL to theme-aware webview URIs backed by the local icon cache,
     * mirroring `IconCacheManager.getLocalUri` usage in the tree data providers. Falls back to the
     * original remote URL (non-theme-aware) until the icon has been downloaded and cached.
     */
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
