import * as vscode from "vscode";
import type { Connection } from "../managers/connectionsManager";
import type { ConnectionsManager } from "../managers/connectionsManager";

/**
 * A tree item representing either a category group or an individual connection.
 */
export class ConnectionTreeItem extends vscode.TreeItem {
  readonly connection?: Connection;
  readonly isCategory: boolean;

  constructor(
    connection: Connection,
    isActive: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState
  );
  constructor(
    categoryLabel: string,
    isActive: false,
    collapsibleState: vscode.TreeItemCollapsibleState,
    isCategory: true
  );
  constructor(
    connectionOrLabel: Connection | string,
    isActive: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState,
    isCategory = false
  ) {
    if (isCategory) {
      super(connectionOrLabel as string, collapsibleState);
      this.isCategory = true;
      this.contextValue = "pptb.category";
    } else {
      const conn = connectionOrLabel as Connection;
      super(conn.name, collapsibleState);
      this.connection = conn;
      this.isCategory = false;
      this.description = conn.environment;
      this.tooltip = conn.url;
      this.iconPath = new vscode.ThemeIcon(
        isActive ? "circle-filled" : "circle-outline"
      );
      this.contextValue = isActive
        ? "pptb.connection.active"
        : "pptb.connection.inactive";
    }
  }
}

/**
 * Provides tree data for the Connections view.
 * Groups connections by category when the category field is set.
 */
export class ConnectionsTreeDataProvider
  implements vscode.TreeDataProvider<ConnectionTreeItem>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly connectionsManager: ConnectionsManager;

  constructor(connectionsManager: ConnectionsManager) {
    this.connectionsManager = connectionsManager;

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
          items.push(
            new ConnectionTreeItem(
              category,
              false,
              vscode.TreeItemCollapsibleState.Expanded,
              true
            )
          );
        }

        // Add uncategorized connections at root
        for (const conn of uncategorized) {
          const isActive = activeConnection?.id === conn.id;
          items.push(
            new ConnectionTreeItem(
              conn,
              isActive,
              vscode.TreeItemCollapsibleState.None
            )
          );
        }

        return items;
      } else {
        // No categories — flat list
        return connections.map((conn) => {
          const isActive = activeConnection?.id === conn.id;
          return new ConnectionTreeItem(
            conn,
            isActive,
            vscode.TreeItemCollapsibleState.None
          );
        });
      }
    } else if (element.isCategory) {
      // Children of a category node
      const categoryLabel = element.label as string;
      return connections
        .filter((c) => c.category === categoryLabel)
        .map((conn) => {
          const isActive = activeConnection?.id === conn.id;
          return new ConnectionTreeItem(
            conn,
            isActive,
            vscode.TreeItemCollapsibleState.None
          );
        });
    }

    return [];
  }
}
