import type { Me } from '../api'
import { appLayout, el } from '../components/layout'
import { navigate } from '../router'

export function searchPage(root: HTMLElement, me: Me): void {
  const content = el('div')
  content.innerHTML = `
    <div class="title">recherche d'un album</div>
    <div class="block">
      <div class="block-header"><span class="label">code-barre EAN-13 / long integer</span></div>
      <div class="row" style="gap:8px;align-items:flex-end">
        <input id="cb" type="text" placeholder="ex: 5400863209100" inputmode="numeric" style="flex:1" />
        <button id="go" class="primary" type="button">chercher</button>
      </div>
      <div id="status" class="muted" style="font-family:var(--mono);font-size:11px;margin-top:8px"></div>
    </div>

    <div id="result" class="block"></div>
  `
  root.appendChild(appLayout(content, { me, active: 'search' }))

  const cbEl = content.querySelector<HTMLInputElement>('#cb')!
  const goBtn = content.querySelector<HTMLButtonElement>('#go')!
  const statusEl = content.querySelector<HTMLDivElement>('#status')!

  // Restore last cb
  const last = sessionStorage.getItem('demo:last-cb') ?? '5400863209100'
  cbEl.value = last

  async function doSearch(): Promise<void> {
    const cb = cbEl.value.trim()
    if (!/^\d{8,18}$/.test(cb)) {
      statusEl.textContent = 'cb invalide (digits, 8-18 chiffres)'
      return
    }
    sessionStorage.setItem('demo:last-cb', cb)
    statusEl.textContent = ''
    // Navigate directly to album page — it fetches its own data via catalog.ts
    navigate(`/album/${cb}`)
  }

  goBtn.addEventListener('click', () => void doSearch())
  cbEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doSearch()
  })
}
