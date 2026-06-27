import React from "react";
import type { Connection } from "../App";

interface Props {
  name: string;
  url: string;
  environment: Connection["environment"];
  onChange: (patch: Partial<Connection>) => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#313244",
  border: "1px solid #45475a",
  borderRadius: 6,
  padding: "8px 12px",
  color: "#cdd6f4",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s ease",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "#a6adc8",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 20,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  appearance: "none" as const,
};

const environments: Connection["environment"][] = [
  "Dev",
  "Test",
  "UAT",
  "Production",
];

export default function EnvironmentDetails({
  name,
  url,
  environment,
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
        Enter the display name and Dataverse environment URL for this connection.
      </p>

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="conn-name">
          Display Name <span style={{ color: "#f38ba8" }}>*</span>
        </label>
        <input
          id="conn-name"
          style={inputStyle}
          type="text"
          value={name}
          placeholder="e.g. Contoso Dev"
          onChange={(e) => onChange({ name: e.target.value })}
          autoFocus
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="conn-url">
          Environment URL <span style={{ color: "#f38ba8" }}>*</span>
        </label>
        <input
          id="conn-url"
          style={inputStyle}
          type="url"
          value={url}
          placeholder="https://yourorg.crm.dynamics.com"
          onChange={(e) => onChange({ url: e.target.value })}
        />
        <span
          style={{ display: "block", marginTop: 4, fontSize: 11, color: "#585b70" }}
        >
          The root URL of your Dataverse / Power Platform environment.
        </span>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="conn-env">
          Environment Type
        </label>
        <select
          id="conn-env"
          style={selectStyle}
          value={environment}
          onChange={(e) =>
            onChange({
              environment: e.target.value as Connection["environment"],
            })
          }
        >
          {environments.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
