/**
 * Reusable album grid card. Click navigates to /album/:cb.
 * Artist row : tiny round avatar + name, clickable to /artist/:id.
 */
import type { Album } from '../catalog'
import { artistAvatarUrl, coverUrl, placeholderDataUrl } from '../covers'
import { navigate } from '../router'

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function renderAlbumCard(album: Album): HTMLElement {
  const card = document.createElement('div')
  card.className = 'album-card'
  const avatarHtml = album.artistId != null
    ? `<img class="av" src="${artistAvatarUrl(album.artistId, 80)}" loading="lazy" alt="">`
    : ''
  card.innerHTML = `
    <img class="cv" src="${coverUrl(album.coverCb, 175)}" loading="lazy" alt="">
    <div class="t">${escapeHtml(album.title)}</div>
    <div class="a-row">${avatarHtml}<span class="a">${escapeHtml(album.artist ?? '')}</span></div>
  `
  const cover = card.querySelector<HTMLImageElement>('img.cv')!
  cover.addEventListener('error', () => {
    cover.src = placeholderDataUrl()
  })
  const av = card.querySelector<HTMLImageElement>('img.av')
  if (av) {
    av.addEventListener('error', () => {
      av.style.display = 'none'
    })
  }
  // Click anywhere on card → album page, except artist name → artist page
  card.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (album.artistId != null && (target.classList.contains('a') || target === av)) {
      e.stopPropagation()
      navigate(`/artist/${album.artistId}`)
      return
    }
    navigate(`/album/${album.cb}`)
  })
  return card
}
