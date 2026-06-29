import * as vscode from "vscode";
import { AuthManager } from "./managers/authManager";
import { ConnectionsManager } from "./managers/connectionsManager";
import { DataverseManager } from "./managers/dataverseManager";
import { ToolManager } from "./managers/toolManager";
import { ToolRegistryManager } from "./managers/toolRegistryManager";
import { ConnectionsTreeDataProvider } from "./providers/connectionsTreeDataProvider";
import { InstalledToolsTreeDataProvider } from "./providers/installedToolsTreeDataProvider";
import { MarketplaceTreeDataProvider } from "./providers/marketplaceTreeDataProvider";
import { registerConnectionCommands } from "./registrations/registerConnectionCommands";
import { registerToolCommands } from "./registrations/registerToolCommands";
import { ConnectionStatusBar } from "./statusbar/connectionStatusBar";

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

    // ── Tree views ────────────────────────────────────────────────────────────
    const treeDataProvider = new ConnectionsTreeDataProvider(connectionsManager);
    const treeView = vscode.window.createTreeView("pptb.connectionsView", {
        treeDataProvider,
        showCollapseAll: true,
    });

    const installedToolsProvider = new InstalledToolsTreeDataProvider(toolManager);
    const installedToolsView = vscode.window.createTreeView("pptb.installedToolsView", {
        treeDataProvider: installedToolsProvider,
        showCollapseAll: false,
    });

    const marketplaceProvider = new MarketplaceTreeDataProvider(toolRegistryManager, toolManager);
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
        statusBar,
        ...registerConnectionCommands(context, authManager, connectionsManager, treeDataProvider),
        ...registerToolCommands(context, toolManager, toolRegistryManager, connectionsManager, dataverseManager, installedToolsProvider, marketplaceProvider),
    );
}

export function deactivate(): void {
    // Cleanup is handled by VS Code via context.subscriptions
}
