import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// Get the authenticated user's auth ID (from Convex Auth)
export async function getAuthUserId(
  ctx: QueryCtx | MutationCtx
): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return identity.subject;
}

// Get the authenticated user's database record
export async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const authId = await getAuthUserId(ctx);
  if (!authId) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", authId))
    .first();

  return user;
}

// Require authentication - throws if not authenticated
export async function requireAuth(
  ctx: QueryCtx | MutationCtx
): Promise<string> {
  const authId = await getAuthUserId(ctx);
  if (!authId) {
    throw new Error("Not authenticated");
  }
  return authId;
}

// Require user record exists - throws if not found
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

// Require specific role
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: string[]
) {
  const user = await requireUser(ctx);
  if (!user.role || !allowedRoles.includes(user.role)) {
    throw new Error("Insufficient permissions");
  }
  return user;
}

// Check if user has access to a recording
export async function canAccessRecording(
  ctx: QueryCtx | MutationCtx,
  recordingId: Id<"recordings">,
  userId: Id<"users">
): Promise<boolean> {
  const recording = await ctx.db.get(recordingId);
  if (!recording || recording.isArchived) return false;

  // Owner can always access
  if (recording.ownerId === userId) return true;

  // Subject can access
  if (recording.subjectId === userId) return true;

  // Check if shared
  if (recording.sharedWith?.includes(userId)) return true;

  return false;
}
