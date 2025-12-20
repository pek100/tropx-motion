import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { auth } from "../auth";

// Get the authenticated user's ID (from Convex Auth)
// Returns the user's _id in the users table, or null if not authenticated
export async function getAuthUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users"> | null> {
  const userId = await auth.getUserId(ctx);
  return userId;
}

// Get the authenticated user's database record
export async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  const user = await ctx.db.get(userId);
  return user;
}

// Require authentication - throws if not authenticated
export async function requireAuth(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
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

// Check if user has access to a session
export async function canAccessSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  userId: Id<"users">
): Promise<boolean> {
  const session = await ctx.db
    .query("recordingSessions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .first();

  if (!session || session.isArchived) return false;

  // Owner can always access
  if (session.ownerId === userId) return true;

  // Subject can access
  if (session.subjectId === userId) return true;

  // Check if shared
  if (session.sharedWith?.includes(userId)) return true;

  return false;
}
