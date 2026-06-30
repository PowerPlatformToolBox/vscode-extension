import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";
import { ACTIVE_CONNECTION_KEY, AUTH_TYPES, AuthType, CATEGORIES_KEY, CATEGORY_COLORS_KEY, CONNECTIONS_STATE_KEY, CONNECTION_SECRETS_KEY_PREFIX, CONNECTION_SECRETS_KEY_SUFFIX } from "../constants";

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
    /** MSAL account identifier used for silent token re-acquisition (interactive auth only). */
    msalAccountId?: string;
    /** ISO-8601 expiry timestamp of the Dataverse access token. */
    tokenExpiry?: string;
    /** Whether this connection is also used for Power Platform API (api.powerplatform.com) calls. */
    enabledForPowerPlatformAPI?: boolean;
    /** Scopes granted for Power Platform API authentication. */
    scopesForPowerPlatformAPI?: string[];
    /** ISO-8601 expiry timestamp of the Power Platform API access token. */
    powerPlatformTokenExpiry?: string;
    /** Marks a connection imported from file that is missing required credentials. */
    hasIncompleteCredentials?: boolean;
    /** Browser to use for interactive auth (e.g. "Chrome", "Edge"). Undefined = system default. */
    browser?: string;
    /** Browser profile name to use for interactive auth. */
    browserProfile?: string;
}

/**
 * Sensitive connection fields stored exclusively in SecretStorage.
 */
export interface ConnectionSecretFields {
    clientSecret?: string;
    password?: string;
    accessToken?: string;
    refreshToken?: string;
    /** Separate access token for Power Platform API (https://api.powerplatform.com scope). */
    powerPlatformAccessToken?: string;
}

/**
 * Full connection model used throughout the extension.
 * Extends the public fields with optional sensitive fields (populated on demand).
 */
export type Connection = ConnectionPublicFields & Partial<ConnectionSecretFields>;

// ---------------------------------------------------------------------------
// Import / Export types
// ---------------------------------------------------------------------------

/** A single connection entry within a connection export file. */
export type ConnectionExportEntry = Omit<ConnectionPublicFields, "msalAccountId" | "tokenExpiry" | "powerPlatformTokenExpiry" | "hasIncompleteCredentials">;

/** Shape of the JSON file produced by `exportConnections`. */
export interface ConnectionExport {
    version: 1;
    exportedAt: string;
    connections: ConnectionExportEntry[];
}

/** Result returned by `importConnections`. */
export interface ConnectionImportResult {
    imported: number;
    skipped: number;
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation helpers (used by importConnections)
// ---------------------------------------------------------------------------

const REQUIRED_IMPORT_FIELDS: (keyof ConnectionPublicFields)[] = ["name", "url", "environment", "authType"];

const VALID_ENVIRONMENTS = new Set<string>(["Dev", "Test", "UAT", "Production"]);
const VALID_AUTH_TYPES = new Set<string>(Object.values(AUTH_TYPES));

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
    setDataverseManager(dm: import("./dataverseManager").DataverseManager): void {
        this.dataverseManager = dm;
    }

    // ---------------------------------------------------------------------------
    // CRUD
    // ---------------------------------------------------------------------------

