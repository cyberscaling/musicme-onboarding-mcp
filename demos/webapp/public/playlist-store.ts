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
import {
  Playlist,
  type PlaylistOptions,
  SecureAudioPlayer,
  type SecureAudioPlayerOptions,
  type TrackRef,
} from '@cyberscaling/secure-audio-stream-client'
import type { CastQueueItem } from './cast/protocol'
import { type CastStore, getCastStore } from './cast-sender'
import { PreviewAudioPlayer } from './preview-player'

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
export const PREVIEW_MODE_KEY = 'musicme:webapp:playback-mode:v1'

export type PreviewSeconds = 60 | 90
export type PreviewPlayerFactory = (
  options: SecureAudioPlayerOptions,
  ref: TrackRef,
  onReady: (seconds: PreviewSeconds) => void,
) => SecureAudioPlayer

type Snapshot = { items: StoredItem[] }

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `q-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

class PlaylistStore {
  private playlist: Playlist | null = null
  private listeners = new Set<() => void>()
  private savedQueue: StoredItem[] = []
  /** The list actually loaded for playback (ephemeral single/album or the queue). */
  private activeItems: StoredItem[] = []
  private mode: Mode = 'idle'
  private _userPaused = false

  // Saved so the local Playlist can be rebuilt after a cast disconnect.
  private audioEl: HTMLAudioElement | null = null
  private workerUrl = ''
  private getToken: (() => Promise<string>) | null = null
  /** Test-only hook: override the player built by the underlying Playlist. */
  private playerFactory: PlaylistOptions['playerFactory']
  private previewPlayerFactory: PreviewPlayerFactory = (options, ref, onReady) =>
    new PreviewAudioPlayer(options, ref, onReady)
  private playlistOptions: PlaylistOptions | null = null
  private _previewEnabled = false
  private _activePreviewSeconds: PreviewSeconds | null = null
  private activeTrackUsesPreview = false
  private pendingRef: TrackRef | null = null
  private playbackGeneration = 0

  private castUnsub: (() => void) | null = null
  private prevCastState = this.cast.state
  /** startId of the last LOAD we sent (reconcile fallback if no STATUS yet). */
  private lastSentStartId: string | undefined

  init(
    audio: HTMLAudioElement,
    workerUrl: string,
    getToken: () => Promise<string>,
    playerFactory?: PlaylistOptions['playerFactory'],
    previewPlayerFactory?: PreviewPlayerFactory,
  ): void {
    if (this.playlist) return
    this.audioEl = audio
    this.workerUrl = workerUrl
    this.getToken = getToken
    this.playerFactory = playerFactory
    if (previewPlayerFactory) this.previewPlayerFactory = previewPlayerFactory
    this.restorePreviewMode()
    this.buildLocalPlaylist()
    this.restore()
    this.prevCastState = this.cast.state
    this.castUnsub = this.cast.onChange(() => this.onCastChange())
    this.emit()
  }

  reset(): void {
    this.castUnsub?.()
    this.castUnsub = null
    this.playlist?.destroy()
    this.playlist = null
    this.listeners.clear()
    this.savedQueue = []
    this.activeItems = []
    this.mode = 'idle'
    this.audioEl = null
    this.workerUrl = ''
    this.getToken = null
    this.playerFactory = undefined
    this.previewPlayerFactory = (options, ref, onReady) =>
      new PreviewAudioPlayer(options, ref, onReady)
    this.playlistOptions = null
    this._previewEnabled = false
    this._activePreviewSeconds = null
    this.activeTrackUsesPreview = false
    this.pendingRef = null
    this.playbackGeneration = 0
  }

  private buildLocalPlaylist(): void {
    const audioElement = this.audioEl
    const getToken = this.getToken
    if (!audioElement || !getToken) return
    const options: PlaylistOptions = {
      workerUrl: this.workerUrl,
      getToken,
      audioElement,
      sessionLookahead: this._previewEnabled ? 0 : 2,
      kvLookahead: 5,
      playerFactory: (playerOptions) => {
        const generation = this.playbackGeneration
        const ref = this.pendingRef
        if (this.activeTrackUsesPreview && ref) {
          return this.previewPlayerFactory(playerOptions, ref, (seconds) => {
            if (generation !== this.playbackGeneration || !this.activeTrackUsesPreview) return
            this._activePreviewSeconds = seconds
            this.emit()
          })
        }
        return this.playerFactory?.(playerOptions) ?? new SecureAudioPlayer(playerOptions)
      },
      onCurrentChange: (current) => {
        this.playbackGeneration += 1
        this.pendingRef = current?.ref ?? null
        this.activeTrackUsesPreview = current !== null && this._previewEnabled
        this._activePreviewSeconds = null
        this.emit()
      },
    }
    this.playlistOptions = options
    this.playlist = new Playlist(options)
  }

  get previewEnabled(): boolean {
    return this._previewEnabled
  }

  get activePreviewSeconds(): PreviewSeconds | null {
    return this._activePreviewSeconds
  }

  /** Selects the mode for the next loaded track; current playback is untouched. */
  setPreviewEnabled(enabled: boolean): boolean {
    if (enabled && this.connected) return false
    this._previewEnabled = enabled
    if (this.playlistOptions) this.playlistOptions.sessionLookahead = enabled ? 0 : 2
    try {
      localStorage.setItem(PREVIEW_MODE_KEY, enabled ? 'preview' : 'full')
    } catch {
      // Selection remains valid for this page even when storage is unavailable.
    }
    this.emit()
    return true
  }

  private get cast(): CastStore {
    return getCastStore()
  }

  private get connected(): boolean {
    return this.cast.state === 'connected'
  }

  private toCastItems(items: StoredItem[]): CastQueueItem[] {
    return items.map((it) => ({
      id: it.id,
      ref: it.ref,
      meta: (it.meta ?? { title: '?' }) as CastQueueItem['meta'],
    }))
  }

  private onCastChange(): void {
    const s = this.cast.state
    if (s === 'connected' && this.prevCastState !== 'connected') this.handoffToCast()
    else if (s !== 'connected' && this.prevCastState === 'connected') this.handoffToLocal()
    this.prevCastState = s
    this.emit()
  }

  private handoffToCast(): void {
    const items = this.activeItems
    if (items.length === 0) {
      this.playlist?.destroy()
      this.playlist = null
      return
    }
    const idx = this.playlist?.currentIndex ?? -1
    const audio = this.playlist?.audio
    const curr = idx >= 0 ? items[idx] : items[0]
    // Mirror the actual play state — don't fold in currentTime, or a track cast
    // in its first instant (currentTime still 0) would hand off paused.
    // positionSec is guarded separately below.
    const wasPlaying = !!audio && !audio.paused
    const positionSec = audio && audio.currentTime > 0 ? audio.currentTime : undefined
    this.playlist?.destroy()
    this.playlist = null
    this._userPaused = !wasPlaying
    this.lastSentStartId = curr?.id
    void this.cast.sendLoad({
      items: this.toCastItems(items),
      ...(curr && { startId: curr.id }),
      ...(positionSec !== undefined && { positionSec }),
      autoplay: wasPlaying,
    })
  }

  private handoffToLocal(): void {
    if (!this.audioEl) return
    this.buildLocalPlaylist()
    if (this.activeItems.length === 0) return
    const currentId = this.cast.lastStatus?.itemId ?? this.lastSentStartId
    const pos = this.cast.lastStatus?.currentTime ?? 0
    this._userPaused = true
    this.playlist?.setItems(
      this.activeItems.map((it) => ({
        id: it.id,
        ref: it.ref,
        meta: it.meta as Record<string, unknown>,
      })),
    )
    void (async () => {
      await this.playlist?.play(currentId)
      this.playlist?.pause()
      const a = this.playlist?.audio
      if (a && pos > 0) {
        try {
          a.currentTime = pos
        } catch {
          // stub audio may not support assignment
        }
      }
    })()
  }

  private loadActive(startId: string | undefined, autoplay: boolean): void {
    if (this.connected) {
      this.lastSentStartId = startId
      void this.cast.sendLoad({
        items: this.toCastItems(this.activeItems),
        ...(startId !== undefined && { startId }),
        autoplay,
      })
    } else {
      this.playlist?.setItems(
        this.activeItems.map((it) => ({
          id: it.id,
          ref: it.ref,
          meta: it.meta as Record<string, unknown>,
        })),
      )
      void (startId ? this.playlist?.play(startId) : this.playlist?.play())
    }
  }

  private reconcileCast(): void {
    if (!this.connected) return
    const currentId = this.cast.lastStatus?.itemId ?? this.lastSentStartId
    if (currentId && this.activeItems.some((i) => i.id === currentId)) {
      void this.cast.sendReconcile(this.toCastItems(this.activeItems), currentId)
    } else {
      this.loadActive(this.activeItems[0]?.id, true)
    }
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
    this._userPaused = false
    this.mode = 'ephemeral'
    this.activeItems = [{ id: genId(), ref, meta }]
    this.loadActive(this.activeItems[0]?.id, true)
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
      this.activeItems = [...this.savedQueue]
      if (this.connected) this.reconcileCast()
      else this.playlist?.insert({ ref, meta: meta as Record<string, unknown> } as never, pos)
    }
    this.persist()
    this.emit()
  }

  remove(id: string): void {
    const idx = this.savedQueue.findIndex((it) => it.id === id)
    if (idx === -1) return
    const wasCurrent =
      this.connected && (this.cast.lastStatus?.itemId ?? this.lastSentStartId) === id
    this.savedQueue.splice(idx, 1)
    if (this.mode === 'queue') {
      this.activeItems = [...this.savedQueue]
      if (this.connected) {
        if (wasCurrent) this.loadActive(this.activeItems[idx]?.id ?? this.activeItems[0]?.id, true)
        else this.reconcileCast()
      } else {
        this.playlist?.remove(id)
      }
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
    if (this.mode === 'queue') {
      this.activeItems = [...this.savedQueue]
      if (this.connected) this.reconcileCast()
      else this.playlist?.move(id, target)
    }
    this.persist()
    this.emit()
  }

  /**
   * Play an ad-hoc list of tracks (e.g. an album's Play-all). Ephemeral —
   * the saved queue is NOT modified. Mode switches to 'ephemeral'.
   */
  playFromStart(items: Array<{ ref: TrackRef; meta: TrackMeta }>): void {
    this._userPaused = false
    this.mode = 'ephemeral'
    this.activeItems = items.map((it) => ({ id: genId(), ref: it.ref, meta: it.meta }))
    this.loadActive(this.activeItems[0]?.id, true)
    this.emit()
  }

  /** Resume queue mode at a specific item (or from start if id omitted). */
  playQueueAt(id?: string): void {
    if (this.savedQueue.length === 0) return
    this._userPaused = false
    this.mode = 'queue'
    this.activeItems = [...this.savedQueue]
    this.loadActive(id ?? this.activeItems[0]?.id, true)
    this.emit()
  }

  next(): void {
    if (this.connected) {
      this._userPaused = false
      this.cast.control('NEXT')
      return
    }
    if (this.mode === 'idle') return
    this._userPaused = false
    void this.playlist?.next()
  }

  prev(): void {
    if (this.connected) {
      this._userPaused = false
      this.cast.control('PREV')
      return
    }
    if (this.mode === 'idle') return
    this._userPaused = false
    void this.playlist?.prev()
  }

  /** Toggle play/pause on whatever is currently playing. */
  toggle(): void {
    if (this.connected) {
      this.cast.control(this.cast.lastStatus?.state === 'playing' ? 'PAUSE' : 'PLAY')
      return
    }
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
    if (this.connected) {
      const id = this.cast.lastStatus?.itemId
      return id ? this.savedQueue.findIndex((it) => it.id === id) : -1
    }
    if (this.mode !== 'queue') return -1
    return this.playlist?.currentIndex ?? -1
  }

  /** Meta of whatever the audio element is currently bound to (single or queue track). */
  get currentTrack(): TrackMeta | null {
    if (this.connected) {
      return (this.cast.lastStatus?.meta as TrackMeta | undefined) ?? null
    }
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

  private restorePreviewMode(): void {
    try {
      this._previewEnabled = localStorage.getItem(PREVIEW_MODE_KEY) === 'preview'
    } catch {
      this._previewEnabled = false
    }
  }
}

export const playlistStore = new PlaylistStore()
