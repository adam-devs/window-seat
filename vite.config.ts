import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
const TOKEN_REFRESH_MARGIN_MS = 60_000
const TOKEN_RETRY_COOLDOWN_MS = 60_000

interface TokenManager {
  enabled: boolean
  ensureToken: () => Promise<string | null>
  currentToken: () => string | null
}

/**
 * Local-only OpenSky OAuth2 helper.
 *
 * Credentials are read from `.env.local` by the Vite dev server (Node side) and
 * never exposed to the browser. Requests are upgraded to authenticated calls
 * through the `/opensky` proxy; if credentials are missing or the token request
 * fails, the app falls back to anonymous access.
 */
function createOpenSkyTokenManager(
  clientId?: string,
  clientSecret?: string,
): TokenManager {
  const enabled = Boolean(clientId && clientSecret)
  let token: string | null = null
  let expiresAt = 0
  let retryAt = 0
  let inFlight: Promise<string | null> | null = null

  async function requestToken(): Promise<string | null> {
    if (!clientId || !clientSecret) return null

    try {
      const res = await fetch(OPENSKY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        console.warn(
          `[opensky-auth] token request failed (${res.status} ${res.statusText}); using anonymous access`,
        )
        retryAt = Date.now() + TOKEN_RETRY_COOLDOWN_MS
        return null
      }

      const data = (await res.json()) as {
        access_token?: string
        expires_in?: number
      }

      if (!data.access_token) {
        console.warn('[opensky-auth] token response missing access_token; using anonymous access')
        retryAt = Date.now() + TOKEN_RETRY_COOLDOWN_MS
        return null
      }

      token = data.access_token
      const ttlSeconds =
        typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 1800
      expiresAt = Date.now() + ttlSeconds * 1000
      retryAt = 0
      console.log(`[opensky-auth] OAuth token acquired (expires in ${ttlSeconds}s)`)
      return token
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[opensky-auth] token request error: ${message}; using anonymous access`)
      retryAt = Date.now() + TOKEN_RETRY_COOLDOWN_MS
      return null
    }
  }

  async function ensureToken(): Promise<string | null> {
    if (!enabled) return null
    if (token && Date.now() < expiresAt - TOKEN_REFRESH_MARGIN_MS) return token
    if (Date.now() < retryAt) return null

    if (!inFlight) {
      inFlight = requestToken().finally(() => {
        inFlight = null
      })
    }

    return inFlight
  }

  return {
    enabled,
    ensureToken,
    currentToken: () => (token && Date.now() < expiresAt ? token : null),
  }
}

function openSkyAuthPlugin(auth: TokenManager): Plugin {
  return {
    name: 'opensky-auth',
    apply: 'serve',
    configureServer(server) {
      if (!auth.enabled) {
        console.warn(
          '[opensky-auth] OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET not set; using anonymous access',
        )
        return
      }

      // Resolve the token before the proxy forwards the request. Vite adds
      // custom middlewares before its internal proxy middleware.
      server.middlewares.use((req, _res, next) => {
        if (!req.url?.startsWith('/opensky')) {
          next()
          return
        }

        auth
          .ensureToken()
          .catch(() => null)
          .finally(() => next())
      })

      // Prefetch so the first data request is usually already authenticated.
      void auth.ensureToken()
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const auth = createOpenSkyTokenManager(
    env.OPENSKY_CLIENT_ID,
    env.OPENSKY_CLIENT_SECRET,
  )

  return {
    plugins: [react(), openSkyAuthPlugin(auth)],
    server: {
      proxy: {
        // Keyless aircraft/route metadata enrichment. Kept server-side so the
        // app has one consistent external-data path and no CORS surprises.
        '/adsbdb': {
          target: 'https://api.adsbdb.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/adsbdb/, ''),
        },
        '/opensky': {
          target: 'https://opensky-network.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/opensky/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const bearer = auth.currentToken()
              if (bearer) proxyReq.setHeader('Authorization', `Bearer ${bearer}`)
            })
          },
        },
      },
    },
  }
})
