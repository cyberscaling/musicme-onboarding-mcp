export type Env = {
  ASSETS: Fetcher
  DEMO_SESSIONS: KVNamespace

  // Vars
  DEMO_USERS: string
  JWT_TTL_SECONDS: string
  SESSION_TTL_SECONDS: string
  STREAM_WORKER_URL: string
  PARTNER_ID: string
  ISS_OVERRIDE: string

  // Secrets
  RSA_PRIVATE_KEY_PEM?: string
  JWKS_PUBLIC_JWK?: string
  SONAR_API_KEY?: string
}

export type SessionData = {
  username: string
  exp: number
}
