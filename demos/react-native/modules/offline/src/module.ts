import { EventEmitter, requireNativeModule } from 'expo-modules-core'
import type { OfflineTrack, OfflineEvent } from './types'

const native = requireNativeModule('OfflineExpoModule')

export const OfflineModule = {
  ingestDownload(opts: {
    tmpPath: string
    license: string
    sizeBytes: number
    metaJson?: string
  }): Promise<string> {
    return native.ingestDownload(opts.tmpPath, opts.license, opts.sizeBytes, opts.metaJson ?? null)
  },

  updateLicense(opts: { trackId: string; license: string }): Promise<void> {
    return native.updateLicense(opts.trackId, opts.license)
  },

  listTracks(): Promise<OfflineTrack[]> {
    return native.listTracks()
  },

  hasTrack(trackId: string): Promise<boolean> {
    return native.hasTrack(trackId)
  },

  removeTrack(trackId: string): Promise<void> {
    return native.removeTrack(trackId)
  },

  wipeAll(): Promise<void> {
    return native.wipeAll()
  },

  getDeviceId(): Promise<string> {
    return native.getDeviceId()
  },

  emitter: new EventEmitter(native),

  addListener<T extends OfflineEvent['type']>(
    eventName: T,
    handler: (event: Extract<OfflineEvent, { type: T }>) => void,
  ): { remove: () => void } {
    const sub = (this.emitter as unknown as { addListener: (name: string, h: (e: unknown) => void) => { remove: () => void } })
      .addListener(eventName, handler as (e: unknown) => void)
    return { remove: () => sub.remove() }
  },
}
