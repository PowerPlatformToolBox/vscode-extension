# Contributing to Power Platform ToolBox

Thank you for your interest in contributing! This guide explains how to set up your development environment and submit contributions.

## Table of Contents

- [Contributing to Power Platform ToolBox](#contributing-to-power-platform-toolbox)
    - [Table of Contents](#table-of-contents)
    - [Prerequisites](#prerequisites)
    - [Development Setup](#development-setup)
    - [Project Structure](#project-structure)
    - [Building](#building)
    - [Pull Request Guidelines](#pull-request-guidelines)
    - [Releasing](#releasing)
    - [Reporting Issues](#reporting-issues)
    - [Code of Conduct](#code-of-conduct)

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or higher
- [pnpm](https://pnpm.io/) 11.0.0
- [VS Code](https://code.visualstudio.com/) 1.85.0 or higher

## Development Setup

1. Fork and clone the repository:

    ```bash
    git clone https://github.com/PowerPlatformToolBox/vscode-extension.git
    cd vscode-extension
    ```

2. Install dependencies:

    ```bash
    pnpm install --frozen-lockfile
    ```

3. Copy the environment template and fill in your values:

    ```bash
    cp .env.example .env
    ```

    | Variable                 | Description                                 |
    | ------------------------ | ------------------------------------------- |
    | `PPTB_SUPABASE_URL`      | URL for the PPTB Supabase backend           |
    | `PPTB_SUPABASE_ANON_KEY` | Anonymous key for the PPTB Supabase backend |

    _NOTE: Reach out to the maintainers if you need access to the Supabase backend._

4. Open the project in VS Code:

    ```bash
    code .
    ```

5. Press **F5** to launch an Extension Development Host with the extension loaded.

## Project Structure

```
src/                      # Extension host source (TypeScript)
  extension.ts            # Entry point
  managers/               # Business logic managers
  panels/                 # Webview panel wrappers
  providers/              # Tree data providers
  registrations/          # Command registrations
  statusbar/              # Status bar items
  utils/                  # Shared utilities
webviews/                 # Webview UI source (React/TypeScript)
  connection/             # Connection management webview
  toolHost/               # Tool host webview
  toolTool/               # Tool configuration webview
resources/                # Static assets (icons)
dist/                     # Compiled output (generated)
```

## Building

```bash
# Development build (incremental)
pnpm compile

# Watch mode (rebuilds on save)
pnpm watch

# Production build
pnpm package

# Run ESLint
pnpm lint

# Format with Prettier
pnpm format
```

## Pull Request Guidelines

1. Create a feature branch from `dev`:

    ```bash
    git checkout -b feat/my-feature
    ```

2. Keep commits small and focused. Use the conventional commit format where possible:
    - `feat:` new feature
    - `fix:` bug fix
    - `chore:` maintenance, dependencies
    - `docs:` documentation changes

3. Ensure the following pass before opening a PR:

    ```bash
    pnpm lint
    pnpm package
    ```

4. Add a Changeset with `pnpm changeset` and commit its generated file in `.changeset/`.
5. Open a PR against `dev` with a clear title and description of the changes.

## Releasing

Releases are automated via GitHub Actions and Changesets. Merge a release PR from `dev` to `main`; the workflow creates or updates a `Version Packages` PR. After that PR is merged, GitHub Actions builds the package, publishes it to the VS Code Marketplace, and creates a GitHub Release.

## Reporting Issues

Please use the [GitHub issue tracker](https://github.com/PowerPlatformToolBox/vscode-extension/issues). Include:

- VS Code version (`Help > About`)
- Extension version
- Operating system
- Steps to reproduce the issue
- Expected vs actual behaviour
- Any relevant logs from the Output panel (`PPTB Registry` channel)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
