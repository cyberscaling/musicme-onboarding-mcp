/**
 * Browser-side typed wrappers + adapters for the catalog API. All HTTP
 * calls go through demo-worker proxy (/api/catalog/*) which injects the
 * x-api-key server-side.
 *
 * The upstream catalog uses three response conventions (raw / aliased /
 * flatten) — see docs/musicme-api.md. Each adapter below maps one
 * convention to the unified domain model.
 */
export type Album = {
  cb: string
  title: string
  artist?: string
  artistId?: number
  releaseDate?: string
  styleId?: number
  trackCount?: number
  coverCb: string
}

export type Artist = {
  id: number
  name: string
  bio?: string
  styles?: number[]
}

export type Track = {
  cb: string
  disc: number
  track: number
  title: string
  durationSec: number
  artist?: string
  albumTitle?: string
}

export type Style = { id: number; name: string }

export class CatalogError extends Error {
  constructor(public status: number, public bodyText: string) {
    super(`catalog HTTP ${status}: ${bodyText.slice(0, 120)}`)
    this.name = 'CatalogError'
  }
}

// ── Adapters ────────────────────────────────────────────────────────────

type RawAlbum = {
  cb: number | string
  album: string
  artist_name?: string
  street_date?: string
  style?: number
  track_count?: number
  artists?: { id: number; name: string }[]
}

export function adaptAlbumRaw(r: RawAlbum): Album {
  const cb = String(r.cb)
  const artistName = r.artist_name ?? r.artists?.[0]?.name
  const artistId = r.artists?.[0]?.id
  return {
    cb,
    title: r.album,
    ...(artistName ? { artist: artistName } : {}),
    ...(artistId != null ? { artistId } : {}),
    ...(r.street_date ? { releaseDate: r.street_date } : {}),
    ...(r.style != null ? { styleId: r.style } : {}),
    ...(r.track_count != null ? { trackCount: r.track_count } : {}),
    coverCb: cb,
  }
}

type AliasedAlbum = {
  id: number | string
  title: string
  artist_name?: string
  release_date?: string
  style_id?: number
  track_count?: number
  artists?: { id: number; name: string }[]
}

export function adaptAlbumAliased(r: AliasedAlbum & { cb?: number | string; album?: string; street_date?: string; style?: number }): Album {
  // Tolerate both aliased (id/title/release_date/style_id) and raw
  // (cb/album/street_date/style) shapes — some upstream routes mix them.
  const cbRaw = r.id ?? r.cb ?? ''
  const cb = String(cbRaw)
  const title = r.title ?? r.album ?? ''
  return {
    cb,
    title,
    ...(() => {
      const a = r.artist_name ?? r.artists?.[0]?.name
      return a ? { artist: a } : {}
    })(),
    ...(r.artists?.[0]?.id != null ? { artistId: r.artists[0]!.id } : {}),
    ...(r.release_date || r.street_date ? { releaseDate: r.release_date ?? r.street_date } : {}),
    ...(r.style_id != null || r.style != null ? { styleId: r.style_id ?? r.style } : {}),
    ...(r.track_count != null ? { trackCount: r.track_count } : {}),
    coverCb: cb,
  }
}

type FlattenAlbumHit = { id: number | string; name: string; artist_name?: string }

export function adaptAlbumFlatten(r: FlattenAlbumHit): Album {
  const cb = String(r.id)
  return {
    cb,
    title: r.name,
    ...(r.artist_name ? { artist: r.artist_name } : {}),
    coverCb: cb,
  }
}

type RawTrack = {
  cb?: number | string
  id?: string
  num_disc?: number
  num_track?: number
  disc_number?: number
  track_number?: number
  track?: string
  title?: string
  timing: number
  artist_name?: string
  album?: string
  album_title?: string
}

export function adaptTrackRaw(r: RawTrack): Track {
  // Tolerate both raw (cb/num_disc/num_track/track) and aliased
  // (id/disc_number/track_number/title) — /albums/:cb/tracks upstream
  // varies per environment.
  let cb = r.cb != null ? String(r.cb) : ''
  let disc = r.num_disc ?? r.disc_number ?? 0
  let track = r.num_track ?? r.track_number ?? 0
  if (!cb && r.id) {
    const parts = r.id.split('_')
    cb = parts[0] ?? ''
    if (parts[1]) disc = Number(parts[1])
    if (parts[2]) track = Number(parts[2])
  }
  return {
    cb,
    disc,
    track,
    title: r.title ?? r.track ?? '',
    durationSec: r.timing ?? 0,
    ...(r.artist_name ? { artist: r.artist_name } : {}),
    ...(r.album_title || r.album ? { albumTitle: r.album_title ?? r.album } : {}),
  }
}

type AliasedTrack = {
  id: string
  disc_number: number
  track_number: number
  title: string
  timing: number
  artist_name?: string
  album_title?: string
}

