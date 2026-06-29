import React, { useEffect, useRef, useState } from "react";

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
                <span style={{ fontWeight: 700, fontSize: 14 }}>{tool?.name ?? "Loading…"}</span>
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
