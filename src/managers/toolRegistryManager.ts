import * as vscode from "vscode";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
  /** URL from which the tool binary/archive can be downloaded. */
  downloadUrl?: string;
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

  constructor() {
    const url: string = process.env.PPTB_SUPABASE_URL ?? "";
    const key: string = process.env.PPTB_SUPABASE_ANON_KEY ?? "";

    if (!url || !key) {
      vscode.window.showInformationMessage(
        "PPTB: Supabase credentials are not configured — tool registry features will be unavailable."
      );
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

    let query = this.client
      .from("tools")
      .select("*", { count: "exact" })
      .range(from, to);

    if (category) {
      query = query.eq("category", category);
    }

    if (search) {
      // Escape PostgREST ILIKE special characters so literal percent-signs,
      // underscores, and backslashes in the search term are treated as text.
      const escaped = search
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      query = query.or(
        `name.ilike.%${escaped}%,description.ilike.%${escaped}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("ToolRegistryManager.getTools error:", error.message);
      return { tools: [], total: 0 };
    }

    return {
      tools: (data ?? []) as RegistryTool[],
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

    const { data, error } = await this.client
      .from("tools")
      .select("capabilityTags");

    if (error) {
      console.error(
        "ToolRegistryManager.getKnownCapabilityTags error:",
        error.message
      );
      return [];
    }

    const tagSet = new Set<string>();
    for (const row of data ?? []) {
      const tags = (row as { capabilityTags?: unknown }).capabilityTags;
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