export function adaptTrackAliased(r: AliasedTrack): Track {
  // id is `${cb}_${disc}_${track}`
  const [cbPart] = r.id.split('_')
  return {
    cb: cbPart ?? '',
    disc: r.disc_number,
    track: r.track_number,
    title: r.title,
    durationSec: r.timing,
    ...(r.artist_name ? { artist: r.artist_name } : {}),
    ...(r.album_title ? { albumTitle: r.album_title } : {}),
  }
}

export function adaptArtistAliased(r: { id: number; name: string; bio?: string; styles?: number[] }): Artist {
  return {
    id: r.id,
    name: r.name,
    ...(r.bio ? { bio: r.bio } : {}),
    ...(r.styles ? { styles: r.styles } : {}),
  }
}

// ── HTTP wrappers ──────────────────────────────────────────────────────

async function get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, location.origin)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const r = await fetch(url.toString(), { credentials: 'include' })
  if (!r.ok) throw new CatalogError(r.status, await r.text().catch(() => ''))
  return (await r.json()) as T
}

export const catalog = {
  topAlbums: async (opts?: { styleId?: number; limit?: number; offset?: number }): Promise<Album[]> => {
    const raw = await get<RawAlbum[]>('/api/catalog/albums/top', {
      style_id: opts?.styleId,
      limit: opts?.limit,
      offset: opts?.offset,
    })
    return raw.map(adaptAlbumRaw)
  },

  newsAlbums: async (opts?: { limit?: number; offset?: number }): Promise<Album[]> => {
    const raw = await get<RawAlbum[]>('/api/catalog/albums/news', {
      limit: opts?.limit,
      offset: opts?.offset,
    })
    return raw.map(adaptAlbumRaw)
  },

  styles: async (): Promise<Style[]> => get<Style[]>('/api/catalog/styles'),

  album: async (cb: string): Promise<{ album: Album; tracks: Track[] }> => {
    const [detailJson, tracksJson] = await Promise.all([
      get<{ album: AliasedAlbum; artists?: { id: number; name: string }[] }>(`/api/catalog/albums/${cb}`),
      get<RawTrack[]>(`/api/catalog/albums/${cb}/tracks`),
    ])
    const resolvedArtists = detailJson.album.artists ?? detailJson.artists
    const album = adaptAlbumAliased({ ...detailJson.album, ...(resolvedArtists != null ? { artists: resolvedArtists } : {}) })
    const tracks = tracksJson
      .map(adaptTrackRaw)
      .sort((a, b) => a.disc - b.disc || a.track - b.track)
    return { album, tracks }
  },

  artist: async (id: number): Promise<{
    artist: Artist
    albums: Album[]
    topTracks: Track[]
    similar: Artist[]
  }> => {
    const [a, alb, t, sim] = await Promise.all([
      get<{ id: number; name: string; bio?: string; styles?: number[] }>(`/api/catalog/artists/${id}`),
      get<RawAlbum[] | { albums: RawAlbum[] }>(`/api/catalog/artists/${id}/albums`, { limit: 24 }),
      get<RawTrack[] | { tracks: RawTrack[] }>(`/api/catalog/artists/${id}/tracks`, { limit: 10 }),
      get<{ id: number; name: string }[] | { artists: { id: number; name: string }[] }>(`/api/catalog/artists/${id}/similar`, { limit: 8 }),
    ])
    const albArr = Array.isArray(alb) ? alb : alb.albums ?? []
    const tArr = Array.isArray(t) ? t : t.tracks ?? []
    const simArr = Array.isArray(sim) ? sim : sim.artists ?? []
    return {
      artist: adaptArtistAliased(a),
      albums: albArr.map(adaptAlbumRaw),
      topTracks: tArr.map(adaptTrackRaw),
      similar: simArr.map((s) => ({ id: s.id, name: s.name })),
    }
  },

  stylePage: async (id: number, opts?: { limit?: number }): Promise<Album[]> => {
    const raw = await get<RawAlbum[]>('/api/catalog/albums/top', {
      style_id: id,
      limit: opts?.limit ?? 30,
    })
    return raw.map(adaptAlbumRaw)
  },

  searchGlobal: async (q: string): Promise<{
    albums: Album[]
    artists: Artist[]
    tracks: Track[]
  }> => {
    type GlobalRes = {
      hits?: Array<{ type: string; id: number | string; name?: string; artist_name?: string }>
    }
    const r = await get<GlobalRes>('/api/catalog/search/global', { q })
    const albums: Album[] = []
    const artists: Artist[] = []
    const tracks: Track[] = []
    for (const h of r.hits ?? []) {
      if (h.type === 'album') albums.push(adaptAlbumFlatten(h as FlattenAlbumHit))
      else if (h.type === 'artist') artists.push({ id: Number(h.id), name: h.name ?? '' })
      // tracks intentionally skipped — global hits don't contain disc/track ;
      // search/tracks endpoint can be added in a follow-up cycle.
    }
    return { albums, artists, tracks }
  },
}
