import React, { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

type ActiveView = "installed" | "marketplace";

interface InstalledTool {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    icon?: string;
    toolPath: string;
    installedAt: string;
}

interface RegistryTool {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    icon?: string;
    category?: string;
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

const listArea: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: "8px 0",
};

const toolRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 16px",
    cursor: "pointer",
    userSelect: "none",
};

const toolRowHover: React.CSSProperties = {
    background: "var(--vscode-list-hoverBackground)",
};

const toolRowActive: React.CSSProperties = {
    background: "var(--vscode-list-activeSelectionBackground)",
    color: "var(--vscode-list-activeSelectionForeground)",
};

const iconBox: React.CSSProperties = {
    width: 36,
    height: 36,
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

const hint: React.CSSProperties = {
    fontSize: 11,
    color: "var(--vscode-descriptionForeground)",
    lineHeight: 1.5,
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

function ToolIcon({ icon, name, selected }: { icon?: string; name: string; selected: boolean }): React.ReactElement {
    return (
        <div
            style={{
                ...iconBox,
                background: icon ? "transparent" : selected ? "var(--vscode-button-foreground)" : "var(--vscode-button-background)",
                color: selected ? "var(--vscode-button-background)" : "var(--vscode-button-foreground)",
                fontSize: 14,
            }}
        >
            {icon ? (
                <img
                    src={icon}
                    alt={name}
                    style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 4 }}
                    onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                        (e.currentTarget.parentElement as HTMLElement).style.background = selected ? "var(--vscode-button-foreground)" : "var(--vscode-button-background)";
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
    const [selected, setSelected] = useState<InstalledTool | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    useEffect(() => {
        vscodeApi.postMessage({ type: "get-installed-tools" });

        const handler = (event: MessageEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = event.data as any;
            if (data?.type === "installed-tools") {
                setTools(data.tools ?? []);
                setLoading(false);
            }
            if (data?.type === "uninstall-done") {
                setTools((prev) => prev.filter((t) => t.id !== data.toolId));
                setSelected((prev) => (prev?.id === data.toolId ? null : prev));
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

    const filtered = tools.filter(
        (t) =>
            !search ||
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            (t.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (t.publisher ?? "").toLowerCase().includes(search.toLowerCase()),
    );

    return (
        <>
            <div style={toolbar}>
                <input style={searchInput} type="text" placeholder="Search installed tools…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <span style={{ ...hint, flexShrink: 0 }}>
                    {filtered.length} / {tools.length}
                </span>
            </div>

            <div style={listArea}>
                {loading && <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>Loading…</div>}
                {!loading && filtered.length === 0 && <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>{search ? "No tools match your search." : "No tools installed."}</div>}
                {filtered.map((tool) => {
                    const isSelected = selected?.id === tool.id;
                    const isHovered = hoveredId === tool.id;
                    const rowStyle: React.CSSProperties = {
                        ...toolRow,
                        ...(isSelected ? toolRowActive : isHovered ? toolRowHover : {}),
                    };
                    return (
                        <div key={tool.id} style={rowStyle} onClick={() => setSelected(tool)} onMouseEnter={() => setHoveredId(tool.id)} onMouseLeave={() => setHoveredId(null)}>
                            <ToolIcon icon={tool.icon} name={tool.name} selected={isSelected} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tool.name}</div>
                                <div style={{ ...hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {tool.publisher ? `${tool.publisher} · v${tool.version}` : `v${tool.version}`}
                                </div>
                                {tool.description && <div style={{ ...hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tool.description}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 4, flexShrink: 0, opacity: isHovered || isSelected ? 1 : 0 }}>
                                <button
                                    style={{ ...primaryBtn, width: "auto", padding: "3px 10px", fontSize: 11 }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        launchTool(tool);
                                    }}
                                >
                                    Launch
                                </button>
                                <button
                                    style={{
                                        ...primaryBtn,
                                        width: "auto",
                                        padding: "3px 10px",
                                        fontSize: 11,
                                        background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
                                        color: "var(--vscode-button-foreground)",
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        uninstallTool(tool);
                                    }}
                                >
                                    Uninstall
                                </button>
                            </div>
                        </div>
                    );
                })}
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

    return (
        <>
            <div style={toolbar}>
                <input style={searchInput} type="text" placeholder="Search marketplace…" value={search} onChange={(e) => handleSearch(e.target.value)} />
                {!loading && <span style={{ ...hint, flexShrink: 0 }}>{tools.length} tools</span>}
            </div>

            <div style={listArea}>
                {loading && <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>Loading…</div>}
                {!loading && error && <div style={{ ...hint, padding: "24px 16px", textAlign: "center", color: "var(--vscode-errorForeground)" }}>{error}</div>}
                {!loading && !error && tools.length === 0 && (
                    <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>{search ? "No tools match your search." : "No tools in registry."}</div>
                )}
                {tools.map((tool) => {
                    const isInstalled = installedIds.has(tool.id);
                    const isBusy = busyIds.has(tool.id);
                    const isHovered = hoveredId === tool.id;
                    const rowStyle: React.CSSProperties = {
                        ...toolRow,
                        ...(isHovered ? toolRowHover : {}),
                        cursor: "default",
                    };
                    return (
                        <div key={tool.id} style={rowStyle} onMouseEnter={() => setHoveredId(tool.id)} onMouseLeave={() => setHoveredId(null)}>
                            <ToolIcon icon={tool.icon} name={tool.name} selected={false} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {tool.name}
                                    {isInstalled && <span style={{ ...hint, marginLeft: 6, color: "var(--vscode-testing-iconPassed, #73c991)" }}>✓ installed</span>}
                                </div>
                                <div style={{ ...hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {tool.publisher ? `${tool.publisher} · v${tool.version}` : `v${tool.version}`}
                                    {tool.category ? ` · ${tool.category}` : ""}
                                </div>
                                {tool.description && <div style={{ ...hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tool.description}</div>}
                            </div>
                            <div style={{ flexShrink: 0, opacity: isHovered ? 1 : 0 }}>
                                {isInstalled ? (
                                    <button
                                        disabled={isBusy}
                                        style={{
                                            ...primaryBtn,
                                            width: "auto",
                                            padding: "3px 10px",
                                            fontSize: 11,
                                            background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
                                            color: "var(--vscode-button-foreground)",
                                            opacity: isBusy ? 0.5 : 1,
                                        }}
                                        onClick={() => uninstallTool(tool)}
                                    >
                                        {isBusy ? "…" : "Uninstall"}
                                    </button>
                                ) : (
                                    <button disabled={isBusy} style={{ ...primaryBtn, width: "auto", padding: "3px 10px", fontSize: 11, opacity: isBusy ? 0.5 : 1 }} onClick={() => installTool(tool)}>
                                        {isBusy ? "…" : "Install"}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
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
