import * as vscode from "vscode";
import type { CspDirective, CspExceptionEntry, CspExceptions } from "../utils/csp";

const STORAGE_KEY = "pptb.cspConsent";

type ConsentStore = Record<string, CspExceptions>;

const DIRECTIVE_LABELS: Record<CspDirective, string> = {
    "connect-src": "Network requests (connect-src)",
    "script-src": "Scripts (script-src)",
    "style-src": "Stylesheets (style-src)",
    "img-src": "Images (img-src)",
    "font-src": "Fonts (font-src)",
    "frame-src": "Embedded frames (frame-src)",
    "media-src": "Audio/video (media-src)",
    mailto: "Email links (mailto)",
};

/** Strips basic markdown emphasis so exception reasons render cleanly in a plain-text dialog. */
function stripMarkdown(text: string): string {
    return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
}

function diffExceptions(granted: CspExceptions | undefined, current: CspExceptions): CspExceptions {
    const newEntries: CspExceptions = {};
    for (const [directive, entries] of Object.entries(current) as [CspDirective, CspExceptionEntry[]][]) {
        const grantedDomains = new Set((granted?.[directive] ?? []).map((e) => e.domain));
        const additions = entries.filter((e) => !grantedDomains.has(e.domain));
        if (additions.length > 0) {
            newEntries[directive] = additions;
        }
    }
    return newEntries;
}

async function promptConsent(toolName: string, newEntries: CspExceptions, hasPriorConsent: boolean): Promise<boolean> {
    const lines: string[] = [`"${toolName}" requests permission to access additional external resources:`, ""];

    for (const [directive, entries] of Object.entries(newEntries) as [CspDirective, CspExceptionEntry[]][]) {
        lines.push(`${DIRECTIVE_LABELS[directive] ?? directive}:`);
        for (const entry of entries) {
            const suffix = entry.optional ? " (optional)" : "";
            const reason = entry.exceptionReason ? ` — ${stripMarkdown(entry.exceptionReason)}` : "";
            lines.push(`  • ${entry.domain}${suffix}${reason}`);
        }
    }

    if (hasPriorConsent) {
        lines.push("", "Previously approved permissions remain unchanged.");
    }

    lines.push("", "Choose Decline to cancel launching this tool.");

    const choice = await vscode.window.showWarningMessage(`CSP permissions requested by "${toolName}"`, { modal: true, detail: lines.join("\n") }, "Allow", "Decline");

    return choice === "Allow";
}

/**
 * Persists and enforces user consent for a tool's declared CSP exceptions, mirroring the
 * desktop app's consent workflow (docs: tool-development/csp-configuration).
 * Consent is stored per-tool in global state and re-requested whenever new exceptions
 * (domains not previously granted) are declared.
 */
export class CspConsentManager {
    constructor(private readonly context: vscode.ExtensionContext) {}

    private readStore(): ConsentStore {
        return this.context.globalState.get<ConsentStore>(STORAGE_KEY, {});
    }

    private async writeStore(store: ConsentStore): Promise<void> {
        await this.context.globalState.update(STORAGE_KEY, store);
    }

    /** Removes all granted CSP consent for a tool, forcing re-prompt on its next launch. */
    async revoke(toolId: string): Promise<void> {
        const store = this.readStore();
        if (store[toolId]) {
            delete store[toolId];
            await this.writeStore(store);
        }
    }

    /** Revokes all stored CSP consents across all tools. */
    async revokeAll(): Promise<void> {
        await this.writeStore({});
    }

    /** Explicitly grants consent for a tool's declared CSP exceptions. */
    async grant(toolId: string, exceptions: CspExceptions): Promise<void> {
        const store = this.readStore();
        store[toolId] = exceptions;
        await this.writeStore(store);
    }

    /** Returns the currently stored CSP exceptions consent for a tool, or undefined. */
    getConsent(toolId: string): CspExceptions | undefined {
        return this.readStore()[toolId];
    }

    /** Returns `true` when the tool currently has any stored CSP consent. */
    hasStoredConsent(toolId: string): boolean {
        return Boolean(this.readStore()[toolId]);
    }

    /**
     * Ensures the user has consented to a tool's declared CSP exceptions, prompting when
     * new exceptions are found. Returns `true` when the tool is cleared to launch with the
     * given exceptions applied, `false` when the user declined (launch should be aborted).
     */
    async ensureConsent(toolId: string, toolName: string, cspExceptions: CspExceptions | undefined): Promise<boolean> {
        if (!cspExceptions || Object.keys(cspExceptions).length === 0) {
            return true;
        }

        const store = this.readStore();
        const granted = store[toolId];
        const newEntries = diffExceptions(granted, cspExceptions);

        if (Object.keys(newEntries).length === 0) {
            return true;
        }

        const accepted = await promptConsent(toolName, newEntries, Boolean(granted));
        if (!accepted) {
            return false;
        }

        store[toolId] = cspExceptions;
        await this.writeStore(store);
        return true;
    }
}
