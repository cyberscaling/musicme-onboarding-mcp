/**
 * Owns two distinct concepts :
 *   - savedQueue : persistent ordered list shown in #queue-panel.
 *     Only `+` (enqueue), drag-reorder, remove and Play-All mutate it.
 *   - audioPlaylist : the SDK Playlist instance attached to <audio>, which
 *     represents the *currently playing* track(s). It can be loaded with
 *     either the savedQueue (mode = 'queue') or a single ephemeral track
 *     (mode = 'single').
 *
 * Click on a track's title plays it standalone (mode 'single') without
 * touching savedQueue. Clicking play in the mini-bar or jumping via the
 * queue panel switches to queue mode. The two modes are mutually
 * exclusive — switching automatically stops the other.
 */
import { Playlist, type TrackRef } from '@cyberscaling/secure-audio-stream-client'

export type TrackMeta = {
  title: string
  artist?: string
  album?: string
  coverCb?: string
}

export type StoredItem = {
  id: string
  ref: TrackRef
  meta: TrackMeta
}

type Mode = 'idle' | 'queue' | 'ephemeral'

export const LS_KEY = 'musicme:webapp:playlist:v1'

type Snapshot = { items: StoredItem[] }

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `q-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

class PlaylistStore {
  private playlist: Playlist | null = null
  private listeners = new Set<() => void>()
  private savedQueue: StoredItem[] = []
  private mode: Mode = 'idle'
  private _userPaused = false

  init(audio: HTMLAudioElement, workerUrl: string, getToken: () => Promise<string>): void {
    if (this.playlist) return
    this.playlist = new Playlist({
      workerUrl,
      getToken,
      audioElement: audio,
      sessionLookahead: 2,
      kvLookahead: 5,
      onCurrentChange: () => {
        this.emit()
      },
    })
    this.restore()
  }

  reset(): void {
    this.playlist?.destroy()
    this.playlist = null
    this.listeners.clear()
    this.savedQueue = []
    this.mode = 'idle'
  }

  /** Read-only flag set when the user explicitly paused. Reset on any
   *  explicit play intent (toggle resume, next/prev, playTrack, …). */
  get userPaused(): boolean {
    return this._userPaused
  }

  notePlayIntent(): void {
    this._userPaused = false
  }

  notePauseIntent(): void {
    this._userPaused = true
  }

  /** Play a single track standalone. Stops any current playlist playback. */
  playTrack(ref: TrackRef, meta: TrackMeta): void {
    if (!this.playlist) return
    this._userPaused = false
    this.mode = 'ephemeral'
    this.playlist.setItems([{ id: genId(), ref, meta: meta as Record<string, unknown> }] as never)
    void this.playlist.play()
    this.emit()
  }

  /**
   * Add a track to the saved queue (visible in the panel). Does NOT start
   * playback. If queue is currently playing, the new track is inserted live
   * via the underlying Playlist so lookahead stays consistent.
   */
  enqueue(ref: TrackRef, meta: TrackMeta, position?: number): void {
    const item: StoredItem = { id: genId(), ref, meta }
    const pos =
      position == null
        ? this.savedQueue.length
        : Math.max(0, Math.min(position, this.savedQueue.length))
    this.savedQueue.splice(pos, 0, item)
    if (this.mode === 'queue') {
      this.playlist?.insert({ ref, meta: meta as Record<string, unknown> } as never, pos)
    }
    this.persist()
    this.emit()
  }

  remove(id: string): void {
    const idx = this.savedQueue.findIndex((it) => it.id === id)
    if (idx === -1) return
    this.savedQueue.splice(idx, 1)
    if (this.mode === 'queue') {
      this.playlist?.remove(id)
    }
    this.persist()
    this.emit()
  }

  move(id: string, position: number): void {
    const from = this.savedQueue.findIndex((it) => it.id === id)
    if (from === -1) return
    const target = Math.max(0, Math.min(position, this.savedQueue.length - 1))
    if (from === target) return
    const [it] = this.savedQueue.splice(from, 1) as [StoredItem]
    this.savedQueue.splice(target, 0, it)
    if (this.mode === 'queue') this.playlist?.move(id, target)
    this.persist()
    this.emit()
  }

  /**
   * Play an ad-hoc list of tracks (e.g. an album's Play-all). Ephemeral —
   * the saved queue is NOT modified. Mode switches to 'ephemeral'.
   */
  playFromStart(items: Array<{ ref: TrackRef; meta: TrackMeta }>): void {
    if (!this.playlist) return
    this._userPaused = false
    this.mode = 'ephemeral'
    this.playlist.setItems(
      items.map((it) => ({ id: genId(), ref: it.ref, meta: it.meta as Record<string, unknown> })) as never,
    )
    void this.playlist.play()
    this.emit()
  }

  /** Resume queue mode at a specific item (or from start if id omitted). */
  playQueueAt(id?: string): void {
    if (!this.playlist || this.savedQueue.length === 0) return
    this._userPaused = false
    if (this.mode !== 'queue') {
      this.playlist.setItems(
        this.savedQueue.map((it) => ({ id: it.id, ref: it.ref, meta: it.meta as Record<string, unknown> })) as never,
      )
      this.mode = 'queue'
    }
    if (id != null) {
      void this.playlist.play(id)
    } else {
      void this.playlist.play()
    }
    this.emit()
  }

  next(): void {
    if (this.mode === 'idle') return
    this._userPaused = false
    void this.playlist?.next()
  }

  prev(): void {
    if (this.mode === 'idle') return
    this._userPaused = false
    void this.playlist?.prev()
  }

  /** Toggle play/pause on whatever is currently playing. */
  toggle(): void {
    if (!this.playlist) return
    const a = this.playlist.audio
    const idx = this.playlist.currentIndex
    if (idx >= 0) {
      if (a.paused) {
        this._userPaused = false
        void this.playlist.resume()
      } else {
        this._userPaused = true
        this.playlist.pause()
      }
      return
    }
    // Nothing playing yet — try to start the saved queue
    if (this.savedQueue.length > 0) this.playQueueAt()
  }

  clear(): void {
    this.savedQueue = []
    this.mode = 'idle'
    this.playlist?.clear()
    try {
      localStorage.removeItem(LS_KEY)
    } catch {}
    this.emit()
  }

  /** Items shown in queue panel — always the saved queue, never the ephemeral single. */
  get items(): readonly StoredItem[] {
    return this.savedQueue
  }

  /** Index of the playing track within the saved queue, or -1 if single / idle. */
  get currentIndex(): number {
    if (this.mode !== 'queue') return -1
    return this.playlist?.currentIndex ?? -1
  }

  /** Meta of whatever the audio element is currently bound to (single or queue track). */
  get currentTrack(): TrackMeta | null {
    const idx = this.playlist?.currentIndex ?? -1
    const items = this.playlist?.items ?? []
    if (idx >= 0 && items[idx]) return (items[idx]!.meta as TrackMeta) ?? null
    return null
  }

  /** True if an ephemeral list (single track or album play-all) is currently loaded. */
  get isEphemeralMode(): boolean {
    return this.mode === 'ephemeral'
  }

  get audio(): HTMLAudioElement | null {
    return this.playlist?.audio ?? null
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  private persist(): void {
    try {
      const snap: Snapshot = { items: this.savedQueue }
      localStorage.setItem(LS_KEY, JSON.stringify(snap))
    } catch {
      // ignore
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const snap = JSON.parse(raw) as Snapshot
      if (!Array.isArray(snap.items) || snap.items.length === 0) return
      this.savedQueue = snap.items
      // mode stays 'idle' — user must click play (mini-bar or queue row) to start.
    } catch {
      // ignore corrupt LS
    }
  }
}

export const playlistStore = new PlaylistStore()
