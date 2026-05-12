/**
 * Generates an RSA-2048 keypair for the demo partner. Outputs:
 *   - PRIVATE PEM (PKCS#8) → keys/private.pem
 *   - PUBLIC JWK (with kid)  → keys/public.jwk.json
 *
 * Both files are gitignored. After running:
 *
 *   bunx wrangler secret put RSA_PRIVATE_KEY_PEM --env dev < keys/private.pem
 *   bunx wrangler secret put JWKS_PUBLIC_JWK     --env dev < keys/public.jwk.json
 *
 * The generated `kid` is timestamped so a fresh key always shadows older ones
 * served by the JWKS endpoint (rotation is just: regenerate + redeploy +
 * wait for the stream worker's 1h JWKS TTL).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const subtle = globalThis.crypto.subtle
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'keys')

function bufToB64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64')
}

function pemWrap(label: string, b64: string): string {
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  const pair = await subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )

  const privatePkcs8 = await subtle.exportKey('pkcs8', pair.privateKey)
  const privatePem = pemWrap('PRIVATE KEY', bufToB64(privatePkcs8))

  const publicJwk = (await subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  const kid = `demo-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`
  const publicWithMeta = {
    ...publicJwk,
    kid,
    use: 'sig',
    alg: 'RS256',
  }

  await writeFile(join(OUT_DIR, 'private.pem'), privatePem, { mode: 0o600 })
  await writeFile(join(OUT_DIR, 'public.jwk.json'), JSON.stringify(publicWithMeta), { mode: 0o644 })

  console.log(`✓ keys generated  (kid=${kid})`)
  console.log(`  private: ${join(OUT_DIR, 'private.pem')}`)
  console.log(`  public : ${join(OUT_DIR, 'public.jwk.json')}`)
  console.log()
  console.log('Upload as Wrangler secrets:')
  console.log(`  cat ${join(OUT_DIR, 'private.pem')} | bunx wrangler secret put RSA_PRIVATE_KEY_PEM --env dev`)
  console.log(`  cat ${join(OUT_DIR, 'public.jwk.json')} | bunx wrangler secret put JWKS_PUBLIC_JWK --env dev`)
}

main().catch((e) => {
  console.error('gen-keys failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
