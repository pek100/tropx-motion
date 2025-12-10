import { BrowserWindow, session } from 'electron';

interface OAuthResult {
  success: boolean;
  error?: string;
}

// Web app URL for OAuth
const WEB_APP_URL = process.env.TROPX_WEB_URL || 'https://app.tropx.ai';

export class OAuthHandler {
  private authWindow: BrowserWindow | null = null;

  /**
   * OAuth Flow using Web App:
   * 1. Open BrowserWindow pointing to web app
   * 2. User authenticates via Google on the web app
   * 3. Web app sets auth cookies (shared session)
   * 4. Detect successful auth and close window
   * 5. Main app reloads with shared session cookies
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

      console.log('[OAuthHandler] Opening web app for auth:', WEB_APP_URL);

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

      // Track if user successfully authenticated
      let authDetected = false;

      // Monitor URL changes to detect successful auth
      this.authWindow.webContents.on('did-navigate', (_event, url) => {
        console.log('[OAuthHandler] Navigated to:', url.substring(0, 100));

        // After Google OAuth, user lands back on web app
        // Check if we're on the main app (not auth pages) - indicates success
        if (url.startsWith(WEB_APP_URL) &&
            !url.includes('/api/auth/') &&
            !url.includes('accounts.google.com')) {

          // Give a moment for cookies to be set
          setTimeout(() => {
            console.log('[OAuthHandler] Auth successful, closing window');
            authDetected = true;
            succeed();
          }, 500);
        }
      });

      this.authWindow.webContents.on('did-navigate-in-page', (_event, url) => {
        console.log('[OAuthHandler] In-page navigation:', url.substring(0, 100));

        // Handle SPA navigation after auth
        if (url.startsWith(WEB_APP_URL) &&
            !url.includes('/api/auth/') &&
            !authDetected) {
          setTimeout(() => {
            console.log('[OAuthHandler] Auth detected via SPA navigation');
            authDetected = true;
            succeed();
          }, 500);
        }
      });

      // Handle window closed by user
      this.authWindow.on('closed', () => {
        this.authWindow = null;
        if (!resolved) {
          fail('Authentication cancelled');
        }
      });

      // Load the web app - user will click sign in there
      this.authWindow.loadURL(WEB_APP_URL).catch((err) => {
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
