import * as vscode from "vscode";
import type { ConnectionsManager } from "../managers/connectionsManager";

/**
 * Left-aligned status bar item showing the active Dataverse connection.
 * Clicking it opens a QuickPick to switch connections.
 */
export class ConnectionStatusBar {
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly connectionsManager: ConnectionsManager;
    private disposables: vscode.Disposable[] = [];

    constructor(connectionsManager: ConnectionsManager) {
        this.connectionsManager = connectionsManager;

        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = "pptb.statusBar.pickConnection";
        this.statusBarItem.tooltip = "Click to switch active PPTB connection";

        this.update();

        // Re-render whenever connections change
        connectionsManager.onConnectionsChanged.event(
            () => {
                this.update();
            },
            null,
            this.disposables,
        );

        // Register the QuickPick command
        this.disposables.push(vscode.commands.registerCommand("pptb.statusBar.pickConnection", () => this.showConnectionPicker()));

        this.statusBarItem.show();
    }

    /** Refresh the status bar text to reflect the current active connection. */
    update(): void {
        const active = this.connectionsManager.getActiveConnection();
        if (active) {
            this.statusBarItem.text = `$(database) ${active.name}`;
        } else {
            this.statusBarItem.text = "$(database) No Connection";
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    private async showConnectionPicker(): Promise<void> {
        const connections = this.connectionsManager.getAll();
        if (connections.length === 0) {
            vscode.window.showInformationMessage("No connections saved. Use PPTB: Add Connection to create one.");
            return;
        }

        const activeId = this.connectionsManager.getActiveConnection()?.id;

        const items: (vscode.QuickPickItem & { id: string })[] = connections.map((conn) => ({
            id: conn.id,
            label: conn.name,
            description: conn.environment,
            detail: conn.url,
            picked: conn.id === activeId,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select the active connection",
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            await this.connectionsManager.setActiveConnection(selected.id);
        }
    }
}
