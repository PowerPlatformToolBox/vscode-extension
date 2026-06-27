import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import {
  CONNECTIONS_STATE_KEY,
  CONNECTION_SECRETS_KEY_PREFIX,
  CONNECTION_SECRETS_KEY_SUFFIX,
  ACTIVE_CONNECTION_KEY,
  AUTH_TYPES,
  AuthType,
} from "../constants";

/**
 * Non-sensitive connection fields persisted in globalState.
 */
export interface ConnectionPublicFields {
  id: string;
  name: string;
  url: string;
  environment: "Dev" | "Test" | "UAT" | "Production";
  authType: AuthType;
  clientId?: string;
  username?: string;
  category?: string;
  environmentColor?: string;
  categoryColor?: string;
  tenantId?: string;
  createdAt?: string;
  lastUsedAt?: string;
}

/**
 * Sensitive connection fields stored exclusively in SecretStorage.
 */
export interface ConnectionSecretFields {
  clientSecret?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Full connection model used throughout the extension.
 * Extends the public fields with optional sensitive fields (populated on demand).
 */
export type Connection = ConnectionPublicFields & Partial<ConnectionSecretFields>;

/**
 * Manages connections — persistence split between globalState (non-sensitive)
 * and SecretStorage (sensitive credentials).
 */
export class ConnectionsManager {
  /** Fired whenever the connection list changes */
  readonly onConnectionsChanged = new vscode.EventEmitter<void>();

  private readonly context: vscode.ExtensionContext;
  private dataverseManager?: import("./dataverseManager").DataverseManager;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** Inject DataverseManager lazily to avoid circular dependency */
  setDataverseManager(
    dm: import("./dataverseManager").DataverseManager
  ): void {
    this.dataverseManager = dm;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /** Return all connections (public fields only — secrets excluded). */
  getAll(): Connection[] {
    return this.context.globalState.get<ConnectionPublicFields[]>(
      CONNECTIONS_STATE_KEY,
      []
    );
  }

  /** Return a single connection by ID (public fields only). */
  getById(id: string): Connection | undefined {
    return this.getAll().find((c) => c.id === id);
  }

  /** Persist a new connection. Secrets are extracted and stored separately. */
  async add(connection: Connection): Promise<void> {
    const connections = this.getAll();
    const id = connection.id || uuidv4();
    const now = new Date().toISOString();

    const { clientSecret, password, accessToken, refreshToken, ...publicFields } =
      connection;
    const publicConnection: ConnectionPublicFields = {
      ...publicFields,
      id,
      createdAt: now,
      lastUsedAt: now,
    };

    connections.push(publicConnection);
    await this.context.globalState.update(CONNECTIONS_STATE_KEY, connections);

    // Persist secrets separately
    await this.saveSecrets(id, { clientSecret, password, accessToken, refreshToken });

    this.onConnectionsChanged.fire();
  }

  /** Update an existing connection in place. */
  async update(connection: Connection): Promise<void> {
    const connections = this.getAll();
    const index = connections.findIndex((c) => c.id === connection.id);
    if (index === -1) {
      throw new Error(`Connection with id "${connection.id}" not found`);
    }

    const { clientSecret, password, accessToken, refreshToken, ...publicFields } =
      connection;

    connections[index] = { ...connections[index], ...publicFields };
    await this.context.globalState.update(CONNECTIONS_STATE_KEY, connections);

    // Update secrets
    await this.saveSecrets(connection.id, {
      clientSecret,
      password,
      accessToken,
      refreshToken,
    });

    this.onConnectionsChanged.fire();
  }

  /** Delete a connection and its stored secrets. */
  async delete(id: string): Promise<void> {
    const connections = this.getAll().filter((c) => c.id !== id);
    await this.context.globalState.update(CONNECTIONS_STATE_KEY, connections);

    // Remove secrets
    await this.context.secrets.delete(this.secretsKey(id));

    // Clear active if needed
    if (this.getActiveConnectionId() === id) {
      await this.context.globalState.update(ACTIVE_CONNECTION_KEY, undefined);
    }

    this.onConnectionsChanged.fire();
  }

  // ---------------------------------------------------------------------------
  // Active connection
  // ---------------------------------------------------------------------------

  /** Return the active connection (public fields only). */
  getActiveConnection(): Connection | undefined {
    const id = this.getActiveConnectionId();
    if (!id) {
      return undefined;
    }
    return this.getById(id);
  }

  /** Set the active connection by ID and update lastUsedAt. */
  async setActiveConnection(id: string): Promise<void> {
    const connection = this.getById(id);
    if (!connection) {
      throw new Error(`Connection "${id}" not found`);
    }
    await this.context.globalState.update(ACTIVE_CONNECTION_KEY, id);

    // Update lastUsedAt
    const connections = this.getAll();
    const index = connections.findIndex((c) => c.id === id);
    if (index !== -1) {
      connections[index].lastUsedAt = new Date().toISOString();
      await this.context.globalState.update(CONNECTIONS_STATE_KEY, connections);
    }

    this.onConnectionsChanged.fire();
  }

  /** Clear the active connection. */
  async clearActiveConnection(): Promise<void> {
    await this.context.globalState.update(ACTIVE_CONNECTION_KEY, undefined);
    this.onConnectionsChanged.fire();
  }

  // ---------------------------------------------------------------------------
  // Secrets
  // ---------------------------------------------------------------------------

  /** Load sensitive fields for a connection and return a hydrated Connection. */
  async getWithSecrets(id: string): Promise<Connection | undefined> {
    const connection = this.getById(id);
    if (!connection) {
      return undefined;
    }
    const secrets = await this.loadSecrets(id);
    return { ...connection, ...secrets };
  }

  // ---------------------------------------------------------------------------
  // Test
  // ---------------------------------------------------------------------------

  /**
   * Test a connection by performing a lightweight WhoAmI request.
   * Returns true if the request succeeds.
   */
  async testConnection(connection: Connection): Promise<boolean> {
    if (!this.dataverseManager) {
      throw new Error("DataverseManager is not initialized");
    }
    try {
      await this.dataverseManager.queryData(
        connection,
        "WhoAmI()"
      );
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private secretsKey(id: string): string {
    return `${CONNECTION_SECRETS_KEY_PREFIX}.${id}.${CONNECTION_SECRETS_KEY_SUFFIX}`;
  }

  private getActiveConnectionId(): string | undefined {
    return this.context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
  }

  private async saveSecrets(
    id: string,
    secrets: Partial<ConnectionSecretFields>
  ): Promise<void> {
    const existing = await this.loadSecrets(id);
    const merged: ConnectionSecretFields = {
      ...existing,
      ...(secrets.clientSecret !== undefined
        ? { clientSecret: secrets.clientSecret }
        : {}),
      ...(secrets.password !== undefined ? { password: secrets.password } : {}),
      ...(secrets.accessToken !== undefined
        ? { accessToken: secrets.accessToken }
        : {}),
      ...(secrets.refreshToken !== undefined
        ? { refreshToken: secrets.refreshToken }
        : {}),
    };
    // Remove undefined values
    const cleaned = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined)
    ) as ConnectionSecretFields;

    if (Object.keys(cleaned).length > 0) {
      await this.context.secrets.store(
        this.secretsKey(id),
        JSON.stringify(cleaned)
      );
    }
  }

  private async loadSecrets(id: string): Promise<ConnectionSecretFields> {
    const raw = await this.context.secrets.get(this.secretsKey(id));
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) as ConnectionSecretFields;
    } catch {
      return {};
    }
  }
}

// Re-export AUTH_TYPES for convenience
export { AUTH_TYPES };
