import React, { useEffect, useState } from "react";

type ToolIconSource = string | { light: string; dark: string };

type CspDirective = "connect-src" | "script-src" | "style-src" | "img-src" | "font-src" | "frame-src" | "media-src" | "mailto";

interface CspExceptionEntry {
    domain: string;
    exceptionReason?: string;
    optional?: boolean;
}

type CspExceptions = Partial<Record<CspDirective, CspExceptionEntry[]>>;

interface ToolCspPermissionState {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    contributors?: string[] | string;
    isVerified?: boolean;
    icon?: ToolIconSource;
    cspExceptions?: CspExceptions;
    hasExceptions: boolean;
    status: "granted" | "pending" | "none";
}

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

const DIRECTIVE_LABELS: Record<string, string> = {
    "connect-src": "Network Connect (connect-src)",
    "script-src": "Script (script-src)",
    "style-src": "Stylesheet (style-src)",
    "img-src": "Image (img-src)",
    "font-src": "Font (font-src)",
    "frame-src": "Embedded Frame (frame-src)",
    "media-src": "Media (media-src)",
    mailto: "Mailto link",
};

export const App: React.FC = () => {
    const [tools, setTools] = useState<ToolCspPermissionState[]>([]);
    const [filterStatus, setFilterStatus] = useState<"all" | "granted" | "pending">("all");
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const data = event.data;
            if (data?.type === "pptb:csp-state" && Array.isArray(data.tools)) {
                setTools(data.tools);
            }
        };

        window.addEventListener("message", handler);
        vscode?.postMessage({ type: "get-state" });

        return () => window.removeEventListener("message", handler);
    }, []);

    const handleGrant = (toolId: string) => {
        vscode?.postMessage({ type: "grant-consent", toolId });
    };

    const handleRevoke = (toolId: string) => {
        vscode?.postMessage({ type: "revoke-consent", toolId });
    };

    const handleRevokeAll = () => {
        vscode?.postMessage({ type: "revoke-all" });
    };

    const totalWithExceptions = tools.length;
    const grantedCount = tools.filter((t) => t.status === "granted").length;
    const pendingCount = tools.filter((t) => t.status === "pending").length;

    const filteredTools = tools.filter((tool) => {
        if (filterStatus === "granted" && tool.status !== "granted") {
            return false;
        }
        if (filterStatus === "pending" && tool.status !== "pending") {
            return false;
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchesName = tool.name.toLowerCase().includes(q);
            const matchesDesc = tool.description?.toLowerCase().includes(q) ?? false;
            const matchesPub = (typeof tool.publisher === "string" ? tool.publisher : "").toLowerCase().includes(q);
            if (!matchesName && !matchesDesc && !matchesPub) {
                return false;
            }
        }
        return true;
    });

    const renderIcon = (icon?: ToolIconSource) => {
        if (!icon) {
            return <div style={{ fontSize: "24px" }}>&#128230;</div>;
        }
        if (typeof icon === "string") {
            return <img src={icon} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} />;
        }
        return (
            <>
                <img src={icon.light} alt="" className="pptb-icon-light" style={{ width: 28, height: 28, objectFit: "contain" }} />
                <img src={icon.dark} alt="" className="pptb-icon-dark" style={{ width: 28, height: 28, objectFit: "contain" }} />
            </>
        );
    };

    return (
        <div
            style={{
                maxWidth: 960,
                margin: "0 auto",
                padding: "24px 16px",
                fontFamily: "var(--vscode-font-family)",
                color: "var(--vscode-foreground)",
            }}
        >
            <style>{`
                body.vscode-light .pptb-icon-dark { display: none; }
                body.vscode-light .pptb-icon-light { display: inline-block; }
                body.vscode-dark .pptb-icon-light { display: none; }
                body.vscode-dark .pptb-icon-dark { display: inline-block; }
                body.vscode-high-contrast .pptb-icon-light { display: none; }
                body.vscode-high-contrast .pptb-icon-dark { display: inline-block; }

                .stat-card {
                    flex: 1;
                    min-width: 140px;
                    padding: 12px 16px;
                    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
                    border-radius: 6px;
                    background: var(--vscode-editor-background);
                }
                .btn {
                    padding: 4px 12px;
                    font-size: 12px;
                    font-family: inherit;
                    border-radius: 3px;
                    cursor: pointer;
                    border: 1px solid transparent;
                }
                .btn-primary {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .btn-primary:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .btn-secondary {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .btn-secondary:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .btn-danger {
                    background: var(--vscode-errorForeground);
                    color: var(--vscode-editor-background);
                }
                .badge {
                    display: inline-block;
                    padding: 2px 8px;
                    font-size: 11px;
                    font-weight: 500;
                    border-radius: 12px;
                }
                .badge-granted {
                    background: rgba(40, 167, 69, 0.2);
                    color: #4cd137;
                    border: 1px solid rgba(40, 167, 69, 0.4);
                }
                .badge-pending {
                    background: rgba(255, 193, 7, 0.2);
                    color: #e1b12c;
                    border: 1px solid rgba(255, 193, 7, 0.4);
                }
                .badge-none {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                }
                .tool-card {
                    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
                    border-radius: 6px;
                    background: var(--vscode-editor-background);
                    margin-bottom: 16px;
                    overflow: hidden;
                }
                .table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .table th, .table td {
                    text-align: left;
                    padding: 8px 12px;
                    border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
                }
                .table th {
                    background: var(--vscode-sideBar-background);
                    font-weight: 600;
                }
            `}</style>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h1 style={{ margin: "0 0 6px 0", fontSize: 20, fontWeight: 600 }}>CSP Permissions &amp; Consent Review</h1>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--vscode-descriptionForeground)" }}>
                        Inspect external network, script, stylesheet, and embedding permissions declared by your installed tools.
                    </p>
                </div>
                {grantedCount > 0 && (
                    <button className="btn btn-secondary" onClick={handleRevokeAll} title="Revoke all approved CSP permissions across all tools">
                        Revoke All Consents
                    </button>
                )}
            </div>

            {/* Stat Cards */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                <div className="stat-card">
                    <div style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", textTransform: "uppercase" }}>Tools Requiring CSP</div>
                    <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{totalWithExceptions}</div>
                </div>
                <div className="stat-card">
                    <div style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", textTransform: "uppercase" }}>Approved</div>
                    <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: "#4cd137" }}>{grantedCount}</div>
                </div>
                <div className="stat-card">
                    <div style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", textTransform: "uppercase" }}>Pending Approval</div>
                    <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: "#e1b12c" }}>{pendingCount}</div>
                </div>
            </div>

            {/* Filter Bar */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
                <input
                    type="text"
                    placeholder="Search tools requiring CSP..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        flex: 1,
                        minWidth: 200,
                        padding: "6px 10px",
                        background: "var(--vscode-input-background)",
                        color: "var(--vscode-input-foreground)",
                        border: "1px solid var(--vscode-input-border, var(--vscode-widget-border))",
                        borderRadius: 3,
                        fontFamily: "inherit",
                        fontSize: 13,
                    }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                    {(
                        [
                            { id: "all", label: `All (${totalWithExceptions})` },
                            { id: "granted", label: `Approved (${grantedCount})` },
                            { id: "pending", label: `Pending (${pendingCount})` },
                        ] as const
                    ).map((f) => (
                        <button key={f.id} className={`btn ${filterStatus === f.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilterStatus(f.id)}>
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tool List */}
            {filteredTools.length === 0 ? (
                <div
                    style={{
                        textAlign: "center",
                        padding: "48px 16px",
                        border: "1px dashed var(--vscode-widget-border, var(--vscode-panel-border))",
                        borderRadius: 6,
                        color: "var(--vscode-descriptionForeground)",
                    }}
                >
                    No tools match the selected filters.
                </div>
            ) : (
                filteredTools.map((tool) => (
                    <div key={tool.id} className="tool-card">
                        <div
                            style={{
                                padding: "14px 16px",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 16,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>{renderIcon(tool.icon)}</div>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>{tool.name}</span>
                                        <span style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>v{tool.version}</span>
                                        {tool.isVerified && <span style={{ fontSize: 11, color: "var(--vscode-textLink-foreground)" }}>&#10003; Verified</span>}
                                    </div>
                                    {tool.description && <div style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", marginTop: 2 }}>{tool.description}</div>}
                                </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {tool.status === "granted" && <span className="badge badge-granted">&#10003; Consent Approved</span>}
                                {tool.status === "pending" && <span className="badge badge-pending">&#9888; Pending Consent</span>}
                                {tool.status === "none" && <span className="badge badge-none">No External Access Needed</span>}

                                {tool.status === "pending" && (
                                    <button className="btn btn-primary" onClick={() => handleGrant(tool.id)}>
                                        Grant Consent
                                    </button>
                                )}
                                {tool.status === "granted" && (
                                    <button className="btn btn-secondary" onClick={() => handleRevoke(tool.id)}>
                                        Revoke Consent
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Directives table if tool has declared exceptions */}
                        {tool.hasExceptions && tool.cspExceptions && (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th style={{ width: "25%" }}>Directive</th>
                                        <th style={{ width: "35%" }}>Domain</th>
                                        <th style={{ width: "40%" }}>Purpose / Reason</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(tool.cspExceptions).flatMap(([directive, entries]) =>
                                        (entries as CspExceptionEntry[]).map((entry, idx) => (
                                            <tr key={`${directive}-${idx}`}>
                                                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{DIRECTIVE_LABELS[directive] ?? directive}</td>
                                                <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                                                    {entry.domain}
                                                    {entry.optional && <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>(optional)</span>}
                                                </td>
                                                <td style={{ color: "var(--vscode-descriptionForeground)" }}>{entry.exceptionReason || "No description provided."}</td>
                                            </tr>
                                        )),
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                ))
            )}
        </div>
    );
};
