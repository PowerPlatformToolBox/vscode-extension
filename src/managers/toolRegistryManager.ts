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
    /** URL from which the tool binary/archive can be downloaded. */
    download?: string;
    /** URL of the tool's icon image. */
    icon?: string;
    /**
     * Relative path inside the tool's installation directory that points to the
     * main executable (e.g. "bin/pac" or "pac.exe").
     */
    executableRelativePath?: string;
    /** Category grouping for this tool (e.g. "CLI", "DevOps"). */
    category?: string;
    /** Capability tags that describe what this tool can do. */
    capabilityTags?: string[];
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

const PAGE_SIZE = 20;

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

        let query = this.client.from("tools").select("*", { count: "exact" }).range(from, to);

        if (category) {
            query = query.eq("category", category);
        }

        if (search) {
            // Escape PostgREST ILIKE special characters so literal percent-signs,
            // underscores, and backslashes in the search term are treated as text.
            const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
            query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`);
        }

        const { data, error, count } = await query;

        if (error) {
            this.output.appendLine(`[Registry] getTools error: ${error.message}`);
            this.output.appendLine(`[Registry] error details: ${JSON.stringify(error)}`);
            this.output.show(true);
            return { tools: [], total: 0 };
        }

        this.output.appendLine(`[Registry] getTools returned ${count ?? 0} total rows, ${(data ?? []).length} in page`);
        if ((data ?? []).length > 0) {
            this.output.appendLine(`[Registry] First row keys: ${Object.keys((data as Record<string, unknown>[])[0]).join(", ")}`);
        }

        return {
            tools: (data ?? []).map(mapRow),
            total: count ?? 0,
        };
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
}

// ---------------------------------------------------------------------------
// Row mapping — handles both camelCase and snake_case column names
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
    return typeof v === "string" && v.length > 0 ? v : undefined;
}

function mapRow(row: Record<string, unknown>): RegistryTool {
    return {
        id: str(row["id"]) ?? "",
        name: str(row["name"]) ?? "",
        version: str(row["version"]) ?? "0.0.0",
        description: str(row["description"]),
        publisher: str(row["publisher"]),
        download: str(row["download"]),
        icon: str(row["icon"]),
        executableRelativePath: str(row["executableRelativePath"]) ?? str(row["executable_relative_path"]),
        category: str(row["category"]),
        capabilityTags: (Array.isArray(row["capabilityTags"]) ? row["capabilityTags"] : Array.isArray(row["capability_tags"]) ? row["capability_tags"] : undefined) as string[] | undefined,
    };
}
