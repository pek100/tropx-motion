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
   * Start a temporary HTTP server to receive the OAuth callback
   */
  private startCallbackServer(port: number): Promise<{ jwt: string; refreshToken: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);

        console.log('[OAuthHandler] Callback received:', url.pathname);

        if (url.pathname === '/callback') {
          const jwt = url.searchParams.get('jwt');
          const refreshToken = url.searchParams.get('refreshToken');
          const error = url.searchParams.get('error');

          console.log('[OAuthHandler] Callback params - jwt:', jwt ? `${jwt.length} chars` : 'null');
          console.log('[OAuthHandler] Callback params - refreshToken:', refreshToken ? `${refreshToken.length} chars` : 'null');
          console.log('[OAuthHandler] Callback params - error:', error);

          // Send a nice HTML response
          res.writeHead(200, { 'Content-Type': 'text/html' });

          if (error) {
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>Sign-in Failed</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                         display: flex; align-items: center; justify-content: center;
                         height: 100vh; margin: 0; background: linear-gradient(135deg, #fff6f3, white); }
                  .container { text-align: center; padding: 40px; }
                  h1 { color: #dc2626; margin-bottom: 16px; }
                  p { color: #666; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>Sign-in Failed</h1>
                  <p>${error}</p>
                  <p>You can close this tab and try again.</p>
                </div>
              </body>
              </html>
            `);
            reject(new Error(error));
          } else if (jwt && refreshToken) {
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>Sign-in Successful</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                         display: flex; align-items: center; justify-content: center;
                         height: 100vh; margin: 0; background: linear-gradient(135deg, #fff6f3, white); }
                  .container { text-align: center; padding: 40px; }
                  .success { width: 80px; height: 80px; background: #dcfce7; border-radius: 50%;
                             display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
                  .success svg { width: 40px; height: 40px; color: #16a34a; }
                  h1 { color: #1f2937; margin-bottom: 16px; }
                  p { color: #666; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="success">
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
          } else {
            res.end(`
              <!DOCTYPE html>
              <html>
              <head><title>Error</title></head>
              <body>
                <h1>Missing tokens</h1>
                <p>Authentication response was incomplete.</p>
              </body>
              </html>
            `);
            reject(new Error('Missing tokens in callback'));
          }

          // Close server after response
          setTimeout(() => this.stopCallbackServer(), 1000);
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
