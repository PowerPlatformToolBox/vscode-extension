import * as vscode from "vscode";
import type { IconCacheManager } from "../managers/iconCacheManager";
import type { InstalledTool, ToolManager } from "../managers/toolManager";
import { formatContributors } from "../managers/toolRegistryManager";

export class InstalledToolTreeItem extends vscode.TreeItem {
    readonly tool: InstalledTool;

    constructor(tool: InstalledTool, iconCacheManager: IconCacheManager) {
        const isVerified = Boolean(tool.isVerified);
        // TreeItem labels render as plain text, so a Unicode glyph is used instead of a codicon ($(...) is not interpreted here).
        const label = isVerified ? `${tool.name} \u2713` : tool.name;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tool = tool;

        const contributors = formatContributors(tool.contributors) || tool.publisher;
        this.description = [contributors, tool.version ? `v${tool.version}` : undefined].filter(Boolean).join(" · ");

        const tooltip = new vscode.MarkdownString();
        tooltip.supportThemeIcons = true;
        tooltip.appendMarkdown(`**${tool.name}**${isVerified ? " $(verified-filled) *(Verified)*" : ""}\n\n`);
        if (contributors) {
            tooltip.appendMarkdown(`**Contributor(s):** ${contributors}\n\n`);
        }
        if (tool.publisher && tool.publisher !== contributors) {
            tooltip.appendMarkdown(`**Publisher:** ${tool.publisher}\n\n`);
        }
        tooltip.appendMarkdown(`**Version:** ${tool.version}\n\n`);
        if (tool.description) {
            tooltip.appendMarkdown(`${tool.description}`);
        }
        tooltip.isTrusted = true;
        this.tooltip = tooltip;

        this.iconPath = iconCacheManager.getLocalUri(tool.icon) ?? new vscode.ThemeIcon("package");
        this.contextValue = "pptb.installedTool";
    }
}

export class InstalledToolsTreeDataProvider implements vscode.TreeDataProvider<InstalledToolTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<InstalledToolTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly toolManager: ToolManager;
    private readonly iconCacheManager: IconCacheManager;

    constructor(toolManager: ToolManager, iconCacheManager: IconCacheManager) {
        this.toolManager = toolManager;
        this.iconCacheManager = iconCacheManager;
        toolManager.onToolsChanged(() => this._onDidChangeTreeData.fire());
        iconCacheManager.onIconsCached(() => this._onDidChangeTreeData.fire());
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
        // Verified tools first; stable sort preserves relative order otherwise.
        const sorted = [...tools].sort((a, b) => Number(Boolean(b.isVerified)) - Number(Boolean(a.isVerified)));
        return sorted.map((t) => new InstalledToolTreeItem(t, this.iconCacheManager));
    }
}
