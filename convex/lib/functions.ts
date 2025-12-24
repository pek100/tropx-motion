/**
 * Convex Functions
 *
 * Re-exports standard Convex functions.
 *
 * Note: Triggers (convex-helpers) were removed due to wrapDB causing
 * excessive document reads (16MB+ limit exceeded on large tables).
 *
 * modifiedAt is now set explicitly in mutations:
 * - Client: useMutation() auto-adds modifiedAt timestamp to all args
 * - Server: Mutations use `args.modifiedAt ?? Date.now()` in patches
 */

export {
  query,
  internalQuery,
  mutation,
  internalMutation,
  action,
  internalAction,
} from "../_generated/server";

// ─────────────────────────────────────────────────────────────────
// Timestamp Utilities
// ─────────────────────────────────────────────────────────────────

/** Max allowed clock drift (5 minutes) */
const MAX_CLOCK_DRIFT_MS = 5 * 60 * 1000;

/**
 * Normalize client timestamp with bounds checking.
 * If client time is too far from server time, use server time instead.
 * This prevents clock manipulation attacks and handles wrong client clocks.
 */
export function normalizeTimestamp(clientTimestamp: number | undefined): number {
  const serverNow = Date.now();

  if (clientTimestamp === undefined) {
    return serverNow;
  }

  const drift = Math.abs(clientTimestamp - serverNow);
  if (drift > MAX_CLOCK_DRIFT_MS) {
    // Client clock is too far off - use server time
    console.warn(
      `[normalizeTimestamp] Clock drift detected: client=${clientTimestamp}, server=${serverNow}, drift=${drift}ms`
    );
    return serverNow;
  }

  return clientTimestamp;
}
