/**
 * On-demand AI artist bio. Mode toggle (fast/deep) + Generate button, an
 * animated phase stepper while the request runs, then the bio plus the REAL
 * per-phase timing and exact cost (LLM + Serper) returned by the worker.
 */
import { ApiError, api, type BioMode, type BioResult } from '../api'

const STEP_LABELS: Record<BioMode, Array<{ key: string; label: string }>> = {
  fast: [
    { key: 'resolve', label: 'Résolution page Wikipédia' },
    { key: 'wikipedia', label: 'Extraction Wikipédia' },
    { key: 'hash', label: 'Hash extraction' },
    { key: 'analyze', label: 'Analyse LLM (sections + champs)' },
  ],
  deep: [
    { key: 'resolve', label: 'Résolution page Wikipédia' },
    { key: 'wikipedia', label: 'Extraction Wikipédia' },
    { key: 'hash', label: 'Hash extraction' },
    { key: 'select', label: 'Sélection sections (LLM)' },
    { key: 'generate', label: 'Rédaction bio (LLM)' },
  ],
}

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ''
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** Minimal markdown → HTML: `## ` headings and blank-line paragraphs. */
function renderMarkdown(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim()
      if (!t) return ''
      if (t.startsWith('## '))
        return `<h4 style="color:#eee;margin:14px 0 4px;">${escapeHtml(t.slice(3))}</h4>`
      return `<p style="color:#cbcbcb;margin:0 0 8px;line-height:1.5;">${escapeHtml(t)}</p>`
    })
    .join('')
}

function chips(items: string[]): string {
  if (!items.length) return '<span style="color:#666;">—</span>'
  return items
    .map((i) => `<span class="style-chip" style="cursor:default;">${escapeHtml(i)}</span>`)
    .join(' ')
}

const fmtUsd = (n: number) => `$${n.toFixed(5)}`

/** Build the stepper rows for a mode; returns the container + a per-key updater. */
function buildStepper(mode: BioMode): {
  el: HTMLElement
  setState: (key: string, state: 'active' | 'done', ms?: number) => void
} {
  const el = document.createElement('div')
  el.style.cssText = 'margin-top:12px;'
  const rows = new Map<string, HTMLElement>()
  for (const { key, label } of STEP_LABELS[mode]) {
    const row = document.createElement('div')
    row.style.cssText =
      'display:flex;align-items:center;gap:8px;color:#888;font-size:13px;padding:3px 0;'
    row.innerHTML = `<span data-icon style="width:14px;display:inline-block;">○</span><span data-label>${label}</span><span data-ms style="margin-left:auto;color:#777;font-variant-numeric:tabular-nums;"></span>`
    rows.set(key, row)
    el.appendChild(row)
  }
  const setState = (key: string, state: 'active' | 'done', ms?: number) => {
    const row = rows.get(key)
    if (!row) return
    const icon = row.querySelector<HTMLElement>('[data-icon]')!
    if (state === 'active') {
      icon.textContent = '⠋'
      row.style.color = '#ddd'
    } else {
      icon.textContent = '✓'
      icon.style.color = '#5ad17a'
      row.style.color = '#bbb'
      if (ms != null) row.querySelector<HTMLElement>('[data-ms]')!.textContent = `${ms} ms`
    }
  }
  return { el, setState }
}

function renderMetrics(r: BioResult): string {
  const m = r.metrics
  if (m.cached) {
    return `<div style="margin-top:14px;color:#888;font-size:13px;">⚡ Servi depuis le cache (coût $0, instantané) — outcome: <code>${r.outcome}</code></div>`
  }
  const phaseRows = m.phases
    .map(
      (p) =>
        `<tr><td style="padding:2px 14px 2px 0;color:#aaa;">${escapeHtml(p.name)}</td><td style="text-align:right;color:#ddd;font-variant-numeric:tabular-nums;">${p.ms} ms</td></tr>`,
    )
    .join('')
  return `
    <div style="margin-top:16px;display:flex;gap:32px;flex-wrap:wrap;font-size:13px;">
      <div>
        <div style="color:#777;text-transform:uppercase;letter-spacing:1px;font-size:11px;margin-bottom:4px;">Temps par phase</div>
        <table style="border-collapse:collapse;">${phaseRows}
          <tr><td style="padding-top:6px;color:#eee;font-weight:600;">total</td><td style="text-align:right;padding-top:6px;color:#eee;font-weight:600;font-variant-numeric:tabular-nums;">${m.totalMs} ms</td></tr>
        </table>
      </div>
      <div>
        <div style="color:#777;text-transform:uppercase;letter-spacing:1px;font-size:11px;margin-bottom:4px;">Coût</div>
        <table style="border-collapse:collapse;">
          <tr><td style="padding:2px 14px 2px 0;color:#aaa;">LLM (${m.llm.calls} appels, ${m.llm.promptTokens}p+${m.llm.completionTokens}c)</td><td style="text-align:right;color:#ddd;">${fmtUsd(m.llm.costUsd)}</td></tr>
          <tr><td style="padding:2px 14px 2px 0;color:#aaa;">Serper (${m.serper.queries} req × ${fmtUsd(m.serper.unitUsd)})</td><td style="text-align:right;color:#ddd;">${fmtUsd(m.serper.costUsd)}</td></tr>
          <tr><td style="padding-top:6px;color:#eee;font-weight:600;">total</td><td style="text-align:right;padding-top:6px;color:#eee;font-weight:600;">${fmtUsd(m.totalCostUsd)}</td></tr>
        </table>
      </div>
    </div>`
}

