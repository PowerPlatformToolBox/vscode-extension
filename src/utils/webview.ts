import * as crypto from "crypto";
import * as vscode from "vscode";

/**
 * Shared webview utilities for use across all VS Code webview panels.
 */

/**
 * Generate a cryptographically random nonce string for use in Content-Security-Policy
 * `script-src 'nonce-...'` directives.
 *
 * The nonce is 32 bytes of cryptographically secure random data encoded as a
 * 64-character lowercase hex string, giving 256 bits of entropy.
 */
export function getNonce(): string {
    return crypto.randomBytes(32).toString("hex");
}

export type Theme = "light" | "dark";
export type ThemeAssetUris = Record<Theme, string>;

export function getThemeAssetUris(extensionUri: vscode.Uri, webview: vscode.Webview, fileName: string): ThemeAssetUris {
    return {
        light: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "light", fileName)).toString(),
        dark: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "dark", fileName)).toString(),
    };
}
