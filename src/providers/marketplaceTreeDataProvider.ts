import * as vscode from "vscode";
import type { IconCacheManager } from "../managers/iconCacheManager";
import type { ToolManager } from "../managers/toolManager";
import { formatContributors, type RegistryTool, type ToolRegistryManager } from "../managers/toolRegistryManager";

export class MarketplaceToolTreeItem extends vscode.TreeItem {
    readonly registryTool: RegistryTool | undefined;

    constructor(tool: RegistryTool, isInstalled: boolean, iconCacheManager: IconCacheManager) {
        const isVerified = Boolean(tool.isVerified);
        // TreeItem labels render as plain text, so a Unicode glyph is used instead of a codicon ($(...) is not interpreted here).
        const label = isVerified ? `${tool.name} \u2713` : tool.name;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.registryTool = tool;

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
        if (tool.category) {
            tooltip.appendMarkdown(`**Category:** ${tool.category}\n\n`);
        }
        tooltip.appendMarkdown(`**Version:** ${tool.version}\n\n`);
        if (tool.description) {
            tooltip.appendMarkdown(`${tool.description}`);
        }
        tooltip.isTrusted = true;
        this.tooltip = tooltip;

        this.iconPath = iconCacheManager.getLocalUri(tool.icon) ?? new vscode.ThemeIcon(isInstalled ? "check" : "extensions");
        this.contextValue = isInstalled ? "pptb.marketplaceTool.installed" : "pptb.marketplaceTool";
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

export class MarketplaceTreeDataProvider implements vscode.TreeDataProvider<AnyItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<AnyItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tools: RegistryTool[] = [];
    private state: "idle" | "loading" | "loaded" | "error" = "idle";
    private errorMessage = "Unknown error";

    constructor(
        private readonly registryManager: ToolRegistryManager,
        private readonly toolManager: ToolManager,
        private readonly iconCacheManager: IconCacheManager,
    ) {
        // Re-render rows when a tool is installed/uninstalled or icons are cached
        toolManager.onToolsChanged(() => this._onDidChangeTreeData.fire());
        iconCacheManager.onIconsCached(() => this._onDidChangeTreeData.fire());
    }

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
                .catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.state = "error";
                    this.errorMessage = msg;
                    this._onDidChangeTreeData.fire();
                });
            return [new PlaceholderTreeItem("Loading…")];
        }

        if (this.state === "loading") {
            return [new PlaceholderTreeItem("Loading…")];
        }

        if (this.state === "error") {
            return [new PlaceholderTreeItem(`Error: ${this.errorMessage}`)];
        }

        if (this.tools.length === 0) {
            return [new PlaceholderTreeItem("No tools found.")];
        }

        // Verified tools first; stable sort preserves relative order otherwise.
        const sorted = [...this.tools].sort((a, b) => Number(Boolean(b.isVerified)) - Number(Boolean(a.isVerified)));
        return sorted.map((t) => new MarketplaceToolTreeItem(t, this.toolManager.isInstalled(t.id), this.iconCacheManager));
    }
}
