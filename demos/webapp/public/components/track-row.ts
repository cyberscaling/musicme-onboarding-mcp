/**
 * Reusable track row for album / artist / search pages. Tap on the title
 * starts a playlist from this row + the rest of the current context.
 * Tap on `+` enqueues without disturbing playback.
 *
 * Two display modes :
 *   - default ('cover') : cover thumbnail + title + duration + +queue
 *   - 'numbered' : track number ("3" or "1·3" multi-disc) + title + duration + +queue
 *     Use 'numbered' on album pages where the cover is redundant.
 */
import type { Track } from '../catalog'
import { coverUrl, placeholderDataUrl } from '../covers'
import { playlistStore, type TrackMeta } from '../playlist-store'

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export type TrackRowContext = {
  context: Track[]
  defaults?: Partial<TrackMeta>
  /** Display variant. Default 'cover'. */
  variant?: 'cover' | 'numbered'
  /** If 'numbered', whether the context spans multiple discs (toggles disc prefix). */
  multiDisc?: boolean
}

function trackToMeta(t: Track, defaults?: Partial<TrackMeta>): TrackMeta {
  const meta: TrackMeta = {
    title: t.title,
    coverCb: defaults?.coverCb ?? t.cb,
  }
  const artist = t.artist ?? defaults?.artist
  if (artist !== undefined) meta.artist = artist
  const album = t.albumTitle ?? defaults?.album
  if (album !== undefined) meta.album = album
  return meta
}

export function renderTrackRow(track: Track, ctx: TrackRowContext): HTMLElement {
  const row = document.createElement('div')
  row.className = 'track-row'
  const variant = ctx.variant ?? 'cover'
  const lead =
    variant === 'numbered'
      ? `<span class="num">${ctx.multiDisc ? `${track.disc}·` : ''}${String(track.track).padStart(2, '0')}</span>`
      : `<img class="cv" src="${coverUrl(ctx.defaults?.coverCb ?? track.cb, 90)}" loading="lazy" alt="">`
  row.innerHTML = `
    <button class="plus" aria-label="add to queue">+</button>
    ${lead}
    <span class="t">${escapeHtml(track.title)}</span>
    <span class="d">${formatDuration(track.durationSec)}</span>
  `
  const img = row.querySelector<HTMLImageElement>('img.cv')
  if (img) {
    img.addEventListener('error', () => {
      img.src = placeholderDataUrl()
    })
  }
  row.querySelector<HTMLElement>('.t')!.addEventListener('click', () => {
    playlistStore.playTrack(
      { cb: Number(track.cb), disc: track.disc, track: track.track, context: 'on_demand' },
      trackToMeta(track, ctx.defaults),
    )
  })
  row.querySelector<HTMLButtonElement>('button.plus')!.addEventListener('click', (e) => {
    e.stopPropagation()
    const btn = e.currentTarget as HTMLElement
    flyToQueue(btn)
    playlistStore.enqueue(
      { cb: Number(track.cb), disc: track.disc, track: track.track, context: 'on_demand' },
      trackToMeta(track, ctx.defaults),
    )
  })
  return row
}

function flyToQueue(srcEl: HTMLElement): void {
  const target = document.querySelector<HTMLElement>('.mini-bar button[data-action="queue"]')
  if (!target) return
  const s = srcEl.getBoundingClientRect()
  const t = target.getBoundingClientRect()
  const dot = document.createElement('div')
  dot.className = 'fly-to-queue'
  dot.style.left = `${s.left + s.width / 2 - 8}px`
  dot.style.top = `${s.top + s.height / 2 - 8}px`
  document.body.appendChild(dot)
  requestAnimationFrame(() => {
    const dx = t.left + t.width / 2 - (s.left + s.width / 2)
    const dy = t.top + t.height / 2 - (s.top + s.height / 2)
    dot.classList.add('go')
    dot.style.transform = `translate(${dx}px, ${dy}px) scale(0.4)`
  })
  setTimeout(() => {
    dot.remove()
    target.classList.add('bump')
    setTimeout(() => target.classList.remove('bump'), 400)
  }, 480)
}

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
