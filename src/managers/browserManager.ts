import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { logger } from "../utils/logger";
import type { Connection } from "./connectionsManager";

/** Browsers supported for profile-aware launching. */
export type SupportedBrowser = "chrome" | "edge";

/** A single browser profile discovered on disk. */
export interface BrowserProfile {
    /** Friendly display name (e.g. "Work", "Personal", or "Default"). */
    name: string;
    /** Profile directory name used as the `--profile-directory` value (e.g. "Default", "Profile 1"). */
    path: string;
}

/**
 * Detects installed Chromium-based browsers (Chrome, Edge), enumerates their
 * profiles, and launches URLs in a specific browser + profile combination.
 * Falls back to the system default browser whenever detection/launch fails.
 */
export class BrowserManager {
    /**
     * Check if a specific browser is installed on the system.
     */
    public isBrowserInstalled(browserType: string | undefined): boolean {
        if (!browserType) {
            return true; // Default browser is always available
        }

        const platform = process.platform;
        let possiblePaths: string[] = [];

        if (browserType === "chrome") {
            if (platform === "win32") {
                possiblePaths = [
                    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
                    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
                    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
                ];
            } else if (platform === "darwin") {
                possiblePaths = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
            } else {
                try {
                    execSync("which google-chrome", { stdio: "ignore" });
                    return true;
                } catch {
                    return false;
                }
            }
        } else if (browserType === "edge") {
            if (platform === "win32") {
                possiblePaths = [
                    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
                    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
                ];
            } else if (platform === "darwin") {
                possiblePaths = ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
            } else {
                try {
                    execSync("which microsoft-edge", { stdio: "ignore" });
                    return true;
                } catch {
                    return false;
                }
            }
        } else {
            return false;
        }

        return possiblePaths.some((p) => fs.existsSync(p));
    }

    /**
     * Get the list of browser profiles for a specific browser.
     */
    public getBrowserProfiles(browserType: string | undefined): BrowserProfile[] {
        if (!browserType || (browserType !== "chrome" && browserType !== "edge")) {
            return [];
        }

        if (!this.isBrowserInstalled(browserType)) {
            return [];
        }

        try {
            return this.getChromiumProfiles(browserType, process.platform);
        } catch (error) {
            logger.warn(`Failed to get profiles for ${browserType}`, error);
            return [];
        }
    }

    /**
     * Read Chromium-based browser profiles (Chrome, Edge) from the user data directory.
     * Prefers the "Local State" file (has friendly names for all profiles); falls back
     * to scanning per-profile "Preferences" files.
     */
    private getChromiumProfiles(browserType: SupportedBrowser, platform: string): BrowserProfile[] {
        let userDataPath = "";

        if (browserType === "chrome") {
            if (platform === "win32") {
                userDataPath = path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\User Data");
            } else if (platform === "darwin") {
                userDataPath = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
            } else {
                userDataPath = path.join(os.homedir(), ".config/google-chrome");
            }
        } else {
            if (platform === "win32") {
                userDataPath = path.join(process.env.LOCALAPPDATA || "", "Microsoft\\Edge\\User Data");
            } else if (platform === "darwin") {
                userDataPath = path.join(os.homedir(), "Library/Application Support/Microsoft Edge");
            } else {
                userDataPath = path.join(os.homedir(), ".config/microsoft-edge");
            }
        }

        if (!fs.existsSync(userDataPath)) {
            return [];
        }

        const profiles: BrowserProfile[] = [];

        try {
            const localStatePath = path.join(userDataPath, "Local State");
            if (fs.existsSync(localStatePath)) {
                const localStateContent = fs.readFileSync(localStatePath, "utf8");
                const localState = JSON.parse(localStateContent);

                if (localState.profile && localState.profile.info_cache) {
                    const infoCache = localState.profile.info_cache;

                    for (const profileDir in infoCache) {
                        if (Object.prototype.hasOwnProperty.call(infoCache, profileDir)) {
                            const profileInfo = infoCache[profileDir];
                            const profileName = profileInfo.name || profileDir;

                            if (profileDir === "Default" || profileDir.startsWith("Profile ")) {
                                profiles.push({ name: profileName, path: profileDir });
                            }
                        }
                    }
                }

                if (profiles.length > 0) {
                    return profiles;
                }
            }
        } catch (error) {
            logger.warn("Failed to read Local State file, falling back to directory scan", error);
        }

        // Fallback: scan directories and try to read individual Preferences files
        try {
            const entries = fs.readdirSync(userDataPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const dirName = entry.name;

                    if (dirName === "Default" || dirName.startsWith("Profile ")) {
                        try {
                            const preferencesPath = path.join(userDataPath, dirName, "Preferences");
                            if (fs.existsSync(preferencesPath)) {
                                const preferencesContent = fs.readFileSync(preferencesPath, "utf8");
                                const preferences = JSON.parse(preferencesContent);
                                const profileName = preferences.profile?.name || dirName;
                                profiles.push({ name: profileName, path: dirName });
                            } else {
                                profiles.push({ name: dirName, path: dirName });
                            }
                        } catch {
                            profiles.push({ name: dirName, path: dirName });
                        }
                    }
                }
            }
        } catch (error) {
            logger.warn("Failed to scan browser profile directories", error);
        }