function renderBio(r: BioResult): string {
  const b = r.bio
  return `
    <div style="margin-top:16px;">
      <p style="color:#ddd;font-style:italic;margin:0 0 12px;line-height:1.5;">${escapeHtml(b.summary)}</p>
      ${b.highlights.length ? `<ul style="color:#cbcbcb;margin:0 0 12px;padding-left:18px;line-height:1.5;">${b.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>` : ''}
      <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:13px;margin-bottom:12px;">
        <div><span style="color:#777;">Genres :</span> ${chips(b.genres)}</div>
        <div><span style="color:#777;">Origine :</span> <span style="color:#ddd;">${escapeHtml(b.origin) || '—'}</span></div>
        <div><span style="color:#777;">Actif :</span> <span style="color:#ddd;">${escapeHtml(b.years_active) || '—'}</span></div>
      </div>
      <div style="font-size:13px;margin-bottom:12px;"><span style="color:#777;">Œuvres notables :</span> ${chips(b.notable_works)}</div>
      <details style="margin-top:8px;"><summary style="color:#888;cursor:pointer;font-size:13px;">Bio complète</summary><div style="margin-top:8px;">${renderMarkdown(b.bio_markdown)}</div></details>
      <div style="margin-top:10px;font-size:12px;color:#666;">Source : <a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener" style="color:#7aa2ff;">${escapeHtml(r.sourceUrl)}</a></div>
    </div>`
}

export function renderBioPanel(artistId: number, artistName: string): HTMLElement {
  const panel = document.createElement('div')
  panel.style.cssText =
    'margin-top:24px;padding:16px;border:1px solid #2a2a2a;border-radius:10px;background:#161616;'
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <strong style="color:#eee;">Bio IA</strong>
      <div data-modes style="display:inline-flex;border:1px solid #333;border-radius:6px;overflow:hidden;">
        <button data-mode="fast" style="background:#2a2a2a;color:#eee;border:none;padding:5px 12px;cursor:pointer;font-size:12px;">Fast</button>
        <button data-mode="deep" style="background:transparent;color:#999;border:none;padding:5px 12px;cursor:pointer;font-size:12px;">Deep</button>
      </div>
      <button data-gen style="margin-left:auto;background:#3b5bdb;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">Générer</button>
    </div>
    <div data-body></div>
  `

  let mode: BioMode = 'fast'
  const modeBtns = panel.querySelectorAll<HTMLButtonElement>('[data-mode]')
  const genBtn = panel.querySelector<HTMLButtonElement>('[data-gen]')!
  const body = panel.querySelector<HTMLElement>('[data-body]')!

  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode as BioMode
      for (const b of modeBtns) {
        const active = b === btn
        b.style.background = active ? '#2a2a2a' : 'transparent'
        b.style.color = active ? '#eee' : '#999'
      }
    })
  }

  genBtn.addEventListener('click', () => {
    void run()
  })

  async function run(): Promise<void> {
    genBtn.disabled = true
    genBtn.style.opacity = '0.6'
    body.innerHTML = ''
    const { el: stepper, setState } = buildStepper(mode)
    body.appendChild(stepper)

    // Cosmetic forward progress: walk steps on a timer so the user sees motion.
    // Real per-phase timings replace this on completion. The last step keeps
    // spinning until the response lands.
    const steps = STEP_LABELS[mode]
    let cursor = 0
    setState(steps[0]!.key, 'active')
    const ticker = window.setInterval(() => {
      if (cursor < steps.length - 1) {
        setState(steps[cursor]!.key, 'done')
        cursor++
        setState(steps[cursor]!.key, 'active')
      }
    }, 900)

    try {
      const result = await api.artistBio(artistId, artistName, mode)
      window.clearInterval(ticker)
      // Mark steps done with real timings (where present).
      for (const { key } of steps) {
        const ph = result.metrics.phases.find((p) => p.name === key)
        setState(key, 'done', ph?.ms)
      }
      body.innerHTML = renderMetrics(result) + renderBio(result)
    } catch (e) {
      window.clearInterval(ticker)
      const msg = e instanceof ApiError ? e.code : (e as Error).message
      body.innerHTML = `<p style="color:#ff6666;margin-top:12px;">Échec de la génération (${escapeHtml(msg)}).</p>`
    } finally {
      genBtn.disabled = false
      genBtn.style.opacity = '1'
    }
  }

  return panel
}
