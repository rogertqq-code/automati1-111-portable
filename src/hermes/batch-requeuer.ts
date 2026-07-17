/**
 * Hermes Batch Requeuer — Phase 2
 *
 * Scans the automation database for credentials that need re-testing
 * and builds optimal retry batches with exponential backoff.
 *
 * A credential is eligible for re-queue if:
 *   - Its last outcome was N/A, error, blocked, or untested
 *   - It hasn't exceeded the max retry count (3 per 24h window)
 *   - Its backoff cooldown has elapsed
 *
 * Terminal outcomes that are NEVER re-queued:
 *   success, noaccount, permdisabled, 2FA
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { createLogger } from "../core/logger.js";

const log = createLogger("BatchRequeuer");

const DB_PATH = path.join(process.cwd(), "automation.db");

// Outcomes that are considered terminal — never re-queue
const TERMINAL_OUTCOMES = new Set([
  "success",
  "noaccount",
  "permdisabled",
  "tempdisabled",
  "2FA",
]);

// Outcomes that trigger re-queue
const REQUEUEABLE_PREFIXES = ["N/A", "error", "blocked", "api-error"];

interface CredentialRow {
  email: string;
  passwords: string;
  outcome: string | null;
  last_tested_at: string | null;
  retry_count: number;
}

export interface RequeueResult {
  /** Credentials eligible for re-testing */
  credentials: Array<{ email: string; passwords: string[] }>;
  /** Total scanned */
  totalScanned: number;
  /** Skipped (terminal) */
  terminalCount: number;
  /** Skipped (cooldown) */
  cooldownCount: number;
  /** Skipped (max retries) */
  maxRetriesCount: number;
  /** Recommended batch size */
  recommendedBatchSize: number;
}

export interface RequeuerConfig {
  /** Max retries per credential per 24h window (default: 3) */
  maxRetries?: number;
  /** Backoff schedule in seconds: [1st retry delay, 2nd, 3rd, ...] */
  backoffSchedule?: number[];
  /** Maximum batch size (default: 50) */
  maxBatchSize?: number;
  /** Database path override (for testing) */
  dbPath?: string;
}

/**
 * Calculate the backoff delay in milliseconds for a given retry count.
 * Default schedule: 2min, 5min, 15min
 */
function getBackoffMs(retryCount: number, schedule: number[]): number {
  const idx = Math.min(retryCount, schedule.length - 1);
  return (schedule[idx] ?? schedule[schedule.length - 1] ?? 120) * 1000;
}

/**
 * Scan the automation database and return credentials eligible for re-testing.
 */
export function scanForRequeue(config: RequeuerConfig = {}): RequeueResult {
  const {
    maxRetries = 3,
    backoffSchedule = [120, 300, 900], // 2min, 5min, 15min
    maxBatchSize = 50,
    dbPath = DB_PATH,
  } = config;

  if (!fs.existsSync(dbPath)) {
    log.warn(`Database not found at ${dbPath}`);
    return {
      credentials: [],
      totalScanned: 0,
      terminalCount: 0,
      cooldownCount: 0,
      maxRetriesCount: 0,
      recommendedBatchSize: 0,
    };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma("journal_mode = WAL");
  } catch {
    // Ignore error if readonly connection cannot set pragma
  }

  try {
    // Query all credentials with their latest outcome
    // The exact schema depends on the project's DB, but we handle common patterns
    let rows: CredentialRow[] = [];
    
    try {
      rows = db
        .prepare(
          `SELECT 
            email, 
            passwords, 
            outcome, 
            last_tested_at,
            COALESCE(retry_count, 0) as retry_count
          FROM credentials 
          ORDER BY last_tested_at ASC NULLS FIRST`
        )
        .all() as CredentialRow[];
    } catch {
      // Fallback: try simpler schema
      try {
        rows = db
          .prepare(
            `SELECT 
              email, 
              passwords, 
              outcome,
              NULL as last_tested_at,
              0 as retry_count
            FROM credentials`
          )
          .all() as CredentialRow[];
      } catch (e) {
        log.warn(`Failed to query credentials: ${e instanceof Error ? e.message : String(e)}`);
        return {
          credentials: [],
          totalScanned: 0,
          terminalCount: 0,
          cooldownCount: 0,
          maxRetriesCount: 0,
          recommendedBatchSize: 0,
        };
      }
    }

    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    const eligible: Array<{ email: string; passwords: string[] }> = [];
    let terminalCount = 0;
    let cooldownCount = 0;
    let maxRetriesCount = 0;

    for (const row of rows) {
      const outcome = row.outcome?.trim() ?? "";

      // Skip terminal outcomes
      if (TERMINAL_OUTCOMES.has(outcome)) {
        terminalCount++;
        continue;
      }

      // Check if this is a requeueable outcome (or never tested)
      const isRequeueable =
        !outcome ||
        REQUEUEABLE_PREFIXES.some((prefix) => outcome.startsWith(prefix));

      if (!isRequeueable) {
        terminalCount++;
        continue;
      }

      // Check max retries within 24h window
      if (row.retry_count >= maxRetries) {
        const lastTested = row.last_tested_at
          ? new Date(row.last_tested_at).getTime()
          : 0;
        if (lastTested > twentyFourHoursAgo) {
          maxRetriesCount++;
          continue;
        }
        // If last test was >24h ago, reset is implicit — allow requeue
      }

      // Check backoff cooldown
      if (row.last_tested_at) {
        const lastTested = new Date(row.last_tested_at).getTime();
        const requiredDelay = getBackoffMs(row.retry_count, backoffSchedule);
        if (now - lastTested < requiredDelay) {
          cooldownCount++;
          continue;
        }
      }

      // Parse passwords
      let passwords: string[] = [];
      try {
        passwords = JSON.parse(row.passwords) as string[];
      } catch {
        passwords = row.passwords ? [row.passwords] : [];
      }

      eligible.push({ email: row.email, passwords });
    }

    // Determine recommended batch size based on eligible count
    const recommendedBatchSize = Math.min(
      eligible.length,
      maxBatchSize
    );

    // Sort: untested first, then oldest-tested first
    const batch = eligible.slice(0, recommendedBatchSize);

    log.info(
      `[Requeue Scan] Total: ${rows.length} | Terminal: ${terminalCount} | ` +
      `Cooldown: ${cooldownCount} | MaxRetries: ${maxRetriesCount} | ` +
      `Eligible: ${eligible.length} | Batch: ${batch.length}`
    );

    return {
      credentials: batch,
      totalScanned: rows.length,
      terminalCount,
      cooldownCount,
      maxRetriesCount,
      recommendedBatchSize,
    };
  } finally {
    db.close();
  }
}

/**
 * Check if there are any credentials left to process.
 * Returns true if the queue is fully exhausted (all terminal).
 */
export function isQueueExhausted(config: RequeuerConfig = {}): boolean {
  const result = scanForRequeue(config);
  return result.credentials.length === 0 && result.cooldownCount === 0;
}
