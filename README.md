# Power Platform ToolBox

> Manage Power Platform connections and developer tools directly from VS Code.

## Preview Release

This extension is currently published as a preview package.

- Expect frequent updates and occasional breaking changes while features are refined.
- If you need help or want to share feedback with the PPTB team, join Discord: https://discord.gg/efwAu9sXyJ

Power Platform ToolBox extension is a VS Code extension that brings Power Platform connectivity and tooling into your editor. Connect to Dataverse environments, browse and install community tools from the marketplace, and launch tools within the context of your active connection — all without leaving VS Code.

## Features

### Connections

- Add, edit, and delete Power Platform / Dataverse connections
- Support for multiple authentication types (Service Principal, Username/Password, etc.)
- Connect and disconnect with a single click
- Export and import connections for easy team sharing
- Visual status bar indicator showing the active connection

### Installed Tools

- Browse tools installed locally
- Launch tools in the context of the active Dataverse connection
- Uninstall tools you no longer need

### Marketplace

- Browse community-published tools from the PPTB registry
- Install tools directly from the marketplace
- Manage installed versions

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

## Requirements

- VS Code **1.85.0** or higher
- An active **Power Platform** / **Dataverse** environment to connect to

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

## Maintainer Checklist

Before publishing, run through [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## License

[GPL-3.0](LICENSE)
