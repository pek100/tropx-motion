import { BrowserWindow, session } from 'electron';

interface OAuthResult {
  success: boolean;
  error?: string;
}

// Web app URL - with autoSignIn param to trigger Google OAuth automatically
const WEB_APP_URL = process.env.TROPX_WEB_URL || 'https://app.tropx.ai';
const AUTH_URL = `${WEB_APP_URL}?autoSignIn=google`;

export class OAuthHandler {
  private authWindow: BrowserWindow | null = null;

  /**
   * OAuth Flow via Web App:
   * 1. Open BrowserWindow to web app with ?autoSignIn=google param
   * 2. Web app auto-triggers Google OAuth on load
   * 3. User authenticates with Google
   * 4. Google redirects back through Convex
   * 5. Detect when back on web app (authenticated) and close
   */
  async signInWithGoogle(): Promise<OAuthResult> {
    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (this.authWindow && !this.authWindow.isDestroyed()) {
          this.authWindow.close();
        }
        this.authWindow = null;
      };

      const succeed = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({ success: true });
        }
      };

      const fail = (error: string) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({ success: false, error });
        }
      };

      console.log('[OAuthHandler] Opening web app with auto sign-in:', AUTH_URL);

      // Create auth window with shared session partition
      // MUST match the partition in MainProcess.ts for cookie sharing
      this.authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: true,
        title: 'Sign in to TropX Motion',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // Share session with main window for Convex auth cookies
          partition: 'persist:convex-auth',
        },
      });

      // Track OAuth flow state
      let authDetected = false;
      let wentToGoogle = false;

      // Monitor URL changes to detect OAuth flow
      this.authWindow.webContents.on('did-navigate', (_event, url) => {
        console.log('[OAuthHandler] Navigated to:', url.substring(0, 100));

        // Detect Google OAuth
        if (url.includes('accounts.google.com')) {
          console.log('[OAuthHandler] At Google OAuth');
          wentToGoogle = true;
          return;
        }

        // Success: User returned to web app after Google OAuth
        if (wentToGoogle && url.startsWith(WEB_APP_URL) && !authDetected) {
          setTimeout(() => {
            console.log('[OAuthHandler] Auth successful, back at web app');
            authDetected = true;
            succeed();
          }, 1000);
        }
      });

      this.authWindow.webContents.on('did-navigate-in-page', (_event, url) => {
        console.log('[OAuthHandler] In-page navigation:', url.substring(0, 100));

        // Handle SPA navigation after auth
        if (wentToGoogle && url.startsWith(WEB_APP_URL) && !authDetected) {
          setTimeout(() => {
            console.log('[OAuthHandler] Auth detected via SPA navigation');
            authDetected = true;
            succeed();
          }, 1000);
        }
      });

      // Handle window closed by user
      this.authWindow.on('closed', () => {
        this.authWindow = null;
        if (!resolved) {
          fail('Authentication cancelled');
        }
      });

      // Load the web app with autoSignIn param
      this.authWindow.loadURL(AUTH_URL).catch((err) => {
        console.error('[OAuthHandler] Failed to load:', err);
        fail(`Failed to load authentication page: ${err.message}`);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!resolved) {
          fail('Authentication timed out');
        }
      }, 5 * 60 * 1000);
    });
  }

  async signOut(): Promise<void> {
    try {
      // Clear the shared session partition (must match MainProcess.ts)
      const authSession = session.fromPartition('persist:convex-auth');
      await authSession.clearStorageData({
        storages: ['cookies', 'localstorage'],
      });
      console.log('[OAuthHandler] Session cleared');
    } catch (err) {
      console.error('[OAuthHandler] Failed to clear session:', err);
    }
  }
}

export const oauthHandler = new OAuthHandler();
