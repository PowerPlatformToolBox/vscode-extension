import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useState } from "react";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

interface Model {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    contributors?: string[] | string;
    isVerified?: boolean;
    categories?: string[];
    capabilityTags?: string[];
    icon?: string | { light: string; dark: string };
    downloads?: number;
    rating?: number;
    mau?: number;
    readmeUrl?: string;
    repository?: string;
    website?: string;
    license?: string;
    status?: string;
    isInstalled: boolean;
    installedVersion?: string;
    latestVersion?: string;
    hasUpdate?: boolean;
    verifiedIcon?: { light: string; dark: string };
}

const contributors = (value?: string[] | string) => (Array.isArray(value) ? value.join(", ") : value);
const isDark = () => !document.body.classList.contains("vscode-light") && !document.body.classList.contains("vscode-high-contrast-light");

export default function App(): React.ReactElement {
    const [model, setModel] = useState<Model | null>(null);
    const [readme, setReadme] = useState("Loading documentation…");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const data = event.data as { type?: string; model?: Model; message?: string; markdown?: string };
            if (data.type === "state" && data.model) {
                setModel(data.model);
                setBusy(false);
                if (!data.model.readmeUrl) setReadme("Documentation is not available for this tool.");
            }
            if (data.type === "error") {
                setError(data.message ?? "Tool action failed.");
                setBusy(false);
            }
            if (data.type === "readme") setReadme(data.markdown ?? "Documentation is not available for this tool.");
        };
        window.addEventListener("message", handler);
        vscode.postMessage({ type: "ready" });
        return () => window.removeEventListener("message", handler);
    }, []);

    if (!model) return <main className="loading">Loading tool details…</main>;
    const icon = typeof model.icon === "string" ? model.icon : model.icon ? (isDark() ? model.icon.dark : model.icon.light) : "";
    const action = (type: string) => {
        setBusy(true);
        setError("");
        vscode.postMessage({ type, toolId: model.id });
    };
    const openLink = (url?: string) => {
        if (url?.startsWith("https://")) vscode.postMessage({ type: "open-link", url });
    };
    const concernUrl = `https://github.com/PowerPlatformToolBox/desktop-app/issues/new?template=issue-form-bug.yml&title=${encodeURIComponent(`Concern about tool: ${model.name}`)}&body=${encodeURIComponent(`Tool name: ${model.name}\nTool ID: ${model.id}\nTool version: ${model.version}\n\nPlease describe the concern:`)}`;
    const readmeHtml = DOMPurify.sanitize(resolveReadmeImages(marked.parse(readme, { async: false }), model.readmeUrl), {
        ALLOWED_TAGS: [
            "a",
            "blockquote",
            "br",
            "code",
            "del",
            "em",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "hr",
            "img",
            "li",
            "ol",
            "p",
            "pre",
            "strong",
            "table",
            "tbody",
            "td",
            "th",
            "thead",
            "tr",
            "ul",
        ],
        ALLOWED_ATTR: ["alt", "height", "href", "rel", "src", "target", "title", "width"],
        ALLOW_DATA_ATTR: false,
    });
    return (
        <main>
            <header className="hero">
                <div className="icon">{icon ? <img src={icon} alt="" /> : model.name.slice(0, 1).toUpperCase()}</div>
                <div className="heroText">
                    <div className="eyebrow">{model.categories?.join(" · ") || "Power Platform Tool"}</div>
                    <h1>
                        {model.name}{" "}
                        {model.isVerified && model.verifiedIcon && (
                            <img className="verified" src={isDark() ? model.verifiedIcon.dark : model.verifiedIcon.light} alt="Verified Tool" title="Verified Tool" />
                        )}
                    </h1>
                    <p>{model.description || "No description available."}</p>
                    <div className="byline">{contributors(model.contributors) || model.publisher || "Unknown contributor"}</div>
                </div>
            </header>
            <section className="actions">
                <button onClick={() => action(model.isInstalled ? "launch" : "install")} disabled={busy}>
                    {busy ? "Working…" : model.isInstalled ? "Launch" : "Install"}
                </button>
                {model.isInstalled && model.hasUpdate && (
                    <button className="secondary" onClick={() => action("update")} disabled={busy}>
                        Update to v{model.latestVersion}
                    </button>
                )}
                {model.isInstalled && (
                    <button className="secondary" onClick={() => action("uninstall")} disabled={busy}>
                        Uninstall
                    </button>
                )}
            </section>
            {error && <div className="error">{error}</div>}
            <section className="stats">
                {[
                    ["Version", model.isInstalled && model.installedVersion ? `${model.installedVersion}${model.hasUpdate ? ` → ${model.latestVersion}` : ""}` : model.version],
                    ["Downloads", model.downloads?.toLocaleString()],
                    ["Rating", model.rating?.toFixed(1)],
                    ["MAU", model.mau?.toLocaleString()],
                    ["License", model.license],
                ]
                    .filter((entry) => entry[1])
                    .map(([label, value]) => (
                        <div key={label}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                        </div>
                    ))}
            </section>
            <div className="links">
                {[
                    ["Repository", model.repository],
                    ["Website", model.website],
                ].map(
                    ([label, url]) =>
                        url && (
                            <button key={label} className="link" onClick={() => openLink(url)}>
                                {label}
                            </button>
                        ),
                )}
                <button className="link" onClick={() => openLink(`https://www.powerplatformtoolbox.com/rate-tool?toolId=${encodeURIComponent(model.id)}`)}>
                    Leave a review
                </button>
                <button className="link concern" onClick={() => openLink(concernUrl)}>
                    Report a concern
                </button>
            </div>
            {model.capabilityTags?.length ? (
                <div className="tags">
                    {model.capabilityTags.map((tag) => (
                        <span key={tag}>{tag}</span>
                    ))}
                </div>
            ) : null}
            <section className="readme">
                <div
                    className="markdown"
                    dangerouslySetInnerHTML={{ __html: readmeHtml }}
                    onClick={(event) => {
                        const anchor = (event.target as HTMLElement).closest("a");
                        if (anchor) {
                            event.preventDefault();
                            openLink(anchor.getAttribute("href") ?? undefined);
                        }
                    }}
                />
            </section>
            <style>{styles}</style>
        </main>
    );
}

