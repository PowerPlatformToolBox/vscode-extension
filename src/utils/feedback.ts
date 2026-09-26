import * as vscode from "vscode";

export interface ToolFeedbackInfo {
    id: string;
    name: string;
    version: string;
}

function getExtensionVersion(): string {
    const extension = vscode.extensions.getExtension("PowerPlatformToolBox.power-platform-toolbox");
    return extension?.packageJSON?.version ?? "unknown";
}

function buildEnvironmentSummary(tool: ToolFeedbackInfo): string {
    return [
        "[Write your comment/feedback/issue here]",
        "",
        `PPTB VS Code Extension Version: ${getExtensionVersion()}`,
        `VS Code Version: ${vscode.version}`,
        `Platform: ${process.platform}`,
        `Architecture: ${process.arch}`,
        `Locale: ${vscode.env.language}`,
        `Tool ID: ${tool.id}`,
        `Tool Name: ${tool.name}`,
        `Tool Version: ${tool.version}`,
    ].join("\n");
}

/** Build a pre-filled issue URL for a tool repository. */
export function buildToolFeedbackUrl(repositoryUrl: string, tool: ToolFeedbackInfo): string {
    try {
        const url = new URL(repositoryUrl.trim().replace(/^git\+/i, ""));
        if (url.hostname.toLowerCase() === "github.com") {
            const cleanPath = url.pathname
                .replace(/\/(issues|pulls|discussions).*$/, "")
                .replace(/\/+$/, "")
                .replace(/\.git$/, "");
            url.pathname = `${cleanPath}/issues/new`;
        }
        url.searchParams.set("body", buildEnvironmentSummary(tool));
        const feedbackUrl = url.toString();
        return feedbackUrl;
    } catch {
        return repositoryUrl;
    }
}
