/**
 * Persistent bottom mini-bar. Hidden when the playlist is empty. Subscribes
 * to playlistStore changes to keep its title/cover/play-state in sync, and
 * listens to the audio element directly for smooth progress updates.
 * When a Cast session is connected, transport controls route to the receiver
 * and the bar mirrors the remote STATUS instead of the local audio element.
 */
import { getCastStore } from '../cast-sender'
import { coverUrl, placeholderDataUrl } from '../covers'
import type { TrackMeta } from '../playlist-store'
import { playlistStore } from '../playlist-store'

export function mountMiniBar(root: HTMLElement): void {
  root.innerHTML = `
    <div class="progress"><div class="bar"></div></div>
    <div class="mini-bar">
      <img class="cv" alt="" src="${placeholderDataUrl()}">
      <div class="meta">
        <div class="title-line">
          <div class="t"></div>
          <span class="preview-badge" hidden></span>
        </div>
        <div class="a"></div>
      </div>
      <button class="ctrl" data-action="prev" aria-label="previous">⏮</button>
      <button class="ctrl" data-action="toggle" aria-label="play/pause">▶</button>
      <button class="ctrl" data-action="next" aria-label="next">⏭</button>
      <button class="ctrl" data-action="cast" aria-label="cast" hidden>📺</button>
      <button class="ctrl" data-action="queue" aria-label="open queue">≡</button>
    </div>
  `

  const cast = getCastStore()
  const cover = root.querySelector<HTMLImageElement>('img.cv')!
  const title = root.querySelector<HTMLElement>('.meta .t')!
  const subtitle = root.querySelector<HTMLElement>('.meta .a')!
  const previewBadge = root.querySelector<HTMLElement>('.preview-badge')!
  const toggleBtn = root.querySelector<HTMLButtonElement>('button[data-action="toggle"]')!
  const castBtn = root.querySelector<HTMLButtonElement>('button[data-action="cast"]')!
  const progressBar = root.querySelector<HTMLElement>('.progress > .bar')!

  cover.addEventListener('error', () => {
    cover.src = placeholderDataUrl()
  })

  root
    .querySelector<HTMLButtonElement>('button[data-action="prev"]')!
    .addEventListener('click', () => playlistStore.prev())
  root
    .querySelector<HTMLButtonElement>('button[data-action="next"]')!
    .addEventListener('click', () => playlistStore.next())
  toggleBtn.addEventListener('click', () => playlistStore.toggle())
  castBtn.addEventListener('click', () => {
    void cast.toggleSession()
  })
  root
    .querySelector<HTMLButtonElement>('button[data-action="queue"]')!
    .addEventListener('click', () => {
      const panel = document.getElementById('queue-panel') as HTMLElement | null
      if (!panel) return
      const isOpen = panel.classList.toggle('open')
      panel.hidden = !isOpen
      const btn = root.querySelector<HTMLButtonElement>('button[data-action="queue"]')!
      btn.textContent = isOpen ? '▾' : '≡'
    })

  function render(): void {
    castBtn.hidden = cast.state === 'unavailable' || playlistStore.previewEnabled
    castBtn.classList.toggle('active', cast.state === 'connected')
    const previewSeconds = playlistStore.activePreviewSeconds
    previewBadge.hidden = previewSeconds === null
    previewBadge.textContent = previewSeconds === null ? '' : `EXTRAIT · ${previewSeconds} s`

    const remote = cast.state === 'connected' ? cast.lastStatus : null
    if (remote) {
      previewBadge.hidden = true
      root.classList.add('visible')
      const meta = remote.meta
      title.textContent = meta?.title ?? '?'
      subtitle.textContent = [meta?.artist, meta?.album].filter(Boolean).join(' · ')
      cover.src = meta?.coverCb ? coverUrl(meta.coverCb, 90) : placeholderDataUrl()
      toggleBtn.textContent = remote.state === 'playing' ? '❚❚' : '▶'
      if (remote.duration > 0) {
        progressBar.style.width = `${(remote.currentTime / remote.duration) * 100}%`
      }
      return
    }

    // Show whatever the audio element is bound to ; fall back to the head of
    // the saved queue so the user can hit play after a reload.
    const playing = playlistStore.currentTrack
    const meta: TrackMeta = playing ??
      (playlistStore.items[0]?.meta as TrackMeta | undefined) ?? { title: '?' }
    const haveSomething = !!playing || playlistStore.items.length > 0
    if (!haveSomething) {
      root.classList.remove('visible')
      return
    }
    root.classList.add('visible')
    title.textContent = meta.title ?? '?'
    subtitle.textContent = [meta.artist, meta.album].filter(Boolean).join(' · ')
    cover.src = meta.coverCb ? coverUrl(meta.coverCb, 90) : placeholderDataUrl()
    const audio = playlistStore.audio
    toggleBtn.textContent = audio && !audio.paused ? '❚❚' : '▶'
  }

  playlistStore.onChange(render)

  // Handoff (LOAD on connect / local rebuild on disconnect) is owned by
  // playlistStore; the bar only mirrors the resulting state.
  cast.onChange(render)

  render()

  const audio = playlistStore.audio
  if (audio) {
    audio.addEventListener('timeupdate', () => {
      if (cast.state === 'connected') return
      if (!audio.duration) return
      const pct = (audio.currentTime / audio.duration) * 100
      progressBar.style.width = `${pct}%`
    })
    audio.addEventListener('play', () => {
      playlistStore.notePlayIntent()
      render()
    })
    audio.addEventListener('pause', () => {
      if (audio.currentTime > 0.05) playlistStore.notePauseIntent()
      render()
    })
    audio.addEventListener('canplay', () => {
      if (playlistStore.userPaused) return
      void audio.play().catch(() => undefined)
    })
  }
}