function resolveReadmeImages(html: string, readmeUrl?: string): string {
    if (!readmeUrl) return html;
    const documentFragment = new DOMParser().parseFromString(html, "text/html");
    documentFragment.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
        const source = image.getAttribute("src");
        if (!source) return;
        try {
            const resolved = new URL(source, readmeUrl);
            if (resolved.protocol === "https:") image.setAttribute("src", resolved.toString());
            else image.remove();
        } catch {
            image.remove();
        }
    });
    return documentFragment.body.innerHTML;
}

const styles = `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px)}main{max-width:1100px;margin:0 auto;padding:32px;display:flex;flex-direction:column;gap:20px}.hero{display:flex;gap:24px;align-items:flex-start}.icon{width:96px;height:96px;flex:none;border:1px solid var(--vscode-panel-border);border-radius:16px;background:var(--vscode-sideBar-background);display:grid;place-items:center;font-size:36px;font-weight:600}.icon img{max-width:76px;max-height:76px}.heroText{min-width:0}.eyebrow{color:var(--vscode-descriptionForeground);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.hero h1{margin:6px 0;font-size:28px}.hero p{margin:0 0 8px;color:var(--vscode-descriptionForeground);line-height:1.5}.byline{color:var(--vscode-descriptionForeground)}.verified{width:18px;height:18px;vertical-align:-2px}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:2px;padding:7px 16px;cursor:pointer}.actions button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-button-border,var(--vscode-panel-border))}.actions button:disabled{opacity:.6;cursor:default}.error{color:var(--vscode-errorForeground)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--vscode-panel-border);border:1px solid var(--vscode-panel-border)}.stats div{padding:12px;background:var(--vscode-sideBar-background);display:flex;flex-direction:column;gap:4px}.stats span{color:var(--vscode-descriptionForeground);font-size:11px}.links,.tags{display:flex;gap:12px;flex-wrap:wrap}.link{color:var(--vscode-textLink-foreground);background:none;border:0;padding:0;cursor:pointer}.link.concern{color:var(--vscode-errorForeground)}.tags span{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:10px;padding:3px 9px;font-size:11px}.readme{border:1px solid var(--vscode-panel-border);border-radius:12px;padding:20px;background:color-mix(in srgb,var(--vscode-editor-background) 94%,var(--vscode-foreground))}.markdown{line-height:1.55}.markdown img{max-width:100%;height:auto}.markdown a{color:var(--vscode-textLink-foreground)}.markdown pre{overflow:auto;background:var(--vscode-textCodeBlock-background);padding:12px}.markdown code{font-family:var(--vscode-editor-font-family)}.markdown table{border-collapse:collapse;width:100%}.markdown th,.markdown td{border:1px solid var(--vscode-panel-border);padding:6px 8px;text-align:left}.loading{padding:32px}.error{white-space:pre-wrap}`;
