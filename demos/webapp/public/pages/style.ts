/**
 * Style detail : grid of top albums filtered by style_id.
 */
import { catalog } from '../catalog'
import { renderAlbumCard } from '../components/album-card'

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ""
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function stylePage(root: HTMLElement, id: number): void {
  root.innerHTML = `
    <div class="page-padding">
      <h1 style="color:#eee; margin:0 0 14px;" id="style-title">Style</h1>
      <div class="grid" id="style-albums"></div>
    </div>
  `

  void (async () => {
    try {
      const [styles, albums] = await Promise.all([catalog.styles(), catalog.stylePage(id, { limit: 30 })])
      const name = styles.find((s) => s.id === id)?.name ?? `Style #${id}`
      root.querySelector<HTMLElement>('#style-title')!.textContent = name
      const grid = root.querySelector<HTMLElement>('#style-albums')!
      for (const a of albums) grid.appendChild(renderAlbumCard(a))
    } catch (e) {
      root.innerHTML = `<div class="page-padding"><p style="color:#ff6666">Couldn't load style (${escapeHtml((e as Error).message)}).</p></div>`
    }
  })()
}
