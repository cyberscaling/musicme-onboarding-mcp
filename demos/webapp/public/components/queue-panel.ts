/**
 * Slide-up queue panel. Drag-and-drop reorder via native HTML5 API
 * (desktop only — touch reorder deferred to RN demo). Click row body
 * to jump-to ; click ✕ to remove ; drag handle (⠿) is visual only,
 * the whole row is draggable for cross-browser reliability.
 */
import { coverUrl, placeholderDataUrl } from '../covers'
import { playlistStore } from '../playlist-store'
import type { TrackMeta } from '../playlist-store'

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ""
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function mountQueuePanel(root: HTMLElement): void {
  function closePanel(): void {
    root.classList.remove('open')
    root.hidden = true
    // Sync mini-bar queue button icon back to ≡
    const btn = document.querySelector<HTMLButtonElement>('button[data-action="queue"]')
    if (btn) btn.textContent = '≡'
  }

  function render(): void {
    const items = playlistStore.items
    const closeBtn = '<button data-action="close-queue" aria-label="close queue" style="position:absolute; top:12px; right:14px; background:none; border:0; color:#888; font-size:20px; cursor:pointer; padding:4px 8px;">✕</button>'
    if (items.length === 0) {
      root.innerHTML = `${closeBtn}<p class="muted" style="color:#666; text-align:center; margin-top:60px;">Queue is empty</p>`
      wireClose()
      return
    }
    const head = `${closeBtn}<h3 style="color:#eee; margin:0 0 10px; font-size:13px;">Queue · ${items.length} track${items.length === 1 ? '' : 's'}</h3>`
    const rows = items
      .map((item, idx) => {
        const meta = (item.meta as TrackMeta | undefined) ?? { title: '?' }
        const isCurr = idx === playlistStore.currentIndex
        const cover = meta.coverCb ? coverUrl(meta.coverCb, 90) : placeholderDataUrl()
        const subtitle = [meta.artist, meta.album].filter(Boolean).join(' · ')
        return `
          <div class="qrow ${isCurr ? 'curr' : ''}" draggable="true" data-id="${escapeHtml(item.id)}" data-idx="${idx}">
            <span class="drag" aria-hidden="true">⠿</span>
            <img class="cv" src="${cover}" loading="lazy" alt="">
            <span class="t">${isCurr ? '▶ ' : ''}${escapeHtml(meta.title)}${subtitle ? ` <span style="color:#777">— ${escapeHtml(subtitle)}</span>` : ''}</span>
            <span class="x" data-action="remove" role="button" aria-label="remove">✕</span>
          </div>
        `
      })
      .join('')
    root.innerHTML = `${head}<div class="queue-list">${rows}</div>`
    wire()
    wireClose()
  }

  function wireClose(): void {
    root.querySelector<HTMLButtonElement>('button[data-action="close-queue"]')?.addEventListener('click', closePanel)
  }

  // ESC closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('open')) closePanel()
  })

  function wire(): void {
    root.querySelectorAll<HTMLImageElement>('.qrow img.cv').forEach((img) => {
      img.addEventListener('error', () => {
        img.src = placeholderDataUrl()
      })
    })
    root.querySelectorAll<HTMLElement>('.qrow').forEach((row) => {
      const id = row.dataset.id!
      const idx = Number(row.dataset.idx)

      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement
        if (target.dataset.action === 'remove') {
          playlistStore.remove(id)
          return
        }
        if (target.classList.contains('drag')) return
        playlistStore.playQueueAt(id)
      })

      row.addEventListener('dragstart', (e) => {
        e.dataTransfer!.setData('text/plain', id)
        e.dataTransfer!.effectAllowed = 'move'
        row.classList.add('dragging')
      })
      row.addEventListener('dragend', () => row.classList.remove('dragging'))
      row.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer!.dropEffect = 'move'
        row.classList.add('drag-over')
      })
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'))
      row.addEventListener('drop', (e) => {
        e.preventDefault()
        row.classList.remove('drag-over')
        const draggedId = e.dataTransfer!.getData('text/plain')
        if (!draggedId || draggedId === id) return
        playlistStore.move(draggedId, idx)
      })
    })
  }

  playlistStore.onChange(render)
  render()
}
