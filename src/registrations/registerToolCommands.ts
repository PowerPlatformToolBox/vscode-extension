import * as vscode from "vscode";
import { ConnectionsManager } from "../managers/connectionsManager";
import { DataverseManager } from "../managers/dataverseManager";
import { ToolManager } from "../managers/toolManager";
import { ToolRegistryManager } from "../managers/toolRegistryManager";
import { ToolHostPanel } from "../panels/toolHostPanel";
import { ToolPanel } from "../panels/toolPanel";
import { InstalledToolsTreeDataProvider, InstalledToolTreeItem } from "../providers/installedToolsTreeDataProvider";
import { MarketplaceToolTreeItem, MarketplaceTreeDataProvider } from "../providers/marketplaceTreeDataProvider";

export function registerToolCommands(
    context: vscode.ExtensionContext,
    toolManager: ToolManager,
    toolRegistryManager: ToolRegistryManager,
    connectionsManager: ConnectionsManager,
    dataverseManager: DataverseManager,
    installedToolsProvider: InstalledToolsTreeDataProvider,
    marketplaceProvider: MarketplaceTreeDataProvider,
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
        ToolPanel.open(context.extensionUri, item.tool.id, toolManager, toolRegistryManager, { connectionsManager, dataverseManager });
    });

    const browseToolsCmd = vscode.commands.registerCommand("pptb.tools.browse", () => {
        ToolHostPanel.open(context.extensionUri, toolRegistryManager, toolManager, "installed", { connectionsManager, dataverseManager });
    });

    const browseMarketplaceCmd = vscode.commands.registerCommand("pptb.marketplace.browse", () => {
        ToolHostPanel.open(context.extensionUri, toolRegistryManager, toolManager, "marketplace", { connectionsManager, dataverseManager });
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
            vscode.window.showErrorMessage(`Install failed: ${msg}`);
        }
    });

    return [refreshInstalledCmd, uninstallToolCmd, refreshMarketplaceCmd, launchToolCmd, browseToolsCmd, browseMarketplaceCmd, marketplaceUninstallCmd, installToolCmd];
}
