/**
 * Custom Convex Functions with Triggers
 *
 * Wraps standard mutation/query with trigger support for auto modifiedAt.
 * Use these instead of importing directly from _generated/server.
 *
 * @see https://stack.convex.dev/triggers
 * @see https://stack.convex.dev/custom-functions
 */

import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import {
  mutation as rawMutation,
  internalMutation as rawInternalMutation,
} from "../_generated/server";
import { triggers } from "./triggers";

/**
 * Mutation with auto modifiedAt trigger.
 * All db.patch/db.insert operations will auto-set modifiedAt on tracked tables.
 */
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));

/**
 * Internal mutation with auto modifiedAt trigger.
 */
export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(triggers.wrapDB)
);

/**
 * Re-export unchanged functions (no db writes, no triggers needed).
 */
export {
  query,
  internalQuery,
  action,
  internalAction,
} from "../_generated/server";
