import * as vscode from "vscode";
import { AuthManager } from "../managers/authManager";
import { ConnectionsManager } from "../managers/connectionsManager";
import { ConnectionPanel } from "../panels/connectionPanel";
import { ConnectionsTreeDataProvider, ConnectionTreeItem } from "../providers/connectionsTreeDataProvider";

export function registerConnectionCommands(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
    connectionsManager: ConnectionsManager,
    treeDataProvider: ConnectionsTreeDataProvider,
): vscode.Disposable[] {
    const addCmd = vscode.commands.registerCommand("pptb.connections.add", async () => {
        await ConnectionPanel.open(context.extensionUri, connectionsManager, undefined);
    });

    const editCmd = vscode.commands.registerCommand("pptb.connections.edit", async (treeItem?: ConnectionTreeItem) => {
        const connection = treeItem?.connection;
        if (!connection) {
            vscode.window.showWarningMessage("No connection selected to edit.");
            return;
        }
        await ConnectionPanel.open(context.extensionUri, connectionsManager, connection);
    });

    const deleteCmd = vscode.commands.registerCommand("pptb.connections.delete", async (treeItem?: ConnectionTreeItem) => {
        const connection = treeItem?.connection;
        if (!connection) {
            vscode.window.showWarningMessage("No connection selected to delete.");
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Delete connection "${connection.name}"? This cannot be undone.`, { modal: true }, "Delete");
        if (confirm === "Delete") {
            await connectionsManager.delete(connection.id);
            vscode.window.showInformationMessage(`Connection "${connection.name}" deleted.`);
        }
    });

    const connectCmd = vscode.commands.registerCommand("pptb.connections.connect", async (treeItem?: ConnectionTreeItem) => {
        const connection = treeItem?.connection;
        if (!connection) {
            vscode.window.showWarningMessage("No connection selected.");
            return;
        }
        try {
            // Load secrets so ClientCredentials / UsernamePassword flows have their credentials
            const connectionWithSecrets = (await connectionsManager.getWithSecrets(connection.id)) ?? connection;
            const token = await authManager.acquireToken(connectionWithSecrets);
            await connectionsManager.update({
                ...connection,
                accessToken: token,
                lastUsedAt: new Date().toISOString(),
            });
            await connectionsManager.setActiveConnection(connection.id);
            vscode.window.showInformationMessage(`Connected to "${connection.name}".`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to connect: ${msg}`);
        }
    });

    const disconnectCmd = vscode.commands.registerCommand("pptb.connections.disconnect", async () => {
        const active = connectionsManager.getActiveConnection();
        if (!active) {
            vscode.window.showInformationMessage("No active connection.");
            return;
        }
        await connectionsManager.clearActiveConnection();
        vscode.window.showInformationMessage("Disconnected.");
    });

    const setActiveCmd = vscode.commands.registerCommand("pptb.connections.setActive", async (treeItem?: ConnectionTreeItem) => {
        const connection = treeItem?.connection;
        if (!connection) {
            vscode.window.showWarningMessage("No connection selected.");
            return;
        }
        await connectionsManager.setActiveConnection(connection.id);
        vscode.window.showInformationMessage(`"${connection.name}" is now the active connection.`);
    });

    const testCmd = vscode.commands.registerCommand("pptb.connections.test", async (treeItem?: ConnectionTreeItem) => {
        const connection = treeItem?.connection;
        if (!connection) {
            vscode.window.showWarningMessage("No connection selected.");
            return;
        }
        try {
            // Load secrets so the auth flow has the required credentials
            const connectionWithSecrets = (await connectionsManager.getWithSecrets(connection.id)) ?? connection;
            const ok = await connectionsManager.testConnection(connectionWithSecrets);
            if (ok) {
                vscode.window.showInformationMessage(`Connection "${connection.name}" is working.`);
            } else {
                vscode.window.showErrorMessage(`Connection "${connection.name}" test failed.`);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Connection test error: ${msg}`);
        }
    });

    const refreshCmd = vscode.commands.registerCommand("pptb.connections.refresh", () => {
        treeDataProvider.refresh();
    });

    const openEnvCmd = vscode.commands.registerCommand("pptb.connections.openEnvironment", (treeItem?: ConnectionTreeItem) => {
        const url = treeItem?.connection?.url;
        if (url) {
            vscode.env.openExternal(vscode.Uri.parse(url));
        }
    });

    const showDetailsCmd = vscode.commands.registerCommand("pptb.connections.showDetails", async (treeItem?: ConnectionTreeItem) => {
        const connection = treeItem?.connection;
        if (!connection) {
            vscode.window.showWarningMessage("No connection selected.");
            return;
        }
        await ConnectionPanel.open(context.extensionUri, connectionsManager, connection);
    });

    const forgetCmd = vscode.commands.registerCommand("pptb.connections.forget", async (treeItem?: ConnectionTreeItem) => {
        const connection = treeItem?.connection;
        if (!connection) {
            vscode.window.showWarningMessage("No connection selected.");
            return;
        }
        await connectionsManager.update({
            ...connection,
            accessToken: undefined,
            refreshToken: undefined,
            msalAccountId: undefined,
            tokenExpiry: undefined,
            powerPlatformAccessToken: undefined,
            powerPlatformTokenExpiry: undefined,
        });
        if (connectionsManager.getActiveConnection()?.id === connection.id) {
            await connectionsManager.clearActiveConnection();
        }
        vscode.window.showInformationMessage(`Connection "${connection.name}" forgotten — cached tokens cleared.`);
    });

    const exportCmd = vscode.commands.registerCommand("pptb.connections.export", async () => {
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
        vscode.window.showInformationMessage(`Exported ${exported.connections.length} connection(s) to ${saveUri.fsPath}`);
    });

    const importCmd = vscode.commands.registerCommand("pptb.connections.import", async () => {
        const [fileUri] =
            (await vscode.window.showOpenDialog({
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
    });

    return [addCmd, editCmd, deleteCmd, connectCmd, disconnectCmd, setActiveCmd, testCmd, refreshCmd, openEnvCmd, showDetailsCmd, forgetCmd, exportCmd, importCmd];
}
