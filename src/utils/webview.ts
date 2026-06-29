import * as crypto from "crypto";

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
