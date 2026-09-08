import React, { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

type ActiveView = "installed" | "marketplace";

/** A single icon URL, or theme-aware light/dark variants resolved from the local icon cache. */
type ToolIconSource = string | { light: string; dark: string };

interface InstalledTool {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    contributors?: string[] | string;
    isVerified?: boolean;
    categories?: string[];
    icon?: ToolIconSource;
    toolPath: string;
    installedAt: string;
}

interface RegistryTool {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    contributors?: string[] | string;
    isVerified?: boolean;
    categories?: string[];
    icon?: ToolIconSource;
}

type InstalledSortOption = "favorite" | "name-asc" | "name-desc" | "popularity" | "rating" | "downloads" | "verified";
type MarketplaceSortOption = "name-asc" | "name-desc" | "popularity" | "rating" | "downloads" | "verified";

interface InstalledFilterState {
    category?: string;
    verifiedOnly?: boolean;
}

interface MarketplaceFilterState {
    category?: string;
    verifiedOnly?: boolean;
}

const INSTALLED_SORT_OPTIONS: { label: string; value: InstalledSortOption }[] = [
    { label: "Favorite", value: "favorite" },
    { label: "Name (A-Z)", value: "name-asc" },
    { label: "Name (Z-A)", value: "name-desc" },
    { label: "Popularity", value: "popularity" },
    { label: "Highly Rated", value: "rating" },
    { label: "Most Downloaded", value: "downloads" },
    { label: "Verified", value: "verified" },
];

const MARKETPLACE_SORT_OPTIONS: { label: string; value: MarketplaceSortOption }[] = [
    { label: "Name (A-Z)", value: "name-asc" },
    { label: "Name (Z-A)", value: "name-desc" },
    { label: "Popularity", value: "popularity" },
    { label: "Highly Rated", value: "rating" },
    { label: "Most Downloaded", value: "downloads" },
    { label: "Verified", value: "verified" },
];

function formatContributors(contributors?: string[] | string): string | undefined {
    if (!contributors) {
        return undefined;
    }
    if (Array.isArray(contributors)) {
        return contributors.join(", ");
    }
    return contributors;
}

// ── VS Code API ────────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};
// Declared globally by the extension host before this script runs.
declare const __pptbInitialView: ActiveView | undefined;

const vscodeApi = acquireVsCodeApi();

// ── Shared styles ──────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
    color: "var(--vscode-foreground)",
    fontFamily: "var(--vscode-font-family)",
    fontSize: "var(--vscode-font-size, 13px)",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
};

const tabBar: React.CSSProperties = {
    display: "flex",
    borderBottom: "1px solid var(--vscode-panel-border)",
    flexShrink: 0,
};

const toolbar: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    borderBottom: "1px solid var(--vscode-panel-border)",
    flexShrink: 0,
};

const searchInput: React.CSSProperties = {
    flex: 1,
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
    borderRadius: 2,
    padding: "4px 8px",
    fontSize: "inherit",
    fontFamily: "inherit",
    outline: "none",
};

const filterBar: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "6px 16px",
    borderBottom: "1px solid var(--vscode-panel-border)",
    flexShrink: 0,
    flexWrap: "wrap",
};

const selectInput: React.CSSProperties = {
    background: "var(--vscode-dropdown-background)",
    color: "var(--vscode-dropdown-foreground)",
    border: "1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))",
    borderRadius: 2,
    padding: "3px 6px",
    fontSize: "inherit",
    fontFamily: "inherit",
    outline: "none",
};

const checkboxLabel: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: "var(--vscode-foreground)",
    cursor: "pointer",
    userSelect: "none",
};

const favoriteBtn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 15,
    lineHeight: 1,
    padding: 2,
    flexShrink: 0,
    color: "var(--vscode-descriptionForeground)",
};

const listArea: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: "4px",
};

const cardGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
    gap: 12,
    padding: "12px",
    alignContent: "start",
};

