/**
 * Persistent player state shared across screens. The WebView itself lives in
 * `<PersistentPlayer />` mounted in the root layout — this store only carries
 * the data and the imperative commands that PersistentPlayer reads.
 *
 * Why a Context (not Zustand/Redux): single demo app, no perf concerns, keeps
 * the dependency surface minimal for the integrator scenario.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TrackRef } from '@cyberscaling/secure-audio-stream-client'
import { persistence, PLAYLIST_KEY } from './persistence'

export type TrackInfo = TrackRef & { title?: string; artist?: string }

export type PhaseBreakdown = {
  get_token: number
  init_session: number
  fetch_key: number
  mse_setup: number
  first_chunk_fetch: number
  first_decrypt: number
  mp4box_ready: number
  first_append_to_canplay: number
  total: number
}

export type ServerBreakdown = { init_session: number; fetch_key: number }

export type PlayMetricsReport = {
  v: 1
  session_id: string
  mode: 'mse' | 'mms' | 'blob'
  cb: string
  track_ref: string
  codec: string
  outcome: 'canplay' | 'error' | 'aborted'
  error_code: string | null
  phases_ms: PhaseBreakdown
  server_ms: ServerBreakdown
  file_size_bytes: number
  chunk_size_bytes: number
}

export type LogEntry = {
  id: number
  ts: number
  level: 'info' | 'ok' | 'err'
  message: string
}

export type PlayerState = {
  track: TrackInfo | null
  playing: boolean
  /** Seconds. */
  currentTime: number
  duration: number
  /** Streaming progress (0–100). */
  progress: number
  /** SDK lifecycle. */
  phase: 'idle' | 'starting' | 'canplay' | 'ended' | 'error'
  errorMessage: string | null
  metrics: PlayMetricsReport | null
  /** Per-endpoint server phase timings (from `Server-Timing` header). */
  serverTimings: ServerTiming[]
  logs: LogEntry[]
  /** Walltime in ms when the last `play()` call was issued — used to compute play→canplay latency. */
  startedAt: number | null
  /** Walltime in ms when canplay fired. */
  canplayAt: number | null
  /** Saved queue, owned by the store. NEVER mirrors the SDK current playlist. */
  items: ReadonlyArray<{ id: string; ref: { cb: number; disc: number; track: number }; meta?: Record<string, unknown> }>
  /** Index of the playing track inside `items`, or -1 when ephemeral / idle. */
  currentIndex: number
  /** 'idle' = SDK has no list. 'queue' = SDK is playing `items`. 'ephemeral' = SDK is playing an ad-hoc list. */
  mode: 'idle' | 'queue' | 'ephemeral'
}

type Command =
  | { type: 'start'; workerUrl: string; token: string; ref: TrackRef; mode?: 'mse' | 'blob' }
  | { type: 'refresh-token'; token: string }
  | { type: 'destroy' }
  | { type: 'play'; at?: number | string }
  | { type: 'pause' }
  | { type: 'seek'; t: number }
  | { type: 'configure'; workerUrl: string; token: string }
  | { type: 'resume' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'playlist:setItems'; items: Array<{ id?: string; ref: TrackRef; meta?: Record<string, unknown> } | TrackRef> }
  | { type: 'playlist:insert'; item: { id?: string; ref: TrackRef; meta?: Record<string, unknown> } | TrackRef; position?: number }
  | { type: 'playlist:move'; id: string; position: number }
  | { type: 'playlist:remove'; id: string }
  | { type: 'playlist:clear' }

