# Power Platform ToolBox

> Manage Power Platform connections and developer tools directly from VS Code.

> **📢 Need help or want to share feedback?** Join our Discord community: https://discord.gg/efwAu9sXyJ

Power Platform ToolBox extension is a VS Code extension that brings Power Platform connectivity and tooling into your editor. Connect to Dataverse environments, browse and install community tools from the marketplace, and launch tools within the context of your active connection — all without leaving VS Code.

### Feedback and Issue Reporting from VS Code

You can report issues and submit ideas without leaving VS Code:

- Run **PPTB: Report a Bug** to open the bug report form.
- Run **PPTB: Request a Feature** to open the feature request form.
- Run **PPTB: Open Issue Tracker** to browse existing issues.
- Run **PPTB: Join PPTB Discord** to get support from the team.

Repository: https://github.com/PowerPlatformToolBox/vscode-extension

### Screenshots

Screenshots for Marketplace listing are tracked in [docs/screenshots/README.md](docs/screenshots/README.md).
This folder documents the exact capture list to keep the listing current as preview features evolve.

Recommended listing captures:

- Connections view with active environment
- Marketplace view with install action
- Installed tools view with launch action
- Command palette showing feedback/support commands

## Feature Comparison: VS Code Extension vs Desktop App

How this extension compares to the [Power Platform ToolBox Desktop App](https://github.com/PowerPlatformToolBox/desktop-app).

### Installed Tools SidePanel

| Feature                                                 | VS Code Extension                  | Desktop App |
| ------------------------------------------------------- | ---------------------------------- | ----------- |
| List installed tools in a sidebar/main list             | ✅                                 | ✅          |
| Launch a tool in the context of the active connection   | ✅                                 | ✅          |
| Uninstall a tool                                        | ✅                                 | ✅          |
| Refresh list                                            | ✅                                 | ✅          |
| Verified badge, publisher/contributor, category tooltip | ✅                                 | ✅          |
| Category/capability tags shown on the list item         | ⚠️ tooltip only                    | ✅          |
| Download count / rating / active-user stats shown       | ⚠️ used for sorting, not displayed | ✅          |
| Mark tool as favorite (star)                            | ✅                                 | ✅          |
| Search box                                              | ❌                                 | ✅          |
| Sort (name, popularity, rating, downloads, favorite)    | ✅                                 | ✅          |
| Filter by category/verified-only                        | ✅                                 | ✅          |

### Marketplace SidePanel

| Feature                                                 | VS Code Extension                  | Desktop App |
| ------------------------------------------------------- | ---------------------------------- | ----------- |
| Browse marketplace tools in a sidebar/main list         | ✅                                 | ✅          |
| Install a tool                                          | ✅                                 | ✅          |
| Uninstall an installed marketplace tool                 | ✅                                 | ✅          |
| Verified badge, publisher/contributor, category tooltip | ✅                                 | ✅          |
| Refresh list                                            | ✅                                 | ✅          |
| Category/capability tags shown on the list item         | ⚠️ tooltip only                    | ✅          |
| Download count / rating / active-user stats shown       | ⚠️ used for sorting, not displayed | ✅          |
| Search box                                              | ❌                                 | ✅          |
| Sort (name, popularity, rating, downloads)              | ✅                                 | ✅          |
| Filter by category/verified-only                        | ✅                                 | ✅          |
| "New tools" highlight/notification                      | ❌                                 | ✅          |

### Installed Tools Full View

| Feature                                                         | VS Code Extension | Desktop App |
| --------------------------------------------------------------- | ----------------- | ----------- |
| Dedicated full-tab card-grid view of installed tools            | ✅                | ❌          |
| Search installed tools                                          | ✅                | ❌          |
| Sort and filter installed tools (shares state with the sidebar) | ✅                | ❌          |
| Mark tool as favorite (star)                                    | ✅                | ❌          |
| Tabbed switch between Installed/Marketplace in the same panel   | ✅                | ❌          |

### Marketplace Full View

| Feature                                                | VS Code Extension | Desktop App |
| ------------------------------------------------------ | ----------------- | ----------- |
| Dedicated full-tab card-grid marketplace browser       | ✅                | ❌          |
| Search marketplace tools                               | ✅                | ❌          |
| Category filter chips                                  | ✅                | ❌          |
| Sort marketplace tools (shares state with the sidebar) | ✅                | ❌          |
| Paginated results                                      | ✅                | ❌          |

### Tool Updates

| Feature                                        | VS Code Extension | Desktop App |
| ---------------------------------------------- | ----------------- | ----------- |
| Check for a newer version of an installed tool | ❌                | ✅          |
| One-click "Update" action                      | ❌                | ✅          |
| Update-in-progress indicator                   | ❌                | ✅          |
| Update-available badge/notification            | ❌                | ✅          |

### Personalization & Home

| Feature                                             | VS Code Extension           | Desktop App |
| --------------------------------------------------- | --------------------------- | ----------- |
| Mark tools as favorite                              | ✅ (no dedicated Home page) | ✅          |
| Recently used tools list ("Open Recent")            | ❌                          | ✅          |
| Homepage dashboard (stats, quick actions, sponsors) | ❌                          | ✅          |
| "What's New" page shown after an update             | ❌                          | ✅          |

### Connection Management

| Feature                                                  | VS Code Extension                                                                                                                 | Desktop App                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Add / edit / delete connections                          | ✅                                                                                                                                | ✅                             |
| Auth: Interactive Browser (OAuth)                        | ✅                                                                                                                                | ✅                             |
| Auth: Client Credentials (Service Principal)             | ✅                                                                                                                                | ✅                             |
| Auth: Username/Password                                  | ✅                                                                                                                                | ✅                             |
| Connection string import & export                        | ❌                                                                                                                                | ✅                             |
| Test connection                                          | ✅                                                                                                                                | ✅                             |
| Export / import connections                              | ✅                                                                                                                                | ✅                             |
| Categories with custom colors                            | ✅                                                                                                                                | ✅                             |
| Category header shows connection count + collapse/expand | ❌                                                                                                                                | ✅                             |
| Active connection indicator                              | ✅ (status bar)                                                                                                                   | ✅                             |
| Embedded in-app browser for auth flow                    | ❌ (opens system browser)                                                                                                         | ✅                             |
| Browser + profile selection for interactive auth         | ⚠️ captured in the form/data model but has no effect — VS Code always uses `env.openExternal`, ignoring the saved browser/profile | ✅                             |
| Auth type badge shown in the connection list             | ❌                                                                                                                                | ✅                             |
| Environment badge/pill shown in the connection list      | ⚠️ colored dot only, no text pill                                                                                                 | ✅                             |
| Credential storage                                       | ✅ (native VS Code SecretStorage)                                                                                                 | ✅ (custom encryption manager) |
| Search box                                               | ❌                                                                                                                                | ✅                             |
| Sort (Last Used, Name A-Z/Z-A)                           | ❌                                                                                                                                | ✅                             |
| Filter by auth type / environment                        | ❌                                                                                                                                | ✅                             |

### Settings

| Feature                       | VS Code Extension | Desktop App |
| ----------------------------- | ----------------- | ----------- |
| Per-tool settings persistence | ✅                | ✅          |
| User/app-level settings       | ❌                | ✅          |
| Dedicated settings UI panel   | ❌                | ✅          |

### CSP

| Feature                                            | VS Code Extension | Desktop App |
| -------------------------------------------------- | ----------------- | ----------- |
| Per-tool webview CSP enforcement                   | ✅ (fixed policy) | ✅          |
| User-consent workflow for external resource access | ❌                | ✅          |
| Configurable CSP per tool                          | ❌                | ✅          |

### Agentic AI

| Feature                                          | VS Code Extension | Desktop App |
| ------------------------------------------------ | ----------------- | ----------- |
| MCP (Model Context Protocol) tool support        | ❌                | ✅          |
| Inter-tool invocation                            | ❌                | ✅          |
| Headless/unattended tool invocation (automation) | ❌                | ✅          |
| Standalone CLI                                   | ❌                | ✅          |

### General

| Feature                                             | VS Code Extension                   | Desktop App                     |
| --------------------------------------------------- | ----------------------------------- | ------------------------------- |
| Notifications                                       | ✅ (native VS Code notifications)   | ✅ (custom notification window) |
| Auto-update                                         | ➖ (handled by VS Code Marketplace) | ✅                              |
| System tray integration                             | ➖ (not applicable)                 | ✅                              |
| Custom protocol handler (deep links)                | ❌                                  | ✅                              |
| Telemetry / error tracking                          | ❌                                  | ✅ (Sentry)                     |
| Private/custom marketplace registry configuration   | ❌                                  | ✅                              |
| Tool/app API version compatibility checks           | ❌                                  | ✅                              |
| Terminal command sandboxing / blocklist             | ❌                                  | ✅                              |
| Azure Blob storage fallback for registry & packages | ❌                                  | ✅                              |

## Requirements

- VS Code **1.85.0** or higher
- An active **Power Platform** / **Dataverse** environment to connect

## Getting Started

1. Install the extension from the VS Code Marketplace.
2. Open the **Power Platform ToolBox** panel in the Activity Bar.
3. Click **Add Connection** (+) to configure a connection to your Dataverse environment.
4. Once connected, browse the **Marketplace** to discover and install community tools.
5. Select a tool in **Installed Tools** and click **Launch** to run it within your active connection.

## Extension Settings

This extension does not contribute any VS Code settings at this time.

## Known Issues

See the [issue tracker](https://github.com/PowerPlatformToolBox/vscode-extension/issues) for known issues and to report new ones.
If you want direct community support, join Discord: https://discord.gg/efwAu9sXyJ

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[GPL-3.0](LICENSE)
