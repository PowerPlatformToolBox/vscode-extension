import * as vscode from "vscode";
import { AuthManager } from "./managers/authManager";
import { ConnectionsManager } from "./managers/connectionsManager";
import { DataverseManager } from "./managers/dataverseManager";
import { ConnectionsTreeDataProvider, ConnectionTreeItem } from "./providers/connectionsTreeDataProvider";
import { ConnectionPanel } from "./panels/connectionPanel";
import { ConnectionStatusBar } from "./statusbar/connectionStatusBar";

export function activate(context: vscode.ExtensionContext): void {
  // ── Bootstrap managers ────────────────────────────────────────────────────
  const authManager = new AuthManager(context);
  const connectionsManager = new ConnectionsManager(context);
  const dataverseManager = new DataverseManager(authManager);

  // Wire up cross-manager references (lazy to avoid circular dependency)
  connectionsManager.setDataverseManager(dataverseManager);

  // ── Tree view ─────────────────────────────────────────────────────────────
  const treeDataProvider = new ConnectionsTreeDataProvider(connectionsManager);
  const treeView = vscode.window.createTreeView("pptb.connectionsView", {
    treeDataProvider,
    showCollapseAll: true,
  });

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = new ConnectionStatusBar(connectionsManager);

  // ── Commands ──────────────────────────────────────────────────────────────

  // Add connection
  const addCmd = vscode.commands.registerCommand(
    "pptb.connections.add",
    () => {
      ConnectionPanel.open(context.extensionUri, connectionsManager, undefined);
    }
  );

  // Edit connection
  const editCmd = vscode.commands.registerCommand(
    "pptb.connections.edit",
    (treeItem?: ConnectionTreeItem) => {
      const connection = treeItem?.connection;
      if (!connection) {
        vscode.window.showWarningMessage("No connection selected to edit.");
        return;
      }
      ConnectionPanel.open(context.extensionUri, connectionsManager, connection);
    }
  );

  // Delete connection
  const deleteCmd = vscode.commands.registerCommand(
    "pptb.connections.delete",
    async (treeItem?: ConnectionTreeItem) => {
      const connection = treeItem?.connection;
      if (!connection) {
        vscode.window.showWarningMessage("No connection selected to delete.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete connection "${connection.name}"? This cannot be undone.`,
        { modal: true },
        "Delete"
      );
      if (confirm === "Delete") {
        await connectionsManager.delete(connection.id);
        vscode.window.showInformationMessage(
          `Connection "${connection.name}" deleted.`
        );
      }
    }
  );

  // Connect (acquire token and set active)
  const connectCmd = vscode.commands.registerCommand(
    "pptb.connections.connect",
    async (treeItem?: ConnectionTreeItem) => {
      const connection = treeItem?.connection;
      if (!connection) {
        vscode.window.showWarningMessage("No connection selected.");
        return;
      }
      try {
        const token = await authManager.acquireToken(connection);
        // Store token in secrets via ConnectionsManager
        await connectionsManager.update({
          ...connection,
          accessToken: token,
          lastUsedAt: new Date().toISOString(),
        });
        await connectionsManager.setActiveConnection(connection.id);
        vscode.window.showInformationMessage(
          `Connected to "${connection.name}".`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to connect: ${msg}`);
      }
    }
  );

  // Disconnect (clear active connection)
  const disconnectCmd = vscode.commands.registerCommand(
    "pptb.connections.disconnect",
    async () => {
      const active = connectionsManager.getActiveConnection();
      if (!active) {
        vscode.window.showInformationMessage("No active connection.");
        return;
      }
      await connectionsManager.clearActiveConnection();
      vscode.window.showInformationMessage("Disconnected.");
    }
  );

  // Set active connection
  const setActiveCmd = vscode.commands.registerCommand(
    "pptb.connections.setActive",
    async (treeItem?: ConnectionTreeItem) => {
      const connection = treeItem?.connection;
      if (!connection) {
        vscode.window.showWarningMessage("No connection selected.");
        return;
      }
      await connectionsManager.setActiveConnection(connection.id);
      vscode.window.showInformationMessage(
        `"${connection.name}" is now the active connection.`
      );
    }
  );

  // Test connection
  const testCmd = vscode.commands.registerCommand(
    "pptb.connections.test",
    async (treeItem?: ConnectionTreeItem) => {
      const connection = treeItem?.connection;
      if (!connection) {
        vscode.window.showWarningMessage("No connection selected.");
        return;
      }
      try {
        const ok = await connectionsManager.testConnection(connection);
        if (ok) {
          vscode.window.showInformationMessage(
            `Connection "${connection.name}" is working.`
          );
        } else {
          vscode.window.showErrorMessage(
            `Connection "${connection.name}" test failed.`
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Connection test error: ${msg}`);
      }
    }
  );

  // Refresh tree
  const refreshCmd = vscode.commands.registerCommand(
    "pptb.connections.refresh",
    () => {
      treeDataProvider.refresh();
    }
  );

  // Export connections
  const exportCmd = vscode.commands.registerCommand(
    "pptb.connections.export",
    async () => {
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file("pptb-connections.json"),
        filters: { "JSON files": ["json"] },
        title: "Export PPTB Connections",
      });
      if (!saveUri) {
        return;
      }
      const exported = connectionsManager.exportConnections();
      const json = JSON.stringify(exported, null, 2);
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(json, "utf8"));
      vscode.window.showInformationMessage(
        `Exported ${exported.connections.length} connection(s) to ${saveUri.fsPath}`
      );
    }
  );

  // Import connections
  const importCmd = vscode.commands.registerCommand(
    "pptb.connections.import",
    async () => {
      const [fileUri] = (await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "JSON files": ["json"] },
        title: "Import PPTB Connections",
      })) ?? [];
      if (!fileUri) {
        return;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        const raw = Buffer.from(bytes).toString("utf8");
        const data: unknown = JSON.parse(raw);
        const result = await connectionsManager.importConnections(data);
        const msg = `Imported ${result.imported} connection(s)${result.skipped > 0 ? `, skipped ${result.skipped}` : ""}.`;
        if (result.warnings.length > 0) {
          vscode.window.showWarningMessage(`${msg} Warnings: ${result.warnings.join(" ")}`);
        } else {
          vscode.window.showInformationMessage(msg);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Import failed: ${message}`);
      }
    }
  );

  // ── Register all disposables ──────────────────────────────────────────────
  context.subscriptions.push(
    authManager,
    connectionsManager.onConnectionsChanged,
    treeView,
    statusBar,
    addCmd,
    editCmd,
    deleteCmd,
    connectCmd,
    disconnectCmd,
    setActiveCmd,
    testCmd,
    refreshCmd,
    exportCmd,
    importCmd
  );
}

export function deactivate(): void {
  // Cleanup is handled by VS Code via context.subscriptions
}
