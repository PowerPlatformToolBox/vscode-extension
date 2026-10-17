export interface ConnectionSlotRange {
    min: number;
    max: number;
}

export type ConnectionTarget = "primary" | "secondary" | number;
export type ConnectionIds = Array<string | null>;

export interface ToolConnectionFeatures {
    connections?: number | { min?: number; max?: number };
    multiConnection?: "required" | "optional" | "none";
    connectionRequirement?: "required" | "optional";
    enabledForPowerPlatformAPI?: boolean;
}

export function resolveConnectionSlots(features?: ToolConnectionFeatures | null): ConnectionSlotRange {
    if (!features) return { min: 1, max: 1 };

    if (features.connections !== undefined) {
        if (typeof features.connections === "number") {
            return validCount(features.connections) ? { min: features.connections, max: features.connections } : { min: 1, max: 1 };
        }

        const min = features.connections.min ?? 1;
        const max = features.connections.max ?? min;
        return validCount(min) && validCount(max) && min <= max ? { min, max } : { min: 1, max: 1 };
    }

    const multiConnection = features.multiConnection ?? "none";
    const connectionRequirement = features.connectionRequirement ?? "required";
    if (multiConnection === "none") return connectionRequirement === "optional" ? { min: 0, max: 1 } : { min: 1, max: 1 };
    if (connectionRequirement === "optional") return { min: 0, max: 2 };
    return multiConnection === "required" ? { min: 2, max: 2 } : { min: 1, max: 2 };
}

export function normalizeConnectionTarget(target: ConnectionTarget): number {
    if (target === "primary") return 0;
    if (target === "secondary") return 1;
    if (Number.isInteger(target) && target >= 0) return target;
    throw new RangeError(`Invalid connection target: ${String(target)}`);
}

export function resolveConnectionSlotIds(connectionIds: Array<string | null>, min: number, max: number): ConnectionIds | undefined {
    if (!validCount(min) || !validCount(max) || min > max) return undefined;
    const slots = Array.from({ length: max }, (_, index) => connectionIds[index] ?? null);
    if (slots.slice(0, min).some((id) => !id)) return undefined;
    return slots;
}

export function connectionTargetLabel(index: number): string {
    if (!Number.isInteger(index) || index < 0) throw new RangeError(`Invalid connection slot index: ${index}`);
    if (index === 0) return "Primary";
    if (index === 1) return "Secondary";
    return `Connection ${index + 1}`;
}

export function parseConnectionsFeature(value: unknown): ToolConnectionFeatures["connections"] | undefined {
    for (let depth = 0; typeof value === "string" && depth < 2; depth++) {
        try {
            value = JSON.parse(value) as unknown;
        } catch {
            return undefined;
        }
    }
    if (typeof value === "number") return validCount(value) ? value : undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const range = value as Record<string, unknown>;
    if (Object.keys(range).some((key) => key !== "min" && key !== "max")) return undefined;
    const min = range.min ?? 1;
    const max = range.max ?? min;
    if (!Number.isInteger(min) || !Number.isInteger(max) || !validCount(min as number) || !validCount(max as number) || (min as number) > (max as number)) return undefined;
    return { min: min as number, max: max as number };
}

export function parseToolConnectionFeatures(value: unknown): ToolConnectionFeatures | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const features = value as Record<string, unknown>;
    const connections = parseConnectionsFeature(features.connections);
    const multiConnection = features.multiConnection === "required" || features.multiConnection === "optional" || features.multiConnection === "none" ? features.multiConnection : undefined;
    const connectionRequirement = features.connectionRequirement === "required" || features.connectionRequirement === "optional" ? features.connectionRequirement : undefined;
    const enabledForPowerPlatformAPI = typeof features.enabledForPowerPlatformAPI === "boolean" ? features.enabledForPowerPlatformAPI : undefined;
    if (connections === undefined && !multiConnection && !connectionRequirement && enabledForPowerPlatformAPI === undefined) return undefined;
    return {
        ...(connections !== undefined ? { connections } : { multiConnection, connectionRequirement }),
        enabledForPowerPlatformAPI,
    };
}

function validCount(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 10;
}
