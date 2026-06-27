import React from "react";
import type { AuthType } from "../App";

interface Props {
  authType: AuthType;
  onChange: (authType: AuthType) => void;
}

const AUTH_OPTIONS: { value: AuthType; label: string; description: string }[] =
  [
    {
      value: "InteractiveBrowser",
      label: "Interactive Browser",
      description:
        "Opens your browser to sign in with your Azure AD account. Recommended for user accounts.",
    },
    {
      value: "ClientCredentials",
      label: "Client Credentials",
      description:
        "Service principal authentication using an app registration's client ID and secret.",
    },
    {
      value: "UsernamePassword",
      label: "Username / Password",
      description:
        "Direct username and password authentication. Use only when browser auth is not available.",
    },
  ];

export default function AuthTypeSelector({
  authType,
  onChange,
}: Props): React.ReactElement {
  return (
    <div>
      <p
        style={{
          margin: "0 0 20px",
          color: "#a6adc8",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Select the authentication method for this connection.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {AUTH_OPTIONS.map((option) => {
          const isSelected = authType === option.value;
          return (
            <label
              key={option.value}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 16px",
                background: isSelected ? "#6c63ff22" : "#313244",
                border: `2px solid ${isSelected ? "#6c63ff" : "#45475a"}`,
                borderRadius: 8,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <input
                type="radio"
                name="authType"
                value={option.value}
                checked={isSelected}
                onChange={() => onChange(option.value)}
                style={{
                  accentColor: "#6c63ff",
                  marginTop: 2,
                  flexShrink: 0,
                  width: 16,
                  height: 16,
                  cursor: "pointer",
                }}
              />
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    color: isSelected ? "#cdd6f4" : "#a6adc8",
                    fontSize: 13,
                    marginBottom: 4,
                  }}
                >
                  {option.label}
                </div>
                <div style={{ fontSize: 12, color: "#585b70", lineHeight: 1.5 }}>
                  {option.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
