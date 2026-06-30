import * as vscode from "vscode";
import { ENVIRONMENT_DEFAULT_COLORS } from "../constants";
import type { Connection, ConnectionsManager } from "../managers/connectionsManager";
import type { IconCacheManager } from "../managers/iconCacheManager";

/**
 * A tree item representing either a category group or an individual connection.
 */
export class ConnectionTreeItem extends vscode.TreeItem {
    readonly connection?: Connection;
    readonly isCategory: boolean;

    constructor(connection: Connection, isActive: boolean, collapsibleState: vscode.TreeItemCollapsibleState, iconCacheManager?: IconCacheManager);
    constructor(categoryLabel: string, categoryColor: string | undefined, collapsibleState: vscode.TreeItemCollapsibleState, isCategory: true, iconCacheManager?: IconCacheManager);
    constructor(
        connectionOrLabel: Connection | string,
        isActiveOrColor: boolean | string | undefined,
        collapsibleState: vscode.TreeItemCollapsibleState,
        isCategoryOrIconMgr: boolean | IconCacheManager = false,
        iconCacheManager?: IconCacheManager,
    ) {
        if (isCategoryOrIconMgr === true) {
            // Category item
            super(connectionOrLabel as string, collapsibleState);
            this.isCategory = true;
            this.contextValue = "pptb.category";
            const categoryColor = isActiveOrColor as string | undefined;
            const iconMgr = iconCacheManager;
            if (categoryColor && iconMgr) {
                this.iconPath = iconMgr.getColoredRectUri(categoryColor);
            } else {
                this.iconPath = new vscode.ThemeIcon("folder");
            }
        } else {
            // Connection item
            const conn = connectionOrLabel as Connection;
            const isActive = isActiveOrColor as boolean;
            const iconMgr = isCategoryOrIconMgr as IconCacheManager | undefined;
            super(conn.name, collapsibleState);
            this.connection = conn;
            this.isCategory = false;
            this.description = conn.environment;
            this.tooltip = conn.url;
            // Use environment color for the circle icon
            const envColor = conn.environmentColor ?? ENVIRONMENT_DEFAULT_COLORS[conn.environment] ?? "#0078d4";
            if (iconMgr) {
                this.iconPath = iconMgr.getColoredCircleUri(envColor);
            } else {
                this.iconPath = new vscode.ThemeIcon(isActive ? "circle-filled" : "circle-outline");
            }
            this.contextValue = isActive ? "pptb.connection.active" : "pptb.connection.inactive";
        }
    }
}

/**
 * Provides tree data for the Connections view.
 * Groups connections by category when the category field is set.
 */
export class ConnectionsTreeDataProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly connectionsManager: ConnectionsManager;
    private readonly iconCacheManager?: IconCacheManager;

    constructor(connectionsManager: ConnectionsManager, iconCacheManager?: IconCacheManager) {
        this.connectionsManager = connectionsManager;
        this.iconCacheManager = iconCacheManager;

        // Refresh tree whenever connections change
        connectionsManager.onConnectionsChanged.event(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConnectionTreeItem): ConnectionTreeItem[] {
        const connections = this.connectionsManager.getAll();
        const activeConnection = this.connectionsManager.getActiveConnection();
        const categoryColors = this.connectionsManager.getCategoryColors();

        if (!element) {
            // Root level: check if any connection has a category
            const hasCategories = connections.some((c) => c.category);

            if (hasCategories) {
                // Build category nodes
                const categories = new Set<string>();
                const uncategorized: Connection[] = [];

                for (const conn of connections) {
                    if (conn.category) {
                        categories.add(conn.category);
                    } else {
                        uncategorized.push(conn);
                    }
                }

                const items: ConnectionTreeItem[] = [];
                for (const category of categories) {
                    const color = categoryColors[category];
                    items.push(new ConnectionTreeItem(category, color, vscode.TreeItemCollapsibleState.Expanded, true, this.iconCacheManager));
                }

                // Add uncategorized connections at root
                for (const conn of uncategorized) {
                    const isActive = activeConnection?.id === conn.id;
                    items.push(new ConnectionTreeItem(conn, isActive, vscode.TreeItemCollapsibleState.None, this.iconCacheManager));
                }

                return items;
            } else {
                // No categories — flat list
                return connections.map((conn) => {
                    const isActive = activeConnection?.id === conn.id;
                    return new ConnectionTreeItem(conn, isActive, vscode.TreeItemCollapsibleState.None, this.iconCacheManager);
                });
            }
        } else if (element.isCategory) {
            // Children of a category node
            const categoryLabel = element.label as string;
            return connections
                .filter((c) => c.category === categoryLabel)
                .map((conn) => {
                    const isActive = activeConnection?.id === conn.id;
                    return new ConnectionTreeItem(conn, isActive, vscode.TreeItemCollapsibleState.None, this.iconCacheManager);
                });
        }

        return [];
    }
}
