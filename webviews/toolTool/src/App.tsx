import React, { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface InstalledTool {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    contributors?: string[] | string;
    isVerified?: boolean;
    toolPath: string;
    installedAt: string;
}

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

// ── VS Code API ────────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

const vscodeApi = acquireVsCodeApi();

// ── Styles ─────────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
    color: "var(--vscode-foreground)",
    fontFamily: "var(--vscode-font-family)",
    fontSize: "var(--vscode-font-size, 13px)",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
};

const header: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 16px",
    borderBottom: "1px solid var(--vscode-panel-border)",
    flexShrink: 0,
};

const hint: React.CSSProperties = {
    fontSize: 11,
    color: "var(--vscode-descriptionForeground)",
    lineHeight: 1.5,
};

// ── App ───────────────────────────────────────────────────────────────────────

export default function App(): React.ReactElement {
    const [tool, setTool] = useState<InstalledTool | null>(null);
    const [toolHtml, setToolHtml] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        // Signal that the webview is ready to receive tool data
        vscodeApi.postMessage({ type: "tool:ready" });

        const handler = (event: MessageEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = event.data as any;

            // Messages originating from the tool iframe → forward to the extension
            if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
                vscodeApi.postMessage(data);
                return;
            }

            switch (data?.type) {
                case "pptb:init": {
                    const t: InstalledTool | undefined = data.tool;
                    const html: string | null = data.toolHtml ?? null;
                    if (t) {
                        setTool(t);
                    }
                    setToolHtml(html);
                    break;
                }
                case "pptb:context": {
                    // Forward context updates to the tool iframe so the polyfill stays in sync
                    iframeRef.current?.contentWindow?.postMessage(data, "*");
                    break;
                }
                case "pptb:response":
                case "pptb:event": {
                    // Forward extension responses and events into the tool iframe
                    iframeRef.current?.contentWindow?.postMessage(data, "*");
                    break;
                }
            }
        };

        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    return (
        <div style={page}>
            {/* Centered tool name header — no back button */}
            <div style={header}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{tool?.name ?? "Loading…"}</span>
                    {tool?.isVerified && <VerifiedBadge size={15} title="Verified Tool" />}
                </div>
            </div>

            {/* Tool content */}
            {toolHtml ? (
                <iframe ref={iframeRef} srcDoc={toolHtml} style={{ flex: 1, border: "none", width: "100%" }} title={tool?.name ?? "Tool"} />
            ) : (
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 12,
                    }}
                >
                    {tool ? (
                        <>
                            <div style={{ fontSize: 48, opacity: 0.3 }}>⚙</div>
                            <div style={{ fontWeight: 600, color: "var(--vscode-foreground)" }}>{tool.name} is ready</div>
                            {tool.description && <div style={{ ...hint, maxWidth: 360, textAlign: "center" }}>{tool.description}</div>}
                            <div style={{ ...hint, maxWidth: 360, textAlign: "center" }}>This tool does not have a web interface. Use the terminal or run it from the command line.</div>
                        </>
                    ) : (
                        <div style={hint}>Loading tool…</div>
                    )}
                </div>
            )}
        </div>
    );
}
