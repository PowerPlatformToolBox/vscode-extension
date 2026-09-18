import * as http from "http";
import * as https from "https";
import * as vscode from "vscode";
import type { ConnectionsManager } from "../managers/connectionsManager";
import type { CspConsentManager } from "../managers/cspConsentManager";
import type { DataverseManager } from "../managers/dataverseManager";
import type { IconCacheManager } from "../managers/iconCacheManager";
import type { InstalledTool, ToolManager } from "../managers/toolManager";
import type { RegistryTool, ToolRegistryManager } from "../managers/toolRegistryManager";
import { getNonce, getThemeAssetUris, type ThemeAssetUris } from "../utils/webview";
import { ToolPanel } from "./toolPanel";

type Managers = { connectionsManager: ConnectionsManager; dataverseManager: DataverseManager };
type IconSource = string | { light: string; dark: string };

export interface ToolDetailModel {
    id: string;
    name: string;
    version: string;
    description?: string;
    publisher?: string;
    contributors?: string[] | string;
    isVerified?: boolean;
    categories?: string[];
    capabilityTags?: string[];
    icon?: IconSource;
    downloads?: number;
    rating?: number;
    mau?: number;
    readmeUrl?: string;
    repository?: string;
    website?: string;
    license?: string;
    status?: string;
    download?: string;
    executableRelativePath?: string;
    isInstalled: boolean;
    installedVersion?: string;
    latestVersion?: string;
    hasUpdate?: boolean;
    verifiedIcon?: ThemeAssetUris;
}

