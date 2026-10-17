export interface ImpersonationPickerItem<T> {
    label: string;
    description?: string;
    detail?: string;
    user?: T;
    skip?: boolean;
    loadMore?: boolean;
    alwaysShow?: boolean;
}

export type ImpersonationPickerSelection<T> =
    | { type: "user"; user: T }
    | { type: "skip" }
    | { type: "loadMore" }
    | { type: "none" };

export function createImpersonationPickerItems<T extends {
    fullname: string;
    internalemailaddress?: string;
    domainname?: string;
    azureactivedirectoryobjectid: string;
    systemuserid: string;
}>(users: T[], hasNextPage: boolean, loadError?: string): ImpersonationPickerItem<T>[] {
    const skipItem: ImpersonationPickerItem<T> = {
        label: "$(close) Skip Impersonation for this connection",
        description: "Use this connection without Dataverse impersonation",
        skip: true,
        alwaysShow: true,
    };
    if (loadError) {
        return [skipItem, { label: "Could not load users", description: loadError }];
    }

    const items: ImpersonationPickerItem<T>[] = [skipItem, ...users.map((user) => ({
        label: user.fullname,
        description: user.internalemailaddress ?? user.domainname ?? user.azureactivedirectoryobjectid,
        detail: user.systemuserid,
        user,
    }))];
    if (hasNextPage) {
        items.push({ label: "$(more) Load more users", description: "Fetch the next page of matching users", loadMore: true, alwaysShow: true });
    }
    return items;
}

export function resolveImpersonationPickerSelection<T>(selected: ImpersonationPickerItem<T> | undefined, hasNextPage: boolean): ImpersonationPickerSelection<T> {
    if (selected?.user) return { type: "user", user: selected.user };
    if (selected?.skip) return { type: "skip" };
    if (selected?.loadMore && hasNextPage) return { type: "loadMore" };
    return { type: "none" };
}

export interface ConnectionStatusSlot {
    index: number;
    connectionId: string | null;
    connectionName?: string;
    impersonatedUserName?: string;
}

export function formatConnectionStatus(slots: ConnectionStatusSlot[], maxConnections: number): { text: string; tooltip: string } {
    const selected = slots.filter((slot) => slot.connectionId).length;
    const impersonated = slots.filter((slot) => slot.connectionId && slot.impersonatedUserName).length;
    const details = slots.map((slot) => {
        const connection = slot.connectionId ? slot.connectionName ?? "Unknown connection" : "Not set";
        const impersonation = slot.impersonatedUserName ? `impersonating ${slot.impersonatedUserName}` : "no impersonation";
        const target = slot.index === 0 ? "Primary" : slot.index === 1 ? "Secondary" : `Connection ${slot.index + 1}`;
        return `${target}: ${connection} · ${impersonation}`;
    });

    return {
        text: `$(database) Connections: ${selected}/${maxConnections} · Impersonation: ${impersonated}/${selected}`,
        tooltip: `${details.join("\n")}\nClick to manage this tool's connection slots`,
    };
}
