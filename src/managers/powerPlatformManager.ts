import axios, { AxiosError } from "axios";
import type { AuthManager } from "./authManager";
import type { Connection } from "./connectionsManager";

export type PowerPlatformNamespace =
  | "Analytics"
  | "AppManagement"
  | "Authorization"
  | "Connectivity"
  | "CopilotStudio"
  | "Dynamics"
  | "EnvironmentManagement"
  | "Governance"
  | "Licensing"
  | "PowerApps"
  | "PowerAutomate"
  | "PowerPages"
  | "ResourceQuery"
  | "UserManagement"
  | "WorkflowAgents";

const NAMESPACE_PATHS: Record<PowerPlatformNamespace, string> = {
  Analytics: "analytics",
  AppManagement: "appmanagement",
  Authorization: "authorization",
  Connectivity: "connectivity",
  CopilotStudio: "copilotstudio",
  Dynamics: "dynamics",
  EnvironmentManagement: "environmentmanagement",
  Governance: "governance",
  Licensing: "licensing",
  PowerApps: "powerapps",
  PowerAutomate: "powerautomate",
  PowerPages: "powerpages",
  ResourceQuery: "resourcequery",
  UserManagement: "usermanagement",
  WorkflowAgents: "workflowagents",
};

type ConnectionWithPowerPlatformSettings = Connection & {
  enabledForPowerPlatformAPI?: boolean;
  scopesForPowerPlatformAPI?: string[];
};

type AcquireTokenFn = (
  connection: Connection,
  scopes?: string[]
) => Promise<string>;

export class PowerPlatformManager {
  private readonly authManager: AuthManager;
  private readonly resolveConnection: (
    target: "primary" | "secondary"
  ) => Promise<ConnectionWithPowerPlatformSettings | undefined>;
  private readonly tokenCache = new Map<string, string>();

  constructor(
    authManager: AuthManager,
    resolveConnection: (
      target: "primary" | "secondary"
    ) => Promise<ConnectionWithPowerPlatformSettings | undefined>
  ) {
    this.authManager = authManager;
    this.resolveConnection = resolveConnection;
  }

  async request(
    namespace: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path = "",
    body: unknown = undefined,
    connectionTarget: "primary" | "secondary" = "primary",
    headers: Record<string, string> = {}
  ): Promise<unknown> {
    const normalizedNamespace = this.normalizeNamespace(namespace);
    const connection = await this.resolveConnection(connectionTarget);

    if (!connection) {
      throw new Error(`No ${connectionTarget} connection available.`);
    }

    if (connection.enabledForPowerPlatformAPI !== true) {
      throw new Error(
        "Power Platform API is not enabled for this connection. Enable it in connection settings and ensure a Client ID is configured."
      );
    }

    const scopes = this.resolveScopes(connection);
    const cacheKey = this.createCacheKey(connection.id, scopes);
    const token = await this.getToken(connection, scopes, cacheKey);

    try {
      return await this.makeRequest(
        normalizedNamespace,
        method,
        path,
        body,
        token,
        headers
      );
    } catch (error: unknown) {
      if (this.isUnauthorized(error)) {
        this.tokenCache.delete(cacheKey);
        const retryToken = await this.getToken(connection, scopes, cacheKey);
        return this.makeRequest(
          normalizedNamespace,
          method,
          path,
          body,
          retryToken,
          headers
        );
      }
      throw error;
    }
  }

  private resolveScopes(connection: ConnectionWithPowerPlatformSettings): string[] {
    const configuredScopes = Array.isArray(connection.scopesForPowerPlatformAPI)
      ? connection.scopesForPowerPlatformAPI
          .filter((scope): scope is string => typeof scope === "string")
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
      : [];

    if (configuredScopes.length > 0) {
      return configuredScopes;
    }

    return ["https://api.powerplatform.com/.default"];
  }

  private createCacheKey(connectionId: string, scopes: string[]): string {
    const sortedScopes = [...scopes].sort();
    return `${connectionId}:${sortedScopes.join(" ")}`;
  }

  private async getToken(
    connection: Connection,
    scopes: string[],
    cacheKey: string
  ): Promise<string> {
    const cached = this.tokenCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const acquireToken = this.authManager.acquireToken as AcquireTokenFn;
    const token = await acquireToken(connection, scopes);
    this.tokenCache.set(cacheKey, token);
    return token;
  }

  private async makeRequest(
    namespace: PowerPlatformNamespace,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    relativePath: string,
    body: unknown,
    accessToken: string,
    customHeaders: Record<string, string>
  ): Promise<unknown> {
    const url = this.buildUrl(namespace, relativePath);

    const response = await axios.request<unknown>({
      method,
      url,
      data: body,
      headers: {
        Authorization: ["Bearer", accessToken].join(" "),
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        ...customHeaders,
      },
    });

    return response.data;
  }

  private buildUrl(namespace: PowerPlatformNamespace, relativePath: string): string {
    const baseUrl = `https://api.powerplatform.com/${NAMESPACE_PATHS[namespace]}`;
    const cleanedPath = relativePath.trim();

    if (!cleanedPath) {
      return baseUrl;
    }

    if (cleanedPath.startsWith("?")) {
      return `${baseUrl}${cleanedPath}`;
    }

    return `${baseUrl}/${cleanedPath.replace(/^\/+/, "")}`;
  }

  private normalizeNamespace(namespace: string): PowerPlatformNamespace {
    if (namespace in NAMESPACE_PATHS) {
      return namespace as PowerPlatformNamespace;
    }

    throw new Error(`Unsupported Power Platform namespace: ${namespace}`);
  }

  private isUnauthorized(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const axiosError = error as AxiosError;
    return axiosError.response?.status === 401;
  }
}
