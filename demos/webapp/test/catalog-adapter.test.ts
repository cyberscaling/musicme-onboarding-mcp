import { describe, expect, it, vi } from 'vitest'
import { adaptAlbumAliased, adaptAlbumFlatten, adaptAlbumRaw, adaptArtistAliased, adaptTrackAliased, adaptTrackRaw, catalog } from '../public/catalog'

describe('catalog adapters', () => {
  it('adaptAlbumRaw maps raw response', () => {
    const raw = {
      cb: 5400863209100,
      album: 'Renaissance',
      artist_name: 'Beyoncé',
      street_date: '2026-04-12',
      style: 2,
      track_count: 16,
    }
    expect(adaptAlbumRaw(raw)).toEqual({
      cb: '5400863209100',
      title: 'Renaissance',
      artist: 'Beyoncé',
      releaseDate: '2026-04-12',
      styleId: 2,
      trackCount: 16,
      coverCb: '5400863209100',
    })
  })

  it('adaptAlbumAliased maps aliased sub-object', () => {
    const aliased = {
      id: '5400863209100',
      title: 'Renaissance',
      artist_name: 'Beyoncé',
      release_date: '2026-04-12',
      style_id: 2,
      track_count: 16,
    }
    expect(adaptAlbumAliased(aliased)).toEqual({
      cb: '5400863209100',
      title: 'Renaissance',
      artist: 'Beyoncé',
      releaseDate: '2026-04-12',
      styleId: 2,
      trackCount: 16,
      coverCb: '5400863209100',
    })
  })

  it('adaptAlbumFlatten maps search-global album hit', () => {
    const hit = {
      id: '5400863209100',
      name: 'Renaissance',
      artist_name: 'Beyoncé',
    }
    expect(adaptAlbumFlatten(hit).cb).toBe('5400863209100')
    expect(adaptAlbumFlatten(hit).title).toBe('Renaissance')
    expect(adaptAlbumFlatten(hit).artist).toBe('Beyoncé')
  })

  it('adaptTrackRaw splits composite track id into disc / track', () => {
    const raw = {
      cb: 5400863209100,
      num_disc: 1,
      num_track: 3,
      track: 'Midnight',
      timing: 234,
    }
    expect(adaptTrackRaw(raw)).toEqual({
      cb: '5400863209100',
      disc: 1,
      track: 3,
      title: 'Midnight',
      durationSec: 234,
    })
  })

  it('adaptTrackAliased uses disc_number / track_number / title', () => {
    const aliased = { id: '5400863209100_1_3', disc_number: 1, track_number: 3, title: 'Midnight', timing: 234 }
    expect(adaptTrackAliased(aliased)).toEqual({
      cb: '5400863209100',
      disc: 1,
      track: 3,
      title: 'Midnight',
      durationSec: 234,
    })
  })

  it('adaptArtistAliased maps artist detail', () => {
    expect(adaptArtistAliased({ id: 42, name: 'Beyoncé' })).toEqual({ id: 42, name: 'Beyoncé' })
  })
})

describe('catalog HTTP wrappers', () => {
  it('topAlbums GETs /api/catalog/albums/top with style_id + limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ cb: 1, album: 'X' }]), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await catalog.topAlbums({ styleId: 2, limit: 5 })
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('/api/catalog/albums/top')
    expect(url).toContain('style_id=2')
    expect(url).toContain('limit=5')
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('X')
    vi.unstubAllGlobals()
  })

  it('album GETs detail + tracks in parallel and zips them', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/api/catalog/albums/5400863209100')) {
        return new Response(JSON.stringify({ album: { id: '5400863209100', title: 'X', release_date: '2026-04-12', track_count: 1, artists: [{ id: 42, name: 'Beyoncé' }] } }), { status: 200 })
      }
      if (u.endsWith('/api/catalog/albums/5400863209100/tracks')) {
        return new Response(JSON.stringify([{ cb: 5400863209100, num_disc: 1, num_track: 1, track: 'T1', timing: 200 }]), { status: 200 })
      }
      throw new Error(`unexpected fetch ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await catalog.album('5400863209100')
    expect(out.album.title).toBe('X')
    expect(out.tracks).toHaveLength(1)
    expect(out.tracks[0]!.title).toBe('T1')
    vi.unstubAllGlobals()
  })

  it('throws CatalogError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })))
    await expect(catalog.styles()).rejects.toThrow(/503/)
    vi.unstubAllGlobals()
  })
})
