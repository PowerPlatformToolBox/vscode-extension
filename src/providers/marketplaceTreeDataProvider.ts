import * as vscode from "vscode";
import { MARKETPLACE_FILTER_KEY, MARKETPLACE_SORT_KEY } from "../constants";
import type { IconCacheManager } from "../managers/iconCacheManager";
import type { ToolManager } from "../managers/toolManager";
import { formatContributors, type RegistryTool, type ToolRegistryManager } from "../managers/toolRegistryManager";

/** Sort options for the marketplace view (mirrors the desktop app's name/popularity/rating/downloads sorting). */
export type MarketplaceSortOption = "name-asc" | "name-desc" | "popularity" | "rating" | "downloads" | "verified";

/** Filter selection for the marketplace view (mirrors the desktop app's category filter). */
export interface MarketplaceFilterState {
    /** When set, only tools in this category are shown. */
    category?: string;
    /** When `true`, only verified tools are shown. */
    verifiedOnly?: boolean;
}

const DEFAULT_SORT: MarketplaceSortOption = "name-asc";
const DEFAULT_FILTER: MarketplaceFilterState = {};

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
        if (tool.categories?.length) {
            tooltip.appendMarkdown(`**Category:** ${tool.categories.join(", ")}\n\n`);
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
        private readonly context: vscode.ExtensionContext,
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

    // ---------------------------------------------------------------------------
    // Sort
    // ---------------------------------------------------------------------------

    getSortOption(): MarketplaceSortOption {
        return this.context.globalState.get<MarketplaceSortOption>(MARKETPLACE_SORT_KEY, DEFAULT_SORT);
    }

    async setSortOption(option: MarketplaceSortOption): Promise<void> {
        await this.context.globalState.update(MARKETPLACE_SORT_KEY, option);
        this._onDidChangeTreeData.fire();
    }

    // ---------------------------------------------------------------------------
    // Filter
    // ---------------------------------------------------------------------------

    getFilterState(): MarketplaceFilterState {
        return this.context.globalState.get<MarketplaceFilterState>(MARKETPLACE_FILTER_KEY, DEFAULT_FILTER);
    }

    async setFilterState(state: MarketplaceFilterState): Promise<void> {
        await this.context.globalState.update(MARKETPLACE_FILTER_KEY, state);
        this._onDidChangeTreeData.fire();
    }

    /** Return the sorted list of unique categories among loaded marketplace tools, for filter pickers. */
    getAvailableCategories(): string[] {
        const categories = new Set<string>();
        for (const tool of this.tools) {
            for (const category of tool.categories ?? []) {
                categories.add(category);
            }
        }
        return [...categories].sort((a, b) => a.localeCompare(b));
    }

    /**
     * Apply the current persisted filter and sort settings to a list of marketplace tools.
     * Shared by the tree view (`getChildren`) and the ToolHostPanel webview so both surfaces
     * stay in sync.
     */
    applyFilterAndSort(tools: RegistryTool[]): RegistryTool[] {
        const filter = this.getFilterState();
        const filtered = tools.filter((t) => {
            if (filter.verifiedOnly && !t.isVerified) {
                return false;
            }
            if (filter.category && !(t.categories ?? []).includes(filter.category)) {
                return false;
            }
            return true;
        });

        const sortOption = this.getSortOption();
        return [...filtered].sort((a, b) => {
            // Verified tools always come first, regardless of the selected sort option.
            const verifiedDiff = Number(Boolean(b.isVerified)) - Number(Boolean(a.isVerified));
            if (verifiedDiff !== 0) {
                return verifiedDiff;
            }
            switch (sortOption) {
                case "name-desc":
                    return b.name.localeCompare(a.name);
                case "popularity":
                    return (b.mau || 0) - (a.mau || 0);
                case "rating":
                    return (b.rating || 0) - (a.rating || 0);
                case "downloads":
                    return (b.downloads || 0) - (a.downloads || 0);
                case "verified":
                case "name-asc":
                default:
                    return a.name.localeCompare(b.name);
            }
        });
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

        const sorted = this.applyFilterAndSort(this.tools);
        if (sorted.length === 0) {
            return [new PlaceholderTreeItem("No tools match the current filter.")];
        }

        return sorted.map((t) => new MarketplaceToolTreeItem(t, this.toolManager.isInstalled(t.id), this.iconCacheManager));
    }
}
