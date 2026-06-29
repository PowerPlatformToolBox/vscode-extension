import * as vscode from "vscode";
import type { InstalledTool, ToolManager } from "../managers/toolManager";

export class InstalledToolTreeItem extends vscode.TreeItem {
  readonly tool: InstalledTool;

  constructor(tool: InstalledTool) {
    super(tool.name, vscode.TreeItemCollapsibleState.None);
    this.tool = tool;
    this.description = tool.publisher ?? tool.version;
    this.tooltip = tool.description ?? tool.name;
    this.iconPath = tool.icon
      ? vscode.Uri.parse(tool.icon)
      : new vscode.ThemeIcon("package");
    this.contextValue = "pptb.installedTool";
  }
}

export class InstalledToolsTreeDataProvider
  implements vscode.TreeDataProvider<InstalledToolTreeItem>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<InstalledToolTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly toolManager: ToolManager;

  constructor(toolManager: ToolManager) {
    this.toolManager = toolManager;
    toolManager.onToolsChanged(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: InstalledToolTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): InstalledToolTreeItem[] {
    const tools = this.toolManager.getAll();
    if (tools.length === 0) {
      const empty = new vscode.TreeItem("No tools installed");
      empty.contextValue = "pptb.installedToolEmpty";
      // Return as InstalledToolTreeItem won't work for plain TreeItem;
      // use a placeholder subclass approach
      return [];
    }
    return tools.map((t) => new InstalledToolTreeItem(t));
  }
}