    /** Return all connections (public fields only — secrets excluded). */
    getAll(): Connection[] {
        return this.context.globalState.get<ConnectionPublicFields[]>(CONNECTIONS_STATE_KEY, []);
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

        const { clientSecret, password, accessToken, refreshToken, ...publicFields } = connection;
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

        const { clientSecret, password, accessToken, refreshToken, ...publicFields } = connection;

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
            await this.dataverseManager.queryData(connection, "WhoAmI()");
            return true;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------------------
    // Import / Export
    // ---------------------------------------------------------------------------

    /**
     * The secret fields excluded from connection exports (tokens should never
     * be written to a portable file).
     */
    private static readonly EXPORT_EXCLUDED_SECRET_FIELDS: (keyof ConnectionSecretFields)[] = ["accessToken", "refreshToken", "powerPlatformAccessToken"];

    /**
     * The public fields excluded from exports (runtime state that is meaningless
     * in another environment).
     */
    private static readonly EXPORT_EXCLUDED_PUBLIC_FIELDS: (keyof ConnectionPublicFields)[] = ["msalAccountId", "tokenExpiry", "powerPlatformTokenExpiry", "hasIncompleteCredentials"];

    /**
     * Export connections to a sanitized JSON structure.
     * Secrets (access/refresh tokens) and runtime-only state are stripped.
     *
     * @param ids When provided, only those connection IDs are exported.
     *            When omitted, all connections are exported.
     */
    exportConnections(ids?: string[]): ConnectionExport {
        const all = this.getAll();
        const toExport = ids && ids.length > 0 ? all.filter((c) => ids.includes(c.id)) : all;

        const sanitized = toExport.map((conn) => {
            const sanitizedConn = { ...conn } as Partial<Connection>;
            for (const field of ConnectionsManager.EXPORT_EXCLUDED_PUBLIC_FIELDS) {
                delete sanitizedConn[field];
            }
            for (const field of ConnectionsManager.EXPORT_EXCLUDED_SECRET_FIELDS) {
                delete sanitizedConn[field];
            }
            return sanitizedConn as ConnectionExportEntry;
        });

        return {
            version: 1,
            exportedAt: new Date().toISOString(),
            connections: sanitized,
        };
    }

    /**
     * Import connections from a parsed JSON export payload.
     * Validates structure; marks connections with missing required secrets as incomplete.
     *
     * @throws `Error` when the payload structure is invalid (wrong version, missing array, etc.).
     * @returns Summary of how many connections were imported, skipped, and any per-entry warnings.
     */
    async importConnections(data: unknown): Promise<ConnectionImportResult> {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Invalid import file: expected a JSON object.");
        }

        const payload = data as Record<string, unknown>;

        if (payload.version !== 1) {
            throw new Error(`Unsupported export version: ${String(payload.version)}. Expected version 1.`);
        }

        if (!Array.isArray(payload.connections)) {
            throw new Error("Invalid import file: 'connections' must be an array.");
        }

        if ((payload.connections as unknown[]).length === 0) {
            throw new Error("Import file contains no connections.");
        }

        const existing = this.getAll();
        const existingIds = new Set(existing.map((c) => c.id));

        let imported = 0;
        let skipped = 0;
        const warnings: string[] = [];

        for (const raw of payload.connections as unknown[]) {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                skipped++;
                warnings.push("Skipped an entry that is not a valid object.");
                continue;
            }

            const entry = raw as Record<string, unknown>;
            const connName = typeof entry.name === "string" ? entry.name : "(unknown)";

            // Validate required fields
            const missingFields: string[] = [];
            for (const field of REQUIRED_IMPORT_FIELDS) {
                if (!entry[field] || typeof entry[field] !== "string") {
                    missingFields.push(field);
                }
            }

            if (missingFields.length > 0) {
                skipped++;
                warnings.push(`Skipped "${connName}": missing required fields: ${missingFields.join(", ")}.`);
                continue;
            }

            if (!VALID_ENVIRONMENTS.has(entry.environment as string)) {
                skipped++;
                warnings.push(`Skipped "${connName}": invalid environment "${String(entry.environment)}". Must be Dev, Test, UAT, or Production.`);
                continue;
            }

            if (!VALID_AUTH_TYPES.has(entry.authType as string)) {
                skipped++;
                warnings.push(`Skipped "${connName}": invalid authType "${String(entry.authType)}".`);
                continue;
            }

            // Determine if credentials are complete for this auth type
            const authType = entry.authType as AuthType;
            let hasIncompleteCredentials = false;

            if (authType === AUTH_TYPES.CLIENT_CREDENTIALS) {
                if (!entry.clientId || typeof entry.clientId !== "string") {
                    warnings.push(`Connection "${connName}" imported with warning: missing clientId.`);
                }
                // clientSecret is a secret, not included in exports — always mark incomplete
                hasIncompleteCredentials = true;
                warnings.push(`Connection "${connName}" imported with warning: clientSecret must be entered manually.`);
            } else if (authType === AUTH_TYPES.USERNAME_PASSWORD) {
                if (!entry.username || typeof entry.username !== "string") {
                    warnings.push(`Connection "${connName}" imported with warning: missing username.`);
                }
                // password is a secret, not included in exports — always mark incomplete
                hasIncompleteCredentials = true;
                warnings.push(`Connection "${connName}" imported with warning: password must be entered manually.`);
            }

            // Generate a new unique ID when the imported one already exists
            let newId = typeof entry.id === "string" && entry.id ? entry.id : uuidv4();
            if (existingIds.has(newId)) {
                newId = uuidv4();
            }
            existingIds.add(newId);

            const newConnection: ConnectionPublicFields = {
                id: newId,
                name: entry.name as string,
                url: entry.url as string,
                environment: entry.environment as ConnectionPublicFields["environment"],
                authType: authType,
                clientId: typeof entry.clientId === "string" ? entry.clientId : undefined,
                username: typeof entry.username === "string" ? entry.username : undefined,
                tenantId: typeof entry.tenantId === "string" ? entry.tenantId : undefined,
                category: typeof entry.category === "string" ? entry.category : undefined,
                environmentColor: typeof entry.environmentColor === "string" ? entry.environmentColor : undefined,
                categoryColor: typeof entry.categoryColor === "string" ? entry.categoryColor : undefined,
                createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
                enabledForPowerPlatformAPI: typeof entry.enabledForPowerPlatformAPI === "boolean" ? entry.enabledForPowerPlatformAPI : false,
                scopesForPowerPlatformAPI:
                    Array.isArray(entry.scopesForPowerPlatformAPI) && (entry.scopesForPowerPlatformAPI as unknown[]).every((s) => typeof s === "string")
                        ? (entry.scopesForPowerPlatformAPI as string[])
                        : undefined,
                hasIncompleteCredentials,
            };

            existing.push(newConnection);
            imported++;
        }

