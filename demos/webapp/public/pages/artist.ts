/**
 * Artist detail : bio + albums grid + top tracks + similar artists.
 */
import { catalog } from '../catalog'
import { renderAlbumCard } from '../components/album-card'
import { renderBioPanel } from '../components/bio-panel'
import { renderTrackRow } from '../components/track-row'
import { navigate } from '../router'

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ''
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export function artistPage(root: HTMLElement, id: number): void {
  root.innerHTML = `
    <div class="page-padding">
      <div id="artist-header"><p style="color:#888">Loading…</p></div>
      <h2 style="color:#eee; font-size:13px; letter-spacing:1px; margin:28px 0 10px;">ALBUMS</h2>
      <div class="grid" id="artist-albums"></div>
      <h2 style="color:#eee; font-size:13px; letter-spacing:1px; margin:28px 0 10px;">TOP TRACKS</h2>
      <div id="artist-tracks"></div>
      <h2 style="color:#eee; font-size:13px; letter-spacing:1px; margin:28px 0 10px;">SIMILAR ARTISTS</h2>
      <div id="artist-similar" style="display:flex; flex-wrap:wrap; gap:4px;"></div>
    </div>
  `

  void (async () => {
    try {
      const data = await catalog.artist(id)
      const header = root.querySelector<HTMLElement>('#artist-header')!
      header.innerHTML = `
        <h1 style="color:#eee; margin:0;">${escapeHtml(data.artist.name)}</h1>
        ${data.artist.bio ? `<p style="color:#bbb; margin-top:8px;">${escapeHtml(data.artist.bio)}</p>` : ''}
      `
      header.appendChild(renderBioPanel(id, data.artist.name))

      const albumsEl = root.querySelector<HTMLElement>('#artist-albums')!
      for (const a of data.albums) albumsEl.appendChild(renderAlbumCard(a))

      const tracksEl = root.querySelector<HTMLElement>('#artist-tracks')!
      for (const t of data.topTracks) {
        tracksEl.appendChild(
          renderTrackRow(t, {
            context: data.topTracks,
            defaults: { artist: data.artist.name },
          }),
        )
      }

      const similarEl = root.querySelector<HTMLElement>('#artist-similar')!
      for (const s of data.similar) {
        const chip = document.createElement('span')
        chip.className = 'style-chip'
        chip.textContent = s.name
        chip.addEventListener('click', () => navigate(`/artist/${s.id}`))
        similarEl.appendChild(chip)
      }
    } catch (e) {
      root.innerHTML = `<div class="page-padding"><p style="color:#ff6666">Couldn't load artist (${escapeHtml((e as Error).message)}).</p></div>`
    }
  })()
}
