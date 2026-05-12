import * as FS from 'expo-file-system/legacy'
import { OfflineModule } from './module'

/**
 * Thrown when the worker returns 403 with `error: 'subscription_expired'`.
 * Distinct class so callers can `if (e instanceof SubscriptionExpiredError)`
 * to skip retry loops and surface the right UI.
 */
export class SubscriptionExpiredError extends Error {
  constructor(message = 'subscription_expired') {
    super(message)
    this.name = 'SubscriptionExpiredError'
  }
}

export type DownloadOptions = {
  baseUrl: string
  jwt: string
  trackId: string
  deviceId: string
  metaJson?: string
}

export async function downloadTrack(opts: DownloadOptions): Promise<void> {
  const licenseRes = await fetch(`${opts.baseUrl}/offline/license`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trackId: opts.trackId, deviceId: opts.deviceId }),
  })
  if (licenseRes.status === 403) {
    const body = (await licenseRes.json().catch(() => ({}))) as { error?: string }
    if (body.error === 'subscription_expired') {
      throw new SubscriptionExpiredError()
    }
  }
  if (!licenseRes.ok) {
    throw new Error(`license_failed: ${licenseRes.status}`)
  }
  const { license, ciphertextUrl, sizeBytes } = (await licenseRes.json()) as {
    license: string
    ciphertextUrl: string
    sizeBytes: number
  }

  const tmpUri = `${FS.cacheDirectory}offline-dl-${Date.now()}.bin`
  const dlResult = await FS.downloadAsync(`${opts.baseUrl}${ciphertextUrl}`, tmpUri)
  if (dlResult.status !== 200) {
    await FS.deleteAsync(tmpUri, { idempotent: true })
    throw new Error(`download_failed: ${dlResult.status}`)
  }

  try {
    await OfflineModule.ingestDownload({
      tmpPath: dlResult.uri.replace('file://', ''),
      license,
      sizeBytes,
      metaJson: opts.metaJson,
    })
  } catch (e) {
    await FS.deleteAsync(tmpUri, { idempotent: true })
    throw e
  }
}

export type RefreshOptions = {
  baseUrl: string
  jwt: string
  trackId: string
  deviceId: string
}

export async function refreshLicense(opts: RefreshOptions): Promise<{ license: string }> {
  const res = await fetch(`${opts.baseUrl}/offline/license-refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trackId: opts.trackId, deviceId: opts.deviceId }),
  })
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (body.error === 'subscription_expired') {
      throw new SubscriptionExpiredError()
    }
  }
  if (!res.ok) {
    throw new Error(`refresh_failed: ${res.status}`)
  }
  return (await res.json()) as { license: string }
}
