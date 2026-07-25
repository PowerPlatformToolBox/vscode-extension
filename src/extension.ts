import * as vscode from "vscode";
import { AuthManager } from "./managers/authManager";
import { ConnectionsManager } from "./managers/connectionsManager";
import { DataverseManager } from "./managers/dataverseManager";
import { IconCacheManager } from "./managers/iconCacheManager";
import { ToolManager } from "./managers/toolManager";
import { ToolRegistryManager } from "./managers/toolRegistryManager";
import { ConnectionsTreeDataProvider } from "./providers/connectionsTreeDataProvider";
import { InstalledToolsTreeDataProvider } from "./providers/installedToolsTreeDataProvider";
import { MarketplaceTreeDataProvider } from "./providers/marketplaceTreeDataProvider";
import { registerConnectionCommands } from "./registrations/registerConnectionCommands";
import { registerSupportCommands } from "./registrations/registerSupportCommands";
import { registerToolCommands } from "./registrations/registerToolCommands";
import { ConnectionStatusBar } from "./statusbar/connectionStatusBar";
import { logger } from "./utils/logger";

export function activate(context: vscode.ExtensionContext): void {
    // ── Bootstrap managers ────────────────────────────────────────────────────
    const authManager = new AuthManager(context);
    const connectionsManager = new ConnectionsManager(context);
    const dataverseManager = new DataverseManager(authManager);

    // Wire up cross-manager references (lazy to avoid circular dependency)
    connectionsManager.setDataverseManager(dataverseManager);

    // ── Tool managers ─────────────────────────────────────────────────────────
    const toolManager = new ToolManager(context);
    const registryOutput = vscode.window.createOutputChannel("PPTB Registry");
    context.subscriptions.push(registryOutput);
    const toolRegistryManager = new ToolRegistryManager(registryOutput);
    const iconCacheManager = new IconCacheManager(context);

    // ── Tree views ────────────────────────────────────────────────────────────
    const treeDataProvider = new ConnectionsTreeDataProvider(connectionsManager, iconCacheManager);
    const treeView = vscode.window.createTreeView("pptb.connectionsView", {
        treeDataProvider,
        showCollapseAll: true,
    });

    const installedToolsProvider = new InstalledToolsTreeDataProvider(toolManager, iconCacheManager);
    const installedToolsView = vscode.window.createTreeView("pptb.installedToolsView", {
        treeDataProvider: installedToolsProvider,
        showCollapseAll: false,
    });

    const marketplaceProvider = new MarketplaceTreeDataProvider(toolRegistryManager, toolManager, iconCacheManager);
    const marketplaceView = vscode.window.createTreeView("pptb.marketplaceView", {
        treeDataProvider: marketplaceProvider,
        showCollapseAll: false,
    });

    // ── Status bar ────────────────────────────────────────────────────────────
    const statusBar = new ConnectionStatusBar(connectionsManager);

    // ── Register all disposables ──────────────────────────────────────────────
    context.subscriptions.push(
        authManager,
        connectionsManager.onConnectionsChanged,
        treeView,
        installedToolsView,
        marketplaceView,
        toolManager,
        iconCacheManager,
        statusBar,
        ...registerConnectionCommands(context, authManager, connectionsManager, treeDataProvider),
        ...registerSupportCommands(),
        ...registerToolCommands(context, toolManager, toolRegistryManager, connectionsManager, dataverseManager, installedToolsProvider, marketplaceProvider),
    );

    // ── Warm up icon cache in background ─────────────────────────────────────
    void (async () => {
        try {
            const installedIconUrls = toolManager
                .getAll()
                .map((t) => t.icon)
                .filter((u): u is string => typeof u === "string" && u.length > 0);

            const registryIconUrls = await toolRegistryManager.getAllIconUrls();

            const allUrls = [...new Set([...installedIconUrls, ...registryIconUrls])];
            await iconCacheManager.warmUp(allUrls);
        } catch (err) {
            logger.error("[Activation] Icon cache warm-up failed:", err instanceof Error ? err.message : String(err));
        }
    })();
}

export function deactivate(): void {
    // Cleanup is handled by VS Code via context.subscriptions
}
