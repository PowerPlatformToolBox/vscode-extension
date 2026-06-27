/**
 * Shared webview utilities for use across all VS Code webview panels.
 */

/**
 * Generate a cryptographically random nonce string for use in Content-Security-Policy
 * `script-src 'nonce-...'` directives.
 *
 * The nonce is 32 characters drawn from [A-Za-z0-9] which gives ≈190 bits of entropy.
 */
export function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
