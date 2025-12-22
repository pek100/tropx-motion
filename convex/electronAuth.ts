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

    // The result structure is: { sessionId, tokens: { token, refreshToken }, userId }
    const typedResult = result as {
      sessionId?: string;
      tokens?: { token: string; refreshToken: string };
      token?: string;
      refreshToken?: string;
    } | null;

    if (!typedResult) {
      console.error("[electronAuth] Failed to create session: null result");
      return null;
    }

    // Handle both possible response structures
    let jwt: string;
    let refreshToken: string;

    if (typedResult.tokens) {
      // New structure: { sessionId, tokens: { token, refreshToken }, userId }
      jwt = typedResult.tokens.token;
      refreshToken = typedResult.tokens.refreshToken;
    } else if (typedResult.token && typedResult.refreshToken) {
      // Old structure: { token, refreshToken }
      jwt = typedResult.token;
      refreshToken = typedResult.refreshToken;
    } else {
      console.error("[electronAuth] Unexpected result structure:", result);
      return null;
    }

    console.log("[electronAuth] Created new session with JWT length:", jwt.length);

    return { jwt, refreshToken };
  },
});
