import * as vscode from "vscode";
import type { RegistryTool, ToolRegistryManager } from "../managers/toolRegistryManager";

export class MarketplaceToolTreeItem extends vscode.TreeItem {
  readonly registryTool: RegistryTool | undefined;

  constructor(tool: RegistryTool) {
    super(tool.name, vscode.TreeItemCollapsibleState.None);
    this.registryTool = tool;
    this.description = tool.publisher ?? tool.version;
    this.tooltip = tool.description ?? tool.name;
    this.iconPath = new vscode.ThemeIcon("extensions");
    this.contextValue = "pptb.marketplaceTool";
  }
}

/**
 * A non-interactive placeholder item (e.g. "Loading…" or "No tools found").
 */
class PlaceholderTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "pptb.marketplacePlaceholder";
  }
}

type AnyItem = MarketplaceToolTreeItem | PlaceholderTreeItem;

export class MarketplaceTreeDataProvider
  implements vscode.TreeDataProvider<AnyItem>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<AnyItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tools: RegistryTool[] = [];
  private state: "idle" | "loading" | "loaded" | "error" = "idle";

  constructor(private readonly registryManager: ToolRegistryManager) {}

  refresh(): void {
    this.state = "idle";
    this.tools = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AnyItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<AnyItem[]> {
    if (this.state === "idle") {
      this.state = "loading";
      // Kick off the async fetch; once done, fire a tree refresh
      this.registryManager
        .getTools()
        .then(({ tools }) => {
          this.tools = tools;
          this.state = "loaded";
          this._onDidChangeTreeData.fire();
        })
        .catch(() => {
          this.state = "error";
          this._onDidChangeTreeData.fire();
        });
      return [new PlaceholderTreeItem("Loading…")];
    }

    if (this.state === "loading") {
      return [new PlaceholderTreeItem("Loading…")];
    }

    if (this.state === "error") {
      return [new PlaceholderTreeItem("Failed to load marketplace tools.")];
    }

    if (this.tools.length === 0) {
      return [new PlaceholderTreeItem("No tools found.")];
    }

    return this.tools.map((t) => new MarketplaceToolTreeItem(t));
  }
}