export class ToolDetailPanel {
    private static readonly panels = new Map<string, ToolDetailPanel>();
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext,
        private readonly toolManager: ToolManager,
        private readonly registry: ToolRegistryManager,
        _iconCache: IconCacheManager,
        private readonly cspConsent: CspConsentManager,
        private readonly managers: Managers,
        private model: ToolDetailModel,
    ) {
        panel.webview.html = this.getHtml(panel.webview);
        this.disposables.push(panel.onDidDispose(() => this.dispose()));
        this.disposables.push(panel.webview.onDidReceiveMessage((message: { type: string; url?: string }) => void this.handleMessage(message)));
        // Wait until React has installed its message listener. Webview messages sent
        // during construction can otherwise be lost before the bundle mounts.
    }

    static async open(
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        toolManager: ToolManager,
        registry: ToolRegistryManager,
        iconCache: IconCacheManager,
        cspConsent: CspConsentManager,
        managers: Managers,
        registryTool: RegistryTool,
        installedTool?: InstalledTool,
    ): Promise<void> {
        const existing = this.panels.get(registryTool.id);
        const model = this.createModel(extensionUri, registryTool, installedTool, iconCache, existing?.panel.webview);
        if (existing) {
            existing.model = model;
            existing.panel.title = `Tool Details: ${model.name}`;
            existing.panel.reveal();
            existing.postState();
            void existing.loadReadme();
            return;
        }

        const panel = vscode.window.createWebviewPanel("pptb.toolDetailPanel", `Tool Details: ${model.name}`, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webviews"), vscode.Uri.joinPath(extensionUri, "resources"), vscode.Uri.file(iconCache.cacheDir)],
        });
        const panelModel = this.createModel(extensionUri, registryTool, installedTool, iconCache, panel.webview);
        this.panels.set(registryTool.id, new ToolDetailPanel(panel, extensionUri, context, toolManager, registry, iconCache, cspConsent, managers, panelModel));
    }

    private static createModel(extensionUri: vscode.Uri, tool: RegistryTool, installed: InstalledTool | undefined, iconCache: IconCacheManager, webview?: vscode.Webview): ToolDetailModel {
        const icon = iconCache.getLocalUri(tool.icon);
        const iconSource =
            icon && webview
                ? "light" in icon
                    ? { light: webview.asWebviewUri(icon.light).toString(), dark: webview.asWebviewUri(icon.dark).toString() }
                    : webview.asWebviewUri(icon).toString()
                : undefined;
        const verifiedIcon = webview ? getThemeAssetUris(extensionUri, webview, "verified.svg") : undefined;
        return {
            ...tool,
            icon: iconSource,
            publisher: tool.publisher ?? installed?.publisher,
            contributors: tool.contributors ?? installed?.contributors,
            isInstalled: Boolean(installed),
            installedVersion: installed?.version,
            latestVersion: tool.version,
            hasUpdate: Boolean(installed && isNewerVersion(installed.version, tool.version)),
            verifiedIcon,
        };
    }

    private async handleMessage(message: { type: string; url?: string }): Promise<void> {
        try {
            switch (message.type) {
                case "ready":
                    this.postState();
                    await this.loadReadme();
                    break;
                case "open-link":
                    if (message.url?.startsWith("https://")) await vscode.env.openExternal(vscode.Uri.parse(message.url));
                    break;
                case "install":
                    await this.toolManager.install(await this.registry.getToolById(this.model.id).then((tool) => tool ?? this.modelToRegistry()));
                    this.model = { ...this.model, isInstalled: true, installedVersion: this.model.version, hasUpdate: false };
                    this.postState();
                    vscode.window.showInformationMessage(`"${this.model.name}" installed successfully.`);
                    break;
                case "update": {
                    const tool = await this.registry.getToolById(this.model.id);
                    if (!tool) throw new Error("Tool not found in registry.");
                    await this.toolManager.updateTool(tool);
                    this.model = { ...this.model, version: tool.version, latestVersion: tool.version, installedVersion: tool.version, hasUpdate: false };
                    this.postState();
                    break;
                }
                case "uninstall":
                    await this.toolManager.uninstall(this.model.id);
                    this.model = { ...this.model, isInstalled: false, installedVersion: undefined, hasUpdate: false };
                    this.postState();
                    break;
                case "launch":
                    ToolPanel.open(this.extensionUri, this.context, this.model.id, this.toolManager, this.registry, this.cspConsent, this.managers);
                    break;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Tool action failed: ${error instanceof Error ? error.message : String(error)}`);
            this.panel.webview.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    }

    private modelToRegistry(): RegistryTool {
        return {
            id: this.model.id,
            name: this.model.name,
            version: this.model.version,
            description: this.model.description,
            publisher: this.model.publisher,
            contributors: this.model.contributors,
            isVerified: this.model.isVerified,
            categories: this.model.categories,
            capabilityTags: this.model.capabilityTags,
            download: this.model.download,
            executableRelativePath: this.model.executableRelativePath,
            downloads: this.model.downloads,
            rating: this.model.rating,
            mau: this.model.mau,
            readmeUrl: this.model.readmeUrl,
            repository: this.model.repository,
            website: this.model.website,
            license: this.model.license,
            status: this.model.status === "active" || this.model.status === "deprecated" || this.model.status === "archived" ? this.model.status : undefined,
        };
    }

    private postState(): void {
        this.panel.webview.postMessage({ type: "state", model: this.model });
    }

    private async loadReadme(): Promise<void> {
        const url = this.model.readmeUrl;
        if (!url || !url.startsWith("https://")) {
            this.panel.webview.postMessage({ type: "readme", markdown: "Documentation is not available for this tool." });
            return;
        }
        try {
            this.panel.webview.postMessage({ type: "readme", markdown: await downloadText(url) });
        } catch {
            this.panel.webview.postMessage({ type: "readme", markdown: "Unable to load documentation." });
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "toolDetail.js"));
        const nonce = getNonce();
        return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: https:; connect-src ${webview.cspSource};"><title>Tool Details</title></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }

    private dispose(): void {
        ToolDetailPanel.panels.delete(this.model.id);
        for (const disposable of this.disposables) disposable.dispose();
    }
}

function downloadText(url: string, redirectsLeft = 5): Promise<string> {
    return new Promise((resolve, reject) => {
        if (redirectsLeft <= 0) {
            reject(new Error("Too many README redirects."));
            return;
        }
        const parsed = new URL(url);
        const transport = parsed.protocol === "https:" ? https : http;
        const request = transport.get(parsed, (response) => {
            const location = response.headers.location;
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
                response.resume();
                void downloadText(new URL(location, url).toString(), redirectsLeft - 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`README request failed with HTTP ${response.statusCode ?? "unknown"}.`));
                return;
            }
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            response.on("error", reject);
        });
        request.on("error", reject);
    });
}

function isNewerVersion(current: string, latest: string): boolean {
    const a = current.replace(/^v/i, "").split(/[.+-]/).map(Number);
    const b = latest.replace(/^v/i, "").split(/[.+-]/).map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (b[i] || 0) - (a[i] || 0);
        if (diff) return diff > 0;
    }
    return false;
}
