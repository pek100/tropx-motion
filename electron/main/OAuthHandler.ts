import { BrowserWindow, session, shell, app } from 'electron';

interface OAuthResult {
  success: boolean;
  error?: string;
  token?: string;
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
        const token = parsedUrl.searchParams.get('token');
        const error = parsedUrl.searchParams.get('error');

        if (error) {
          console.log('[OAuthHandler] Auth error:', error);
          this.resolveAuth({ success: false, error });
        } else if (token) {
          console.log('[OAuthHandler] Auth token received');
          this.resolveAuth({ success: true, token });
        } else {
          // No token but also no error - auth was successful on web
          console.log('[OAuthHandler] Auth callback received (no token in URL)');
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
   * OAuth Flow via System Browser (preferred):
   * 1. Open default browser to web app with ?autoSignIn=google&electronAuth=true
   * 2. Web app auto-triggers Google OAuth on load
   * 3. User authenticates with Google
   * 4. Web app redirects to tropx://auth-callback?token=...
   * 5. Electron receives the callback via protocol handler
   *
   * Falls back to BrowserWindow if system browser fails
   */
  async signInWithGoogle(): Promise<OAuthResult> {
    return new Promise((resolve) => {
      this.pendingAuthResolve = resolve;

      console.log('[OAuthHandler] Opening system browser for auth:', AUTH_URL);

      // Try to open system browser first
      shell.openExternal(AUTH_URL)
        .then(() => {
          console.log('[OAuthHandler] System browser opened successfully');
        })
        .catch((err) => {
          console.error('[OAuthHandler] Failed to open system browser, using fallback:', err);
          this.openFallbackWindow();
        });

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
   * Fallback: Open BrowserWindow if system browser fails
   */
  private openFallbackWindow(): void {
    console.log('[OAuthHandler] Opening fallback auth window');

    this.authWindow = new BrowserWindow({
      width: 500,
      height: 700,
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

    // Monitor URL changes to detect OAuth flow
    this.authWindow.webContents.on('did-navigate', (_event, url) => {
      console.log('[OAuthHandler] Navigated to:', url.substring(0, 100));

      if (url.includes('accounts.google.com')) {
        wentToGoogle = true;
        return;
      }

      // Check for our custom protocol redirect
      if (url.startsWith(`${PROTOCOL}://`)) {
        this.handleProtocolUrl(url);
        return;
      }

      // Success: User returned to web app after Google OAuth
      if (wentToGoogle && url.startsWith(WEB_APP_URL)) {
        // Wait a bit for the token to be set, then close
        setTimeout(() => {
          console.log('[OAuthHandler] Auth successful via fallback window');
          this.resolveAuth({ success: true });
        }, 1500);
      }
    });

    this.authWindow.on('closed', () => {
      this.authWindow = null;
      if (this.pendingAuthResolve) {
        this.resolveAuth({ success: false, error: 'Authentication cancelled' });
      }
    });

    this.authWindow.loadURL(AUTH_URL).catch((err) => {
      console.error('[OAuthHandler] Failed to load fallback window:', err);
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
