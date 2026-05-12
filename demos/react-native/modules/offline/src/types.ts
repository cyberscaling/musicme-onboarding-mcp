export type OfflineTrack = {
  trackId: string
  mid: number
  sizeBytes: number
  downloadedAt: number
  licenseExp: number
  meta: { title?: string; artist?: string; coverUrl?: string; duration?: number }
}

export type OfflineEvent =
  | { type: 'offline:download:progress'; trackId: string; loaded: number; total: number }
  | { type: 'offline:download:complete'; trackId: string }
  | { type: 'offline:download:error'; trackId: string; code: string; message: string }
  | { type: 'offline:license:expired'; trackId: string }
