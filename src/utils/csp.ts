/**
 * Per-tool Content-Security-Policy exception support.
 * Schema mirrors https://docs.powerplatformtoolbox.com/tool-development/csp-configuration
 */

/** CSP directives that a tool's package.json may declare exceptions for. */
export type CspDirective = "connect-src" | "script-src" | "style-src" | "img-src" | "font-src" | "frame-src" | "media-src" | "mailto";

/** A single normalized CSP exception entry. */
export interface CspExceptionEntry {
    domain: string;
    exceptionReason?: string;
    optional?: boolean;
}

/** Normalized `cspExceptions` map, keyed by directive. */
export type CspExceptions = Partial<Record<CspDirective, CspExceptionEntry[]>>;

const KNOWN_DIRECTIVES: CspDirective[] = ["connect-src", "script-src", "style-src", "img-src", "font-src", "frame-src", "media-src", "mailto"];

/** Domains that are too broad to safely honor (would defeat the purpose of a CSP allow-list). */
const UNSAFE_DOMAINS = new Set(["*", "http:", "https:", "http://*", "https://*"]);

function isSafeCspDomain(domain: string): boolean {
    const trimmed = domain.trim();
    return trimmed.length > 0 && !UNSAFE_DOMAINS.has(trimmed);
}

/**
 * Parses and validates the raw `cspExceptions` value from a tool's package.json.
 * Silently drops malformed or unsafe entries rather than throwing, since manifest
 * data is untrusted input.
 */
export function normalizeCspExceptions(raw: unknown): CspExceptions | undefined {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }

    const result: CspExceptions = {};
    for (const directive of KNOWN_DIRECTIVES) {
        const rawEntries = (raw as Record<string, unknown>)[directive];
        if (!Array.isArray(rawEntries)) {
            continue;
        }

        const entries: CspExceptionEntry[] = [];
        for (const rawEntry of rawEntries) {
            if (typeof rawEntry === "string") {
                if (isSafeCspDomain(rawEntry)) {
                    entries.push({ domain: rawEntry.trim() });
                }
                continue;
            }
            if (rawEntry && typeof rawEntry === "object") {
                const domain = (rawEntry as Record<string, unknown>)["domain"];
                if (typeof domain === "string" && isSafeCspDomain(domain)) {
                    const exceptionReason = (rawEntry as Record<string, unknown>)["exceptionReason"];
                    const optional = (rawEntry as Record<string, unknown>)["optional"];
                    entries.push({
                        domain: domain.trim(),
                        exceptionReason: typeof exceptionReason === "string" ? exceptionReason : undefined,
                        optional: optional === true,
                    });
                }
            }
        }

        if (entries.length > 0) {
            result[directive] = entries;
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Builds the `Content-Security-Policy` meta tag content for a tool's webview,
 * merging the fixed base policy with the tool's granted exceptions.
 * `mailto` is intentionally excluded — it isn't a fetch directive; external links
 * are opened via the `utils.openExternal` toolboxAPI instead.
 */
export function buildToolCsp(cspSource: string, cspExceptions?: CspExceptions): string {
    const domainsFor = (directive: CspDirective): string[] => (cspExceptions?.[directive] ?? []).map((e) => e.domain);

    const directives: string[] = [
        `default-src 'none'`,
        [`script-src ${cspSource} 'unsafe-inline'`, ...domainsFor("script-src")].join(" "),
        [`style-src ${cspSource} 'unsafe-inline'`, ...domainsFor("style-src")].join(" "),
        [`img-src ${cspSource} https: data: blob:`, ...domainsFor("img-src")].join(" "),
        [`font-src ${cspSource} https: data:`, ...domainsFor("font-src")].join(" "),
        [`connect-src ${cspSource} https:`, ...domainsFor("connect-src")].join(" "),
    ];

    const frameSrc = domainsFor("frame-src");
    if (frameSrc.length > 0) {
        directives.push([`frame-src ${cspSource}`, ...frameSrc].join(" "));
    }

    const mediaSrc = domainsFor("media-src");
    if (mediaSrc.length > 0) {
        directives.push([`media-src ${cspSource}`, ...mediaSrc].join(" "));
    }

    return directives.join("; ");
}
