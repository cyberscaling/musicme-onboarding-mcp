/**
 * Interactive explanation of the partner ↔ stream-worker authentication flow.
 *
 * Each step:
 *  - hits a real endpoint (or stages a real call) and prints the actual artefact
 *  - drives an animated SVG sequence diagram so the reader sees which messages
 *    travel where
 *
 * The diagram has three lifelines: Browser (SPA), Demo Worker (the partner),
 * Stream Worker. Each step activates one or two `.msg` arrow groups. Active
 * arrows pulse; once the step's API call returns OK they switch to "done"
 * (green, static).
 */
import { ApiError, api, type AppConfig, type Me } from '../api'
import { appLayout, el, escape } from '../components/layout'
import { navigate } from '../router'

function decodeB64Url(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  return atob(b64)
}

function tryParseJwt(token: string): { header: unknown; payload: unknown } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return {
      header: JSON.parse(decodeB64Url(parts[0]!)),
      payload: JSON.parse(decodeB64Url(parts[1]!)),
    }
  } catch {
    return null
  }
}

/**
 * Sequence-diagram coordinates. The 3 actor lifelines sit at fixed X
 * positions; each step's messages are stacked vertically.
 */
const X_BROWSER = 100
const X_PARTNER = 380
const X_STREAM = 660
const Y_TOP = 60
const SVG_W = 760
const SVG_H = 560

function actor(x: number, label: string, sub: string, partner = false): string {
  return `
    <g transform="translate(${x - 80}, 20)">
      <rect class="actor-box${partner ? ' partner' : ''}" x="0" y="0" width="160" height="32" rx="4" />
      <text class="actor-label" x="80" y="14" text-anchor="middle">${label}</text>
      <text class="actor-sub" x="80" y="26" text-anchor="middle">${sub}</text>
    </g>
  `
}

/**
 * One arrow + label. `dir`: "down" (req) or "up" (res). `from`/`to` are X
 * coords of the origin/destination lifelines. `y` is vertical position on
 * the lifeline. `dataStep` ties the message to a step number.
 */
function msg(opts: {
  step: number
  y: number
  from: number
  to: number
  label: string
  id: string
}): string {
  const { step, y, from, to, label, id } = opts
  const arrowSize = 6
  const dir = to > from ? 1 : -1
  const arrowX = to - dir * arrowSize
  const arrowPoints = `${to},${y} ${arrowX},${y - arrowSize / 2} ${arrowX},${y + arrowSize / 2}`
  const midX = (from + to) / 2
  return `
    <g class="msg" data-step="${step}" data-id="${id}">
      <line class="msg-line" x1="${from}" y1="${y}" x2="${to}" y2="${y}" />
      <polygon class="msg-arrow" points="${arrowPoints}" />
      <text class="msg-label" x="${midX}" y="${y - 6}">${label}</text>
    </g>
  `
}

