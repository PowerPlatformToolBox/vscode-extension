import * as vscode from "vscode";
import { ConnectionsManager } from "../managers/connectionsManager";
import { CspConsentManager } from "../managers/cspConsentManager";
import { DataverseManager } from "../managers/dataverseManager";
import type { IconCacheManager } from "../managers/iconCacheManager";
import { ToolManager } from "../managers/toolManager";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import { CspPermissionsPanel } from "../panels/cspPermissionsPanel";
import { ToolHostPanel } from "../panels/toolHostPanel";
import { ToolPanel } from "../panels/toolPanel";
import { InstalledToolsTreeDataProvider, InstalledToolTreeItem, type InstalledToolsSortOption } from "../providers/installedToolsTreeDataProvider";
import { MarketplaceToolTreeItem, MarketplaceTreeDataProvider, type MarketplaceSortOption } from "../providers/marketplaceTreeDataProvider";

export function registerToolCommands(
    context: vscode.ExtensionContext,
    toolManager: ToolManager,
    toolRegistryManager: ToolRegistryManager,
    connectionsManager: ConnectionsManager,
    dataverseManager: DataverseManager,
    installedToolsProvider: InstalledToolsTreeDataProvider,
    marketplaceProvider: MarketplaceTreeDataProvider,
    iconCacheManager: IconCacheManager,
    cspConsentManager: CspConsentManager,
): vscode.Disposable[] {
    const refreshInstalledCmd = vscode.commands.registerCommand("pptb.tools.refresh", () => installedToolsProvider.refresh());

    const uninstallToolCmd = vscode.commands.registerCommand("pptb.tools.uninstall", async (item?: InstalledToolTreeItem) => {
        if (!item?.tool) {
            vscode.window.showWarningMessage("No tool selected to uninstall.");
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Uninstall "${item.tool.name}"? This cannot be undone.`, { modal: true }, "Uninstall");
        if (confirm === "Uninstall") {
            await toolManager.uninstall(item.tool.id);
            vscode.window.showInformationMessage(`"${item.tool.name}" uninstalled.`);
        }
    });

    const refreshMarketplaceCmd = vscode.commands.registerCommand("pptb.marketplace.refresh", () => marketplaceProvider.refresh());

    const launchToolCmd = vscode.commands.registerCommand("pptb.tools.launch", (item?: InstalledToolTreeItem) => {
        if (!item?.tool.id) {
            return;
        }
        ToolPanel.open(context.extensionUri, context, item.tool.id, toolManager, toolRegistryManager, cspConsentManager, { connectionsManager, dataverseManager });
    });

    const revokeCspConsentCmd = vscode.commands.registerCommand("pptb.tools.revokeCspConsent", async (item?: InstalledToolTreeItem) => {
        if (!item?.tool) {
            vscode.window.showWarningMessage("No tool selected.");
            return;
        }
        if (!cspConsentManager.hasStoredConsent(item.tool.id)) {
            vscode.window.showInformationMessage(`"${item.tool.name}" has no granted CSP permissions to revoke.`);
            return;
        }
        await cspConsentManager.revoke(item.tool.id);
        vscode.window.showInformationMessage(`CSP consent revoked for "${item.tool.name}". You'll be prompted again the next time it's launched.`);
    });

    const managePermissionsCmd = vscode.commands.registerCommand("pptb.tools.managePermissions", () => {
        CspPermissionsPanel.open(context.extensionUri, toolManager, cspConsentManager, iconCacheManager);
    });

    const browseToolsCmd = vscode.commands.registerCommand("pptb.tools.browse", () => {
        ToolHostPanel.open(context.extensionUri, context, toolRegistryManager, toolManager, installedToolsProvider, marketplaceProvider, iconCacheManager, cspConsentManager, "installed", {
            connectionsManager,
            dataverseManager,
        });
    });

    const browseMarketplaceCmd = vscode.commands.registerCommand("pptb.marketplace.browse", () => {
        ToolHostPanel.open(context.extensionUri, context, toolRegistryManager, toolManager, installedToolsProvider, marketplaceProvider, iconCacheManager, cspConsentManager, "marketplace", {
            connectionsManager,
            dataverseManager,
        });
    });

    const marketplaceUninstallCmd = vscode.commands.registerCommand("pptb.marketplace.uninstall", async (item?: MarketplaceToolTreeItem) => {
        if (!item?.registryTool) {
            vscode.window.showWarningMessage("No tool selected.");
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Uninstall "${item.registryTool.name}"? This cannot be undone.`, { modal: true }, "Uninstall");
        if (confirm === "Uninstall") {
            await toolManager.uninstall(item.registryTool.id);
            vscode.window.showInformationMessage(`"${item.registryTool.name}" uninstalled.`);
        }
    });

    const installToolCmd = vscode.commands.registerCommand("pptb.marketplace.install", async (item?: MarketplaceToolTreeItem) => {
        if (!item?.registryTool) {
            vscode.window.showWarningMessage("No tool selected to install.");
            return;
        }
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Installing "${item.registryTool.name}"…`,
                    cancellable: false,
                },
                (progress) => toolManager.install(item.registryTool!, (message) => progress.report({ message })),
            );
            vscode.window.showInformationMessage(`"${item.registryTool.name}" installed successfully.`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const action = await vscode.window.showErrorMessage(`Install failed: ${msg}`, "Report Bug");
            if (action === "Report Bug") {
                await vscode.commands.executeCommand("pptb.help.reportBug");
            }
        }
    });

    const addFavoriteCmd = vscode.commands.registerCommand("pptb.tools.addFavorite", async (item?: InstalledToolTreeItem) => {
        if (!item?.tool) {
            return;
        }
        await toolManager.toggleFavorite(item.tool.id);
    });

    const removeFavoriteCmd = vscode.commands.registerCommand("pptb.tools.removeFavorite", async (item?: InstalledToolTreeItem) => {
        if (!item?.tool) {
            return;
        }
        await toolManager.toggleFavorite(item.tool.id);
    });

    const sortAndFilterInstalledCmd = vscode.commands.registerCommand("pptb.tools.sortAndFilter", async () => {
        const currentSort = installedToolsProvider.getSortOption();
        const currentFilter = installedToolsProvider.getFilterState();

        interface ActionPick extends vscode.QuickPickItem {
            apply?: () => Thenable<void>;
        }

        const sortOptions: { label: string; value: InstalledToolsSortOption }[] = [
            { label: "Favorite", value: "favorite" },
            { label: "Name (A-Z)", value: "name-asc" },
            { label: "Name (Z-A)", value: "name-desc" },
            { label: "Popularity", value: "popularity" },
            { label: "Highly Rated", value: "rating" },
            { label: "Most Downloaded", value: "downloads" },
            { label: "Verified", value: "verified" },
        ];

        const items: ActionPick[] = [
            { label: "Sort", kind: vscode.QuickPickItemKind.Separator },
            ...sortOptions.map((o) => ({
                label: o.value === currentSort ? `$(check) ${o.label}` : o.label,
                apply: () => installedToolsProvider.setSortOption(o.value),
            })),
            { label: "Filter", kind: vscode.QuickPickItemKind.Separator },
            {
                label: currentFilter.verifiedOnly ? "$(check) Verified Only" : "Verified Only",
                apply: () => installedToolsProvider.setFilterState({ ...currentFilter, verifiedOnly: !currentFilter.verifiedOnly }),
            },
            {
                label: !currentFilter.category ? "$(check) All Categories" : "All Categories",
                apply: () => installedToolsProvider.setFilterState({ ...currentFilter, category: undefined }),
            },
            ...installedToolsProvider.getAvailableCategories().map((c) => ({
                label: currentFilter.category === c ? `$(check) Category: ${c}` : `Category: ${c}`,
                apply: () => installedToolsProvider.setFilterState({ ...currentFilter, category: c }),
            })),
        ];

        const picked = await vscode.window.showQuickPick(items, { placeHolder: "Sort or filter installed tools…" });
        await picked?.apply?.();
    });

    const sortAndFilterMarketplaceCmd = vscode.commands.registerCommand("pptb.marketplace.sortAndFilter", async () => {
        const currentSort = marketplaceProvider.getSortOption();
        const currentFilter = marketplaceProvider.getFilterState();

        interface ActionPick extends vscode.QuickPickItem {
            apply?: () => Thenable<void>;
        }

        const sortOptions: { label: string; value: MarketplaceSortOption }[] = [
            { label: "Name (A-Z)", value: "name-asc" },
            { label: "Name (Z-A)", value: "name-desc" },
            { label: "Popularity", value: "popularity" },
            { label: "Highly Rated", value: "rating" },
            { label: "Most Downloaded", value: "downloads" },
            { label: "Verified", value: "verified" },
        ];

        const items: ActionPick[] = [
            { label: "Sort", kind: vscode.QuickPickItemKind.Separator },
            ...sortOptions.map((o) => ({
                label: o.value === currentSort ? `$(check) ${o.label}` : o.label,
                apply: () => marketplaceProvider.setSortOption(o.value),
            })),
            { label: "Filter", kind: vscode.QuickPickItemKind.Separator },
            {
                label: currentFilter.verifiedOnly ? "$(check) Verified Only" : "Verified Only",
                apply: () => marketplaceProvider.setFilterState({ ...currentFilter, verifiedOnly: !currentFilter.verifiedOnly }),
            },
            {
                label: !currentFilter.category ? "$(check) All Categories" : "All Categories",
                apply: () => marketplaceProvider.setFilterState({ ...currentFilter, category: undefined }),
            },
            ...marketplaceProvider.getAvailableCategories().map((c) => ({
                label: currentFilter.category === c ? `$(check) Category: ${c}` : `Category: ${c}`,
                apply: () => marketplaceProvider.setFilterState({ ...currentFilter, category: c }),
            })),
        ];

        const picked = await vscode.window.showQuickPick(items, { placeHolder: "Sort or filter marketplace tools…" });
        await picked?.apply?.();
    });

    return [
        refreshInstalledCmd,
        uninstallToolCmd,
        refreshMarketplaceCmd,
        launchToolCmd,
        revokeCspConsentCmd,
        managePermissionsCmd,
        browseToolsCmd,
        browseMarketplaceCmd,
        marketplaceUninstallCmd,
        installToolCmd,
        addFavoriteCmd,
        removeFavoriteCmd,
        sortAndFilterInstalledCmd,
        sortAndFilterMarketplaceCmd,
    ];
}