type Ctx = PlayerState & {
  /** Called from screens. Sets currentTrack; PersistentPlayer reacts and mounts/starts the WebView. */
  play: (track: TrackInfo) => Promise<void>
  playSingle: (track: TrackInfo) => Promise<void>
  playAlbumEphemeral: (
    tracks: Array<{ ref: TrackRef; meta?: Record<string, unknown> }>,
    startIndex: number,
  ) => Promise<void>
  /** Switch to queue mode and play the saved queue (at id or from the start). */
  playQueueAt: (id?: string) => Promise<void>
  hydrateFromStorage: () => Promise<void>
  clearPersistedQueue: () => Promise<void>
  togglePlayback: () => void
  seek: (t: number) => void
  stop: () => void
  /** Logging hook — used by both screens and PersistentPlayer. */
  log: (level: LogEntry['level'], message: string) => void
  /** Mutation helpers exposed to PersistentPlayer so it can update store from WebView events. */
  applyPlayerEvent: (event: PlayerEvent) => void
  resetForNewTrack: (track: TrackInfo) => void
  /** Subscribe to commands so PersistentPlayer can forward to the WebView. */
  subscribeCommand: (handler: (cmd: Command) => void) => () => void
  /** Dispatch a command into the queue. */
  dispatch: (cmd: Command) => void
  setPlaylist: (items: Array<{ id?: string; ref: TrackRef; meta?: Record<string, unknown> } | TrackRef>, startAt?: number | string) => Promise<void>
  enqueue: (item: { ref: TrackRef; meta?: Record<string, unknown> } | TrackRef, position?: number) => void
  dequeue: (id: string) => void
  moveItem: (id: string, position: number) => void
  next: () => void
  prev: () => void
}

export type PlayerEvent =
  | { type: 'log'; level: LogEntry['level']; message: string }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'state'; state: 'canplay' | 'ended' | 'destroyed' | 'loaded' }
  | { type: 'error'; message: string }
  | { type: 'playback'; playing: boolean }
  | { type: 'time'; current: number; duration: number }
  | { type: 'metrics'; report: PlayMetricsReport }
  | {
      type: 'server-timing'
      endpoint: 'init-stream' | 'key' | 'stream-first'
      phases: Record<string, number>
      desc?: Record<string, string>
    }
  | { type: 'ready' }
  | { type: 'playlist:items-change'; items: PlayerState['items'] }
  | { type: 'playlist:current-change'; curr: PlayerState['items'][number] | null; prev: PlayerState['items'][number] | null }
  | { type: 'playlist:prefetch-state'; event: { itemId: string; ref: TrackRef; layer: 'session' | 'kv'; state: 'pending' | 'ready' | 'error' | 'invalidated'; message?: string } }

export type ServerTiming = {
  endpoint: 'init-stream' | 'key' | 'stream-first'
  phases: Record<string, number>
  desc: Record<string, string>
}

const PlayerContext = createContext<Ctx | null>(null)

let logSeq = 0

const initialState: PlayerState = {
  track: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  progress: 0,
  phase: 'idle',
  errorMessage: null,
  metrics: null,
  serverTimings: [],
  logs: [],
  startedAt: null,
  canplayAt: null,
  items: [],
  currentIndex: -1,
  mode: 'idle',
}

type ProviderProps = {
  children: ReactNode
  /** Demo-worker mint endpoint. Caller injects to keep this file framework-agnostic. */
  mintToken: () => Promise<string>
  /** Worker URL the SDK posts to. */
  streamWorkerUrl: string | null
}

