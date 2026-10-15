export type ConnectionTarget = "primary" | "secondary" | number;

export interface ToolConnection {
    id: string;
    name: string;
    url: string;
    environment: "Dev" | "Test" | "UAT" | "Production";
    category?: string;
    enabledForPowerPlatformAPI?: boolean;
}

export interface ToolContext {
    toolId: string | null;
    instanceId?: string | null;
    connectionIds?: Array<string | null>;
    connectionUrls?: Array<string | null>;
    connectionId?: string | null;
    connectionUrl: string | null;
    secondaryConnectionId?: string | null;
    secondaryConnectionUrl?: string | null;
}

export interface ToolFeatures {
    connections?: number | { min?: number; max?: number };
    multiConnection?: "required" | "optional" | "none";
    connectionRequirement?: "required" | "optional";
    enabledForPowerPlatformAPI?: boolean;
}

export interface ConnectionsAPI {
    getConnections(): Promise<Array<ToolConnection | null>>;
    getConnection(target?: ConnectionTarget): Promise<ToolConnection | null>;
    getActiveConnection(): Promise<ToolConnection | null>;
    getSecondaryConnection(): Promise<ToolConnection | null>;
}

export type DataverseConnectionTarget = ConnectionTarget;
export type PowerPlatformConnectionTarget = ConnectionTarget;

declare global {
    interface Window {
        toolboxAPI: {
            getToolContext(): Promise<ToolContext>;
            connections: ConnectionsAPI;
            dataverse: {
                [method: string]: (...args: unknown[]) => Promise<unknown>;
                queryData(query: string, connectionTarget?: ConnectionTarget): Promise<unknown>;
                retrieve(entity: string, id: string, columns?: string[], connectionTarget?: ConnectionTarget): Promise<unknown>;
                retrieveMultiple(fetchXml: string, connectionTarget?: ConnectionTarget): Promise<unknown>;
            };
            powerplatform: Record<string, {
                Get(path?: string, connectionTarget?: ConnectionTarget, headers?: Record<string, string>): Promise<unknown>;
                Post(path?: string, body?: unknown, connectionTarget?: ConnectionTarget, headers?: Record<string, string>): Promise<unknown>;
                Put(path?: string, body?: unknown, connectionTarget?: ConnectionTarget, headers?: Record<string, string>): Promise<unknown>;
                Patch(path?: string, body?: unknown, connectionTarget?: ConnectionTarget, headers?: Record<string, string>): Promise<unknown>;
                Delete(path?: string, connectionTarget?: ConnectionTarget, headers?: Record<string, string>, body?: unknown): Promise<unknown>;
            }>;
        };
        dataverseAPI: Window["toolboxAPI"]["dataverse"];
        powerplatformAPI: Window["toolboxAPI"]["powerplatform"];
        TOOLBOX_CONTEXT: ToolContext | null;
        TOOLBOX_FEATURES?: ToolFeatures;
    }
}

export {};
