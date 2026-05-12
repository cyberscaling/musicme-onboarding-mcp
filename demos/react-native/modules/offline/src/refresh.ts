import NetInfo from '@react-native-community/netinfo'
import { OfflineModule } from './module'
import { refreshLicense, SubscriptionExpiredError } from './api'

const SEVEN_DAYS_S = 7 * 86400

export type RefreshAllOptions = {
  baseUrl: string
  jwt: string
  deviceId: string
  withinSeconds?: number
}

export type RefreshFailure = {
  trackId: string
  /** `'subscription_expired'` is a terminal reason — caller should stop
   *  scheduling refresh ticks until the user re-authenticates. Any other
   *  string is the underlying error message (transient). */
  reason: 'subscription_expired' | string
}

export async function refreshExpiringLicenses(opts: RefreshAllOptions): Promise<{
  refreshed: string[]
  failed: RefreshFailure[]
}> {
  const within = opts.withinSeconds ?? SEVEN_DAYS_S

  const net = await NetInfo.fetch()
  if (!net.isConnected) {
    return { refreshed: [], failed: [] }
  }

  const tracks = await OfflineModule.listTracks()
  const now = Math.floor(Date.now() / 1000)
  const due = tracks.filter((t) => t.licenseExp - now < within)
  const refreshed: string[] = []
  const failed: RefreshFailure[] = []

  for (const t of due) {
    try {
      const { license } = await refreshLicense({
        baseUrl: opts.baseUrl,
        jwt: opts.jwt,
        trackId: t.trackId,
        deviceId: opts.deviceId,
      })
      await OfflineModule.updateLicense({ trackId: t.trackId, license })
      refreshed.push(t.trackId)
    } catch (e) {
      if (e instanceof SubscriptionExpiredError) {
        for (const u of due.slice(due.indexOf(t))) {
          failed.push({ trackId: u.trackId, reason: 'subscription_expired' })
        }
        break
      }
      failed.push({ trackId: t.trackId, reason: String((e as Error).message ?? e) })
    }
  }

  return { refreshed, failed }
}
