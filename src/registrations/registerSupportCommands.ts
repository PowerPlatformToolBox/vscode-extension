import * as vscode from "vscode";

const REPO_BASE_URL = "https://github.com/PowerPlatformToolBox/vscode-extension";
const DISCORD_INVITE_URL = "https://discord.gg/efwAu9sXyJ";

function openExternal(url: string): Thenable<boolean> {
    return vscode.env.openExternal(vscode.Uri.parse(url));
}

export function registerSupportCommands(): vscode.Disposable[] {
    const reportBugCmd = vscode.commands.registerCommand("pptb.help.reportBug", async () => {
        await openExternal(`${REPO_BASE_URL}/issues/new?template=bug-report.yml`);
    });

    const requestFeatureCmd = vscode.commands.registerCommand("pptb.help.requestFeature", async () => {
        await openExternal(`${REPO_BASE_URL}/issues/new?template=feature-request.yml`);
    });

    const openIssuesCmd = vscode.commands.registerCommand("pptb.help.openIssues", async () => {
        await openExternal(`${REPO_BASE_URL}/issues`);
    });

    const joinDiscordCmd = vscode.commands.registerCommand("pptb.help.joinDiscord", async () => {
        await openExternal(DISCORD_INVITE_URL);
    });

    return [reportBugCmd, requestFeatureCmd, openIssuesCmd, joinDiscordCmd];
}
