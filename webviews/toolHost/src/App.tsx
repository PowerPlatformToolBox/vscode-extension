import React, { useCallback, useEffect, useRef, useState } from "react";

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

const detailPane: React.CSSProperties = {
  width: 280,
  borderLeft: "1px solid var(--vscode-panel-border)",
  padding: "20px 16px",
  overflowY: "auto",
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const badge: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  background: "var(--vscode-badge-background)",
  color: "var(--vscode-badge-foreground)",
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
  ...primaryBtn,
  background: "var(--vscode-button-secondaryBackground)",
  color: "var(--vscode-button-secondaryForeground)",
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

  // "list" = browser view; "tool" = a specific tool is running
  const [view, setView] = useState<"list" | "tool">("list");
  const [toolHtml, setToolHtml] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const launchTool = useCallback((tool: InstalledTool) => {
    setSelected(tool);
    vscodeApi.postMessage({
      type: "set-tool-context",
      context: { toolId: tool.id, connectionUrl: null },
    });
  }, []);

  // Request installed tools on mount; handle all inbound messages
  useEffect(() => {
    vscodeApi.postMessage({ type: "get-installed-tools" });

    const handler = (event: MessageEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = event.data as any;

      // Messages originating from the tool iframe → forward to the extension
      if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
        vscodeApi.postMessage(data);
        return;
      }

      switch (data?.type) {
        case "installed-tools": {
          const loadedTools: InstalledTool[] = data.tools ?? [];
          setTools(loadedTools);
          setLoading(false);

          // A specific tool was requested when the panel was opened
          const initialId: string | undefined = data.initialToolId;
          if (initialId) {
            const tool = loadedTools.find((t) => t.id === initialId);
            if (tool) {
              launchTool(tool);
            }
          }
          break;
        }

        case "navigate-to-tool": {
          // Panel already existed; user launched a different tool from the tree
          const tool: InstalledTool | undefined = data.tool;
          const toolId: string | undefined = data.toolId;

          if (tool) {
            setTools((prev) =>
              prev.find((t) => t.id === tool.id) ? prev : [...prev, tool]
            );
            setLoading(false);
            launchTool(tool);
          } else if (toolId) {
            setTools((prev) => {
              const found = prev.find((t) => t.id === toolId);
              if (found) {
                launchTool(found);
              }
              return prev;
            });
          }
          break;
        }

        case "pptb:context": {
          // Panel confirmed the tool context; switch to the tool view
          const ctx: { toolId: string | null } = data.context ?? {};
          const html: string | null = data.toolHtml ?? null;

          if (ctx.toolId) {
            setToolHtml(html);
            setView("tool");
          }
          // Forward pptb:context to the iframe so the tool's polyfill can
          // update window.TOOLBOX_CONTEXT with the latest connection info.
          iframeRef.current?.contentWindow?.postMessage(data, "*");
          break;
        }

        case "pptb:response":
        case "pptb:event": {
          // Forward extension responses / events into the tool iframe so the
          // polyfill's pending promises resolve correctly.
          iframeRef.current?.contentWindow?.postMessage(data, "*");
          break;
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [launchTool]);

  const filtered = tools.filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.publisher ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleOpenFolder = (tool: InstalledTool) => {
    vscodeApi.postMessage({
      type: "pptb:request",
      namespace: "utils",
      method: "openInConnectionBrowser",
      args: [`vscode://file/${tool.toolPath}`],
      requestId: `open-${tool.id}`,
    });
  };

  const renderDetail = () => {
    if (!selected) {
      return (
        <div style={{ ...hint, padding: "20px 0", textAlign: "center" }}>
          Select a tool to see details
        </div>
      );
    }
    return (
      <>
        <div style={iconBox as React.CSSProperties}>{selected.name[0]}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
            {selected.name}
          </div>
          <span style={badge}>{selected.version}</span>
          {selected.publisher && (
            <div style={{ ...hint, marginTop: 4 }}>{selected.publisher}</div>
          )}
        </div>
        {selected.description && (
          <p style={{ ...hint, margin: 0 }}>{selected.description}</p>
        )}
        <div
          style={{
            borderTop: "1px solid var(--vscode-panel-border)",
            paddingTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <button style={primaryBtn} onClick={() => launchTool(selected)}>
            Launch Tool
          </button>
          <button
            style={secondaryBtn}
            onClick={() => handleOpenFolder(selected)}
          >
            Open Folder
          </button>
        </div>
        <div
          style={{
            borderTop: "1px solid var(--vscode-panel-border)",
            paddingTop: 8,
          }}
        >
          <div style={{ ...hint, marginBottom: 2 }}>Installed</div>
          <div style={{ fontSize: 12 }}>
            {new Date(selected.installedAt).toLocaleDateString()}
          </div>
          <div style={{ ...hint, marginTop: 6, marginBottom: 2 }}>Location</div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--vscode-editor-font-family, monospace)",
              wordBreak: "break-all",
              color: "var(--vscode-descriptionForeground)",
            }}
          >
            {selected.toolPath}
          </div>
        </div>
      </>
    );
  };

  // ── Tool running view ────────────────────────────────────────────────────────

  if (view === "tool") {
    const tool = selected;
    return (
      <div style={page}>
        {/* Tool header */}
        <div style={{ ...toolbar, gap: 10 }}>
          <button
            style={{
              ...secondaryBtn,
              width: "auto",
              padding: "4px 10px",
              fontSize: 11,
              flexShrink: 0,
            }}
            onClick={() => {
              setView("list");
              setToolHtml(null);
            }}
          >
            ← All Tools
          </button>
          {tool && (
            <>
              <div
                style={{
                  ...iconBox,
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {tool.name[0].toUpperCase()}
              </div>
              <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                {tool.name}
              </span>
              <span style={badge}>{tool.version}</span>
              {tool.publisher && (
                <span style={{ ...hint, flexShrink: 0 }}>{tool.publisher}</span>
              )}
            </>
          )}
        </div>

        {/* Tool content */}
        {toolHtml ? (
          // srcdoc shares the parent's origin so the polyfill's postMessage
          // reaches the parent and extension responses are bridged back in.
          <iframe
            ref={iframeRef}
            srcDoc={toolHtml}
            style={{ flex: 1, border: "none", width: "100%" }}
            title={tool?.name ?? "Tool"}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              color: "var(--vscode-descriptionForeground)",
            }}
          >
            <div style={{ fontSize: 48, opacity: 0.3 }}>⚙</div>
            <div style={{ fontWeight: 600, color: "var(--vscode-foreground)" }}>
              {tool?.name ?? "Tool"} is ready
            </div>
            {tool?.description && (
              <div style={{ ...hint, maxWidth: 360, textAlign: "center" }}>
                {tool.description}
              </div>
            )}
            <div style={{ ...hint, maxWidth: 360, textAlign: "center" }}>
              This tool does not have a web interface. Use the terminal or run it
              from the command line.
            </div>
            {tool && (
              <button
                style={{ ...secondaryBtn, width: "auto", padding: "6px 16px" }}
                onClick={() => handleOpenFolder(tool)}
              >
                Open Tool Folder
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────

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
        <input
          style={searchInput}
          type="text"
          placeholder="Search tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ ...hint, flexShrink: 0 }}>
          {filtered.length} / {tools.length}
        </span>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Tool list */}
        <div style={listArea}>
          {loading && (
            <div
              style={{ ...hint, padding: "24px 16px", textAlign: "center" }}
            >
              Loading tools…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div
              style={{ ...hint, padding: "24px 16px", textAlign: "center" }}
            >
              {search ? "No tools match your search." : "No tools installed."}
            </div>
          )}
          {filtered.map((tool) => {
            const isSelected = selected?.id === tool.id;
            const isHovered = hoveredId === tool.id;
            const rowStyle: React.CSSProperties = {
              ...toolRow,
              ...(isSelected
                ? toolRowActive
                : isHovered
                ? toolRowHover
                : {}),
            };
            return (
              <div
                key={tool.id}
                style={rowStyle}
                onClick={() => setSelected(tool)}
                onMouseEnter={() => setHoveredId(tool.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div
                  style={{
                    ...iconBox,
                    background: isSelected
                      ? "var(--vscode-button-foreground)"
                      : "var(--vscode-button-background)",
                    color: isSelected
                      ? "var(--vscode-button-background)"
                      : "var(--vscode-button-foreground)",
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
                    {tool.publisher
                      ? `${tool.publisher} · v${tool.version}`
                      : `v${tool.version}`}
                  </div>
                </div>
                <button
                  style={{
                    ...primaryBtn,
                    width: "auto",
                    padding: "3px 10px",
                    fontSize: 11,
                    flexShrink: 0,
                    opacity: 0,
                    ...(isHovered || isSelected ? { opacity: 1 } : {}),
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

        {/* Detail pane */}
        <div style={detailPane}>{renderDetail()}</div>
      </div>
    </div>
  );
}