function buildDiagram(): string {
  const stepRows: { step: number; y: number; from: number; to: number; label: string; id: string }[] = [
    // Step 1: config
    { step: 1, y: Y_TOP + 30, from: X_BROWSER, to: X_PARTNER, label: 'GET /api/config', id: '1.req' },
    { step: 1, y: Y_TOP + 60, from: X_PARTNER, to: X_BROWSER, label: 'streamWorkerUrl, partnerId', id: '1.res' },
    // Step 2: jwks
    { step: 2, y: Y_TOP + 110, from: X_BROWSER, to: X_PARTNER, label: 'GET /.well-known/jwks.json', id: '2.req' },
    { step: 2, y: Y_TOP + 140, from: X_PARTNER, to: X_BROWSER, label: 'public JWK { kid, n, e }', id: '2.res' },
    // Step 3: mint
    { step: 3, y: Y_TOP + 190, from: X_BROWSER, to: X_PARTNER, label: 'POST /api/jwt (cookie auth)', id: '3.req' },
    { step: 3, y: Y_TOP + 220, from: X_PARTNER, to: X_BROWSER, label: 'JWT RS256 (iss, aud, sub, exp)', id: '3.res' },
    // Step 4: init-stream + JWKS fetch
    { step: 4, y: Y_TOP + 270, from: X_BROWSER, to: X_STREAM, label: 'POST /init-stream + Bearer JWT', id: '4.req' },
    { step: 4, y: Y_TOP + 300, from: X_STREAM, to: X_PARTNER, label: 'fetch JWKS (cached 1h)', id: '4.jwks-req' },
    { step: 4, y: Y_TOP + 330, from: X_PARTNER, to: X_STREAM, label: 'public JWK', id: '4.jwks-res' },
    { step: 4, y: Y_TOP + 360, from: X_STREAM, to: X_BROWSER, label: 'sessionId, fileSize, streamUrl, keyUrl', id: '4.res' },
    // Step 5: tampered
    { step: 5, y: Y_TOP + 410, from: X_BROWSER, to: X_STREAM, label: 'POST /init-stream + tampered JWT', id: '5.req' },
    { step: 5, y: Y_TOP + 440, from: X_STREAM, to: X_BROWSER, label: '401 invalid_token', id: '5.res' },
  ]
  return `
    <svg viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg">
      ${actor(X_BROWSER, 'Browser', 'SPA + cookie session')}
      ${actor(X_PARTNER, 'Demo Worker', 'partner = "demo"', true)}
      ${actor(X_STREAM, 'Stream Worker', 'verifyJwt + sessions')}

      <line class="lifeline" x1="${X_BROWSER}" y1="55" x2="${X_BROWSER}" y2="${SVG_H - 20}" />
      <line class="lifeline" x1="${X_PARTNER}" y1="55" x2="${X_PARTNER}" y2="${SVG_H - 20}" />
      <line class="lifeline" x1="${X_STREAM}" y1="55" x2="${X_STREAM}" y2="${SVG_H - 20}" />

      ${stepRows.map((r) => msg(r)).join('')}
    </svg>
  `
}

function setStepState(svg: SVGElement, step: number, state: 'active' | 'done' | 'idle'): void {
  for (const el of svg.querySelectorAll<SVGGElement>(`.msg[data-step="${step}"]`)) {
    el.classList.remove('active', 'done')
    if (state !== 'idle') el.classList.add(state)
  }
}