const card: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 6,
    border: "1px solid var(--vscode-panel-border)",
    background: "var(--vscode-sideBar-background, var(--vscode-editor-background))",
    transition: "border-color 0.1s ease, box-shadow 0.1s ease",
};

const cardHover: React.CSSProperties = {
    border: "1px solid var(--vscode-focusBorder)",
};

const cardHeader: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
};

const cardFooter: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: "auto",
};

const categoryChip: React.CSSProperties = {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 10,
    background: "var(--vscode-badge-background)",
    color: "var(--vscode-badge-foreground)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
};

const iconBox: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 6,
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    flexShrink: 0,
};

const primaryBtn: React.CSSProperties = {
    padding: "6px 14px",
    border: "none",
    borderRadius: 2,
    cursor: "pointer",
    fontSize: "inherit",
    fontFamily: "inherit",
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    width: "100%",
};

const secondaryBtn: React.CSSProperties = {
    padding: "6px 14px",
    border: "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
    borderRadius: 2,
    cursor: "pointer",
    fontSize: "inherit",
    fontFamily: "inherit",
    background: "var(--vscode-button-secondaryBackground, transparent)",
    color: "var(--vscode-button-secondaryForeground, var(--vscode-foreground))",
};

const hint: React.CSSProperties = {
    fontSize: 11,
    color: "var(--vscode-descriptionForeground)",
    lineHeight: 1.5,
};

const clampText: React.CSSProperties = {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
};

// ── Tab button ─────────────────────────────────────────────────────────────────

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.ReactElement {
    return (
        <button
            onClick={onClick}
            style={{
                flex: 1,
                padding: "8px 12px",
                border: "none",
                borderBottom: active ? "2px solid var(--vscode-focusBorder)" : "2px solid transparent",
                background: "transparent",
                color: active ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                fontFamily: "var(--vscode-font-family)",
                fontSize: "var(--vscode-font-size, 13px)",
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
            }}
        >
            {label}
        </button>
    );
}

// ── Tool icon ──────────────────────────────────────────────────────────────────

function VerifiedBadge({ size = 15, title = "Verified Tool" }: { size?: number; title?: string }): React.ReactElement {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ verticalAlign: "middle", flexShrink: 0, display: "inline-block" }} aria-label={title}>
            <title>{title}</title>
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                fill="var(--vscode-charts-blue, #0078d4)"
                d="M6.34665 3.75195C6.83576 2.31412 8.39808 1.54513 9.83591 2.03417C9.94833 2.07242 10.0585 2.11747 10.165 2.16991L11.4482 2.80175C11.7962 2.97293 12.2038 2.97295 12.5517 2.80175L13.8349 2.16991C15.1974 1.49929 16.8457 2.06041 17.5166 3.42284L17.5898 3.58495L17.6533 3.75195L18.1133 5.10546C18.2382 5.47279 18.5272 5.76172 18.8945 5.88671L20.248 6.34667C21.6858 6.83586 22.4549 8.39812 21.9658 9.83593C21.9275 9.94843 21.8816 10.0584 21.8291 10.165L21.1982 11.4473C21.0268 11.7954 21.0269 12.2036 21.1982 12.5518L21.8291 13.835C22.4998 15.1975 21.9396 16.8457 20.5771 17.5166C20.4705 17.5691 20.3605 17.6151 20.248 17.6533L18.8945 18.1133C18.5272 18.2383 18.2382 18.5272 18.1133 18.8945L17.6533 20.248C17.1641 21.6857 15.6018 22.4547 14.164 21.9658C14.0516 21.9276 13.9415 21.8816 13.8349 21.8291L12.5517 21.1973C12.2039 21.0262 11.7961 21.0262 11.4482 21.1973L10.165 21.8291C8.80257 22.4998 7.15434 21.9394 6.48337 20.5771C6.43092 20.4706 6.3849 20.3605 6.34665 20.248L5.88669 18.8945C5.76171 18.5272 5.47279 18.2382 5.10544 18.1133L3.75192 17.6533C2.31423 17.1642 1.54524 15.6018 2.03415 14.1641C2.07237 14.0517 2.11749 13.9414 2.16989 13.835L2.80173 12.5518C2.9731 12.2036 2.97312 11.7954 2.80173 11.4473L2.16989 10.165C1.49919 8.80256 2.06046 7.15431 3.42282 6.48339C3.52942 6.43091 3.63944 6.38494 3.75192 6.34667L5.10544 5.88671C5.47281 5.76174 5.76172 5.47283 5.88669 5.10546L6.34665 3.75195ZM16.2803 8.96972C15.9874 8.67695 15.5126 8.67687 15.2197 8.96972L10.75 13.4394L8.78025 11.4697C8.48734 11.177 8.01255 11.1769 7.7197 11.4697C7.42695 11.7626 7.42697 12.2374 7.7197 12.5303L10.2197 15.0303C10.5126 15.3231 10.9873 15.3231 11.2802 15.0303L16.2803 10.0303C16.5731 9.73737 16.5731 9.26261 16.2803 8.96972Z"
            />
        </svg>
    );
}

