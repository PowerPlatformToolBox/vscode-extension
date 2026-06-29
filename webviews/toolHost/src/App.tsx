import React, { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface InstalledTool {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    toolPath: string;
    installedAt: string;
}

// ── VS Code API ────────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

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

const toolbar: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
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

// ── App ───────────────────────────────────────────────────────────────────────

export default function App(): React.ReactElement {
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
        };

        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    const launchTool = (tool: InstalledTool) => {
        // Ask the extension to open this tool in a separate "PPTB Tool" panel
        vscodeApi.postMessage({ type: "launch-tool", toolId: tool.id });
    };

    const filtered = tools.filter(
        (t) =>
            !search ||
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            (t.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (t.publisher ?? "").toLowerCase().includes(search.toLowerCase()),
    );

    return (
        <div style={page}>
            {/* Toolbar */}
            <div style={toolbar}>
                <span
                    style={{
                        fontSize: 13,
                        fontWeight: 600,
                        flexShrink: 0,
                        color: "var(--vscode-foreground)",
                    }}
                >
                    Installed Tools
                </span>
                <input style={searchInput} type="text" placeholder="Search tools…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <span style={{ ...hint, flexShrink: 0 }}>
                    {filtered.length} / {tools.length}
                </span>
            </div>

            {/* Tool list */}
            <div style={listArea}>
                {loading && <div style={{ ...hint, padding: "24px 16px", textAlign: "center" }}>Loading tools…</div>}
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
                            <div
                                style={{
                                    ...iconBox,
                                    background: isSelected ? "var(--vscode-button-foreground)" : "var(--vscode-button-background)",
                                    color: isSelected ? "var(--vscode-button-background)" : "var(--vscode-button-foreground)",
                                    fontSize: 14,
                                }}
                            >
                                {tool.name[0].toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                    style={{
                                        fontWeight: 600,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {tool.name}
                                </div>
                                <div
                                    style={{
                                        ...hint,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {tool.publisher ? `${tool.publisher} · v${tool.version}` : `v${tool.version}`}
                                </div>
                                {tool.description && (
                                    <div
                                        style={{
                                            ...hint,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {tool.description}
                                    </div>
                                )}
                            </div>
                            <button
                                style={{
                                    ...primaryBtn,
                                    width: "auto",
                                    padding: "3px 10px",
                                    fontSize: 11,
                                    flexShrink: 0,
                                    opacity: isHovered || isSelected ? 1 : 0,
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    launchTool(tool);
                                }}
                            >
                                Launch
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
