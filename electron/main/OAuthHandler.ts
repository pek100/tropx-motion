import { session, shell } from 'electron';
import * as http from 'http';
import * as net from 'net';

interface OAuthResult {
  success: boolean;
  error?: string;
  tokens?: {
    jwt: string;
    refreshToken: string;
  };
}

// Web app URL
const WEB_APP_URL = process.env.TROPX_WEB_URL || 'https://app.tropx.ai';

export class OAuthHandler {
  private server: http.Server | null = null;
  private pendingAuthResolve: ((result: OAuthResult) => void) | null = null;
  private authTimeout: NodeJS.Timeout | null = null;
  private retryCount: number = 0;
  private maxRetries: number = 2;

  /**
   * Validate a JWT token by decoding and checking expiry
   */
  private validateToken(jwt: string): { valid: boolean; error?: string } {
    try {
      // JWT format: header.payload.signature
      const parts = jwt.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token format' };
      }

      // Decode payload (base64url)
      const payload = parts[1];
      const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
      const claims = JSON.parse(decoded);

      // Check expiry
      if (claims.exp) {
        const expiryTime = claims.exp * 1000; // Convert to milliseconds
        const now = Date.now();
        const bufferTime = 60 * 1000; // 1 minute buffer

        if (expiryTime < now + bufferTime) {
          console.log('[OAuthHandler] Token expired or expiring soon:', {
            exp: new Date(expiryTime).toISOString(),
            now: new Date(now).toISOString()
          });
          return { valid: false, error: 'Token expired' };
        }
      }

      console.log('[OAuthHandler] Token validated successfully');
      return { valid: true };
    } catch (err) {
      console.error('[OAuthHandler] Token validation error:', err);
      return { valid: false, error: 'Failed to decode token' };
    }
  }

  /**
   * Find an available port for the callback server
   */
  private async findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error('Could not get port'));
        }
      });
    });
  }

  /**
   * Get the common CSS styles for HTML pages
   */
  private getPageStyles(): string {
    return `
      :root { --bg: #fafafa; --text: #1f2937; --text-sub: #6b7280; --success-bg: #dcfce7; --success: #16a34a; --error-bg: #fef2f2; --error: #dc2626; --info-bg: #dbeafe; --info: #2563eb; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #18181b; --text: #fafafa; --text-sub: #a1a1aa; --success-bg: rgba(22, 101, 52, 0.3); --success: #4ade80; --error-bg: rgba(127, 29, 29, 0.3); --error: #f87171; --info-bg: rgba(37, 99, 235, 0.2); --info: #60a5fa; }
      }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             display: flex; align-items: center; justify-content: center;
             height: 100vh; margin: 0; background: var(--bg); }
      .container { text-align: center; padding: 40px; }
      .icon { width: 80px; height: 80px; border-radius: 50%;
              display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
      .icon svg { width: 40px; height: 40px; }
      .icon.success { background: var(--success-bg); color: var(--success); }
      .icon.error { background: var(--error-bg); color: var(--error); }
      .icon.info { background: var(--info-bg); color: var(--info); }
      .spinner { animation: spin 1s linear infinite; }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      h1 { color: var(--text); margin-bottom: 16px; }
      p { color: var(--text-sub); }
    `;
  }

  /**
   * Start a temporary HTTP server to receive the OAuth callback
   */
  private startCallbackServer(port: number): Promise<{ jwt: string; refreshToken: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);

        console.log('[OAuthHandler] Callback received:', url.pathname);

        if (url.pathname === '/callback') {
          const jwt = url.searchParams.get('jwt');
          const refreshToken = url.searchParams.get('refreshToken');
          const error = url.searchParams.get('error');

          console.log('[OAuthHandler] Callback params - jwt:', jwt ? `${jwt.length} chars` : 'null');
          console.log('[OAuthHandler] Callback params - refreshToken:', refreshToken ? `${refreshToken.length} chars` : 'null');
          console.log('[OAuthHandler] Callback params - error:', error);

          res.writeHead(200, { 'Content-Type': 'text/html' });

          if (error) {
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>Sign-in Failed</title>
                <style>${this.getPageStyles()}</style>
              </head>
              <body>
                <div class="container">
                  <div class="icon error">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </div>
                  <h1>Sign-in Failed</h1>
                  <p>${error}</p>
                  <p>You can close this tab and try again.</p>
                </div>
              </body>
              </html>
            `);
            reject(new Error(error));
            setTimeout(() => this.stopCallbackServer(), 1000);
          } else if (jwt && refreshToken) {
            // Validate the token before accepting it
            const validation = this.validateToken(jwt);

            if (!validation.valid) {
              console.log(`[OAuthHandler] Token invalid: ${validation.error}. Retry count: ${this.retryCount}/${this.maxRetries}`);

              if (this.retryCount < this.maxRetries) {
                this.retryCount++;

                // Show "re-authenticating" page and redirect to OAuth
                const callbackUrl = `http://localhost:${port}/callback`;
                const authUrl = `${WEB_APP_URL}?autoSignIn=google&electronAuth=true&callbackUrl=${encodeURIComponent(callbackUrl)}&forceReauth=true`;

                res.end(`
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <title>Re-authenticating...</title>
                    <style>${this.getPageStyles()}</style>
                    <meta http-equiv="refresh" content="2;url=${authUrl}">
                  </head>
                  <body>
                    <div class="container">
                      <div class="icon info">
                        <svg class="spinner" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                        </svg>
                      </div>
                      <h1>Session Expired</h1>
                      <p>Your session has expired. Redirecting to sign in again...</p>
                    </div>
                  </body>
                  </html>
                `);
                // Don't resolve/reject - keep server running for new callback
              } else {
                // Max retries reached
                res.end(`
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <title>Sign-in Failed</title>
                    <style>${this.getPageStyles()}</style>
                  </head>
                  <body>
                    <div class="container">
                      <div class="icon error">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                      </div>
                      <h1>Sign-in Failed</h1>
                      <p>Unable to obtain a valid session after multiple attempts.</p>
                      <p>Please close this tab and try again later.</p>
                    </div>
                  </body>
                  </html>
                `);
                reject(new Error('Token validation failed after retries'));
                setTimeout(() => this.stopCallbackServer(), 1000);
              }
            } else {
              // Token is valid - success!
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>Sign-in Successful</title>
                  <style>${this.getPageStyles()}</style>
                </head>
                <body>
                  <div class="container">
                    <div class="icon success">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                      </svg>
                    </div>
                    <h1>Sign-in Successful!</h1>
                    <p>You can close this tab and return to TropX Motion.</p>
                  </div>
                </body>
                </html>
              `);
              resolve({ jwt, refreshToken });
              setTimeout(() => this.stopCallbackServer(), 1000);
            }
          } else {
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>Error</title>
                <style>${this.getPageStyles()}</style>
              </head>
              <body>
                <div class="container">
                  <div class="icon error">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </div>
                  <h1>Missing tokens</h1>
                  <p>Authentication response was incomplete.</p>
                </div>
              </body>
              </html>
            `);
            reject(new Error('Missing tokens in callback'));
            setTimeout(() => this.stopCallbackServer(), 1000);
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.server.listen(port, () => {
        console.log(`[OAuthHandler] Callback server listening on port ${port}`);
      });

      this.server.on('error', (err) => {
        console.error('[OAuthHandler] Server error:', err);
        reject(err);
      });
    });
  }

  /**
   * Stop the callback server
   */
  private stopCallbackServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      console.log('[OAuthHandler] Callback server stopped');
    }
  }

  /**
   * OAuth Flow using localhost callback:
   * 1. Start temporary HTTP server on random port
   * 2. Open system browser to web app with callback URL
   * 3. User authenticates with Google
   * 4. Web app redirects to localhost callback with tokens
   * 5. Extract tokens and return
   */
  async signInWithGoogle(): Promise<OAuthResult> {
    try {
      // Reset retry count for new auth flow
      this.retryCount = 0;

      // Find available port
      const port = await this.findAvailablePort();
      const callbackUrl = `http://localhost:${port}/callback`;

      console.log('[OAuthHandler] Starting OAuth flow with callback:', callbackUrl);

      // Build auth URL with callback
      const authUrl = `${WEB_APP_URL}?autoSignIn=google&electronAuth=true&callbackUrl=${encodeURIComponent(callbackUrl)}`;

      // Start callback server
      const tokenPromise = this.startCallbackServer(port);

      // Open system browser
      console.log('[OAuthHandler] Opening system browser:', authUrl);
      await shell.openExternal(authUrl);

      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        this.authTimeout = setTimeout(() => {
          this.stopCallbackServer();
          reject(new Error('Authentication timed out'));
        }, 5 * 60 * 1000); // 5 minutes
      });

      // Wait for callback or timeout
      const tokens = await Promise.race([tokenPromise, timeoutPromise]);

      // Clear timeout
      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }

      console.log('[OAuthHandler] OAuth successful, tokens received');
      return { success: true, tokens };

    } catch (err) {
      console.error('[OAuthHandler] OAuth failed:', err);
      this.stopCallbackServer();

      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }

      return {
        success: false,
        error: err instanceof Error ? err.message : 'Authentication failed'
      };
    }
  }

  async signOut(): Promise<void> {
    try {
      // Clear the shared session partition
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