export function explainPage(root: HTMLElement, me: Me): void {
  const content = el('div')
  content.innerHTML = `
    <div class="title">comment ça marche — partner federation auth</div>
    <p class="muted" style="margin:0 0 24px">
      Le démo est un <strong>partner</strong> au sens du worker stream. Il signe ses JWT en RS256
      avec une clé privée qu'il garde, et publie sa clé publique sur un endpoint
      <span class="kbd">/.well-known/jwks.json</span>. Le worker stream récupère cette clé via
      l'<span class="kbd">iss</span> du JWT, vérifie la signature, et autorise la session.
      Lance les étapes ci-dessous dans l'ordre — chaque clic anime les messages correspondants
      sur le diagramme.
    </p>

    <div class="seq-diagram" id="diagram">
      <div class="seq-controls">
        <button class="play-pause" id="seq-toggle" type="button">⏸ pause</button>
        <span class="step-badge" id="seq-badge">étape 1/5</span>
        <span class="step-title" id="seq-title">…</span>
        <div class="progress-track"><div class="progress-fill" id="seq-progress"></div></div>
      </div>
      ${buildDiagram()}
    </div>

    <div class="steps" id="steps"></div>
  `
  root.appendChild(appLayout(content, { me, active: 'explain' }))

  const stepsEl = content.querySelector<HTMLDivElement>('#steps')!
  const svgEl = content.querySelector<SVGElement>('#diagram svg')!
  const toggleBtn = content.querySelector<HTMLButtonElement>('#seq-toggle')!
  const badgeEl = content.querySelector<HTMLSpanElement>('#seq-badge')!
  const titleEl = content.querySelector<HTMLSpanElement>('#seq-title')!
  const progressEl = content.querySelector<HTMLDivElement>('#seq-progress')!

  // ── auto-loop animation driver ─────────────────────────────────────────
  // Each step lights up its arrows, holds for STEP_HOLD_MS, marks them done,
  // moves on. After step 5, brief pause, reset everything, restart at 1.
  // Pause button freezes the cycle in place; resume continues from same step.
  const STEP_TITLES = [
    'Configuration du démo',
    'Publication de la clé publique (JWKS)',
    'Frappe d\'un JWT pour l\'utilisateur',
    'Vérification + session de streaming',
    'Test négatif (signature invalide)',
  ]
  const STEPS = STEP_TITLES.length
  const STEP_HOLD_MS = 3500
  const RESET_PAUSE_MS = 1500

  let loopStep = 1
  let loopElapsed = 0
  let loopIsPlaying = true
  let lastTick = performance.now()
  let rafId = 0

  function resetAllSteps(): void {
    for (let i = 1; i <= STEPS; i++) setStepState(svgEl, i, 'idle')
  }

  function showStep(n: number): void {
    badgeEl.textContent = `étape ${n}/${STEPS}`
    titleEl.textContent = STEP_TITLES[n - 1] ?? ''
    setStepState(svgEl, n, 'active')
  }

  function tick(now: number): void {
    const dt = now - lastTick
    lastTick = now
    if (loopIsPlaying) {
      loopElapsed += dt
      const total = loopStep > STEPS ? RESET_PAUSE_MS : STEP_HOLD_MS
      progressEl.style.width = `${Math.min(100, (loopElapsed / total) * 100)}%`
      if (loopElapsed >= total) {
        loopElapsed = 0
        if (loopStep > STEPS) {
          // end of reset pause — start over
          resetAllSteps()
          loopStep = 1
          showStep(1)
        } else {
          // mark current done, advance
          setStepState(svgEl, loopStep, 'done')
          loopStep += 1
          if (loopStep <= STEPS) {
            showStep(loopStep)
          } else {
            badgeEl.textContent = `cycle terminé — reset…`
            titleEl.textContent = ''
          }
        }
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  function setPlaying(on: boolean): void {
    loopIsPlaying = on
    toggleBtn.textContent = on ? '⏸ pause' : '▶ play'
    toggleBtn.classList.toggle('paused', !on)
    lastTick = performance.now()
  }

  toggleBtn.addEventListener('click', () => setPlaying(!loopIsPlaying))

  // Boot the loop.
  showStep(1)
  rafId = requestAnimationFrame(tick)

  // Tear down on navigation.
  const onNav = () => {
    if (location.pathname !== '/explain') {
      cancelAnimationFrame(rafId)
      window.removeEventListener('popstate', onNav)
    }
  }
  window.addEventListener('popstate', onNav)

  const step = (n: number, title: string, descHtml: string) => {
    const s = el('div', 'step')
    s.dataset.step = String(n)
    s.innerHTML = `
      <div class="step-num">étape ${n}</div>
      <h3>${title}</h3>
      <p>${descHtml}</p>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"></div>
      <div class="meta-line"></div>
      <pre class="payload" style="display:none"></pre>
      <div class="out"></div>
    `
    stepsEl.appendChild(s)
    return {
      el: s,
      actions: s.querySelector<HTMLDivElement>('.actions')!,
      meta: s.querySelector<HTMLDivElement>('.meta-line')!,
      payload: s.querySelector<HTMLPreElement>('.payload')!,
      out: s.querySelector<HTMLDivElement>('.out')!,
      activate: () => {
        s.classList.add('active')
        s.classList.remove('done')
        // User-initiated step takes over the diagram: pause the auto-loop and
        // clear other steps so the focus is unambiguous.
        if (loopIsPlaying) setPlaying(false)
        for (let i = 1; i <= STEPS; i++) setStepState(svgEl, i, 'idle')
        setStepState(svgEl, n, 'active')
        loopStep = n
        loopElapsed = 0
        badgeEl.textContent = `étape ${n}/${STEPS} (manuel)`
        titleEl.textContent = STEP_TITLES[n - 1] ?? ''
        svgEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      },
      done: () => {
        s.classList.add('done')
        s.classList.remove('active')
        setStepState(svgEl, n, 'done')
      },
      err: (msg: string) => {
        const o = s.querySelector<HTMLDivElement>('.out')!
        o.classList.add('err')
        o.textContent = msg
        s.classList.remove('active')
        setStepState(svgEl, n, 'idle')
      },
    }
  }

  let cfg: AppConfig | null = null
  let mintedToken: string | null = null

  // ── step 1: app config ──
  const s1 = step(
    1,
    'Configuration du démo (côté serveur)',
    `Le SPA appelle <span class="kbd">GET /api/config</span>. Le démo y publie l'URL du worker
     stream cible et son <span class="kbd">partner_id</span>.`,
  )
  const s1Btn = document.createElement('button')
  s1Btn.className = 'primary'
  s1Btn.textContent = 'GET /api/config'
  s1.actions.appendChild(s1Btn)
  s1Btn.addEventListener('click', async () => {
    s1.activate()
    s1.payload.style.display = 'block'
    s1.payload.textContent = '…'
    try {
      cfg = await api.config()
      s1.payload.textContent = JSON.stringify(cfg, null, 2)
      s1.done()
    } catch (e) {
      s1.err(`failed: ${(e as Error).message}`)
    }
  })

  // ── step 2: JWKS ──
  const s2 = step(
    2,
    'Le démo publie sa clé publique (JWKS)',
    `Endpoint standard <span class="kbd">/.well-known/jwks.json</span>. Le worker stream
     interroge cette URL une fois et garde la clé en cache 1h.`,
  )
  const s2Btn = document.createElement('button')
  s2Btn.className = 'primary'
  s2Btn.textContent = 'GET /.well-known/jwks.json'
  s2.actions.appendChild(s2Btn)
  s2Btn.addEventListener('click', async () => {
    s2.activate()
    s2.payload.style.display = 'block'
    s2.payload.textContent = '…'
    try {
      const r = await fetch('/.well-known/jwks.json')
      const body = await r.json()
      s2.payload.textContent = JSON.stringify(body, null, 2)
      s2.done()
    } catch (e) {
      s2.err(`failed: ${(e as Error).message}`)
    }
  })

  // ── step 3: mint JWT ──
  const s3 = step(
    3,
    'Frappe d\'un JWT pour l\'utilisateur connecté',
    `Le SPA appelle <span class="kbd">POST /api/jwt</span>. Auth = cookie de session du démo.
     Le worker démo signe en RS256 avec la clé privée associée à <span class="kbd">kid</span>.`,
  )
  const s3Btn = document.createElement('button')
  s3Btn.className = 'primary'
  s3Btn.textContent = 'POST /api/jwt'
  s3.actions.appendChild(s3Btn)
  s3Btn.addEventListener('click', async () => {
    s3.activate()
    s3.payload.style.display = 'block'
    s3.payload.textContent = '…'
    try {
      const { token, expiresAt } = await api.mintJwt()
      mintedToken = token
      const decoded = tryParseJwt(token)
      s3.payload.textContent =
        `// raw JWT (head.payload.sig)\n${token}\n\n` +
        `// header\n${JSON.stringify(decoded?.header, null, 2)}\n\n` +
        `// payload\n${JSON.stringify(decoded?.payload, null, 2)}`
      s3.meta.textContent = `expire dans ${Math.round((expiresAt - Date.now()) / 1000)}s`
      s3.done()
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'error'
      s3.err(`failed: ${code}`)
      if (e instanceof ApiError && e.status === 401) navigate('/login')
    }
  })

  // ── step 4: init-stream + JWKS roundtrip ──
  const s4 = step(
    4,
    'Le SDK appelle <code>/init-stream</code> sur le worker stream',
    `Le SDK envoie le JWT en <span class="kbd">Authorization: Bearer …</span>. Le worker stream
     parse <span class="kbd">iss</span>, lit la ligne partner correspondante en D1, fetch la JWKS
     (1ère fois seulement), vérifie la signature avec <span class="kbd">kid</span>, valide
     <span class="kbd">aud</span> + <span class="kbd">exp</span>, puis crée une session de
     streaming.`,
  )
  const s4Inputs = el('div', 'row')
  s4Inputs.style.marginBottom = '8px'
  s4Inputs.innerHTML = `
    <input id="x-cb" type="text" placeholder="cb" value="5400863209100" style="flex:1" />
    <input id="x-disc" type="text" placeholder="disc" value="1" style="width:60px" />
    <input id="x-track" type="text" placeholder="track" value="1" style="width:60px" />
  `
  s4.el.insertBefore(s4Inputs, s4.actions)
  const s4Btn = document.createElement('button')
  s4Btn.className = 'primary'
  s4Btn.textContent = 'POST /init-stream'
  s4.actions.appendChild(s4Btn)
  s4Btn.addEventListener('click', async () => {
    s4.activate()
    s4.payload.style.display = 'block'
    s4.payload.textContent = '…'
    if (!cfg) {
      s4.err('exécute l\'étape 1 d\'abord (config manquante)')
      return
    }
    if (!mintedToken) {
      s4.err('exécute l\'étape 3 d\'abord (JWT manquant)')
      return
    }
    const cb = Number((s4.el.querySelector('#x-cb') as HTMLInputElement).value.trim())
    const disc = Number((s4.el.querySelector('#x-disc') as HTMLInputElement).value.trim())
    const track = Number((s4.el.querySelector('#x-track') as HTMLInputElement).value.trim())
    try {
      const r = await fetch(`${cfg.streamWorkerUrl}/init-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mintedToken}`,
        },
        body: JSON.stringify({ cb, disc, track }),
      })
      const text = await r.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
      s4.payload.textContent = `HTTP ${r.status}\n\n${JSON.stringify(parsed, null, 2)}`
      if (r.ok) s4.done()
      else s4.err(`status ${r.status}`)
    } catch (e) {
      s4.err(`failed: ${(e as Error).message}`)
    }
  })

  // ── step 5: tampering ──
  const s5 = step(
    5,
    'Test négatif: modifier la signature',
    `On envoie le même JWT mais avec la signature corrompue. Le worker stream doit refuser
     (<span class="kbd">401 invalid_token</span>).`,
  )
  const s5Btn = document.createElement('button')
  s5Btn.className = 'ghost-indigo'
  s5Btn.textContent = 'POST /init-stream (sig tamper)'
  s5.actions.appendChild(s5Btn)
  s5Btn.addEventListener('click', async () => {
    s5.activate()
    s5.payload.style.display = 'block'
    s5.payload.textContent = '…'
    if (!cfg || !mintedToken) {
      s5.err('exécute étapes 1 + 3 d\'abord')
      return
    }
    const parts = mintedToken.split('.')
    const tampered = `${parts[0]}.${parts[1]}.${(parts[2] ?? '').slice(0, -2)}AA`
    try {
      const r = await fetch(`${cfg.streamWorkerUrl}/init-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tampered}` },
        body: JSON.stringify({ cb: 5400863209100, disc: 1, track: 1 }),
      })
      const text = await r.text()
      s5.payload.textContent = `HTTP ${r.status}\n\n${text}`
      if (r.status === 401) s5.done()
      else s5.err(`expected 401, got ${r.status}`)
    } catch (e) {
      s5.err(`failed: ${(e as Error).message}`)
    }
  })
}
