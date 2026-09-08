import * as vscode from "vscode";
import { INSTALLED_TOOLS_FILTER_KEY, INSTALLED_TOOLS_SORT_KEY } from "../constants";
import type { IconCacheManager } from "../managers/iconCacheManager";
import type { InstalledTool, ToolManager } from "../managers/toolManager";
import { formatContributors, type ToolAnalytics, type ToolRegistryManager } from "../managers/toolRegistryManager";

/** Sort options for the installed tools view (mirrors the desktop app's name/popularity/rating/downloads sorting). */
export type InstalledToolsSortOption = "favorite" | "name-asc" | "name-desc" | "popularity" | "rating" | "downloads" | "verified";

/** Filter selection for the installed tools view (mirrors the desktop app's category/verified filters). */
export interface InstalledToolsFilterState {
    /** When set, only tools in this category are shown. */
    category?: string;
    /** When `true`, only verified tools are shown. */
    verifiedOnly?: boolean;
}

const DEFAULT_SORT: InstalledToolsSortOption = "name-asc";
const DEFAULT_FILTER: InstalledToolsFilterState = {};

export class InstalledToolTreeItem extends vscode.TreeItem {
    readonly tool: InstalledTool;

    constructor(tool: InstalledTool, isFavorite: boolean, iconCacheManager: IconCacheManager) {
        const isVerified = Boolean(tool.isVerified);
        // TreeItem labels render as plain text, so Unicode glyphs are used instead of codicons ($(...) is not interpreted here).
        const label = [tool.name, isFavorite ? "\u2605" : undefined, isVerified ? "\u2713" : undefined].filter(Boolean).join(" ");
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tool = tool;

        const contributors = formatContributors(tool.contributors) || tool.publisher;
        this.description = [contributors, tool.version ? `v${tool.version}` : undefined].filter(Boolean).join(" · ");

        const tooltip = new vscode.MarkdownString();
        tooltip.supportThemeIcons = true;
        tooltip.appendMarkdown(`**${tool.name}**${isVerified ? " $(verified-filled) *(Verified)*" : ""}${isFavorite ? " $(star-full) *(Favorite)*" : ""}\n\n`);
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

        this.iconPath = iconCacheManager.getLocalUri(tool.icon) ?? new vscode.ThemeIcon("package");
        this.contextValue = isFavorite ? "pptb.installedTool.favorite" : "pptb.installedTool";
    }
}

class PlaceholderTreeItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = "pptb.installedToolEmpty";
    }
}

type AnyItem = InstalledToolTreeItem | PlaceholderTreeItem;

export class InstalledToolsTreeDataProvider implements vscode.TreeDataProvider<AnyItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<AnyItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly context: vscode.ExtensionContext;
    private readonly toolManager: ToolManager;
    private readonly toolRegistryManager: ToolRegistryManager;
    private readonly iconCacheManager: IconCacheManager;

    /** Cached downloads/rating/MAU analytics per tool ID, refreshed in the background. */
    private analytics = new Map<string, ToolAnalytics>();
    private analyticsFetchedForIds = "";

    constructor(context: vscode.ExtensionContext, toolManager: ToolManager, toolRegistryManager: ToolRegistryManager, iconCacheManager: IconCacheManager) {
        this.context = context;
        this.toolManager = toolManager;
        this.toolRegistryManager = toolRegistryManager;
        this.iconCacheManager = iconCacheManager;
        toolManager.onToolsChanged(() => this._onDidChangeTreeData.fire());
        iconCacheManager.onIconsCached(() => this._onDidChangeTreeData.fire());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AnyItem): vscode.TreeItem {
        return element;
    }

    // ---------------------------------------------------------------------------
    // Sort
    // ---------------------------------------------------------------------------

    getSortOption(): InstalledToolsSortOption {
        return this.context.globalState.get<InstalledToolsSortOption>(INSTALLED_TOOLS_SORT_KEY, DEFAULT_SORT);
    }

    async setSortOption(option: InstalledToolsSortOption): Promise<void> {
        await this.context.globalState.update(INSTALLED_TOOLS_SORT_KEY, option);
        this._onDidChangeTreeData.fire();
    }

    // ---------------------------------------------------------------------------
    // Filter
    // ---------------------------------------------------------------------------

    getFilterState(): InstalledToolsFilterState {
        return this.context.globalState.get<InstalledToolsFilterState>(INSTALLED_TOOLS_FILTER_KEY, DEFAULT_FILTER);
    }

    async setFilterState(state: InstalledToolsFilterState): Promise<void> {
        await this.context.globalState.update(INSTALLED_TOOLS_FILTER_KEY, state);
        this._onDidChangeTreeData.fire();
    }

    /** Return the sorted list of unique categories among installed tools, for filter pickers. */
    getAvailableCategories(): string[] {
        const categories = new Set<string>();
        for (const tool of this.toolManager.getAll()) {
            for (const category of tool.categories ?? []) {
                categories.add(category);
            }
        }
        return [...categories].sort((a, b) => a.localeCompare(b));
    }

    /** Kick off a background analytics refresh for the given tool IDs (fire-and-forget; refreshes the tree on completion). */
    private refreshAnalytics(toolIds: string[]): void {
        const key = [...toolIds].sort().join(",");
        if (toolIds.length === 0 || key === this.analyticsFetchedForIds) {
            return;
        }
        this.analyticsFetchedForIds = key;
        this.toolRegistryManager
            .getAnalytics(toolIds)
            .then((map) => {
                this.analytics = map;
                this._onDidChangeTreeData.fire();
            })
            .catch(() => {
                /* analytics are best-effort; ignore failures */
            });
    }

    /**
     * Apply the current persisted filter and sort settings to a list of installed tools.
     * Shared by the tree view (`getChildren`) and the ToolHostPanel webview so both surfaces
     * stay in sync.
     */
    applyFilterAndSort(tools: InstalledTool[]): InstalledTool[] {
        this.refreshAnalytics(tools.map((t) => t.id));

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

        const favorites = new Set(this.toolManager.getFavorites());
        const sortOption = this.getSortOption();
        return [...filtered].sort((a, b) => {
            // Verified tools always come first, regardless of the selected sort option.
            const verifiedDiff = Number(Boolean(b.isVerified)) - Number(Boolean(a.isVerified));
            if (verifiedDiff !== 0) {
                return verifiedDiff;
            }
            switch (sortOption) {
                case "favorite": {
                    const favDiff = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
                    return favDiff !== 0 ? favDiff : a.name.localeCompare(b.name);
                }
                case "name-desc":
                    return b.name.localeCompare(a.name);
                case "popularity":
                    return (this.analytics.get(b.id)?.mau || 0) - (this.analytics.get(a.id)?.mau || 0);
                case "rating":
                    return (this.analytics.get(b.id)?.rating || 0) - (this.analytics.get(a.id)?.rating || 0);
                case "downloads":
                    return (this.analytics.get(b.id)?.downloads || 0) - (this.analytics.get(a.id)?.downloads || 0);
                case "verified":
                case "name-asc":
                default:
                    return a.name.localeCompare(b.name);
            }
        });
    }

    getChildren(): AnyItem[] {
        const tools = this.toolManager.getAll();
        if (tools.length === 0) {
            return [new PlaceholderTreeItem("No tools installed")];
        }

        const sorted = this.applyFilterAndSort(tools);
        if (sorted.length === 0) {
            return [new PlaceholderTreeItem("No tools match the current filter.")];
        }

        const favorites = new Set(this.toolManager.getFavorites());
        return sorted.map((t) => new InstalledToolTreeItem(t, favorites.has(t.id), this.iconCacheManager));
    }
}