/**
 * Tracks whether the active VS Code theme is dark/high-contrast-dark, mirroring the light/dark
 * split used by IconCacheManager when it pre-renders themed icon variants for the tree views.
 */
function useIsDarkTheme(): boolean {
    const getIsDark = () => !document.body.classList.contains("vscode-light") && !document.body.classList.contains("vscode-high-contrast-light");
    const [isDark, setIsDark] = useState(getIsDark);

    useEffect(() => {
        const observer = new MutationObserver(() => setIsDark(getIsDark()));
        observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    return isDark;
}

function ToolIcon({ icon, name, size = 40 }: { icon?: ToolIconSource; name: string; size?: number }): React.ReactElement {
    const isDarkTheme = useIsDarkTheme();
    const src = typeof icon === "string" ? icon : icon ? (isDarkTheme ? icon.dark : icon.light) : undefined;

    return (
        <div
            style={{
                ...iconBox,
                width: size,
                height: size,
                background: src ? "transparent" : "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
                fontSize: size * 0.4,
            }}
        >
            {src ? (
                <img
                    src={src}
                    alt={name}
                    style={{ width: size * 0.75, height: size * 0.75, objectFit: "contain", borderRadius: 4 }}
                    onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                        (e.currentTarget.parentElement as HTMLElement).style.background = "var(--vscode-button-background)";
                        (e.currentTarget.parentElement as HTMLElement).textContent = name[0].toUpperCase();
                    }}
                />
            ) : (
                name[0].toUpperCase()
            )}
        </div>
    );
}

// ── Installed Tools Tab ────────────────────────────────────────────────────────

