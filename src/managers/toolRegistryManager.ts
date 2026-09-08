import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as vscode from "vscode";

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
    /** Capability tags that describe what this tool can do. */
    capabilityTags?: string[];
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
            vscode.window.showInformationMessage("PPTB: Supabase credentials are not configured — tool registry features will be unavailable.");
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

        const buildQuery = (selectColumns: string) => {
            // Typed as `any`: supabase-js infers row shape from the literal `selectColumns`
            // string, which breaks down once it's widened to `string` here — that's fine
            // since we parse rows manually via `mapRow` regardless of the inferred type.
            let q = this.client!.from("tools").select(selectColumns, { count: "exact" }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            q = q.range(from, to);
            if (category) {
                q = q.eq("category", category);
            }
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
        let { data, error, count } = await buildQuery("*, tool_analytics(downloads,rating,mau), tool_categories(categories(name))");
        if (error) {
            this.output.appendLine(`[Registry] getTools embedded-relations query failed, retrying without them: ${error.message}`);
            ({ data, error, count } = await buildQuery("*"));
        }

        if (error) {
            this.output.appendLine(`[Registry] getTools error: ${error.message}`);
            this.output.appendLine(`[Registry] error details: ${JSON.stringify(error)}`);
            this.output.show(true);
            return { tools: [], total: 0 };
        }

        this.output.appendLine(`[Registry] getTools returned ${count ?? 0} total rows, ${(data ?? []).length} in page`);
        if ((data ?? []).length > 0) {
            this.output.appendLine(`[Registry] First row keys: ${Object.keys((data as Record<string, unknown>[])[0]).join(", ")}`);
            this.output.appendLine(`[Registry] First row raw: ${JSON.stringify((data as Record<string, unknown>[])[0])}`);
        }

        const tools = (data ?? []).map(mapRow);
        const maturityMap = await this.getMaturityMap(tools.map((t) => t.id));
        for (const tool of tools) {
            if (maturityMap.has(tool.id)) {
                tool.isVerified = maturityMap.get(tool.id) ?? false;
            }
        }

        this.output.appendLine(`[Registry] Mapped tools: ${tools.map((t) => `${t.id} (contributors=${JSON.stringify(t.contributors) ?? "none"}, verified=${t.isVerified})`).join("; ")}`);

        return {
            tools,
            total: count ?? 0,
        };
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

        const { data, error } = await this.client.from("tools").select("id, tool_analytics(downloads,rating,mau)").in("id", toolIds);

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
     * Fetch a single tool from the registry by its ID.
     * Returns `null` if the tool is not found or the client is not configured.
     */
    async getToolById(id: string): Promise<RegistryTool | null> {
        if (!this.client) {
            return null;
        }

        let { data, error } = await this.client.from("tools").select("*, tool_analytics(downloads,rating,mau), tool_categories(categories(name))").eq("id", id).single();
        if (error) {
            ({ data, error } = await this.client.from("tools").select("*").eq("id", id).single());
        }

        if (error || !data) {
            return null;
        }

        const tool = mapRow(data as Record<string, unknown>);
        const maturityMap = await this.getMaturityMap([tool.id]);
        if (maturityMap.has(tool.id)) {
            tool.isVerified = maturityMap.get(tool.id) ?? false;
        }
        return tool;
    }

    /**
     * Query the `tool_maturity` table for the given tool IDs and return a map
     * of tool ID → verified status. A tool with no row in `tool_maturity` is
     * considered *not verified*. A missing/unqueryable table is treated as
     * "unknown" (empty map) so callers fall back to any other verification
     * signal already present on the tool row.
     */
    private async getMaturityMap(toolIds: string[]): Promise<Map<string, boolean>> {
        const map = new Map<string, boolean>();
        if (!this.client || toolIds.length === 0) {
            return map;
        }

        const { data, error } = await this.client.from("tool_maturity").select("tool_id, status").in("tool_id", toolIds);

        if (error) {
            this.output.appendLine(`[Registry] tool_maturity lookup error: ${error.message}`);
            return map;
        }

        for (const row of (data ?? []) as Record<string, unknown>[]) {
            const toolId = str(row["tool_id"]);
            if (!toolId) {
                continue;
            }
            const status = str(row["status"])?.toLowerCase();
            map.set(toolId, status === "verified");
        }

        // Any requested tool without a tool_maturity row is explicitly not verified.
        for (const id of toolIds) {
            if (!map.has(id)) {
                map.set(id, false);
            }
        }

        return map;
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

        // Select all columns; we filter capability tags client-side to avoid
        // column-name guessing issues.
        const { data, error } = await this.client.from("tools").select("*");

        if (error) {
            this.output.appendLine(`[Registry] getKnownCapabilityTags error: ${error.message}`);
            return [];
        }

        const tagSet = new Set<string>();
        for (const row of data ?? []) {
            const r = row as Record<string, unknown>;
            // Accept both naming conventions
            const tags = r["capabilityTags"] ?? r["capability_tags"];
            if (Array.isArray(tags)) {
                for (const tag of tags) {
                    if (typeof tag === "string" && tag.length > 0) {
                        tagSet.add(tag);
                    }
                }
            }
        }

        return Array.from(tagSet).sort();
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
            const { data, error } = await this.client.from("tools").select("icon");
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
    const keys = ["contributors", "contributor", "authors", "author", "publisher", "maintainers", "maintainer", "developer", "developers", "owner", "created_by", "org", "organization"];

    for (const key of keys) {
        const val = row[key];
        if (val !== null && val !== undefined) {
            const parsed = extractNames(val);
            if (parsed) {
                return parsed;
            }
        }
    }

    // Fall back to scanning one level of nested JSON blobs (e.g. a
    // "package_json" / "manifest" / "metadata" column holding the tool's
    // full package.json) for the same set of contributor-like keys.
    for (const value of Object.values(row)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const nested = value as Record<string, unknown>;
            for (const key of keys) {
                const val = nested[key];
                if (val !== null && val !== undefined) {
                    const parsed = extractNames(val);
                    if (parsed) {
                        return parsed;
                    }
                }
            }
        }
    }

    return undefined;
}

export function parseVerifiedFromRecord(row: Record<string, unknown>): boolean {
    const candidates = [row["isVerified"], row["is_verified"], row["verified"], row["is_official"], row["official"], row["verified_tool"], row["is_verified_tool"], row["badge"]];
    for (const val of candidates) {
        const b = bool(val);
        if (b !== undefined) {
            return b;
        }
    }
    return false;
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

    const flatArray = row["categories"];
    if (Array.isArray(flatArray)) {
        const names = flatArray.filter((v): v is string => typeof v === "string" && v.length > 0);
        if (names.length > 0) {
            return names;
        }
    }

    const single = str(row["category"]);
    return single ? [single] : undefined;
}

function mapRow(row: Record<string, unknown>): RegistryTool {
    const contributors = parseContributorsFromRecord(row);
    const publisher = str(row["publisher"]) ?? str(row["author"]) ?? (typeof contributors === "string" ? contributors : Array.isArray(contributors) ? contributors[0] : undefined);
    const isVerified = parseVerifiedFromRecord(row);
    const analytics = parseAnalyticsFromRecord(row);

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
        capabilityTags: (Array.isArray(row["capabilityTags"]) ? row["capabilityTags"] : Array.isArray(row["capability_tags"]) ? row["capability_tags"] : undefined) as string[] | undefined,
        downloads: analytics?.downloads,
        rating: analytics?.rating,
        mau: analytics?.mau,
    };
}
