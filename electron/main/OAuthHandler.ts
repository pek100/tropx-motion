import { BrowserWindow, session, shell, app, ipcMain } from 'electron';

interface OAuthResult {
  success: boolean;
  error?: string;
  tokens?: {
    jwt: string;
    refreshToken: string;
  };
}

// Web app URL - with electronAuth param to indicate Electron OAuth flow
const WEB_APP_URL = process.env.TROPX_WEB_URL || 'https://app.tropx.ai';
const AUTH_URL = `${WEB_APP_URL}?autoSignIn=google&electronAuth=true`;

// Custom protocol for OAuth callback
const PROTOCOL = 'tropx';
const CALLBACK_PATH = 'auth-callback';

export class OAuthHandler {
  private authWindow: BrowserWindow | null = null;
  private pendingAuthResolve: ((result: OAuthResult) => void) | null = null;
  private authTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.registerProtocol();
  }

  /**
   * Register tropx:// protocol handler for OAuth callback
   * The web app will redirect to tropx://auth-callback?token=... after auth
   */
  private registerProtocol(): void {
    // Check if already registered
    if (app.isDefaultProtocolClient(PROTOCOL)) {
      console.log(`[OAuthHandler] ${PROTOCOL}:// protocol already registered`);
      return;
    }

    // Register as default protocol client
    const success = app.setAsDefaultProtocolClient(PROTOCOL);
    console.log(`[OAuthHandler] ${PROTOCOL}:// protocol registration:`, success ? 'success' : 'failed');

    // Handle protocol on macOS (open-url event)
    app.on('open-url', (event, url) => {
      event.preventDefault();
      console.log('[OAuthHandler] Received protocol URL:', url);
      this.handleProtocolUrl(url);
    });

    // Handle protocol on Windows/Linux (second-instance event)
    app.on('second-instance', (_event, commandLine) => {
      // Find the protocol URL in command line args
      const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
      if (url) {
        console.log('[OAuthHandler] Received protocol URL from second instance:', url);
        this.handleProtocolUrl(url);
      }
    });
  }

  /**
   * Handle the OAuth callback URL (tropx://auth-callback?token=...)
   */
  private handleProtocolUrl(url: string): void {
    try {
      const parsedUrl = new URL(url);

      // Check if this is our auth callback
      if (parsedUrl.host === CALLBACK_PATH || parsedUrl.pathname.includes(CALLBACK_PATH)) {
        const error = parsedUrl.searchParams.get('error');

        if (error) {
          console.log('[OAuthHandler] Auth error:', error);
          this.resolveAuth({ success: false, error });
        } else {
          // Protocol callback received - auth was successful on web
          // Note: For production installed apps, the main window will reload to pick up tokens
          console.log('[OAuthHandler] Auth callback received');
          this.resolveAuth({ success: true });
        }
      }
    } catch (err) {
      console.error('[OAuthHandler] Failed to parse protocol URL:', err);
    }
  }

  private resolveAuth(result: OAuthResult): void {
    if (this.pendingAuthResolve) {
      // Clear timeout
      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }

      this.pendingAuthResolve(result);
      this.pendingAuthResolve = null;
    }

    // Close fallback auth window if open
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close();
      this.authWindow = null;
    }
  }

  /**
   * OAuth Flow:
   * - In production: Opens system browser, uses tropx:// protocol for callback
   * - In development: Uses BrowserWindow (protocol handler doesn't work in dev)
   */
  async signInWithGoogle(): Promise<OAuthResult> {
    return new Promise((resolve) => {
      this.pendingAuthResolve = resolve;

      // In dev mode, protocol handler won't work - use BrowserWindow directly
      const isDev = !app.isPackaged;

      if (isDev) {
        console.log('[OAuthHandler] Dev mode - using BrowserWindow for auth');
        this.openFallbackWindow();
      } else {
        console.log('[OAuthHandler] Production - opening system browser for auth:', AUTH_URL);

        // Try to open system browser first
        shell.openExternal(AUTH_URL)
          .then(() => {
            console.log('[OAuthHandler] System browser opened successfully');
          })
          .catch((err) => {
            console.error('[OAuthHandler] Failed to open system browser, using fallback:', err);
            this.openFallbackWindow();
          });
      }

      // Timeout after 5 minutes
      this.authTimeout = setTimeout(() => {
        if (this.pendingAuthResolve) {
          console.log('[OAuthHandler] Auth timed out');
          this.resolveAuth({ success: false, error: 'Authentication timed out' });
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * BrowserWindow OAuth flow:
   * - Opens web app in BrowserWindow
   * - Monitors for OAuth completion
   * - Auto-closes when auth is successful
   * - Works for portable apps (no protocol handler needed)
   */
  private openFallbackWindow(): void {
    console.log('[OAuthHandler] Opening auth window');

    this.authWindow = new BrowserWindow({
      width: 600,
      height: 800,
      minWidth: 500,
      minHeight: 700,
      show: true,
      title: 'Sign in to TropX Motion',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:convex-auth',
      },
    });

    // Track OAuth flow state
    let wentToGoogle = false;
    let authCheckInterval: NodeJS.Timeout | null = null;

    // Monitor URL changes to detect OAuth flow
    this.authWindow.webContents.on('did-navigate', (_event, url) => {
      console.log('[OAuthHandler] Navigated to:', url.substring(0, 100));

      if (url.includes('accounts.google.com')) {
        wentToGoogle = true;
        return;
      }

      // Check for our custom protocol redirect (works in production)
      if (url.startsWith(`${PROTOCOL}://`)) {
        this.handleProtocolUrl(url);
        return;
      }

      // Success: User returned to web app after Google OAuth
      // Also check for ?code= parameter which indicates OAuth callback
      if ((wentToGoogle && url.startsWith(WEB_APP_URL)) || url.includes('?code=')) {
        console.log('[OAuthHandler] Returned to web app, checking for auth completion...');
        console.log('[OAuthHandler] URL:', url);

        // Poll for auth completion by checking page content
        authCheckInterval = setInterval(async () => {
          try {
            if (!this.authWindow || this.authWindow.isDestroyed()) {
              if (authCheckInterval) clearInterval(authCheckInterval);
              return;
            }

            // Check if JWT token exists and extract it
            const result = await this.authWindow.webContents.executeJavaScript(`
              (function() {
                // Find JWT and refresh tokens in localStorage
                const keys = Object.keys(localStorage);
                console.log('[OAuthHandler] localStorage keys:', keys);

                // Look for Convex Auth tokens (key contains 'JWT' or 'RefreshToken')
                const jwtKey = keys.find(k => k.toLowerCase().includes('jwt') && k.includes('convex'));
                const refreshKey = keys.find(k => k.toLowerCase().includes('refreshtoken') && k.includes('convex'));

                const jwt = jwtKey ? localStorage.getItem(jwtKey) : null;
                const refreshToken = refreshKey ? localStorage.getItem(refreshKey) : null;

                // Check for success screen text
                const hasSuccessScreen = document.body.innerText.includes('Sign-in Successful');

                console.log('[OAuthHandler] Found tokens:', { jwtKey, refreshKey, hasJWT: !!jwt, hasRefresh: !!refreshToken });

                return { jwt, refreshToken, jwtKey, refreshKey, hasSuccessScreen };
              })()
            `);

            console.log('[OAuthHandler] Auth check:', {
              hasJWT: !!result.jwt,
              hasRefresh: !!result.refreshToken,
              hasSuccessScreen: result.hasSuccessScreen
            });

            if (result.jwt && result.refreshToken) {
              if (authCheckInterval) clearInterval(authCheckInterval);
              console.log('[OAuthHandler] Auth successful, extracting tokens');
              this.resolveAuth({
                success: true,
                tokens: {
                  jwt: result.jwt,
                  refreshToken: result.refreshToken
                }
              });
            } else if (result.hasSuccessScreen) {
              // Success screen but no tokens yet, wait a bit more
              console.log('[OAuthHandler] Success screen visible, waiting for tokens...');
            }
          } catch (err) {
            // Window might be closed
            if (authCheckInterval) clearInterval(authCheckInterval);
          }
        }, 500);

        // Stop checking after 30 seconds
        setTimeout(() => {
          if (authCheckInterval) {
            clearInterval(authCheckInterval);
            authCheckInterval = null;
          }
        }, 30000);
      }
    });

    this.authWindow.on('closed', () => {
      if (authCheckInterval) clearInterval(authCheckInterval);
      this.authWindow = null;
      if (this.pendingAuthResolve) {
        this.resolveAuth({ success: false, error: 'Authentication cancelled' });
      }
    });

    this.authWindow.loadURL(AUTH_URL).catch((err) => {
      console.error('[OAuthHandler] Failed to load auth window:', err);
      this.resolveAuth({ success: false, error: `Failed to load authentication page: ${err.message}` });
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
