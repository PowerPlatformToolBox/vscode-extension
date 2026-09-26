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

/** Parse a version string into numeric [major, minor, patch, ...] segments; non-numeric segments count as 0. */
function parseVersionParts(version: string): number[] {
    const cleaned = version.trim().replace(/^v/i, "").split(/[-+]/)[0];
    return cleaned.split(".").map((part) => {
        const n = parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
    });
}

/** Return `true` when `latest` is a strictly newer version than `current` (segment-by-segment numeric compare). */
function isNewerVersion(current: string, latest: string): boolean {
    const currentParts = parseVersionParts(current);
    const latestParts = parseVersionParts(latest);
    const len = Math.max(currentParts.length, latestParts.length);
    for (let i = 0; i < len; i++) {
        const diff = (latestParts[i] ?? 0) - (currentParts[i] ?? 0);
        if (diff !== 0) {
            return diff > 0;
        }
    }
    return false;
}

export class InstalledToolTreeItem extends vscode.TreeItem {
    readonly tool: InstalledTool;

    constructor(tool: InstalledTool, isFavorite: boolean, updateInfo: { hasUpdate: boolean; latestVersion?: string; isUpdating: boolean }, iconCacheManager: IconCacheManager) {
        const isVerified = Boolean(tool.isVerified);
        const { hasUpdate, latestVersion, isUpdating } = updateInfo;
        // TreeItem labels render as plain text, so Unicode glyphs are used instead of codicons ($(...) is not interpreted here).
        const label = [tool.name, isFavorite ? "\u2605" : undefined, isVerified ? "\u2713" : undefined, hasUpdate ? "\u2191" : undefined].filter(Boolean).join(" ");
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tool = tool;
        this.command = { command: "pptb.tools.showDetails", title: "Show Tool Details", arguments: [this] };

        const contributors = formatContributors(tool.contributors) || tool.publisher;
        const versionSuffix = isUpdating ? "updating\u2026" : hasUpdate ? `v${tool.version} \u2192 v${latestVersion}` : tool.version ? `v${tool.version}` : undefined;
        this.description = [contributors, versionSuffix].filter(Boolean).join(" · ");

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
        if (isUpdating) {
            tooltip.appendMarkdown(`$(sync~spin) *Updating\u2026*\n\n`);
        } else if (hasUpdate) {
            tooltip.appendMarkdown(`$(arrow-up) **Update available:** v${latestVersion}\n\n`);
        }
        if (tool.description) {
            tooltip.appendMarkdown(`${tool.description}`);
        }
        tooltip.isTrusted = true;
        this.tooltip = tooltip;

        this.iconPath = iconCacheManager.getLocalUri(tool.icon) ?? new vscode.ThemeIcon("package");
        // contextValue segments: base, optional ".favorite", optional ".updateAvailable" (in this order).
        this.contextValue = ["pptb.installedTool", isFavorite ? "favorite" : undefined, hasUpdate ? "updateAvailable" : undefined].filter(Boolean).join(".");
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

    /** Cached registry versions per tool ID, used to detect available updates (mirrors the desktop app's checkForUpdates). */
    private latestVersions = new Map<string, string>();
    private updatesFetchedForIds = "";

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

    /** Kick off a background update-check refresh for the given tool IDs (fire-and-forget; refreshes the tree on completion). */
    private refreshUpdates(toolIds: string[]): void {
        const key = [...toolIds].sort().join(",");
        if (toolIds.length === 0 || key === this.updatesFetchedForIds) {
            return;
        }
        this.updatesFetchedForIds = key;
        this.toolRegistryManager
            .getLatestVersions(toolIds)
            .then((map) => {
                this.latestVersions = map;
                void vscode.commands.executeCommand("setContext", "pptb.hasToolUpdates", this.getToolsWithUpdates().length > 0);
                this._onDidChangeTreeData.fire();
            })
            .catch(() => {
                /* update checks are best-effort; ignore failures */
            });
    }

    /**
     * Force the next render to re-fetch registry versions, instead of relying on the
     * installed-tool-ID cache key (which doesn't change across an update/re-install).
     * Call this right after a tool finishes updating so the tree can't get stuck showing
     * a stale "update available" state.
     */
    invalidateUpdateCache(): void {
        this.updatesFetchedForIds = "";
        this._onDidChangeTreeData.fire();
    }

    /**
     * Return `true` when the registry has a version of `tool` that is strictly newer than
     * what's installed. Uses a numeric segment-by-segment comparison (not a plain string
     * inequality) so a registry entry that is equal to, or older than (e.g. stale/out-of-sync
     * publisher metadata), the installed version never gets flagged as an update — which would
     * otherwise send tools into an endless "update available" loop that re-installs the same
     * (or an older) version every time.
     */
    hasUpdate(tool: InstalledTool): boolean {
        const latest = this.latestVersions.get(tool.id);
        return latest !== undefined && isNewerVersion(tool.version, latest);
    }

    /** Return the latest registry version known for a tool, if any. */
    getLatestVersion(id: string): string | undefined {
        return this.latestVersions.get(id);
    }

    getAnalytics(id: string): ToolAnalytics | undefined {
        return this.analytics.get(id);
    }

    /** Return every installed tool that currently has an update available. */
    getToolsWithUpdates(): InstalledTool[] {
        return this.toolManager.getAll().filter((t) => this.hasUpdate(t));
    }

    /**
     * Apply the current persisted filter and sort settings to a list of installed tools.
     * Shared by the tree view (`getChildren`) and the ToolHostPanel webview so both surfaces
     * stay in sync.
     */
    applyFilterAndSort(tools: InstalledTool[]): InstalledTool[] {
        this.refreshAnalytics(tools.map((t) => t.id));
        this.refreshUpdates(tools.map((t) => t.id));

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
        return sorted.map(
            (t) =>
                new InstalledToolTreeItem(
                    t,
                    favorites.has(t.id),
                    { hasUpdate: this.hasUpdate(t), latestVersion: this.getLatestVersion(t.id), isUpdating: this.toolManager.isUpdating(t.id) },
                    this.iconCacheManager,
                ),
        );
    }
}
