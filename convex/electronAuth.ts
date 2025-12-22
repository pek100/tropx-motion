import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Create a separate session for Electron app.
 *
 * This is called from the web app during Electron OAuth flow.
 * Instead of sharing the web app's session (which would cause sign-out
 * on one platform to affect the other), we create a brand new session
 * specifically for the Electron app.
 *
 * The web app must be authenticated to call this - we use the current
 * user's ID to create a new session for them.
 */
export const createElectronSession = action({
  args: {},
  handler: async (ctx): Promise<{ jwt: string; refreshToken: string } | null> => {
    // Get the currently authenticated user
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      console.error("[electronAuth] No authenticated user");
      return null;
    }

    console.log("[electronAuth] Creating new session for user:", userId);

    // Call the internal auth store mutation to create a new session
    // This creates a fresh session with new tokens, independent of the web session
    const result = await ctx.runMutation(internal.auth.store, {
      args: {
        type: "signIn",
        userId,
        generateTokens: true,
      },
    });

    if (!result || typeof result !== "object" || !("token" in result)) {
      console.error("[electronAuth] Failed to create session:", result);
      return null;
    }

    const tokens = result as { token: string; refreshToken: string };
    console.log("[electronAuth] Created new session with JWT length:", tokens.token.length);

    return {
      jwt: tokens.token,
      refreshToken: tokens.refreshToken,
    };
  },
});
