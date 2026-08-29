export type TrackRef = {
  cb: number
  disc: number
  track: number
  /** Mode d'écoute pour les déclaratifs de royalties — OBLIGATOIRE dans les
   *  intégrations. Le player natif de cette demo déclare toujours
   *  `on_demand` au /init-stream (lecture locale/offline) ; porter `radio` /
   *  `artist_mix` jusqu'au natif demandera d'étendre le bridge Expo
   *  (`prefetch` est typé `[String: Int]`). */
  context: 'on_demand' | 'radio' | 'artist_mix'
}

export function formatTrackRef(ref: TrackRef): string {
  return `${ref.cb}:${ref.disc}:${ref.track}`
}

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
  | { type: 'player:remote:next' }
  | { type: 'player:remote:prev' }
