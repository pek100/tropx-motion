/**
 * Optimistic Update Utilities
 *
 * Applies optimistic updates to cached data by finding records with matching IDs.
 * Searches through all cached queries and updates matching records.
 */

import type { SyncContextValue } from "../cache/SyncProvider";
import { debug } from "./debug";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

/** Common ID field names for extracting record identifiers */
const ID_FIELD_NAMES = ["_id", "id", "userId", "sessionId", "notificationId", "inviteId"];

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Check if a record matches the given ID fields */
function recordMatchesIds(
  record: Record<string, unknown>,
  idFields: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(idFields)) {
    if (record[key] !== value) return false;
  }
  return true;
}

/** Apply field updates to a record, returning new record */
function applyFieldsToRecord(
  record: Record<string, unknown>,
  updateFields: Record<string, unknown>
): Record<string, unknown> {
  return { ...record, ...updateFields };
}

// ─────────────────────────────────────────────────────────────────
// Main Function
// ─────────────────────────────────────────────────────────────────

/**
 * Apply optimistic update to cached data.
 * Finds records with matching IDs and updates their fields.
 */
export function applyOptimisticUpdate(
  sync: SyncContextValue | null,
  mutationPath: string,
  args: Record<string, unknown>
): void {
  if (!sync) {
    debug.optimistic.log("No sync context");
    return;
  }

  // Extract ID fields from args
  const idFields: Record<string, unknown> = {};
  for (const field of ID_FIELD_NAMES) {
    if (args[field] !== undefined) {
      idFields[field] = args[field];
    }
  }

  // No ID fields - can't match records
  if (Object.keys(idFields).length === 0) {
    debug.optimistic.log("No ID fields found in args");
    return;
  }

  // Get fields to update (exclude ID fields)
  const updateFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!ID_FIELD_NAMES.includes(key)) {
      updateFields[key] = value;
    }
  }

  // No update fields - nothing to do
  if (Object.keys(updateFields).length === 0) {
    debug.optimistic.log("No update fields found");
    return;
  }

  // Get module from mutation path (e.g., "users:setContactStar" → "users")
  const module = mutationPath.split(":")[0];

  // Get all cache keys and filter by module
  const allKeys = sync.getQueryKeys();
  const relevantKeys = allKeys.filter((key) => key.startsWith(`${module}:`));

  debug.optimistic.log(`Module: ${module}, idFields:`, idFields, `updateFields:`, updateFields);
  debug.optimistic.log(`Relevant cache keys:`, relevantKeys);

  // Collect all updates for batch processing
  const batchUpdates: Array<{ key: string; data: unknown }> = [];

  for (const cacheKey of relevantKeys) {
    const cachedData = sync.getQuery(cacheKey);
    if (!cachedData) continue;

    let updated = false;
    let newData: unknown = cachedData;

    // Handle array of records
    if (Array.isArray(cachedData)) {
      const newArray = cachedData.map((item) => {
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          if (recordMatchesIds(record, idFields)) {
            updated = true;
            return applyFieldsToRecord(record, updateFields);
          }
        }
        return item;
      });
      if (updated) {
        newData = newArray;
      }
    }
    // Handle single record
    else if (typeof cachedData === "object" && cachedData !== null) {
      const record = cachedData as Record<string, unknown>;
      if (recordMatchesIds(record, idFields)) {
        updated = true;
        newData = applyFieldsToRecord(record, updateFields);
      }
    }

    if (updated) {
      debug.optimistic.log(`Will update cache key: ${cacheKey}`);
      batchUpdates.push({ key: cacheKey, data: newData });
    }
  }

  // Apply all updates in a single batch (one state update)
  if (batchUpdates.length > 0) {
    sync.setQueryBatch(batchUpdates);
    debug.optimistic.log(`Batch updated ${batchUpdates.length} cache entries`);
  }
}
