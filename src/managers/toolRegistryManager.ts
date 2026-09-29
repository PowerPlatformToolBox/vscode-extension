import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as vscode from "vscode";
import type { CspExceptions } from "../utils/csp";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A tool entry as stored in the PPTB Supabase registry.
 */
export interface RegistryTool {
    /** Unique identifier for the tool (e.g. "pac-cli"). */
    id: string;
    /** Human-readable display name. */
    name: string;
    /** Semantic version string (e.g. "1.2.3"). */
    version: string;
    /** Short description of what the tool does. */
    description?: string;
    /** Publisher / author of the tool. */
    publisher?: string;
    /** Contributors to the tool. Can be a string or array of strings. */
    contributors?: string[] | string;
    /** Whether the tool is verified. */
    isVerified?: boolean;
    /** URL from which the tool binary/archive can be downloaded. */
    download?: string;
    /** URL of the tool's icon image. */
    icon?: string;
    /**
     * Relative path inside the tool's installation directory that points to the
     * main executable (e.g. "bin/pac" or "pac.exe").
     */
    executableRelativePath?: string;
    /** Category groupings for this tool (e.g. "CLI", "DevOps"). */
    categories?: string[];
    multiConnection?: "required" | "optional" | "none";
    connectionRequirement?: "required" | "optional";
    enabledForPowerPlatformAPI?: boolean;
    mcpEnabled?: boolean;
    maturityStatus?: string;
    minAPI?: string;
    maxAPI?: string;
    checksum?: string;
    size?: number;
    cspExceptions?: CspExceptions;
    readmeUrl?: string;
    repository?: string;
    website?: string;
    license?: string;
    publishedAt?: string;
    createdAt?: string;
    status?: "active" | "deprecated" | "archived";
    /** Total download count (analytics), when available. */
    downloads?: number;
    /** Average user rating (analytics), when available. */
    rating?: number;
    /** Monthly Active Users (analytics), when available. */
    mau?: number;
}

/**
 * Analytics counters for a single tool, as tracked in the `tool_analytics` table.
 */
export interface ToolAnalytics {
    downloads?: number;
    rating?: number;
    mau?: number;
}

/**
 * Paginated result from `getTools`.
 */
export interface RegistryToolsResult {
    tools: RegistryTool[];
    /** Total number of matching tools (before pagination). */
    total: number;
}

/** Options accepted by `getTools`. */
export interface GetToolsOptions {
    /** Free-text search against name and description. */
    search?: string;
    /** Filter by category. */
    category?: string;
    /** 1-based page number (default: 1). */
    page?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

// ── ToolRegistryManager ───────────────────────────────────────────────────────

/**
 * Provides read-only access to the PPTB community tool registry hosted in
 * Supabase.
 *
 * The Supabase URL and anonymous key are baked into the extension bundle at
 * build time via `webpack.DefinePlugin` from the repo's `.env` file.  They
 * are **not** user-configurable VS Code settings.
 *
 * If either value is absent at runtime (e.g. a local dev build without a
 * `.env` file), the manager logs an informational warning and returns empty
 * results rather than throwing.
 */
export class ToolRegistryManager {
    private readonly client: SupabaseClient | null;
    private readonly output: vscode.OutputChannel;

