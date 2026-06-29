import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as vscode from "vscode";
import { logger } from "../utils/logger";

const DOWNLOAD_CONCURRENCY = 5;

/**
 * Manages a local disk cache of tool icons so that VS Code TreeItem.iconPath
 * can reference local file URIs (remote https:// URLs are not supported by the
 * VS Code tree view API).
 *
 * Cache directory: globalStorageUri/icon-cache/
 * Cache key      : the last path segment of the icon URL (e.g. "tool-1.2.0-icon.svg")
 */
export class IconCacheManager implements vscode.Disposable {
    private readonly _onIconsCached = new vscode.EventEmitter<void>();
    /** Fired after a warmUp() call finishes downloading/pruning. */
    readonly onIconsCached: vscode.Event<void> = this._onIconsCached.event;

    readonly cacheDir: string;

    constructor(context: vscode.ExtensionContext) {
        this.cacheDir = vscode.Uri.joinPath(context.globalStorageUri, "icon-cache").fsPath;
    }

    /**
     * Returns the local file URI for a cached icon, or `undefined` if the icon
     * has not been downloaded yet.
     */
    getLocalUri(iconUrl: string | undefined): vscode.Uri | undefined {
        if (!iconUrl) {
            return undefined;
        }
        const fileName = fileNameFromUrl(iconUrl);
        if (!fileName) {
            return undefined;
        }
        const localPath = path.join(this.cacheDir, fileName);
        return fs.existsSync(localPath) ? vscode.Uri.file(localPath) : undefined;
    }

    /**
     * Warm up the cache for the given set of icon URLs:
     *  1. Prunes any cached file whose name is not in the current URL set.
     *  2. Downloads any URL whose icon is not yet cached.
     *  3. Fires `onIconsCached` so tree providers can refresh their items.
     *
     * Safe to call multiple times; already-cached icons are skipped.
     *
     * @param iconUrls The complete current set of known icon URLs.
     */
    async warmUp(iconUrls: string[]): Promise<void> {
        ensureDir(this.cacheDir);

        const expectedNames = new Set(iconUrls.map(fileNameFromUrl).filter((n): n is string => !!n));

        // ── Prune orphaned icons ─────────────────────────────────────────────
        try {
            for (const file of fs.readdirSync(this.cacheDir)) {
                if (!expectedNames.has(file)) {
                    try {
                        fs.unlinkSync(path.join(this.cacheDir, file));
                    } catch {
                        // ignore — file may have been removed already
                    }
                }
            }
        } catch {
            // ignore — dir may not exist yet
        }

        // ── Download missing icons ───────────────────────────────────────────
        const toDownload = iconUrls.filter((url) => {
            const fn = fileNameFromUrl(url);
            return fn && !fs.existsSync(path.join(this.cacheDir, fn));
        });

        for (let i = 0; i < toDownload.length; i += DOWNLOAD_CONCURRENCY) {
            await Promise.all(
                toDownload.slice(i, i + DOWNLOAD_CONCURRENCY).map(async (url) => {
                    const fn = fileNameFromUrl(url)!;
                    const dest = path.join(this.cacheDir, fn);
                    try {
                        await download(url, dest);
                    } catch (err) {
                        logger.error(`[IconCache] Failed to download ${url}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }),
            );
        }

        this._onIconsCached.fire();
    }

    dispose(): void {
        this._onIconsCached.dispose();
    }
}

// ── Private helpers ────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function fileNameFromUrl(url: string): string | undefined {
    try {
        const { pathname } = new URL(url);
        const base = pathname.split("/").filter(Boolean).pop();
        return base && base.length > 0 ? base : undefined;
    } catch {
        return undefined;
    }
}

function download(url: string, destPath: string, redirectsLeft = 5): Promise<void> {
    return new Promise((resolve, reject) => {
        if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects: ${url}`));
            return;
        }

        const transport: typeof https | typeof http = url.startsWith("https:") ? https : http;

        transport
            .get(url, (res) => {
                const { statusCode, headers } = res;

                if (statusCode !== undefined && statusCode >= 300 && statusCode < 400 && headers.location) {
                    res.resume();
                    download(new URL(headers.location, url).toString(), destPath, redirectsLeft - 1).then(resolve, reject);
                    return;
                }

                if (statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${statusCode ?? "unknown"}`));
                    return;
                }

                const file = fs.createWriteStream(destPath);
                res.pipe(file);
                file.on("finish", () => {
                    file.close();
                    resolve();
                });
                file.on("error", (err) => {
                    fs.unlink(destPath, () => {});
                    reject(err);
                });
                res.on("error", (err) => {
                    file.close();
                    fs.unlink(destPath, () => {});
                    reject(err);
                });
            })
            .on("error", reject);
    });
}
