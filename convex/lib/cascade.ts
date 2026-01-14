/**
 * Generic Cascade Delete
 *
 * Reads relationship config and deletes all child records.
 */

import { GenericMutationCtx } from "convex/server";
import { DataModel } from "../_generated/dataModel";
import { RELATIONSHIPS, ARRAY_RELATIONSHIPS } from "./relationships";

type MutationCtx = GenericMutationCtx<DataModel>;

// ─────────────────────────────────────────────────────────────────
// Generic Cascade Function
// ─────────────────────────────────────────────────────────────────

/**
 * Delete all child records for a parent.
 * @param ctx - Mutation context
 * @param parentKey - Relationship key (e.g., "recordingSessions.sessionId")
 * @param parentValue - The ID value to match
 * @returns Number of records deleted
 */
export async function cascadeDelete(
  ctx: MutationCtx,
  parentKey: string,
  parentValue: string
): Promise<number> {
  let deleted = 0;

  // Delete related records
  const relationships = RELATIONSHIPS[parentKey] ?? [];
  for (const rel of relationships) {
    const records = await ctx.db
      .query(rel.table)
      .withIndex(rel.index as any, (q: any) => q.eq(rel.field, parentValue))
      .collect();

    for (const record of records) {
      await ctx.db.delete(record._id);
      deleted++;
    }
  }

  // Remove from array fields
  const arrayRels = ARRAY_RELATIONSHIPS[parentKey] ?? [];
  for (const rel of arrayRels) {
    const records = await ctx.db.query(rel.table).collect();
    for (const record of records) {
      const arr = (record as any)[rel.field] as string[] | undefined;
      if (arr?.includes(parentValue)) {
        await ctx.db.patch(record._id, {
          [rel.field]: arr.filter((id) => id !== parentValue),
        } as any);
      }
    }
  }

  return deleted;
}

// ─────────────────────────────────────────────────────────────────
// Convenience Wrappers
// ─────────────────────────────────────────────────────────────────

/** Delete all child records for a session (chunks, metrics, Horus data) */
export const cascadeDeleteSession = (ctx: MutationCtx, sessionId: string) =>
  cascadeDelete(ctx, "recordingSessions.sessionId", sessionId);

/** Delete only Horus data for a session (not chunks/metrics) */
export const cascadeDeleteHorusSession = (ctx: MutationCtx, sessionId: string) =>
  cascadeDelete(ctx, "horus.sessionId", sessionId);

/** Delete all child records for a user */
export const cascadeDeleteUser = (ctx: MutationCtx, userId: string) =>
  cascadeDelete(ctx, "users._id", userId);