        return profiles;
    }

    /**
     * Get browser executable path and arguments for launching with a specific profile.
     * Returns null if the browser is not found, which triggers fallback to the default browser.
     */
    private getBrowserLaunchCommand(browserType: string, profilePath: string | undefined): { executable: string; args: string[] } | null {
        const platform = process.platform;
        let executable = "";
        const args: string[] = [];

        if (browserType === "chrome") {
            if (platform === "win32") {
                const chromePaths = [
                    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
                    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
                    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
                ];
                for (const chromePath of chromePaths) {
                    if (fs.existsSync(chromePath)) {
                        executable = chromePath;
                        break;
                    }
                }
            } else if (platform === "darwin") {
                executable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
            } else {
                executable = "google-chrome";
            }
        } else if (browserType === "edge") {
            if (platform === "win32") {
                const edgePaths = [
                    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
                    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
                ];
                for (const edgePath of edgePaths) {
                    if (fs.existsSync(edgePath)) {
                        executable = edgePath;
                        break;
                    }
                }
            } else if (platform === "darwin") {
                executable = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
            } else {
                executable = "microsoft-edge";
            }
        } else {
            return null;
        }

        if (!executable) {
            return null;
        }

        if (path.isAbsolute(executable) && !fs.existsSync(executable)) {
            return null;
        }

        if (profilePath) {
            // Sanitize profile directory to avoid problematic characters in the CLI argument
            const safeProfilePath = profilePath.replace(/[^\w\s-]/g, "_");
            args.push(`--profile-directory=${safeProfilePath}`);
        }

        return { executable, args };
    }

    /**
     * Open a URL using the connection's configured browser + profile.
     * Falls back to the system default browser if no browser/profile is configured,
     * or if the configured browser cannot be located/launched.
     */
    public async openBrowserWithProfile(url: string, connection: Pick<Connection, "browser" | "browserProfile">): Promise<void> {
        const browserType = connection.browser;
        const profilePath = connection.browserProfile;

        if (!browserType || !profilePath) {
            await vscode.env.openExternal(vscode.Uri.parse(url));
            return;
        }

        const browserCommand = this.getBrowserLaunchCommand(browserType, profilePath);

        if (!browserCommand) {
            logger.info(`Browser ${browserType} not found, falling back to default browser`);
            await vscode.env.openExternal(vscode.Uri.parse(url));
            return;
        }

        try {
            const { executable, args } = browserCommand;
            const browserArgs = [...args, url];

            logger.info(`Launching ${browserType} with profile ${profilePath}: ${executable} ${browserArgs.join(" ")}`);

            spawn(executable, browserArgs, {
                detached: true,
                stdio: "ignore",
            }).unref();
        } catch (error) {
            logger.warn(`Failed to launch ${browserType} with profile, falling back to default`, error);
            await vscode.env.openExternal(vscode.Uri.parse(url));
        }
    }
}
