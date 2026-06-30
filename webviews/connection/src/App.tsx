import React, { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuthType = "InteractiveBrowser" | "ClientCredentials" | "UsernamePassword";

export interface Connection {
    id: string;
    name: string;
    url: string;
    environment: "Dev" | "Test" | "UAT" | "Production";
    authType: AuthType;
    clientId?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    tenantId?: string;
    category?: string;
    environmentColor?: string;
    categoryColor?: string;
    enabledForPowerPlatformAPI?: boolean;
    browser?: string;
    browserProfile?: string;
    createdAt?: string;
    lastUsedAt?: string;
}

// ── VS Code API ────────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

const vscodeApi = acquireVsCodeApi();

function generateId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AUTH_OPTIONS: { value: AuthType; label: string }[] = [
    { value: "InteractiveBrowser", label: "Microsoft Login (OAuth)" },
    { value: "ClientCredentials", label: "Client Credentials (Service Principal)" },
    { value: "UsernamePassword", label: "Username / Password" },
];

const ENVIRONMENTS: Connection["environment"][] = ["Dev", "Test", "UAT", "Production"];

const BROWSERS = ["System Default", "Chrome", "Firefox", "Edge", "Safari"];

const ENV_DEFAULT_COLORS: Record<Connection["environment"], string> = {
    Dev: "#2d883e",
    Test: "#d9a84e",
    UAT: "#d97706",
    Production: "#dc2626",
};

// ── Shared VS Code–themed styles ───────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
    borderRadius: 2,
    padding: "5px 8px",
    fontSize: "inherit",
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
    ...inputStyle,
    background: "var(--vscode-dropdown-background)",
    color: "var(--vscode-dropdown-foreground)",
    border: "1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))",
    cursor: "pointer",
};

const labelCss: React.CSSProperties = {
    display: "block",
    marginBottom: 4,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--vscode-foreground)",
};

const hintCss: React.CSSProperties = {
    display: "block",
    marginTop: 3,
    fontSize: 11,
    color: "var(--vscode-descriptionForeground)",
    lineHeight: 1.4,
};

const sectionBox: React.CSSProperties = {
    border: "1px solid var(--vscode-panel-border)",
    borderRadius: 2,
    padding: "12px 14px",
};

const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground))",
    marginBottom: 14,
};

const secondaryBtnStyle: React.CSSProperties = {
    padding: "5px 14px",
    border: "none",
    borderRadius: 2,
    cursor: "pointer",
    fontSize: "inherit",
    fontFamily: "inherit",
    background: "var(--vscode-button-secondaryBackground)",
    color: "var(--vscode-button-secondaryForeground)",
};

const primaryBtnStyle: React.CSSProperties = {
    padding: "5px 14px",
    border: "none",
    borderRadius: 2,
    cursor: "pointer",
    fontSize: "inherit",
    fontFamily: "inherit",
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
};

// ── Field wrapper ──────────────────────────────────────────────────────────────

