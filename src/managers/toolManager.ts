import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Metadata describing a PPTB community tool (prior to installation).
 */
export interface Tool {
  /** Unique identifier for the tool (e.g. "pac-cli"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Semantic version string (e.g. "1.2.3"). */
  version: string;
  /** Optional short description. */
  description?: string;
  /** URL from which the tool binary/archive can be downloaded. */
  downloadUrl?: string;
  /**
   * Relative path inside the tool's installation directory that points to the
   * main executable (e.g. "bin/pac" or "pac.exe").
   */
  executableRelativePath?: string;
}

/**
 * A tool that has been installed into the extension's storage.
 * Extends `Tool` with installation-time metadata.
 */
export interface InstalledTool extends Tool {
  /** ISO-8601 timestamp of when the tool was installed. */
  installedAt: string;
  /** Absolute path to the directory that holds this tool's files. */
  toolPath: string;
}

// ── Manifest helper ───────────────────────────────────────────────────────────

/** Shape of the installed.json manifest file. */
type Manifest = InstalledTool[];

// ── ToolManager ───────────────────────────────────────────────────────────────

/**
 * Manages PPTB community tools installed into the extension's own storage
 * directory.
 *
 * Directory layout:
 * ```
 * globalStorageUri/
 *   tools/
 *     installed.json          ← manifest of all installed tools
 *     <toolId>/               ← one sub-directory per installed tool
 *       ...                   ← tool files (executable, assets, etc.)
 * ```
 */
export class ToolManager implements vscode.Disposable {
  /** Fired whenever the set of installed tools changes. */
  readonly onToolsChanged = new vscode.EventEmitter<void>();

  /** Absolute path to the root tools directory. */
  readonly toolsDir: string;

  /** Absolute path to the installed-tools manifest file. */
  readonly manifestPath: string;

  constructor(context: vscode.ExtensionContext) {
    this.toolsDir = path.join(context.globalStorageUri.fsPath, "tools");
    this.manifestPath = path.join(this.toolsDir, "installed.json");
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** Return every installed tool recorded in the manifest. */
  getAll(): InstalledTool[] {
    return this.readManifest();
  }

  /** Return a single installed tool by its ID, or `undefined` if not found. */
  getById(id: string): InstalledTool | undefined {
    return this.readManifest().find((t) => t.id === id);
  }

  /** Return `true` when a tool with the given ID is present in the manifest. */
  isInstalled(id: string): boolean {
    return this.readManifest().some((t) => t.id === id);
  }

  /**
   * Return the absolute path to the directory that holds an installed tool's
   * files, regardless of whether the tool is actually installed.
   */
  getToolPath(id: string): string {
    return path.join(this.toolsDir, id);
  }

  // ---------------------------------------------------------------------------
  // Install
  // ---------------------------------------------------------------------------

  /**
   * Install a tool.
   *
   * If `tool.downloadUrl` is provided the file is downloaded from that URL
   * into the tool's dedicated sub-directory before the manifest is updated.
   * If no URL is supplied the directory is still created and the manifest is
   * updated so that callers that place files manually (e.g. extracted from a
   * bundled resource) are still tracked.
   *
   * Replaces any previously-installed version of the same tool.
   *
   * @throws If the download fails or the destination cannot be written.
   */
  async install(tool: Tool): Promise<InstalledTool> {
    this.ensureToolsDir();

    const toolDir = this.getToolPath(tool.id);

    // Remove any previous installation directory for this tool
    if (fs.existsSync(toolDir)) {
      fs.rmSync(toolDir, { recursive: true, force: true });
    }
    fs.mkdirSync(toolDir, { recursive: true });

    // Download the tool file when a URL is provided
    if (tool.downloadUrl) {
      const fileName = this.fileNameFromUrl(tool.downloadUrl);
      const destPath = path.join(toolDir, fileName);
      await this.download(tool.downloadUrl, destPath);
    }

    const installed: InstalledTool = {
      ...tool,
      installedAt: new Date().toISOString(),
      toolPath: toolDir,
    };

    // Update manifest (replace if already present)
    const manifest = this.readManifest().filter((t) => t.id !== tool.id);
    manifest.push(installed);
    this.writeManifest(manifest);

    this.onToolsChanged.fire();
    return installed;
  }

  // ---------------------------------------------------------------------------
  // Uninstall
  // ---------------------------------------------------------------------------

  /**
   * Remove an installed tool.
   *
   * Deletes the tool's directory and removes its entry from the manifest.
   * Does nothing (and does not throw) when the tool is not installed.
   */
  async uninstall(id: string): Promise<void> {
    const toolDir = this.getToolPath(id);
    if (fs.existsSync(toolDir)) {
      fs.rmSync(toolDir, { recursive: true, force: true });
    }

    const manifest = this.readManifest().filter((t) => t.id !== id);
    this.writeManifest(manifest);

    this.onToolsChanged.fire();
  }

  // ---------------------------------------------------------------------------
  // Disposable
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.onToolsChanged.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Ensure the root tools directory (and any parents) exist. */
  private ensureToolsDir(): void {
    if (!fs.existsSync(this.toolsDir)) {
      fs.mkdirSync(this.toolsDir, { recursive: true });
    }
  }

  /** Read and parse the manifest; returns an empty array when missing/corrupt. */
  private readManifest(): Manifest {
    if (!fs.existsSync(this.manifestPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.manifestPath, "utf8");
      return JSON.parse(raw) as Manifest;
    } catch {
      return [];
    }
  }

  /** Serialise and write the manifest to disk, creating the directory first. */
  private writeManifest(manifest: Manifest): void {
    this.ensureToolsDir();
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  /**
   * Extract a filename from a URL (falls back to "tool" when the URL has no
   * discernible filename component).
   */
  private fileNameFromUrl(url: string): string {
    try {
      const { pathname } = new URL(url);
      const base = pathname.split("/").filter(Boolean).pop();
      return base && base.length > 0 ? base : "tool";
    } catch {
      return "tool";
    }
  }

  /**
   * Download a URL to a local file path.
   * Follows HTTP redirects up to a configurable depth.
   */
  private download(url: string, destPath: string, redirectsLeft = 5): Promise<void> {
    return new Promise((resolve, reject) => {
      if (redirectsLeft <= 0) {
        reject(new Error(`Too many redirects while downloading: ${url}`));
        return;
      }

      const parsed = new URL(url);
      const transport: typeof https | typeof http =
        parsed.protocol === "https:" ? https : http;

      const request = transport.get(url, (response) => {
        const { statusCode, headers } = response;

        // Handle redirects
        if (
          statusCode !== undefined &&
          statusCode >= 300 &&
          statusCode < 400 &&
          headers.location
        ) {
          response.resume();
          const redirectUrl = new URL(headers.location, url).toString();
          this.download(redirectUrl, destPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `Failed to download "${url}": HTTP ${statusCode ?? "unknown"}`
            )
          );
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });

        fileStream.on("error", (err) => {
          fs.unlink(destPath, () => {/* best-effort cleanup */});
          reject(err);
        });

        response.on("error", (err) => {
          fileStream.close();
          fs.unlink(destPath, () => {/* best-effort cleanup */});
          reject(err);
        });
      });

      request.on("error", reject);
      request.end();
    });
  }
}
