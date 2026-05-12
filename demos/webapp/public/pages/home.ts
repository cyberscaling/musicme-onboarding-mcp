/**
 * Discovery landing — top albums, new releases, style chips.
 */
import { catalog } from '../catalog'
import { renderAlbumCard } from '../components/album-card'
import { navigate } from '../router'

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ""
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function homePage(root: HTMLElement): void {
  root.innerHTML = `
    <div class="page-padding">
      <h2 style="color:#eee; font-size:13px; letter-spacing:1px; margin:0 0 10px;">TOP ALBUMS</h2>
      <div class="grid" id="home-top"></div>
      <h2 style="color:#eee; font-size:13px; letter-spacing:1px; margin:28px 0 10px;">NEW RELEASES</h2>
      <div class="grid" id="home-news"></div>
      <h2 style="color:#eee; font-size:13px; letter-spacing:1px; margin:28px 0 10px;">STYLES</h2>
      <div id="home-styles" style="display:flex; flex-wrap:wrap; gap:4px;"></div>
    </div>
  `

  const topEl = root.querySelector<HTMLElement>('#home-top')!
  const newsEl = root.querySelector<HTMLElement>('#home-news')!
  const stylesEl = root.querySelector<HTMLElement>('#home-styles')!

  void (async () => {
    try {
      const top = await catalog.topAlbums({ limit: 12 })
      topEl.innerHTML = ''
      for (const a of top) topEl.appendChild(renderAlbumCard(a))
    } catch {
      topEl.innerHTML = '<p style="color:#888">Couldn\'t load top albums.</p>'
    }
  })()
  void (async () => {
    try {
      const news = await catalog.newsAlbums({ limit: 8 })
      newsEl.innerHTML = ''
      for (const a of news) newsEl.appendChild(renderAlbumCard(a))
    } catch {
      newsEl.innerHTML = '<p style="color:#888">Couldn\'t load new releases.</p>'
    }
  })()
  void (async () => {
    try {
      const styles = await catalog.styles()
      stylesEl.innerHTML = ''
      for (const s of styles) {
        const chip = document.createElement('span')
        chip.className = 'style-chip'
        chip.textContent = s.name
        chip.addEventListener('click', () => navigate(`/style/${s.id}`))
        stylesEl.appendChild(chip)
      }
    } catch {
      stylesEl.innerHTML = '<p style="color:#888">Couldn\'t load styles.</p>'
    }
  })()
}
