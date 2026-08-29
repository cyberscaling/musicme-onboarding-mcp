/**
 * Cast-framework-agnostic playback brain of the receiver. Wraps the SDK
 * Playlist; consumes SenderMessages, emits ReceiverMessages through the
 * injected `send`. No CAF import — unit-testable in happy-dom via the SDK's
 * PlaylistOptions.playerFactory injection point.
 */
import { Playlist, type PlaylistOptions } from '@cyberscaling/secure-audio-stream-client'
import type { CastTrackMeta, CastTrackRef, ReceiverMessage, ReceiverState, SenderMessage } from './protocol'

/** Cast wire tolerance: a queue sent by a pre-0.7 sender bundle carries refs
 *  without `context` (the type is compile-time only across the cast boundary).
 *  Default it explicitly here rather than letting `undefined` silently ride. */
function withContext(ref: CastTrackRef): CastTrackRef {
  return { ...ref, context: ref.context ?? 'on_demand' }
}

const STATUS_THROTTLE_MS = 1000

export type ReceiverControllerOptions = {
  workerUrl: string
  audioElement: HTMLAudioElement
  send: (msg: ReceiverMessage) => void
  /** Fired when the current track meta changes — drives the on-TV UI. */
  onTrackChange?: (meta: CastTrackMeta | null) => void
  /** Test-only hook: override the player built by the underlying Playlist. */
  playerFactory?: PlaylistOptions['playerFactory']
}

export class ReceiverController {
  private playlist: Playlist
  private token = ''
  private loading = false
  private lastStatusAt = 0
  /** Desired play state. The SDK Playlist only LOADs on play()/next(); the
   *  receiver must start the audio itself (the local app does this via the
   *  mini-bar's canplay listener — we mirror that here). */
  private wantPlay = true
  private pendingSeekSec = 0
  private opts: ReceiverControllerOptions

  constructor(opts: ReceiverControllerOptions) {
    this.opts = opts
    this.playlist = new Playlist({
      workerUrl: opts.workerUrl,
      getToken: async () => this.token,
      audioElement: opts.audioElement,
      sessionLookahead: 2,
      kvLookahead: 5,
      ...(opts.playerFactory !== undefined && { playerFactory: opts.playerFactory }),
      onCurrentChange: (curr) => {
        this.opts.onTrackChange?.((curr?.meta as CastTrackMeta | undefined) ?? null)
        this.sendStatus(true)
      },
      onError: (err) => {
        this.opts.send({ type: 'ERROR', code: 'playback', message: err.message })
      },
    })
    const a = opts.audioElement
    // Start playback once the freshly-loaded track is ready (the SDK only
    // buffers on load). Honors wantPlay so a paused handoff stays paused, and
    // applies a pending seek (connect-at-position) before playing.
    a.addEventListener('canplay', () => {
      if (this.pendingSeekSec > 0) {
        try {
          a.currentTime = this.pendingSeekSec
        } catch {
          // stub audio may not support assignment
        }
        this.pendingSeekSec = 0
      }
      if (this.wantPlay) void a.play().catch(() => undefined)
    })
    a.addEventListener('play', () => this.sendStatus(true))
    a.addEventListener('pause', () => this.sendStatus(true))
    a.addEventListener('timeupdate', () => this.sendStatus(false))
  }

  async handleMessage(msg: SenderMessage): Promise<void> {
    switch (msg.type) {
      case 'LOAD': {
        this.token = msg.token
        const cur = this.playlist.currentItem
        const sameTrack =
          msg.startId != null && cur?.id === msg.startId && !this.opts.audioElement.ended
        if (sameTrack) {
          // Queue edited around the still-playing track — reconcile, no restart.
          this.playlist.reconcile(
            msg.items.map((it) => ({ id: it.id, ref: withContext(it.ref), meta: it.meta })),
            msg.startId as string,
          )
          this.sendStatus(true)
          break
        }
        // Set desired play state + pending seek BEFORE loading, so the canplay
        // listener (which may fire mid-load) starts/seeks correctly.
        this.wantPlay = msg.autoplay !== false
        this.pendingSeekSec = msg.positionSec && msg.positionSec > 0 ? msg.positionSec : 0
        this.loading = true
        // setItems before the loading status so the frame reflects the new
        // queue (index reset to -1), not the previously playing track.
        this.playlist.setItems(msg.items.map((it) => ({ id: it.id, ref: withContext(it.ref), meta: it.meta })))
        this.sendStatus(true)
        try {
          await this.playlist.play(msg.startId)
        } finally {
          this.loading = false
          this.sendStatus(true)
        }
        break
      }
      case 'PLAY':
        this.wantPlay = true
        this.playlist.resume()
        break
      case 'PAUSE':
        this.wantPlay = false
        this.playlist.pause()
        break
      case 'NEXT':
        this.wantPlay = true
        await this.playlist.next()
        break
      case 'PREV':
        this.wantPlay = true
        await this.playlist.prev()
        break
      case 'SEEK':
        try {
          this.opts.audioElement.currentTime = msg.time
        } catch {
          // stub audio may not support assignment
        }
        this.sendStatus(true)
        break
      case 'SET_TOKEN':
        this.token = msg.token
        break
      case 'STOP':
        this.playlist.clear()
        this.sendStatus(true)
        break
    }
  }

  /** Immediate status push — the CAF shell calls this when a sender connects. */
  statusNow(): void {
    this.sendStatus(true)
  }

  private sendStatus(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastStatusAt < STATUS_THROTTLE_MS) return
    this.lastStatusAt = now
    const idx = this.playlist.currentIndex
    const item = idx >= 0 ? (this.playlist.items[idx] ?? null) : null
    const a = this.opts.audioElement
    let state: ReceiverState = 'idle'
    if (this.loading) state = 'loading'
    else if (item) state = a.paused ? 'paused' : 'playing'
    this.opts.send({
      type: 'STATUS',
      state,
      itemId: item?.id ?? null,
      index: idx,
      currentTime: Number.isFinite(a.currentTime) ? a.currentTime : 0,
      duration: Number.isFinite(a.duration) ? a.duration : 0,
      meta: (item?.meta as CastTrackMeta | undefined) ?? null,
    })
  }
}
