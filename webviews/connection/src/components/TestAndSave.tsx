import React from "react";

interface Props {
  testState: "idle" | "pending" | "success" | "failure";
  testError?: string;
  onTest: () => void;
}

const SPINNER: React.CSSProperties = {
  display: "inline-block",
  width: 16,
  height: 16,
  border: "2px solid #6c63ff",
  borderTopColor: "transparent",
  borderRadius: "50%",
  animation: "spin 0.7s linear infinite",
  verticalAlign: "middle",
  marginRight: 8,
};

export default function TestAndSave({
  testState,
  testError,
  onTest,
}: Props): React.ReactElement {
  const buttonText = (): string => {
    switch (testState) {
      case "pending":
        return "Testing…";
      case "success":
        return "Test Passed ✓";
      case "failure":
        return "Retry Test";
      default:
        return "Test Connection";
    }
  };

  const buttonBg = (): string => {
    switch (testState) {
      case "success":
        return "#a6e3a1";
      case "failure":
        return "#f38ba8";
      default:
        return "#6c63ff";
    }
  };

  return (
    <div>
      {/* Inject spin keyframes */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <p
        style={{
          margin: "0 0 24px",
          color: "#a6adc8",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        Click <strong>Test Connection</strong> to verify the credentials before
        saving. The Save button will be enabled once the test passes.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          padding: "24px",
          background: "#313244",
          borderRadius: 10,
        }}
      >
        <button
          disabled={testState === "pending"}
          onClick={onTest}
          style={{
            padding: "10px 28px",
            borderRadius: 6,
            border: "none",
            cursor: testState === "pending" ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 600,
            background: buttonBg(),
            color: "#1e1e2e",
            transition: "background 0.2s ease",
            display: "flex",
            alignItems: "center",
          }}
        >
          {testState === "pending" && <span style={SPINNER} />}
          {buttonText()}
        </button>

        {testState === "success" && (
          <div
            style={{
              color: "#a6e3a1",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>✅</span>
            Connection successful! You can now save.
          </div>
        )}

        {testState === "failure" && (
          <div
            style={{
              color: "#f38ba8",
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: 18 }}>❌</span>
            <span>Connection failed.</span>
            {testError && (
              <span
                style={{
                  fontSize: 12,
                  color: "#fab387",
                  maxWidth: 320,
                  wordBreak: "break-word",
                }}
              >
                {testError}
              </span>
            )}
          </div>
        )}

        {testState === "idle" && (
          <div style={{ color: "#585b70", fontSize: 12 }}>
            Run a test to verify credentials before saving.
          </div>
        )}
      </div>
    </div>
  );
}
