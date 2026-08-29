/**
 * Album detail : cover + title + artist link + "Play all" + track list.
 */
import { catalog, type Track } from '../catalog'
import { renderTrackRow } from '../components/track-row'
import { coverUrl, placeholderDataUrl } from '../covers'
import { playlistStore, type TrackMeta } from '../playlist-store'
import { navigate } from '../router'
import type { Me } from '../api'

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function albumPage(root: HTMLElement, _me: Me, cb: string): void {
  root.innerHTML = `<div class="page-padding"><p style="color:#888">Loading…</p></div>`

  void (async () => {
    try {
      const { album, tracks } = await catalog.album(cb)
      root.innerHTML = `
        <div class="page-padding">
          <div style="display:flex; gap:16px; margin-bottom:18px;">
            <img class="cv" src="${coverUrl(album.coverCb, 295)}" loading="lazy" alt="" style="width:120px; height:120px; border-radius:4px; object-fit:cover; background:#2a2a2a;">
            <div>
              <h1 style="color:#eee; margin:0; font-size:20px;">${escapeHtml(album.title)}</h1>
              <p style="color:#bbb; margin:4px 0 0;" id="album-artist">${escapeHtml(album.artist ?? '')}</p>
              <p style="color:#777; margin:4px 0 0; font-size:12px;">${escapeHtml(album.releaseDate ?? '')} · ${album.trackCount ?? tracks.length} tracks</p>
              <button id="album-play-all" style="margin-top:10px; background:#2a4a2a; color:#eee; border:0; padding:6px 12px; font-size:12px; border-radius:3px; cursor:pointer;">▶ Play all</button>
            </div>
          </div>
          <div id="album-tracks"></div>
        </div>
      `

      const cover = root.querySelector<HTMLImageElement>('img.cv')!
      cover.addEventListener('error', () => {
        cover.src = placeholderDataUrl()
      })

      if (album.artistId != null) {
        const artistEl = root.querySelector<HTMLElement>('#album-artist')!
        artistEl.style.cursor = 'pointer'
        artistEl.style.textDecoration = 'underline'
        artistEl.addEventListener('click', () => navigate(`/artist/${album.artistId}`))
      }

      const tracksEl = root.querySelector<HTMLElement>('#album-tracks')!
      const discs = new Set(tracks.map((t) => t.disc))
      const multiDisc = discs.size > 1
      let currentDisc: number | null = null
      for (const t of tracks) {
        if (multiDisc && t.disc !== currentDisc) {
          currentDisc = t.disc
          const head = document.createElement('div')
          head.className = 'disc-head'
          head.textContent = `Disc ${t.disc}`
          tracksEl.appendChild(head)
        }
        tracksEl.appendChild(
          renderTrackRow(t, {
            context: tracks,
            variant: 'numbered',
            multiDisc,
            defaults: {
              album: album.title,
              coverCb: album.coverCb,
              ...(album.artist !== undefined ? { artist: album.artist } : {}),
            },
          }),
        )
      }

      root.querySelector<HTMLButtonElement>('#album-play-all')!.addEventListener('click', () => {
        const items = tracks.map((t: Track) => {
          const meta: TrackMeta = { title: t.title, album: album.title, coverCb: album.coverCb }
          if (album.artist !== undefined) meta.artist = album.artist
          return { ref: { cb: Number(t.cb), disc: t.disc, track: t.track, context: 'on_demand' as const }, meta }
        })
        playlistStore.playFromStart(items)
      })
    } catch (e) {
      root.innerHTML = `<div class="page-padding"><p style="color:#ff6666">Couldn't load album (${escapeHtml((e as Error).message)}).</p></div>`
    }
  })()
}
