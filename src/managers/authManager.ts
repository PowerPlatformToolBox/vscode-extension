import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as net from "net";
import {
  PublicClientApplication,
  ConfidentialClientApplication,
  Configuration,
  AuthenticationResult,
  ICachePlugin,
  TokenCacheContext,
} from "@azure/msal-node";
import {
  AUTH_CACHE_FILE,
  AUTHORITY_BASE,
  COMMON_TENANT,
  POWER_PLATFORM_CLIENT_ID,
  AUTH_TYPES,
} from "../constants";
import type { Connection } from "./connectionsManager";

/**
 * File-based MSAL cache plugin that persists tokens to globalStorageUri.
 */
function createCachePlugin(cacheFilePath: string): ICachePlugin {
  return {
    beforeCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
      if (fs.existsSync(cacheFilePath)) {
        const data = fs.readFileSync(cacheFilePath, "utf8");
        cacheContext.tokenCache.deserialize(data);
      }
    },
    afterCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
      if (cacheContext.cacheHasChanged) {
        const dir = path.dirname(cacheFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(cacheFilePath, cacheContext.tokenCache.serialize());
      }
    },
  };
}

/**
 * Find a random available TCP port.
 */
function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Failed to obtain a port"));
        }
      });
    });
  });
}

/**
 * Manages MSAL-based authentication for Dataverse connections.
 * Supports Interactive Browser, Client Credentials, and Username/Password flows.
 */
export class AuthManager {
  private readonly cacheFilePath: string;

  constructor(context: vscode.ExtensionContext) {
    this.cacheFilePath = path.join(
      context.globalStorageUri.fsPath,
      AUTH_CACHE_FILE
    );
  }

  /**
   * Acquire an access token for the given connection.
   */
  async acquireToken(connection: Connection): Promise<string> {
    const scope = `${connection.url}/.default`;

    switch (connection.authType) {
      case AUTH_TYPES.INTERACTIVE_BROWSER:
        return this.acquireTokenInteractive(connection, scope);
      case AUTH_TYPES.CLIENT_CREDENTIALS:
        return this.acquireTokenClientCredentials(connection, scope);
      case AUTH_TYPES.USERNAME_PASSWORD:
        return this.acquireTokenUsernamePassword(connection, scope);
      default:
        throw new Error(`Unsupported auth type: ${connection.authType}`);
    }
  }

  /**
   * Refresh the access token for the given connection.
   * For interactive flow, this attempts silent acquisition first.
   */
  async refreshToken(connection: Connection): Promise<string> {
    const scope = `${connection.url}/.default`;

    if (connection.authType === AUTH_TYPES.INTERACTIVE_BROWSER) {
      const pca = this.createPublicClient(connection);
      const accounts = await pca.getTokenCache().getAllAccounts();
      if (accounts.length > 0) {
        const result = await pca.acquireTokenSilent({
          scopes: [scope],
          account: accounts[0],
        });
        if (result?.accessToken) {
          return result.accessToken;
        }
      }
      // Fall back to interactive if silent fails
      return this.acquireTokenInteractive(connection, scope);
    }

    // For other flows, re-acquire
    return this.acquireToken(connection);
  }

  /**
   * Clear the persistent token cache.
   */
  async clearCache(): Promise<void> {
    if (fs.existsSync(this.cacheFilePath)) {
      fs.unlinkSync(this.cacheFilePath);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createPublicClient(connection: Connection): PublicClientApplication {
    const tenantId = connection.tenantId ?? COMMON_TENANT;
    const config: Configuration = {
      auth: {
        clientId: POWER_PLATFORM_CLIENT_ID,
        authority: `${AUTHORITY_BASE}${tenantId}`,
      },
      cache: {
        cachePlugin: createCachePlugin(this.cacheFilePath),
      },
    };
    return new PublicClientApplication(config);
  }

  private createConfidentialClient(
    connection: Connection
  ): ConfidentialClientApplication {
    if (!connection.clientId || !connection.clientSecret) {
      throw new Error(
        "clientId and clientSecret are required for Client Credentials flow"
      );
    }
    const tenantId = connection.tenantId ?? COMMON_TENANT;
    const config: Configuration = {
      auth: {
        clientId: connection.clientId,
        clientSecret: connection.clientSecret,
        authority: `${AUTHORITY_BASE}${tenantId}`,
      },
      cache: {
        cachePlugin: createCachePlugin(this.cacheFilePath),
      },
    };
    return new ConfidentialClientApplication(config);
  }

  private async acquireTokenInteractive(
    connection: Connection,
    scope: string
  ): Promise<string> {
    const port = await getAvailablePort();
    const redirectUri = `http://localhost:${port}`;
    const pca = this.createPublicClient(connection);

    // Build the authorization URL
    const authUrl = await pca.getAuthCodeUrl({
      scopes: [scope],
      redirectUri,
    });

    // Start a local HTTP server to receive the redirect
    const code = await new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        const authCode = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        res.writeHead(200, { "Content-Type": "text/html" });
        if (authCode) {
          res.end(
            "<html><body><h2>Authentication successful. You can close this window.</h2></body></html>"
          );
          server.close();
          resolve(authCode);
        } else {
          const errorDesc = url.searchParams.get("error_description") ?? error ?? "Unknown error";
          res.end(
            `<html><body><h2>Authentication failed: ${errorDesc}</h2></body></html>`
          );
          server.close();
          reject(new Error(`Auth failed: ${errorDesc}`));
        }
      });

      server.listen(port, "127.0.0.1", () => {
        vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(
          () => {/* opened */},
          (err: Error) => {
            server.close();
            reject(err);
          }
        );
      });

      server.on("error", reject);
    });

    const result: AuthenticationResult | null = await pca.acquireTokenByCode({
      code,
      scopes: [scope],
      redirectUri,
    });

    if (!result?.accessToken) {
      throw new Error("Failed to acquire token: no access token in response");
    }
    return result.accessToken;
  }

  private async acquireTokenClientCredentials(
    connection: Connection,
    scope: string
  ): Promise<string> {
    const cca = this.createConfidentialClient(connection);
    const result = await cca.acquireTokenByClientCredential({
      scopes: [scope],
    });
    if (!result?.accessToken) {
      throw new Error(
        "Failed to acquire token via Client Credentials: no access token"
      );
    }
    return result.accessToken;
  }

  private async acquireTokenUsernamePassword(
    connection: Connection,
    scope: string
  ): Promise<string> {
    if (!connection.username || !connection.password) {
      throw new Error(
        "username and password are required for Username/Password flow"
      );
    }
    const pca = this.createPublicClient(connection);
    const result = await pca.acquireTokenByUsernamePassword({
      scopes: [scope],
      username: connection.username,
      password: connection.password,
    });
    if (!result?.accessToken) {
      throw new Error(
        "Failed to acquire token via Username/Password: no access token"
      );
    }
    return result.accessToken;
  }
}