function Field({ label, required, hint, children, style }: { label: string; required?: boolean; hint?: string; children: React.ReactNode; style?: React.CSSProperties }): React.ReactElement {
    return (
        <div style={{ marginBottom: 14, ...style }}>
            <label style={labelCss}>
                {label}
                {required && (
                    <span
                        style={{
                            color: "var(--vscode-inputValidation-errorForeground, #f48771)",
                            marginLeft: 2,
                        }}
                    >
                        *
                    </span>
                )}
            </label>
            {children}
            {hint && <span style={hintCss}>{hint}</span>}
        </div>
    );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App(): React.ReactElement {
    const [conn, setConn] = useState<Connection>({
        id: generateId(),
        name: "",
        url: "",
        environment: "Dev",
        authType: "InteractiveBrowser",
    });
    const [isEditing, setIsEditing] = useState(false);

    // Category state
    const [localCategories, setLocalCategories] = useState<string[]>([]);
    const [categoryColors, setCategoryColors] = useState<Record<string, string>>({});
    const [showNewCategory, setShowNewCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");

    useEffect(() => {
        const handler = (
            event: MessageEvent<{
                type: string;
                connection?: Connection;
                categories?: string[];
                categoryColors?: Record<string, string>;
            }>,
        ) => {
            if (event.data.type === "pptb:init") {
                if (event.data.categories) {
                    setLocalCategories(event.data.categories);
                }
                if (event.data.categoryColors) {
                    setCategoryColors(event.data.categoryColors);
                }
                if (event.data.connection) {
                    setConn(event.data.connection);
                    setIsEditing(true);
                }
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    const update = (patch: Partial<Connection>) => setConn((prev) => ({ ...prev, ...patch }));

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        vscodeApi.postMessage({ type: "pptb:save", connection: conn });
    };

    const handleCancel = () => vscodeApi.postMessage({ type: "pptb:cancel" });

    const addNewCategory = () => {
        const name = newCategoryName.trim();
        if (!name) return;
        if (!localCategories.includes(name)) {
            setLocalCategories((prev) => [...prev, name].sort());
        }
        const autoColor = categoryColors[name];
        update({ category: name, categoryColor: autoColor });
        setShowNewCategory(false);
        setNewCategoryName("");
    };

    const canSave = conn.name.trim().length > 0 && conn.url.trim().length > 0;

    // ── Auth-specific credentials section ─────────────────────────────────────
    let authTitle = "MICROSOFT LOGIN OPTIONS";
    let authSection: React.ReactElement;

    if (conn.authType === "InteractiveBrowser") {
        authSection = (
            <>
                <Field label="Username / Email (Optional)" hint="Pre-fill the login prompt with a specific email address. Leave empty to choose from browser accounts.">
                    <input style={inputStyle} type="text" value={conn.username ?? ""} placeholder="user@domain.com" onChange={(e) => update({ username: e.target.value || undefined })} />
                </Field>
                <Field label="Client ID (Optional)" hint="Use a custom App Registration instead of the default PPTB client.">
                    <input
                        style={inputStyle}
                        type="text"
                        value={conn.clientId ?? ""}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        onChange={(e) => update({ clientId: e.target.value || undefined })}
                    />
                </Field>
                <Field label="Tenant ID (Optional)" hint="Restrict sign-in to a specific Azure AD tenant." style={{ marginBottom: 0 }}>
                    <input
                        style={inputStyle}
                        type="text"
                        value={conn.tenantId ?? ""}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        onChange={(e) => update({ tenantId: e.target.value || undefined })}
                    />
                </Field>
            </>
        );
    } else if (conn.authType === "ClientCredentials") {
        authTitle = "SERVICE PRINCIPAL";
        authSection = (
            <>
                <Field label="Tenant ID" required>
                    <input
                        style={inputStyle}
                        type="text"
                        value={conn.tenantId ?? ""}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        onChange={(e) => update({ tenantId: e.target.value || undefined })}
                    />
                </Field>
                <Field label="Client ID" required>
                    <input
                        style={inputStyle}
                        type="text"
                        value={conn.clientId ?? ""}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        onChange={(e) => update({ clientId: e.target.value || undefined })}
                    />
                </Field>
                <Field label="Client Secret" required style={{ marginBottom: 0 }}>
                    <input
                        style={inputStyle}
                        type="password"
                        value={conn.clientSecret ?? ""}
                        placeholder="Your client secret value"
                        onChange={(e) => update({ clientSecret: e.target.value || undefined })}
                    />
                </Field>
            </>
        );
    } else {
        authTitle = "USER CREDENTIALS";
        authSection = (
            <>
                <Field label="Username" required>
                    <input style={inputStyle} type="text" value={conn.username ?? ""} placeholder="user@domain.com" onChange={(e) => update({ username: e.target.value || undefined })} />
                </Field>
                <Field label="Password" required>
                    <input style={inputStyle} type="password" value={conn.password ?? ""} placeholder="Your password" onChange={(e) => update({ password: e.target.value || undefined })} />
                </Field>
                <Field label="Tenant ID (Optional)" style={{ marginBottom: 0 }}>
                    <input
                        style={inputStyle}
                        type="text"
                        value={conn.tenantId ?? ""}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        onChange={(e) => update({ tenantId: e.target.value || undefined })}
                    />
                </Field>
            </>
        );
    }

    return (
        <div
            style={{
                padding: "20px 24px 28px",
                maxWidth: 760,
                color: "var(--vscode-foreground)",
                fontFamily: "var(--vscode-font-family)",
                fontSize: "var(--vscode-font-size, 13px)",
            }}
        >
            {/* Breadcrumb */}
            <div
                style={{
                    fontSize: 11,
                    color: "var(--vscode-descriptionForeground)",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                }}
            >
                CONNECTIONS
            </div>

            {/* Title */}
            <h1
                style={{
                    margin: "0 0 24px",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--vscode-foreground)",
                }}
            >
                {isEditing ? "Edit Connection" : "Add Dataverse Connection"}
            </h1>

            <form onSubmit={handleSave}>
                {/* Row 1: Connection Name + Auth Type */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <Field label="Connection Name" required>
                        <input style={inputStyle} type="text" value={conn.name} placeholder="Production" autoFocus onChange={(e) => update({ name: e.target.value })} />
                    </Field>
                    <Field label="Authentication Type" required>
                        <select style={selectStyle} value={conn.authType} onChange={(e) => update({ authType: e.target.value as AuthType })}>
                            {AUTH_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </Field>
                </div>

                {/* Enable for Power Platform API */}
                <div style={{ marginBottom: 16 }}>
                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={conn.enabledForPowerPlatformAPI ?? false}
                            onChange={(e) =>
                                update({
                                    enabledForPowerPlatformAPI: e.target.checked || undefined,
                                })
                            }
                        />
                        <span style={{ fontWeight: 600 }}>Enable for Power Platform API</span>
                    </label>
                    <span style={{ ...hintCss, marginLeft: 22 }}>Check this to allow this connection to be used for Power Platform API tools.</span>
                </div>

                {/* Environment URL */}
                <Field label="Environment URL" required hint="The root URL of your Dataverse / Power Platform environment.">
                    <input style={inputStyle} type="url" value={conn.url} placeholder="https://org.crm.dynamics.com" onChange={(e) => update({ url: e.target.value })} />
                </Field>

                {/* Environment + Color */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <Field label="Environment">
                        <select
                            style={selectStyle}
                            value={conn.environment}
                            onChange={(e) =>
                                update({
                                    environment: e.target.value as Connection["environment"],
                                })
                            }
                        >
                            {ENVIRONMENTS.map((env) => (
                                <option key={env} value={env}>
                                    {env}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Environment Color">
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                                type="color"
                                value={conn.environmentColor ?? ENV_DEFAULT_COLORS[conn.environment]}
                                onChange={(e) => update({ environmentColor: e.target.value })}
                                style={{
                                    width: 32,
                                    height: 26,
                                    padding: 1,
                                    border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
                                    borderRadius: 2,
                                    background: "var(--vscode-input-background)",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                }}
                            />
                            <input
                                style={{ ...inputStyle, flex: 1 }}
                                type="text"
                                value={conn.environmentColor ?? ""}
                                placeholder={ENV_DEFAULT_COLORS[conn.environment]}
                                maxLength={7}
                                onChange={(e) => update({ environmentColor: e.target.value || undefined })}
                            />
                            <button type="button" onClick={() => update({ environmentColor: undefined })} style={{ ...secondaryBtnStyle, flexShrink: 0 }}>
                                Reset
                            </button>
                        </div>
                    </Field>
                </div>

                {/* Category + Category Color */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <Field label="Category (Optional)">
                        <select
                            style={selectStyle}
                            value={showNewCategory ? "__new__" : (conn.category ?? "")}
                            onChange={(e) => {
                                if (e.target.value === "__new__") {
                                    setShowNewCategory(true);
                                } else {
                                    setShowNewCategory(false);
                                    setNewCategoryName("");
                                    const cat = e.target.value || undefined;
                                    const autoColor = cat ? (categoryColors[cat] ?? undefined) : undefined;
                                    update({ category: cat, categoryColor: autoColor });
                                }
                            }}
                        >
                            <option value="">-- None --</option>
                            {localCategories.map((cat) => (
                                <option key={cat} value={cat}>
                                    {cat}
                                </option>
                            ))}
                            <option value="__new__">+ New Category…</option>
                        </select>
                        {showNewCategory && (
                            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                <input
                                    style={{ ...inputStyle, flex: 1 }}
                                    type="text"
                                    value={newCategoryName}
                                    placeholder="Category name"
                                    autoFocus
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            addNewCategory();
                                        } else if (e.key === "Escape") {
                                            setShowNewCategory(false);
                                            setNewCategoryName("");
                                        }
                                    }}
                                />
                                <button type="button" style={primaryBtnStyle} onClick={addNewCategory}>
                                    Add
                                </button>
                                <button
                                    type="button"
                                    style={secondaryBtnStyle}
                                    onClick={() => {
                                        setShowNewCategory(false);
                                        setNewCategoryName("");
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </Field>
                    {conn.category ? (
                        <Field label="Category Color (Optional)">
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                    type="color"
                                    value={conn.categoryColor ?? categoryColors[conn.category] ?? "#888888"}
                                    onChange={(e) => update({ categoryColor: e.target.value })}
                                    style={{
                                        width: 32,
                                        height: 26,
                                        padding: 1,
                                        border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
                                        borderRadius: 2,
                                        background: "var(--vscode-input-background)",
                                        cursor: "pointer",
                                        flexShrink: 0,
                                    }}
                                />
                                <input
                                    style={{ ...inputStyle, flex: 1 }}
                                    type="text"
                                    value={conn.categoryColor ?? ""}
                                    placeholder={categoryColors[conn.category] ?? "#888888"}
                                    maxLength={7}
                                    onChange={(e) => update({ categoryColor: e.target.value || undefined })}
                                />
                                <button type="button" onClick={() => update({ categoryColor: undefined })} style={{ ...secondaryBtnStyle, flexShrink: 0 }}>
                                    Reset
                                </button>
                            </div>
                        </Field>
                    ) : (
                        <div />
                    )}
                </div>

                {/* Two sections: Browser Settings + Auth Credentials */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 16,
                        marginBottom: 28,
                    }}
                >
                    {/* Browser Settings */}
                    <div style={sectionBox}>
                        <div style={sectionTitle}>Browser Settings (Optional)</div>
                        <Field label="Browser" hint="Choose which browser to use when opening URLs with authentication. Defaults to your system's default browser.">
                            <select
                                style={selectStyle}
                                value={conn.browser ?? "System Default"}
                                onChange={(e) =>
                                    update({
                                        browser: e.target.value === "System Default" ? undefined : e.target.value,
                                    })
                                }
                            >
                                {BROWSERS.map((b) => (
                                    <option key={b} value={b}>
                                        {b}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Browser Profile" style={{ marginBottom: 0 }}>
                            <input style={inputStyle} type="text" value={conn.browserProfile ?? ""} placeholder="Default" onChange={(e) => update({ browserProfile: e.target.value || undefined })} />
                        </Field>
                    </div>

                    {/* Auth credentials section */}
                    <div style={sectionBox}>
                        <div style={sectionTitle}>{authTitle}</div>
                        {authSection}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" onClick={handleCancel} style={secondaryBtnStyle}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!canSave}
                        style={{
                            ...primaryBtnStyle,
                            opacity: canSave ? 1 : 0.5,
                            cursor: canSave ? "pointer" : "not-allowed",
                        }}
                    >
                        {isEditing ? "Save" : "Add"}
                    </button>
                </div>
            </form>
        </div>
    );
}
