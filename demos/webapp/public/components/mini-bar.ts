/**
 * Persistent bottom mini-bar. Hidden when the playlist is empty. Subscribes
 * to playlistStore changes to keep its title/cover/play-state in sync, and
 * listens to the audio element directly for smooth progress updates.
 */
import { coverUrl, placeholderDataUrl } from '../covers'
import { playlistStore } from '../playlist-store'
import type { TrackMeta } from '../playlist-store'

export function mountMiniBar(root: HTMLElement): void {
  root.innerHTML = `
    <div class="progress"><div class="bar"></div></div>
    <div class="mini-bar">
      <img class="cv" alt="" src="${placeholderDataUrl()}">
      <div class="meta">
        <div class="t"></div>
        <div class="a"></div>
      </div>
      <button class="ctrl" data-action="prev" aria-label="previous">⏮</button>
      <button class="ctrl" data-action="toggle" aria-label="play/pause">▶</button>
      <button class="ctrl" data-action="next" aria-label="next">⏭</button>
      <button class="ctrl" data-action="queue" aria-label="open queue">≡</button>
    </div>
  `

  const cover = root.querySelector<HTMLImageElement>('img.cv')!
  const title = root.querySelector<HTMLElement>('.meta .t')!
  const subtitle = root.querySelector<HTMLElement>('.meta .a')!
  const toggleBtn = root.querySelector<HTMLButtonElement>('button[data-action="toggle"]')!
  const progressBar = root.querySelector<HTMLElement>('.progress > .bar')!

  cover.addEventListener('error', () => {
    cover.src = placeholderDataUrl()
  })

  root.querySelector<HTMLButtonElement>('button[data-action="prev"]')!.addEventListener('click', () => playlistStore.prev())
  root.querySelector<HTMLButtonElement>('button[data-action="next"]')!.addEventListener('click', () => playlistStore.next())
  toggleBtn.addEventListener('click', () => playlistStore.toggle())
  root.querySelector<HTMLButtonElement>('button[data-action="queue"]')!.addEventListener('click', () => {
    const panel = document.getElementById('queue-panel') as HTMLElement | null
    if (!panel) return
    const isOpen = panel.classList.toggle('open')
    panel.hidden = !isOpen
    const btn = root.querySelector<HTMLButtonElement>('button[data-action="queue"]')!
    btn.textContent = isOpen ? '▾' : '≡'
  })

  function render(): void {
    // Show whatever the audio element is bound to ; fall back to the head of
    // the saved queue so the user can hit play after a reload.
    const playing = playlistStore.currentTrack
    const meta: TrackMeta =
      playing ?? ((playlistStore.items[0]?.meta as TrackMeta | undefined) ?? { title: '?' })
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
  render()

  const audio = playlistStore.audio
  if (audio) {
    audio.addEventListener('timeupdate', () => {
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