export function PlayerProvider({ children, mintToken, streamWorkerUrl }: ProviderProps) {
  const [state, setState] = useState<PlayerState>(initialState)
  const stateRef = useRef<PlayerState>(initialState)
  stateRef.current = state
  const subscribers = useRef<Set<(cmd: Command) => void>>(new Set())

  const log = useCallback((level: LogEntry['level'], message: string) => {
    setState((s) => ({
      ...s,
      logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level, message }],
    }))
  }, [])

  const dispatch = useCallback((cmd: Command) => {
    for (const sub of subscribers.current) sub(cmd)
  }, [])

  const subscribeCommand = useCallback((handler: (cmd: Command) => void) => {
    subscribers.current.add(handler)
    return () => {
      subscribers.current.delete(handler)
    }
  }, [])

  const resetForNewTrack = useCallback((track: TrackInfo) => {
    // Reset only playback-related fields. Saved queue (`items`), `mode`, and
    // `currentIndex` are NOT touched here — the caller manages them.
    setState((s) => ({
      ...initialState,
      items: s.items,
      mode: s.mode,
      currentIndex: s.currentIndex,
      track,
      phase: 'starting',
      startedAt: Date.now(),
      logs: [{ id: ++logSeq, ts: Date.now(), level: 'info', message: `start cb=${track.cb} disc=${track.disc} track=${track.track}` }],
    }))
  }, [])

  const applyPlayerEvent = useCallback((event: PlayerEvent) => {
    setState((s) => {
      switch (event.type) {
        case 'log':
          return { ...s, logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: event.level, message: event.message }] }
        case 'progress': {
          const pct = event.total > 0 ? (event.loaded / event.total) * 100 : 0
          return { ...s, progress: pct }
        }
        case 'state': {
          if (event.state === 'canplay') {
            return {
              ...s,
              phase: 'canplay',
              canplayAt: s.canplayAt ?? Date.now(),
              logs: [
                ...s.logs.slice(-99),
                {
                  id: ++logSeq,
                  ts: Date.now(),
                  level: 'ok',
                  message: `canplay (${s.startedAt ? Date.now() - s.startedAt : 0}ms since play)`,
                },
              ],
            }
          }
          if (event.state === 'ended') {
            // When the SDK's playlist runs out, downgrade mode to 'idle'.
            // Next user play intent will re-load `items` via playQueueAt.
            return { ...s, phase: 'ended', playing: false, mode: 'idle', currentIndex: -1 }
          }
          if (event.state === 'loaded') {
            return { ...s, logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: 'ok', message: 'all bytes streamed' }] }
          }
          return s
        }
        case 'error':
          return {
            ...s,
            phase: 'error',
            errorMessage: event.message,
            logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: 'err', message: event.message }],
          }
        case 'playback':
          return { ...s, playing: event.playing }
        case 'time':
          return { ...s, currentTime: event.current, duration: event.duration || s.duration }
        case 'metrics': {
          const next = { ...s, metrics: event.report }
          const p = event.report.phases_ms
          next.logs = [
            ...s.logs.slice(-95),
            { id: ++logSeq, ts: Date.now(), level: 'info', message: `metrics: outcome=${event.report.outcome} mode=${event.report.mode}` },
            { id: ++logSeq, ts: Date.now(), level: 'info', message: `  get_token=${p.get_token.toFixed(1)}ms init_session=${p.init_session.toFixed(1)}ms fetch_key=${p.fetch_key.toFixed(1)}ms` },
            { id: ++logSeq, ts: Date.now(), level: 'info', message: `  mse_setup=${p.mse_setup.toFixed(1)}ms first_chunk=${p.first_chunk_fetch.toFixed(1)}ms first_decrypt=${p.first_decrypt.toFixed(1)}ms` },
            { id: ++logSeq, ts: Date.now(), level: 'info', message: `  mp4box_ready=${p.mp4box_ready.toFixed(1)}ms first_append→canplay=${p.first_append_to_canplay.toFixed(1)}ms total=${p.total.toFixed(1)}ms` },
          ]
          return next
        }
        case 'server-timing': {
          const phaseStr = Object.entries(event.phases)
            .filter(([k]) => k !== 'total' && k !== 'app')
            .map(([k, v]) => `${k}=${v.toFixed(1)}`)
            .join(' ')
          const descStr =
            event.desc && Object.keys(event.desc).length > 0
              ? ' [' + Object.entries(event.desc).map(([k, v]) => `${k}=${v}`).join(' ') + ']'
              : ''
          const desc = event.desc ?? {}
          return {
            ...s,
            serverTimings: [
              ...s.serverTimings.filter((t) => t.endpoint !== event.endpoint),
              { endpoint: event.endpoint, phases: event.phases, desc },
            ],
            logs: [
              ...s.logs.slice(-99),
              {
                id: ++logSeq,
                ts: Date.now(),
                level: 'info',
                message: `server[${event.endpoint}]: ${phaseStr}${descStr}`,
              },
            ],
          }
        }
        case 'ready':
          return s
        case 'playlist:items-change':
          // SDK's current playlist is internal — UI displays `state.items`
          // (the saved queue). Ignore SDK echoes entirely.
          return s
        case 'playlist:current-change': {
          const idx = event.curr && s.mode === 'queue'
            ? s.items.findIndex((i) => i.id === event.curr!.id)
            : -1
          const trackInfo = event.curr
            ? {
                ...event.curr.ref,
                ...(event.curr.meta?.title ? { title: event.curr.meta.title as string } : {}),
                ...(event.curr.meta?.artist ? { artist: event.curr.meta.artist as string } : {}),
              }
            : null
          return {
            ...s,
            currentIndex: idx,
            track: trackInfo,
            phase: event.curr ? 'starting' : 'ended',
            startedAt: event.curr ? Date.now() : s.startedAt,
            canplayAt: null,
          }
        }
        case 'playlist:prefetch-state':
          return s
        default:
          return s
      }
    })
  }, [])

  const ensureConfigured = useRef(false)
  const configure = useCallback(async () => {
    if (ensureConfigured.current || !streamWorkerUrl) return
    const token = await mintToken()
    dispatch({ type: 'configure', workerUrl: streamWorkerUrl, token })
    ensureConfigured.current = true
  }, [streamWorkerUrl, mintToken, dispatch])

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const playSingle = useCallback(
    async (track: TrackInfo) => {
      if (!streamWorkerUrl) {
        log('err', 'streamWorkerUrl not yet resolved')
        return
      }
      await configure()
      resetForNewTrack(track)
      setState((s) => ({ ...s, mode: 'ephemeral', currentIndex: -1 }))
      const id = `single-${track.cb}-${track.disc}-${track.track}`
      const ephemeral = [{ id, ref: { cb: track.cb, disc: track.disc, track: track.track }, meta: track.title ? { title: track.title } : {} }]
      dispatch({ type: 'playlist:setItems', items: ephemeral })
      dispatch({ type: 'play', at: 0 })
    },
    [streamWorkerUrl, configure, resetForNewTrack, dispatch, log],
  )

  const play = playSingle

  const playAlbumEphemeral = useCallback(
    async (
      tracks: Array<{ ref: TrackRef; meta?: Record<string, unknown> }>,
      startIndex: number,
    ) => {
      if (tracks.length === 0) return
      await configure()
      const ephemeral = tracks.map((t, i) => ({
        id: `ephem-${i}-${t.ref.cb}-${t.ref.disc}-${t.ref.track}`,
        ref: t.ref,
        meta: t.meta ?? {},
      }))
      // Force-set `track` so PersistentPlayer mounts the WebView immediately;
      // otherwise it waits for `playlist:current-change` which never fires
      // because the WebView isn't running to emit it.
      const first = ephemeral[Math.max(0, Math.min(startIndex, ephemeral.length - 1))]!
      const title = (first.meta?.title as string | undefined) ?? undefined
      resetForNewTrack({ ...first.ref, ...(title ? { title } : {}) })
      setState((s) => ({ ...s, mode: 'ephemeral', currentIndex: -1 }))
      dispatch({ type: 'playlist:setItems', items: ephemeral })
      dispatch({ type: 'play', at: startIndex })
    },
    [configure, dispatch, resetForNewTrack],
  )

  const playQueueAt = useCallback(
    async (id?: string) => {
      const prev = stateRef.current
      if (prev.items.length === 0) return
      await configure()
      const wasNotQueueMode = prev.mode !== 'queue'
      if (wasNotQueueMode) {
        const target = id != null
          ? prev.items.find((it) => it.id === id) ?? prev.items[0]!
          : prev.items[0]!
        const title = (target.meta?.title as string | undefined) ?? undefined
        resetForNewTrack({ ...target.ref, ...(title ? { title } : {}) })
        setState((s) => ({ ...s, mode: 'queue' }))
        dispatch({ type: 'playlist:setItems', items: [...prev.items] })
      }
      dispatch(id != null ? { type: 'play', at: id } : { type: 'play' })
    },
    [configure, dispatch, resetForNewTrack],
  )

  const enqueue = useCallback(
    (item: { ref: TrackRef; meta?: Record<string, unknown> } | TrackRef, position?: number) => {
      const ref = 'ref' in item ? item.ref : item
      const meta = 'meta' in item ? item.meta ?? {} : {}
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const entry = { id, ref, meta }
      const prev = stateRef.current
      const nextItems = position !== undefined && position >= 0 && position <= prev.items.length
        ? [...prev.items.slice(0, position), entry, ...prev.items.slice(position)]
        : [...prev.items, entry]
      setState((s) => ({ ...s, items: nextItems }))
      // Only mirror to SDK when queue is the SDK's current playlist. In other
      // modes (ephemeral / idle), the SDK is busy with something else (or
      // nothing) — the saved queue change stays local until the user starts
      // queue mode via toggle / playQueueAt.
      if (prev.mode === 'queue') {
        dispatch(position !== undefined ? { type: 'playlist:insert', item: entry, position } : { type: 'playlist:insert', item: entry })
      }
    },
    [dispatch],
  )

  const dequeue = useCallback((id: string) => {
    const prev = stateRef.current
    const nextItems = prev.items.filter((it) => it.id !== id)
    if (nextItems.length === prev.items.length) return
    setState((s) => ({ ...s, items: nextItems }))
    if (prev.mode === 'queue') dispatch({ type: 'playlist:remove', id })
  }, [dispatch])

  const moveItem = useCallback((id: string, position: number) => {
    const prev = stateRef.current
    const fromIdx = prev.items.findIndex((it) => it.id === id)
    if (fromIdx === -1) return
    const target = Math.max(0, Math.min(position, prev.items.length - 1))
    if (fromIdx === target) return
    const copy = [...prev.items]
    const [it] = copy.splice(fromIdx, 1) as [PlayerState['items'][number]]
    copy.splice(target, 0, it)
    setState((s) => ({ ...s, items: copy }))
    if (prev.mode === 'queue') dispatch({ type: 'playlist:move', id, position: target })
  }, [dispatch])

  const next = useCallback(() => dispatch({ type: 'next' }), [dispatch])
  const prev = useCallback(() => dispatch({ type: 'prev' }), [dispatch])

  const togglePlayback = useCallback(() => {
    const cur = stateRef.current
    // If SDK has a current item, just play/pause it.
    if (cur.track && cur.phase !== 'ended' && cur.phase !== 'idle') {
      dispatch({ type: cur.playing ? 'pause' : 'play' })
      return
    }
    // Nothing actively playing — try to start the saved queue.
    if (cur.items.length > 0) {
      void playQueueAt()
      return
    }
  }, [dispatch, playQueueAt])

  const seek = useCallback((t: number) => dispatch({ type: 'seek', t }), [dispatch])

  const stop = useCallback(() => {
    dispatch({ type: 'destroy' })
    if (writeTimer.current) {
      clearTimeout(writeTimer.current)
      writeTimer.current = null
    }
    setState(initialState)
  }, [dispatch])

  const setPlaylist = useCallback(
    async (items: Array<{ id?: string; ref: TrackRef; meta?: Record<string, unknown> } | TrackRef>, startAt?: number | string) => {
      await configure()
      dispatch({ type: 'playlist:setItems', items })
      dispatch(startAt !== undefined ? { type: 'play', at: startAt } : { type: 'play' })
    },
    [configure, dispatch],
  )

  const hydrateFromStorage = useCallback(async () => {
    const saved = await persistence.get<Array<{ id: string; ref: TrackRef; meta?: Record<string, unknown> }>>(PLAYLIST_KEY)
    if (!saved || saved.length === 0) return
    // Just hydrate `state.items` — do NOT push to SDK. User clicks play to start.
    setState((s) => ({ ...s, items: saved }))
  }, [])

  const clearPersistedQueue = useCallback(async () => {
    await persistence.remove(PLAYLIST_KEY)
  }, [])

  useEffect(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      void persistence.set(PLAYLIST_KEY, state.items)
    }, 200)
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current)
    }
  }, [state.items])

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      play,
      playSingle,
      playAlbumEphemeral,
      playQueueAt,
      togglePlayback,
      seek,
      stop,
      log,
      applyPlayerEvent,
      resetForNewTrack,
      subscribeCommand,
      dispatch,
      setPlaylist,
      enqueue,
      dequeue,
      moveItem,
      next,
      prev,
      hydrateFromStorage,
      clearPersistedQueue,
    }),
    [state, play, playSingle, playAlbumEphemeral, playQueueAt, togglePlayback, seek, stop, log, applyPlayerEvent, resetForNewTrack, subscribeCommand, dispatch, setPlaylist, enqueue, dequeue, moveItem, next, prev, hydrateFromStorage, clearPersistedQueue],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer(): Ctx {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}
