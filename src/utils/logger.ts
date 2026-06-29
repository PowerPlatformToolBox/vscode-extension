const PREFIX = "[PPTB]";

/**
 * Centralized logger for the PPTB extension.
 * All output is prefixed with "[PPTB]" so messages are easy to filter in the
 * developer console or VS Code output panels.
 */
export const logger = {
    log(...args: unknown[]): void {
        console.log(PREFIX, ...args);
    },

    info(...args: unknown[]): void {
        console.info(PREFIX, ...args);
    },

    warn(...args: unknown[]): void {
        console.warn(PREFIX, ...args);
    },

    error(...args: unknown[]): void {
        console.error(PREFIX, ...args);
    },

    debug(...args: unknown[]): void {
        console.debug(PREFIX, ...args);
    },
};