    constructor(output: vscode.OutputChannel) {
        this.output = output;
        const url: string = process.env.PPTB_SUPABASE_URL ?? "";
        const key: string = process.env.PPTB_SUPABASE_ANON_KEY ?? "";

        this.output.appendLine(`[Registry] URL  : ${url || "(not set)"}`);
        this.output.appendLine(`[Registry] Key  : ${key ? "(set)" : "(not set)"}`);

        if (!url || !key) {
            void vscode.window.showInformationMessage("PPTB: Supabase credentials are not configured — tool registry features will be unavailable.");
            this.client = null;
            return;
        }

        this.client = createClient(url, key);
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Fetch a page of tools from the registry, optionally filtered by search
     * text and/or category.
     *
     * @param options.search   Free-text filter applied to tool name and description.
     * @param options.category Exact category filter.
     * @param options.page     1-based page index (default: 1).
     */
    async getTools(options: GetToolsOptions = {}): Promise<RegistryToolsResult> {
        if (!this.client) {
            return { tools: [], total: 0 };
        }

        const { search, category, page = 1 } = options;
        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const buildQuery = (
            selectColumns: string,
            start = category ? 0 : from,
            end = category ? 999 : to,
        ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null; count: number | null }> => {
            // Typed as `any`: supabase-js infers row shape from the literal `selectColumns`
            // string, which breaks down once it's widened to `string` here — that's fine
            // since we parse rows manually via `mapRow` regardless of the inferred type.
            let q = this.client!.from("tools_catalog").select(selectColumns, { count: "exact" }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            q = q.eq("status", "active");
            q = q.range(start, end);
            if (search) {
                // Escape PostgREST ILIKE special characters so literal percent-signs,
                // underscores, and backslashes in the search term are treated as text.
                const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
                q = q.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`);
            }
            return q as Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null; count: number | null }>;
        };

        // Attempt to embed the `tool_analytics` (downloads/rating/mau) and `tool_categories`
        // relations so Popularity/Highly Rated/Most Downloaded sorting and the Category filter
        // have data to work with. Fall back to a plain query when either relation isn't
        // configured in this Supabase project so those features simply degrade to "no data".
        const catalogColumns =
            "id, packagename, name, description, website, repository, status, created_at, version, download, icon, readme_url, license, csp_exceptions, min_api, max_api, multi_connection, connection_requirement, enabled_for_power_platform_api, mcp_enabled, maturity_status, tool_analytics(downloads,rating,mau), tool_categories(categories(name)), tool_contributors(contributors(name))";
        let columns = catalogColumns;
        let { data, error, count } = await buildQuery(columns);
        if (error) {
            columns = "*";
            ({ data, error, count } = await buildQuery(columns));
        }

        if (error) {
            this.output.appendLine(`[Registry] getTools error: ${error.message}`);
            this.output.appendLine(`[Registry] error details: ${JSON.stringify(error)}`);
            this.output.show(true);
            return { tools: [], total: 0 };
        }

        this.output.appendLine(`[Registry] getTools returned ${count ?? 0} total rows, ${(data ?? []).length} in page`);
        let rows = data ?? [];
        if (category) {
            // Category is a relation, not a flat catalog column. Fetch all pages before slicing.
            for (let start = rows.length; start < (count ?? 0); start += 1000) {
                const result = await buildQuery(columns, start, start + 999);
                if (result.error) {
                    this.output.appendLine(`[Registry] category page error: ${result.error.message}`);
                    return { tools: [], total: 0 };
                }
                rows = rows.concat((result.data ?? []) as Record<string, unknown>[]);
            }
        }
        if (columns === "*") {
            await this.attachCatalogRelations(rows);
        }
        let tools = rows.map(mapRow);
        if (category) {
            tools = tools.filter((tool) => tool.categories?.includes(category));
            count = tools.length;
            tools = tools.slice(from, to + 1);
        }
        this.output.appendLine(`[Registry] Mapped tools: ${tools.map((t) => `${t.id} (contributors=${JSON.stringify(t.contributors) ?? "none"}, verified=${t.isVerified})`).join("; ")}`);

        return {
            tools,
            total: count ?? 0,
        };
    }

    private async attachCatalogRelations(rows: Record<string, unknown>[]): Promise<void> {
        if (!this.client) return;
        for (let start = 0; start < rows.length; start += 100) {
            const batch = rows.slice(start, start + 100);
            const ids = batch.map((row) => str(row["id"])).filter((id): id is string => !!id);
            if (!ids.length) continue;
            for (const [table, columns] of [
                ["tool_categories", "tool_id, categories(name)"],
                ["tool_contributors", "tool_id, contributors(name)"],
                ["tool_analytics", "tool_id, downloads, rating, mau"],
            ]) {
                const { data, error } = await this.client.from(table).select(columns).in("tool_id", ids);
                if (error) {
                    this.output.appendLine(`[Registry] ${table} lookup error: ${error.message}`);
                    continue;
                }
                for (const row of batch) {
                    const matches = ((data ?? []) as unknown as Record<string, unknown>[]).filter((relation) => relation["tool_id"] === row["id"]);
                    row[table] = table === "tool_analytics" ? matches[0] : matches;
                }
            }
        }
    }

    /**
     * Fetch download/rating/MAU analytics for a set of tool IDs (used to sort
     * installed tools by Popularity/Highly Rated/Most Downloaded, mirroring the
     * desktop app's `tool_analytics` lookup). Returns an empty map when the
     * client isn't configured, no IDs are given, or the query fails.
     */
    async getAnalytics(toolIds: string[]): Promise<Map<string, ToolAnalytics>> {
        const map = new Map<string, ToolAnalytics>();
        if (!this.client || toolIds.length === 0) {
            return map;
        }

        const { data, error } = await this.client.from("tools_catalog").select("id, tool_analytics(downloads,rating,mau)").in("id", toolIds).eq("status", "active");

        if (error) {
            this.output.appendLine(`[Registry] getAnalytics error: ${error.message}`);
            return map;
        }

        for (const row of (data ?? []) as Record<string, unknown>[]) {
            const id = str(row["id"]);
            if (!id) {
                continue;
            }
            const analytics = parseAnalyticsFromRecord(row);
            if (analytics) {
                map.set(id, analytics);
            }
        }

        return map;
    }

    /**
     * Fetch the current registry version for a set of tool IDs, used to detect
     * when an installed tool has an update available.
     * Returns an empty map when the client isn't configured, no IDs are given,
     * or the query fails.
     */
    async getLatestVersions(toolIds: string[]): Promise<Map<string, string>> {
        const map = new Map<string, string>();
        if (!this.client || toolIds.length === 0) {
            return map;
        }

        const { data, error } = await this.client.from("tools_catalog").select("id, version").in("id", toolIds).eq("status", "active");

        if (error) {
            this.output.appendLine(`[Registry] getLatestVersions error: ${error.message}`);
            return map;
        }

        for (const row of (data ?? []) as Record<string, unknown>[]) {
            const id = str(row["id"]);
            const version = str(row["version"]);
            if (id && version) {
                map.set(id, version);
            }
        }

        return map;
    }

    /**
     * Fetch a single tool from the registry by its ID.
     * Returns `null` if the tool is not found or the client is not configured.
     */
    async getToolById(id: string): Promise<RegistryTool | null> {
        if (!this.client) {
            return null;
        }

        let { data, error } = await this.client
            .from("tools_catalog")
            .select("*, tool_analytics(downloads,rating,mau), tool_categories(categories(name)), tool_contributors(contributors(name))")
            .eq("id", id)
            .eq("status", "active")
            .single();
        if (error) {
            ({ data, error } = await this.client.from("tools_catalog").select("*").eq("id", id).eq("status", "active").single());
        }

        if (error || !data) {
            return null;
        }

        if (!data["tool_categories"]) {
            await this.attachCatalogRelations([data as Record<string, unknown>]);
        }
        const tool = mapRow(data as Record<string, unknown>);
        return tool;
    }

    /**
     * Return the deduplicated list of all capability tags present across every
     * tool in the registry.
     *
     * The extension panel uses this to populate tag filter chips.
     */
    async getKnownCapabilityTags(): Promise<string[]> {
        if (!this.client) {
            return [];
        }

        const { data, error } = await this.client.from("capability_tags").select("tag");

        if (error) {
            this.output.appendLine(`[Registry] getKnownCapabilityTags error: ${error.message}`);
            return [];
        }
        return [...new Set((data ?? []).map((row) => str(row.tag)).filter((tag): tag is string => !!tag))].sort();
    }

    /**
     * Fetch the icon URL for every tool in the registry (all pages).
     * Returns a deduplicated list of non-empty URLs.
     * Used by IconCacheManager to warm up the icon cache at activation.
     */
    async getAllIconUrls(): Promise<string[]> {
        if (!this.client) {
            return [];
        }
        try {
            const { data, error } = await this.client.from("tools_catalog").select("icon").eq("status", "active");
            if (error || !data) {
                return [];
            }
            const urls = (data as { icon?: string | null }[]).map((r) => r.icon).filter((u): u is string => typeof u === "string" && u.length > 0);
            return [...new Set(urls)];
        } catch {
            return [];
        }
    }
}

// ---------------------------------------------------------------------------
// Row mapping — handles both camelCase and snake_case column names
// ---------------------------------------------------------------------------

export function str(v: unknown): string | undefined {
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export function bool(v: unknown): boolean | undefined {
    if (typeof v === "boolean") {
        return v;
    }
    if (typeof v === "string") {
        const lower = v.trim().toLowerCase();
        if (lower === "true" || lower === "1" || lower === "yes" || lower === "verified" || lower === "official") {
            return true;
        }
        if (lower === "false" || lower === "0" || lower === "no" || lower === "unverified" || lower === "community") {
            return false;
        }
    }
    if (typeof v === "number") {
        return v === 1;
    }
    return undefined;
}

export function extractNames(v: unknown): string[] | string | undefined {
    if (v === null || v === undefined) {
        return undefined;
    }
    if (typeof v === "string") {
        const trimmed = v.trim();
        if (!trimmed) {
            return undefined;
        }
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(trimmed);
                return extractNames(parsed);
            } catch {
                return trimmed;
            }
        }
        return trimmed;
    }
    if (Array.isArray(v)) {
        const names: string[] = [];
        for (const item of v) {
            if (typeof item === "string" && item.trim().length > 0) {
                names.push(item.trim());
            } else if (item && typeof item === "object") {
                const obj = item as Record<string, unknown>;
                const name = str(obj["name"]) ?? str(obj["username"]) ?? str(obj["login"]) ?? str(obj["displayName"]) ?? str(obj["title"]);
                if (name) {
                    names.push(name);
                }
            }
        }
        return names.length > 0 ? names : undefined;
    }
    if (typeof v === "object") {
        const obj = v as Record<string, unknown>;
        const name = str(obj["name"]) ?? str(obj["username"]) ?? str(obj["login"]) ?? str(obj["displayName"]) ?? str(obj["title"]);
        return name ?? undefined;
    }
    return undefined;
}

export function parseContributorsFromRecord(row: Record<string, unknown>): string[] | string | undefined {
    const joined = row["tool_contributors"];
    if (Array.isArray(joined)) {
        const names = joined
            .map((entry) => {
                const contributor = entry && typeof entry === "object" ? (entry as Record<string, unknown>)["contributors"] : undefined;
                return contributor && typeof contributor === "object" ? str((contributor as Record<string, unknown>)["name"]) : undefined;
            })
            .filter((name): name is string => !!name);
        if (names.length) {
            return names;
        }
    }
    return undefined;
}

export function formatContributors(contributors?: string[] | string): string | undefined {
    if (!contributors) {
        return undefined;
    }
    if (Array.isArray(contributors)) {
        return contributors.join(", ");
    }
    return contributors;
}

/**
 * Parse an embedded/joined `tool_analytics(downloads,rating,mau)` relation off a
 * raw Supabase row. PostgREST returns to-one embeds as either a single object or
 * (depending on FK cardinality detection) a one-element array.
 */
function parseAnalyticsFromRecord(row: Record<string, unknown>): ToolAnalytics | undefined {
    const raw = row["tool_analytics"];
    const analytics = Array.isArray(raw) ? raw[0] : raw;
    if (!analytics || typeof analytics !== "object") {
        return undefined;
    }
    const a = analytics as Record<string, unknown>;
    const downloads = typeof a["downloads"] === "number" ? a["downloads"] : undefined;
    const rating = typeof a["rating"] === "number" ? a["rating"] : undefined;
    const mau = typeof a["mau"] === "number" ? a["mau"] : undefined;
    if (downloads === undefined && rating === undefined && mau === undefined) {
        return undefined;
    }
    return { downloads, rating, mau };
}

/**
 * Parse category names off a raw Supabase row. Supports the normalized
 * `tool_categories(categories(name))` many-to-many join (an array of `{ categories: { name } }`
 * entries), a flat `categories` array column, or a flat `category` string column — whichever
 * shape this Supabase project actually uses.
 */
function parseCategoriesFromRecord(row: Record<string, unknown>): string[] | undefined {
    const joined = row["tool_categories"];
    if (Array.isArray(joined)) {
        const names = joined
            .map((entry) => {
                if (!entry || typeof entry !== "object") {
                    return undefined;
                }
                const nested = (entry as Record<string, unknown>)["categories"];
                const category = Array.isArray(nested) ? nested[0] : nested;
                return category && typeof category === "object" ? str((category as Record<string, unknown>)["name"]) : undefined;
            })
            .filter((n): n is string => !!n);
        if (names.length > 0) {
            return names;
        }
    }

    return undefined;
}

function mapRow(row: Record<string, unknown>): RegistryTool {
    const contributors = parseContributorsFromRecord(row);
    const publisher = str(row["publisher"]) ?? str(row["author"]) ?? (typeof contributors === "string" ? contributors : Array.isArray(contributors) ? contributors[0] : undefined);
    const maturityStatus = str(row["maturity_status"]);
    const isVerified = maturityStatus?.toLowerCase() === "verified";
    const analytics = parseAnalyticsFromRecord(row);
    const multiConnection = row["multi_connection"];
    const connectionRequirement = row["connection_requirement"];

    return {
        id: str(row["id"]) ?? "",
        name: str(row["name"]) ?? "",
        version: str(row["version"]) ?? "0.0.0",
        description: str(row["description"]),
        publisher,
        contributors,
        isVerified,
        download: str(row["download"]),
        icon: str(row["icon"]),
        executableRelativePath: str(row["executableRelativePath"]) ?? str(row["executable_relative_path"]),
        categories: parseCategoriesFromRecord(row),
        multiConnection: multiConnection === "required" || multiConnection === "optional" || multiConnection === "none" ? multiConnection : undefined,
        connectionRequirement: connectionRequirement === "required" || connectionRequirement === "optional" ? connectionRequirement : undefined,
        enabledForPowerPlatformAPI: typeof row["enabled_for_power_platform_api"] === "boolean" ? row["enabled_for_power_platform_api"] : undefined,
        mcpEnabled: typeof row["mcp_enabled"] === "boolean" ? row["mcp_enabled"] : undefined,
        maturityStatus,
        minAPI: str(row["min_api"]),
        maxAPI: str(row["max_api"]),
        checksum: str(row["checksum"]),
        size: typeof row["size"] === "number" ? row["size"] : undefined,
        cspExceptions: row["csp_exceptions"] && typeof row["csp_exceptions"] === "object" ? (row["csp_exceptions"] as CspExceptions) : undefined,
        readmeUrl: str(row["readme_url"]),
        repository: str(row["repository"]) ?? str(row["repository_url"]),
        website: str(row["website"]) ?? str(row["website_url"]),
        license: str(row["license"]),
        publishedAt: str(row["publishedAt"]) ?? str(row["published_at"]),
        createdAt: str(row["createdAt"]) ?? str(row["created_at"]),
        status: parseStatus(row["status"]),
        downloads: analytics?.downloads,
        rating: analytics?.rating,
        mau: analytics?.mau,
    };
}

function parseStatus(value: unknown): RegistryTool["status"] {
    const status = str(value)?.toLowerCase();
    return status === "active" || status === "deprecated" || status === "archived" ? status : undefined;
}
