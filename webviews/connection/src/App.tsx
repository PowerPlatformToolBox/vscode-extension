import React, { useState, useEffect, useCallback } from "react";
import EnvironmentDetails from "./components/EnvironmentDetails";
import AuthTypeSelector from "./components/AuthTypeSelector";
import CredentialsForm from "./components/CredentialsForm";
import TestAndSave from "./components/TestAndSave";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuthType =
  | "InteractiveBrowser"
  | "ClientCredentials"
  | "UsernamePassword";

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
  createdAt?: string;
  lastUsedAt?: string;
}

// ── VS Code API ───────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
};

const vscodeApi = acquireVsCodeApi();

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    minHeight: "100vh",
    background: "#1e1e2e",
    color: "#cdd6f4",
    fontFamily: "var(--vscode-font-family, 'Segoe UI', sans-serif)",
    fontSize: 14,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "32px 16px",
  } as React.CSSProperties,
  card: {
    background: "#181825",
    borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    width: "100%",
    maxWidth: 560,
    overflow: "hidden",
  } as React.CSSProperties,
  header: {
    background: "#11111b",
    padding: "20px 28px",
    borderBottom: "1px solid #313244",
    display: "flex",
    alignItems: "center",
    gap: 12,
  } as React.CSSProperties,
  headerTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: "#cdd6f4",
  } as React.CSSProperties,
  stepIndicator: {
    display: "flex",
    gap: 8,
    padding: "16px 28px",
    borderBottom: "1px solid #313244",
    background: "#11111b",
  } as React.CSSProperties,
  body: {
    padding: "28px",
  } as React.CSSProperties,
  footer: {
    padding: "16px 28px",
    borderTop: "1px solid #313244",
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
  } as React.CSSProperties,
};

function stepDotStyle(active: boolean, done: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    background: done ? "#6c63ff" : active ? "#6c63ff33" : "#313244",
    color: done || active ? "#cdd6f4" : "#6c7086",
    border: active ? "2px solid #6c63ff" : "2px solid transparent",
    transition: "all 0.2s ease",
  };
}

function stepLineStyle(done: boolean): React.CSSProperties {
  return {
    flex: 1,
    height: 2,
    background: done ? "#6c63ff" : "#313244",
    margin: "13px 0",
    transition: "background 0.2s ease",
  };
}

function buttonStyle(variant: "primary" | "secondary" | "danger"): React.CSSProperties {
  return {
    padding: "8px 20px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background:
      variant === "primary"
        ? "#6c63ff"
        : variant === "danger"
        ? "#f38ba8"
        : "#313244",
    color:
      variant === "primary" || variant === "danger" ? "#1e1e2e" : "#cdd6f4",
    transition: "opacity 0.15s ease",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// ── App ───────────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

export default function App(): React.ReactElement {
  const [step, setStep] = useState(1);
  const [connection, setConnection] = useState<Connection>({
    id: generateId(),
    name: "",
    url: "",
    environment: "Dev",
    authType: "InteractiveBrowser",
  });
  const [testState, setTestState] = useState<
    "idle" | "pending" | "success" | "failure"
  >("idle");
  const [testError, setTestError] = useState<string | undefined>();
  const [isEditing, setIsEditing] = useState(false);

  // Listen for messages from the extension host
  useEffect(() => {
    const handler = (event: MessageEvent<{ type: string; connection?: Connection; success?: boolean; error?: string }>) => {
      const msg = event.data;
      if (msg.type === "pptb:init") {
        if (msg.connection) {
          setConnection(msg.connection);
          setIsEditing(true);
        }
      } else if (msg.type === "pptb:testResult") {
        if (msg.success) {
          setTestState("success");
        } else {
          setTestState("failure");
          setTestError(msg.error);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const updateConnection = useCallback(
    (patch: Partial<Connection>) => {
      setConnection((prev) => ({ ...prev, ...patch }));
      // Reset test state if connection details change
      if (testState !== "idle") {
        setTestState("idle");
        setTestError(undefined);
      }
    },
    [testState]
  );

  const canProceed = (): boolean => {
    switch (step) {
      case 1:
        return connection.name.trim().length > 0 && connection.url.trim().length > 0;
      case 2:
        return !!connection.authType;
      case 3:
        if (connection.authType === "ClientCredentials") {
          return !!connection.clientId?.trim() && !!connection.clientSecret?.trim();
        }
        if (connection.authType === "UsernamePassword") {
          return !!connection.username?.trim() && !!connection.password?.trim();
        }
        return true; // InteractiveBrowser has no required fields
      case 4:
        return testState === "success";
      default:
        return false;
    }
  };

  const handleTest = (): void => {
    setTestState("pending");
    vscodeApi.postMessage({ type: "pptb:test", connection });
  };

  const handleSave = (): void => {
    vscodeApi.postMessage({ type: "pptb:save", connection });
  };

  const handleCancel = (): void => {
    vscodeApi.postMessage({ type: "pptb:cancel" });
  };

  const renderStep = (): React.ReactElement => {
    switch (step) {
      case 1:
        return (
          <EnvironmentDetails
            name={connection.name}
            url={connection.url}
            environment={connection.environment}
            onChange={(patch) => updateConnection(patch)}
          />
        );
      case 2:
        return (
          <AuthTypeSelector
            authType={connection.authType}
            onChange={(authType) => updateConnection({ authType })}
          />
        );
      case 3:
        return (
          <CredentialsForm
            authType={connection.authType}
            connection={connection}
            onChange={(patch) => updateConnection(patch)}
          />
        );
      case 4:
        return (
          <TestAndSave
            testState={testState}
            testError={testError}
            onTest={handleTest}
          />
        );
      default:
        return <></>;
    }
  };

  const stepLabels = ["Details", "Auth", "Credentials", "Test & Save"];

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <span style={{ fontSize: 22 }}>🔌</span>
          <h1 style={styles.headerTitle}>
            {isEditing ? "Edit Connection" : "Add Connection"}
          </h1>
        </div>

        {/* Step indicator */}
        <div style={styles.stepIndicator}>
          {stepLabels.map((label, i) => {
            const num = i + 1;
            const isDone = num < step;
            const isActive = num === step;
            return (
              <React.Fragment key={label}>
                <div
                  title={label}
                  style={stepDotStyle(isActive, isDone)}
                >
                  {isDone ? "✓" : num}
                </div>
                {i < stepLabels.length - 1 && (
                  <div style={stepLineStyle(isDone)} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step content */}
        <div style={styles.body}>{renderStep()}</div>

        {/* Footer nav */}
        <div style={styles.footer}>
          <div>
            <button
              style={buttonStyle("secondary")}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 1 && (
              <button
                style={buttonStyle("secondary")}
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </button>
            )}
            {step < TOTAL_STEPS ? (
              <button
                style={{
                  ...buttonStyle("primary"),
                  opacity: canProceed() ? 1 : 0.5,
                  cursor: canProceed() ? "pointer" : "not-allowed",
                }}
                onClick={() => {
                  if (canProceed()) {
                    setStep((s) => s + 1);
                  }
                }}
                disabled={!canProceed()}
              >
                Next
              </button>
            ) : (
              <button
                style={{
                  ...buttonStyle("primary"),
                  opacity: canProceed() ? 1 : 0.5,
                  cursor: canProceed() ? "pointer" : "not-allowed",
                }}
                onClick={handleSave}
                disabled={!canProceed()}
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
