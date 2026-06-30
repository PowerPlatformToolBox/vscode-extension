/**
 * Extension-wide constants for Power Platform ToolBox VS Code extension
 */

/** Extension identifier */
export const EXTENSION_ID = "power-platform-toolbox";

/** Power Platform well-known public client ID for interactive auth */
export const POWER_PLATFORM_CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d";

/** Authority base URL for Azure AD */
export const AUTHORITY_BASE = "https://login.microsoftonline.com/";

/** Common tenant for multi-tenant auth */
export const COMMON_TENANT = "common";

/** GlobalState key for persisted connections (non-sensitive fields) */
export const CONNECTIONS_STATE_KEY = "pptb.connections";

/** SecretStorage key prefix for connection secrets */
export const CONNECTION_SECRETS_KEY_PREFIX = "pptb.connection";

/** SecretStorage key suffix for connection secrets */
export const CONNECTION_SECRETS_KEY_SUFFIX = "secrets";

/** GlobalState key for the active connection ID */
export const ACTIVE_CONNECTION_KEY = "pptb.activeConnectionId";

/** Dataverse Web API version */
export const DATAVERSE_API_VERSION = "v9.2";

/** Auth cache file name stored in globalStorageUri */
export const AUTH_CACHE_FILE = "auth-cache.json";

/** Auth types supported by the extension */
export const AUTH_TYPES = {
    INTERACTIVE_BROWSER: "InteractiveBrowser",
    CLIENT_CREDENTIALS: "ClientCredentials",
    USERNAME_PASSWORD: "UsernamePassword",
} as const;

export type AuthType = (typeof AUTH_TYPES)[keyof typeof AUTH_TYPES];

/** GlobalState key for persisted user-defined connection categories */
export const CATEGORIES_KEY = "pptb.categories";

/** GlobalState key for persisted category colors (map of category name → hex color) */
export const CATEGORY_COLORS_KEY = "pptb.categoryColors";

/** Default environment indicator colors (used when no custom environmentColor is set) */
export const ENVIRONMENT_DEFAULT_COLORS: Record<string, string> = {
    Dev: "#2d883e",
    Test: "#d9a84e",
    UAT: "#d97706",
    Production: "#dc2626",
};