        if (imported > 0) {
            await this.context.globalState.update(CONNECTIONS_STATE_KEY, existing);
            this.onConnectionsChanged.fire();
        }

        return { imported, skipped, warnings };
    }

    // ---------------------------------------------------------------------------
    // Categories
    // ---------------------------------------------------------------------------

    /** Return all user-defined categories (merged with any used in existing connections). */
    getCategories(): string[] {
        const stored = this.context.globalState.get<string[]>(CATEGORIES_KEY, []);
        const fromConnections = this.getAll()
            .map((c) => c.category)
            .filter((c): c is string => typeof c === "string" && c.length > 0);
        const merged = new Set([...stored, ...fromConnections]);
        return [...merged].sort();
    }

    /** Persist a category name (and optionally its color). Idempotent. */
    async saveCategory(name: string, color?: string): Promise<void> {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const categories = this.context.globalState.get<string[]>(CATEGORIES_KEY, []);
        if (!categories.includes(trimmed)) {
            categories.push(trimmed);
            await this.context.globalState.update(CATEGORIES_KEY, categories);
        }
        if (color) {
            const colors = this.context.globalState.get<Record<string, string>>(CATEGORY_COLORS_KEY, {});
            colors[trimmed] = color;
            await this.context.globalState.update(CATEGORY_COLORS_KEY, colors);
        }
    }

    /** Return the stored category color map, enriched with colors inferred from existing connections. */
    getCategoryColors(): Record<string, string> {
        const stored = this.context.globalState.get<Record<string, string>>(CATEGORY_COLORS_KEY, {});
        const result: Record<string, string> = { ...stored };
        for (const conn of this.getAll()) {
            if (conn.category && conn.categoryColor && !result[conn.category]) {
                result[conn.category] = conn.categoryColor;
            }
        }
        return result;
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

    private async saveSecrets(id: string, secrets: Partial<ConnectionSecretFields>): Promise<void> {
        const existing = await this.loadSecrets(id);
        const merged: ConnectionSecretFields = {
            ...existing,
            ...(secrets.clientSecret !== undefined ? { clientSecret: secrets.clientSecret } : {}),
            ...(secrets.password !== undefined ? { password: secrets.password } : {}),
            ...(secrets.accessToken !== undefined ? { accessToken: secrets.accessToken } : {}),
            ...(secrets.refreshToken !== undefined ? { refreshToken: secrets.refreshToken } : {}),
            ...(secrets.powerPlatformAccessToken !== undefined ? { powerPlatformAccessToken: secrets.powerPlatformAccessToken } : {}),
        };
        // Remove undefined values
        const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as ConnectionSecretFields;

        if (Object.keys(cleaned).length > 0) {
            await this.context.secrets.store(this.secretsKey(id), JSON.stringify(cleaned));
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
