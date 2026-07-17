/**
 * Leveled, tagged logger.
 *
 * Wraps `console.*` so:
 *   • Every line is prefixed with a stable `[tag]` (the existing convention
 *     across the codebase) without each call site having to repeat it.
 *   • Output below the active level is suppressed at zero per-call cost
 *     (single integer comparison).
 *   • Tests that `spyOn(console, "warn"|"error"|...)` continue to work
 *     because the underlying methods are still invoked.
 *
 * Active level is read once from `LOG_LEVEL` (env) at module load. Override
 * at runtime via `setLogLevel()` — used by the dashboard's verbose toggle.
 *
 *   LOG_LEVEL=debug npm start   # show everything
 *   LOG_LEVEL=warn  npm start   # only warn/error
 *   LOG_LEVEL=silent npm test   # mute all log output
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const LEVEL_NAMES: LogLevel[] = ["debug", "info", "warn", "error", "silent"];

function readLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (raw in LEVEL_ORDER) return raw as LogLevel;
  return "info";
}

let threshold: number = LEVEL_ORDER[readLevel()];

/** Override the active log level. Returns the previous level. */
export function setLogLevel(level: LogLevel): LogLevel {
  const previous = LEVEL_NAMES[threshold] ?? "info";
  threshold = LEVEL_ORDER[level];
  return previous;
}

/** Read the active log level. */
export function getLogLevel(): LogLevel {
  return LEVEL_NAMES[threshold] ?? "info";
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Create a logger bound to a `[tag]` prefix.
 *
 * The prefix is computed once per call to `createLogger` and reused by every
 * subsequent emission — keeping the hot path a single string + spread.
 */
export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;
  return {
    debug: (...args: unknown[]) => {
      if (threshold <= LEVEL_ORDER.debug) console.debug(prefix, ...args);
    },
    info: (...args: unknown[]) => {
      if (threshold <= LEVEL_ORDER.info) console.log(prefix, ...args);
    },
    warn: (...args: unknown[]) => {
      if (threshold <= LEVEL_ORDER.warn) console.warn(prefix, ...args);
    },
    error: (...args: unknown[]) => {
      if (threshold <= LEVEL_ORDER.error) console.error(prefix, ...args);
    },
  };
}
