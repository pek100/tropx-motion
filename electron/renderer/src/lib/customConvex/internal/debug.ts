/**
 * Debug logging utility - only logs in development mode
 */

const isDev = import.meta.env.DEV;

type LogLevel = "log" | "warn" | "error";

function createLogger(prefix: string) {
  const log = (level: LogLevel, ...args: unknown[]) => {
    if (!isDev) return;
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
    console[level](`[${timestamp}] [${prefix}]`, ...args);
  };

  return {
    log: (...args: unknown[]) => log("log", ...args),
    warn: (...args: unknown[]) => log("warn", ...args),
    error: (...args: unknown[]) => log("error", ...args),
  };
}

export const debug = {
  connectivity: createLogger("connectivity"),
  cache: createLogger("cache"),
  sync: createLogger("sync"),
  query: createLogger("query"),
  mutation: createLogger("mutation"),
  optimistic: createLogger("optimistic"),
};