function InstalledToolsTab(): React.ReactElement {
    const [tools, setTools] = useState<InstalledTool[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [sort, setSort] = useState<InstalledSortOption>("name-asc");
    const [filter, setFilter] = useState<InstalledFilterState>({});
    const [categories, setCategories] = useState<string[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());

    useEffect(() => {
        vscodeApi.postMessage({ type: "get-installed-tools" });

        const handler = (event: MessageEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = event.data as any;
            if (data?.type === "installed-tools") {
                setTools(data.tools ?? []);
                setSort(data.sort ?? "name-asc");
                setFilter(data.filter ?? {});
                setCategories(data.categories ?? []);
                setFavorites(new Set(data.favorites ?? []));
                setLoading(false);
            }
            if (data?.type === "uninstall-done") {
                setTools((prev) => prev.filter((t) => t.id !== data.toolId));
            }
        };

        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    const launchTool = (tool: InstalledTool) => {
        vscodeApi.postMessage({ type: "launch-tool", toolId: tool.id });
    };

    const uninstallTool = (tool: InstalledTool) => {
        vscodeApi.postMessage({ type: "uninstall-tool", toolId: tool.id });
    };

    const toggleFavorite = (tool: InstalledTool) => {
        vscodeApi.postMessage({ type: "toggle-favorite", toolId: tool.id });
    };

    const changeSort = (value: InstalledSortOption) => {
        setSort(value);
        vscodeApi.postMessage({ type: "set-installed-sort", sort: value });
    };

    const changeFilter = (next: InstalledFilterState) => {
        setFilter(next);
        vscodeApi.postMessage({ type: "set-installed-filter", filter: next });
    };

    // The extension host already applies the persisted sort/filter (category, verified-only);
    // only free-text search is filtered locally here.
    const filtered = tools.filter(
        (t) =>
            !search ||
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            (t.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (t.publisher ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (formatContributors(t.contributors) ?? "").toLowerCase().includes(search.toLowerCase()),
    );

    return (
        <>
            <div style={toolbar}>
                <input style={searchInput} type="text" placeholder="Search installed tools…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <span style={{ ...hint, flexShrink: 0 }}>
                    {filtered.length} / {tools.length}
                </span>
            </div>

            <div style={filterBar}>
                <select style={selectInput} value={sort} onChange={(e) => changeSort(e.target.value as InstalledSortOption)} aria-label="Sort installed tools">
                    <optgroup label="Sort">
                        {INSTALLED_SORT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </optgroup>
                </select>
                {categories.length > 0 && (
                    <select style={selectInput} value={filter.category ?? ""} onChange={(e) => changeFilter({ ...filter, category: e.target.value || undefined })} aria-label="Filter by category">
                        <optgroup label="Filter">
                            <option value="">All Categories</option>
                            {categories.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </optgroup>
                    </select>
                )}
                <label style={checkboxLabel}>
                    <input type="checkbox" checked={Boolean(filter.verifiedOnly)} onChange={(e) => changeFilter({ ...filter, verifiedOnly: e.target.checked || undefined })} />
                    Verified Only
                </label>
            </div>

            <div style={listArea}>
                {loading && <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>Loading…</div>}
                {!loading && filtered.length === 0 && <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>{search ? "No tools match your search." : "No tools installed."}</div>}
                {!loading && filtered.length > 0 && (
                    <div style={cardGrid}>
                        {filtered.map((tool) => {
                            const isHovered = hoveredId === tool.id;
                            const isFavorite = favorites.has(tool.id);
                            const contributorText = formatContributors(tool.contributors) || tool.publisher;
                            return (
                                <div key={tool.id} style={{ ...card, ...(isHovered ? cardHover : {}) }} onMouseEnter={() => setHoveredId(tool.id)} onMouseLeave={() => setHoveredId(null)}>
                                    <div style={cardHeader}>
                                        <ToolIcon icon={tool.icon} name={tool.name} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tool.name}</span>
                                                {tool.isVerified && <VerifiedBadge size={14} title="Verified Tool" />}
                                            </div>
                                            <div style={{ ...hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {contributorText ? `${contributorText} · v${tool.version}` : `v${tool.version}`}
                                            </div>
                                        </div>
                                        <button
                                            style={{ ...favoriteBtn, color: isFavorite ? "var(--vscode-charts-yellow, #e2c08d)" : favoriteBtn.color }}
                                            onClick={() => toggleFavorite(tool)}
                                            title={isFavorite ? "Remove from Favorites" : "Mark as Favorite"}
                                            aria-label={isFavorite ? "Remove from Favorites" : "Mark as Favorite"}
                                        >
                                            {isFavorite ? "★" : "☆"}
                                        </button>
                                    </div>
                                    <div style={{ ...hint, ...clampText, minHeight: 30 }}>{tool.description || " "}</div>
                                    <div style={cardFooter}>
                                        {tool.categories?.length ? <span style={categoryChip}>{tool.categories.join(", ")}</span> : null}
                                        <span style={{ flex: 1 }} />
                                        <button style={{ ...secondaryBtn, fontSize: 11, padding: "5px 10px" }} onClick={() => uninstallTool(tool)}>
                                            Uninstall
                                        </button>
                                        <button style={{ ...primaryBtn, width: "auto", fontSize: 11, padding: "5px 10px" }} onClick={() => launchTool(tool)}>
                                            Launch
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
}

// ── Marketplace Tab ────────────────────────────────────────────────────────────

function MarketplaceTab(): React.ReactElement {
    const [tools, setTools] = useState<RegistryTool[]>([]);
    const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [sort, setSort] = useState<MarketplaceSortOption>("name-asc");
    const [filter, setFilter] = useState<MarketplaceFilterState>({});
    const [categories, setCategories] = useState<string[]>([]);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchTools = (q: string) => {
        setLoading(true);
        setError(null);
        vscodeApi.postMessage({ type: "get-marketplace-tools", search: q || undefined });
    };

    useEffect(() => {
        fetchTools("");

        const handler = (event: MessageEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = event.data as any;
            if (data?.type === "marketplace-tools") {
                setTools(data.tools ?? []);
                setInstalledIds(new Set(data.installedIds ?? []));
                setSort(data.sort ?? "name-asc");
                setFilter(data.filter ?? {});
                setCategories(data.categories ?? []);
                setLoading(false);
            }
            if (data?.type === "marketplace-error") {
                setError(data.message ?? "Unknown error");
                setLoading(false);
            }
            if (data?.type === "install-done") {
                setInstalledIds((prev) => new Set([...prev, data.toolId]));
                setBusyIds((prev) => {
                    const n = new Set(prev);
                    n.delete(data.toolId);
                    return n;
                });
            }
            if (data?.type === "install-error") {
                setBusyIds((prev) => {
                    const n = new Set(prev);
                    n.delete(data.toolId);
                    return n;
                });
            }
            if (data?.type === "uninstall-done") {
                setInstalledIds((prev) => {
                    const n = new Set(prev);
                    n.delete(data.toolId);
                    return n;
                });
                setBusyIds((prev) => {
                    const n = new Set(prev);
                    n.delete(data.toolId);
                    return n;
                });
            }
        };

        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    const handleSearch = (q: string) => {
        setSearch(q);
        if (searchTimer.current) {
            clearTimeout(searchTimer.current);
        }
        searchTimer.current = setTimeout(() => fetchTools(q), 400);
    };

    const installTool = (tool: RegistryTool) => {
        setBusyIds((prev) => new Set([...prev, tool.id]));
        vscodeApi.postMessage({ type: "install-tool", toolId: tool.id });
    };

    const uninstallTool = (tool: RegistryTool) => {
        setBusyIds((prev) => new Set([...prev, tool.id]));
        vscodeApi.postMessage({ type: "uninstall-tool", toolId: tool.id });
    };

    const changeSort = (value: MarketplaceSortOption) => {
        setSort(value);
        vscodeApi.postMessage({ type: "set-marketplace-sort", sort: value });
    };

    const changeFilter = (next: MarketplaceFilterState) => {
        setFilter(next);
        vscodeApi.postMessage({ type: "set-marketplace-filter", filter: next });
    };

    // The extension host already applies search, persisted sort, and persisted filter
    // (category, verified-only) before sending `tools`, so no client-side re-sort is needed here.

    return (
        <>
            <div style={toolbar}>
                <input style={searchInput} type="text" placeholder="Search marketplace…" value={search} onChange={(e) => handleSearch(e.target.value)} />
                {!loading && <span style={{ ...hint, flexShrink: 0 }}>{tools.length} tools</span>}
            </div>

            <div style={filterBar}>
                <select style={selectInput} value={sort} onChange={(e) => changeSort(e.target.value as MarketplaceSortOption)} aria-label="Sort marketplace tools">
                    <optgroup label="Sort">
                        {MARKETPLACE_SORT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </optgroup>
                </select>
                {categories.length > 0 && (
                    <select style={selectInput} value={filter.category ?? ""} onChange={(e) => changeFilter({ ...filter, category: e.target.value || undefined })} aria-label="Filter by category">
                        <optgroup label="Filter">
                            <option value="">All Categories</option>
                            {categories.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </optgroup>
                    </select>
                )}
                <label style={checkboxLabel}>
                    <input type="checkbox" checked={Boolean(filter.verifiedOnly)} onChange={(e) => changeFilter({ ...filter, verifiedOnly: e.target.checked || undefined })} />
                    Verified Only
                </label>
            </div>

            <div style={listArea}>
                {loading && <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>Loading…</div>}
                {!loading && error && <div style={{ ...hint, padding: "24px 16px", textAlign: "center", color: "var(--vscode-errorForeground)" }}>{error}</div>}
                {!loading && !error && tools.length === 0 && (
                    <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>{search ? "No tools match your search." : "No tools in registry."}</div>
                )}
                {!loading && !error && tools.length > 0 && (
                    <div style={cardGrid}>
                        {tools.map((tool) => {
                            const isInstalled = installedIds.has(tool.id);
                            const isBusy = busyIds.has(tool.id);
                            const isHovered = hoveredId === tool.id;
                            const contributorText = formatContributors(tool.contributors) || tool.publisher;
                            const subtitle = contributorText ? `${contributorText} · v${tool.version}` : `v${tool.version}`;
                            return (
                                <div key={tool.id} style={{ ...card, ...(isHovered ? cardHover : {}) }} onMouseEnter={() => setHoveredId(tool.id)} onMouseLeave={() => setHoveredId(null)}>
                                    <div style={cardHeader}>
                                        <ToolIcon icon={tool.icon} name={tool.name} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tool.name}</span>
                                                {tool.isVerified && <VerifiedBadge size={14} title="Verified Tool" />}
                                            </div>
                                            <div style={{ ...hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
                                        </div>
                                    </div>
                                    <div style={{ ...hint, ...clampText, minHeight: 30 }}>{tool.description || " "}</div>
                                    <div style={cardFooter}>
                                        {tool.categories?.length ? <span style={categoryChip}>{tool.categories.join(", ")}</span> : null}
                                        {isInstalled && <span style={{ ...hint, color: "var(--vscode-testing-iconPassed, #73c991)" }}>✓ Installed</span>}
                                        <span style={{ flex: 1 }} />
                                        {isInstalled ? (
                                            <button disabled={isBusy} style={{ ...secondaryBtn, fontSize: 11, padding: "5px 10px", opacity: isBusy ? 0.5 : 1 }} onClick={() => uninstallTool(tool)}>
                                                {isBusy ? "…" : "Uninstall"}
                                            </button>
                                        ) : (
                                            <button
                                                disabled={isBusy}
                                                style={{ ...primaryBtn, width: "auto", fontSize: 11, padding: "5px 10px", opacity: isBusy ? 0.5 : 1 }}
                                                onClick={() => installTool(tool)}
                                            >
                                                {isBusy ? "…" : "Install"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App(): React.ReactElement {
    const [activeView, setActiveView] = useState<ActiveView>(typeof __pptbInitialView !== "undefined" ? __pptbInitialView : "installed");

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = event.data as any;
            if (data?.type === "set-active-view" && (data.view === "installed" || data.view === "marketplace")) {
                setActiveView(data.view as ActiveView);
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    return (
        <div style={page}>
            <div style={tabBar}>
                <TabButton label="Installed Tools" active={activeView === "installed"} onClick={() => setActiveView("installed")} />
                <TabButton label="Marketplace" active={activeView === "marketplace"} onClick={() => setActiveView("marketplace")} />
            </div>

            {activeView === "installed" ? <InstalledToolsTab /> : <MarketplaceTab />}
        </div>
    );
}
