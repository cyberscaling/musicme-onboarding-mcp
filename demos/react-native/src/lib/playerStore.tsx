/**
 * Persistent player state shared across screens. The audio playback engine
 * lives in <PersistentPlayer /> (mounted in the root layout) which observes
 * this store and drives the <NativePlayer /> view via props.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TrackRef } from '@demos/offline'
import { persistence, PLAYLIST_KEY } from './persistence'

export type TrackInfo = TrackRef & { title?: string; artist?: string }

export type PlayMetricsReport = {
  v: 1
  trackRef: string
  outcome: 'canplay' | 'error' | 'aborted'
  bootstrapMs: number | null
  firstKeyMs: number | null
  firstRangeMs: number | null
  firstCanplayMs: number | null
  totalPlayMs: number | null
  bufferUnderruns: number
  sessionRotations: number
  fileSizeBytes: number | null
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
  currentTime: number
  duration: number
  progress: number
  phase: 'idle' | 'starting' | 'canplay' | 'ended' | 'error'
  errorMessage: string | null
  metrics: PlayMetricsReport | null
  logs: LogEntry[]
  startedAt: number | null
  canplayAt: number | null
  seekToMs: number | null
  /** Saved queue — persisted across launches. Owned by the user. */
  items: ReadonlyArray<{ id: string; ref: TrackRef; meta?: Record<string, unknown> }>
  /** Active playback list — snapshot of items (queue mode), an ephemeral album,
   * or a single track. NOT persisted. next/prev operate against this. */
  nowPlaying: ReadonlyArray<{ id: string; ref: TrackRef; meta?: Record<string, unknown> }>
  currentIndex: number
  mode: 'idle' | 'queue' | 'ephemeral'
}

export type PlayerEvent =
  | { type: 'log'; level: LogEntry['level']; message: string }
  | { type: 'state'; state: 'canplay' | 'ended' | 'destroyed' | 'loaded' }
  | { type: 'error'; message: string }
  | { type: 'playback'; playing: boolean }
  | { type: 'time'; current: number; duration: number }
  | { type: 'metrics'; report: PlayMetricsReport }

type Ctx = PlayerState & {
  play: (track: TrackInfo) => Promise<void>
  playSingle: (track: TrackInfo) => Promise<void>
  playAlbumEphemeral: (tracks: Array<{ ref: TrackRef; meta?: Record<string, unknown> }>, startIndex: number) => Promise<void>
  playQueueAt: (id?: string) => Promise<void>
  hydrateFromStorage: () => Promise<void>
  clearPersistedQueue: () => Promise<void>
  togglePlayback: () => void
  seek: (t: number) => void
  stop: () => void
  log: (level: LogEntry['level'], message: string) => void
  applyPlayerEvent: (event: PlayerEvent) => void
  resetForNewTrack: (track: TrackInfo) => void
  setPlaylist: (items: Array<{ id?: string; ref: TrackRef; meta?: Record<string, unknown> } | TrackRef>, startAt?: number | string) => Promise<void>
  enqueue: (item: { ref: TrackRef; meta?: Record<string, unknown> } | TrackRef, position?: number) => void
  dequeue: (id: string) => void
  moveItem: (id: string, position: number) => void
  next: () => void
  prev: () => void
}

const PlayerContext = createContext<Ctx | null>(null)
let logSeq = 0

const initialState: PlayerState = {
  track: null, playing: false, currentTime: 0, duration: 0, progress: 0,
  phase: 'idle', errorMessage: null, metrics: null, logs: [],
  startedAt: null, canplayAt: null, seekToMs: null,
  items: [], nowPlaying: [], currentIndex: -1, mode: 'idle',
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>(initialState)
  const stateRef = useRef<PlayerState>(initialState)
  stateRef.current = state

  const log = useCallback((level: LogEntry['level'], message: string) => {
    setState((s) => ({ ...s, logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level, message }] }))
  }, [])

  const resetForNewTrack = useCallback((track: TrackInfo) => {
    setState((s) => ({
      ...initialState,
      items: s.items, nowPlaying: s.nowPlaying, mode: s.mode, currentIndex: s.currentIndex,
      track, phase: 'starting', startedAt: Date.now(),
      playing: true,
      logs: [{ id: ++logSeq, ts: Date.now(), level: 'info',
               message: `start cb=${track.cb} disc=${track.disc} track=${track.track}` }],
    }))
  }, [])

  const applyPlayerEvent = useCallback((event: PlayerEvent) => {
    setState((s) => {
      switch (event.type) {
        case 'log':
          return { ...s, logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: event.level, message: event.message }] }
        case 'state':
          if (event.state === 'canplay') {
            return { ...s, phase: 'canplay', canplayAt: s.canplayAt ?? Date.now(),
                     logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: 'ok',
                            message: `canplay (${s.startedAt ? Date.now() - s.startedAt : 0}ms since play)` }] }
          }
          if (event.state === 'ended') {
            // Auto-advance to next track when nowPlaying has more.
            const nextIdx = s.currentIndex + 1
            if (nextIdx >= 0 && nextIdx < s.nowPlaying.length) {
              const target = s.nowPlaying[nextIdx]!
              const title = (target.meta?.title as string | undefined) ?? undefined
              return {
                ...s,
                track: { ...target.ref, ...(title ? { title } : {}) },
                currentIndex: nextIdx,
                phase: 'starting',
                playing: true,
                startedAt: Date.now(),
                canplayAt: null,
                currentTime: 0,
                duration: 0,
                progress: 0,
                logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: 'info',
                       message: `advance → ${target.ref.cb}:${target.ref.disc}:${target.ref.track}` }],
              }
            }
            return { ...s, phase: 'ended', playing: false, mode: 'idle', currentIndex: -1 }
          }
          return s
        case 'error':
          return { ...s, phase: 'error', errorMessage: event.message,
                   logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: 'err', message: event.message }] }
        case 'playback':
          return { ...s, playing: event.playing }
        case 'time':
          return { ...s, currentTime: event.current, duration: event.duration || s.duration }
        case 'metrics':
          return { ...s, metrics: event.report,
                   logs: [...s.logs.slice(-99), { id: ++logSeq, ts: Date.now(), level: 'info',
                          message: `metrics: outcome=${event.report.outcome}` }] }
        default: return s
      }
    })
  }, [])

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const playSingle = useCallback(async (track: TrackInfo) => {
    const single = [{
      id: `single-${track.cb}-${track.disc}-${track.track}`,
      // Respecte le mode déclaré par l'appelant (radio / mix), pas de valeur forcée.
      ref: { cb: track.cb, disc: track.disc, track: track.track, context: track.context },
      meta: track.title ? { title: track.title } : {},
    }]
    resetForNewTrack(track)
    setState((s) => ({ ...s, mode: 'ephemeral', currentIndex: 0, nowPlaying: single }))
  }, [resetForNewTrack])

  const play = playSingle

  const playAlbumEphemeral = useCallback(async (
    tracks: Array<{ ref: TrackRef; meta?: Record<string, unknown> }>, startIndex: number,
  ) => {
    if (tracks.length === 0) return
    const ephemeral = tracks.map((t, i) => ({ id: `ephem-${i}-${t.ref.cb}-${t.ref.disc}-${t.ref.track}`, ref: t.ref, meta: t.meta ?? {} }))
    const idx = Math.max(0, Math.min(startIndex, ephemeral.length - 1))
    const first = ephemeral[idx]!
    const title = (first.meta?.title as string | undefined) ?? undefined
    resetForNewTrack({ ...first.ref, ...(title ? { title } : {}) })
    setState((s) => ({ ...s, nowPlaying: ephemeral, mode: 'ephemeral', currentIndex: idx }))
  }, [resetForNewTrack])

  const playQueueAt = useCallback(async (id?: string) => {
    const prev = stateRef.current
    if (prev.items.length === 0) return
    const target = id != null
      ? prev.items.find((it) => it.id === id) ?? prev.items[0]!
      : prev.items[0]!
    const title = (target.meta?.title as string | undefined) ?? undefined
    resetForNewTrack({ ...target.ref, ...(title ? { title } : {}) })
    const idx = prev.items.findIndex((it) => it.id === target.id)
    setState((s) => ({ ...s, nowPlaying: [...prev.items], mode: 'queue', currentIndex: idx }))
  }, [resetForNewTrack])

  const enqueue = useCallback((item: { ref: TrackRef; meta?: Record<string, unknown> } | TrackRef, position?: number) => {
    const ref = 'ref' in item ? item.ref : item
    const meta = 'meta' in item ? item.meta ?? {} : {}
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const entry = { id, ref, meta }
    const prev = stateRef.current
    const nextItems = position !== undefined && position >= 0 && position <= prev.items.length
      ? [...prev.items.slice(0, position), entry, ...prev.items.slice(position)]
      : [...prev.items, entry]
    setState((s) => ({ ...s, items: nextItems }))
  }, [])

  const dequeue = useCallback((id: string) => {
    const prev = stateRef.current
    const nextItems = prev.items.filter((it) => it.id !== id)
    if (nextItems.length === prev.items.length) return
    setState((s) => ({ ...s, items: nextItems }))
  }, [])

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
  }, [])

  const next = useCallback(() => {
    const s = stateRef.current
    if (s.currentIndex < 0) return
    const nextIdx = s.currentIndex + 1
    if (nextIdx >= s.nowPlaying.length) {
      setState((p) => ({ ...p, phase: 'ended', playing: false, mode: 'idle', currentIndex: -1 }))
      return
    }
    const target = s.nowPlaying[nextIdx]!
    const title = (target.meta?.title as string | undefined) ?? undefined
    resetForNewTrack({ ...target.ref, ...(title ? { title } : {}) })
    setState((p) => ({ ...p, currentIndex: nextIdx }))
  }, [resetForNewTrack])

  const prev = useCallback(() => {
    const s = stateRef.current
    if (s.currentIndex <= 0) return
    const target = s.nowPlaying[s.currentIndex - 1]!
    const title = (target.meta?.title as string | undefined) ?? undefined
    resetForNewTrack({ ...target.ref, ...(title ? { title } : {}) })
    setState((p) => ({ ...p, currentIndex: s.currentIndex - 1 }))
  }, [resetForNewTrack])

  const togglePlayback = useCallback(() => {
    const cur = stateRef.current
    if (cur.track && cur.phase !== 'ended' && cur.phase !== 'idle') {
      setState((s) => ({ ...s, playing: !s.playing }))
      return
    }
    if (cur.items.length > 0) { void playQueueAt() }
  }, [playQueueAt])

  const seek = useCallback((t: number) => {
    setState((s) => ({ ...s, seekToMs: t * 1000 }))
  }, [])

  useEffect(() => {
    if (state.seekToMs == null) return
    const id = setTimeout(() => setState((s) => ({ ...s, seekToMs: null })), 100)
    return () => clearTimeout(id)
  }, [state.seekToMs])

  const stop = useCallback(() => { setState(initialState) }, [])

  const setPlaylist = useCallback(async (
    items: Array<{ id?: string; ref: TrackRef; meta?: Record<string, unknown> } | TrackRef>,
    startAt?: number | string,
  ) => {
    const normalized = items.map((it, i) => {
      if ('ref' in it) return { id: it.id ?? `q-${i}`, ref: it.ref, meta: it.meta ?? {} }
      return { id: `q-${i}`, ref: it, meta: {} }
    })
    setState((s) => ({ ...s, items: normalized, nowPlaying: normalized, mode: 'queue' }))
    const target = typeof startAt === 'string'
      ? normalized.find((it) => it.id === startAt)
      : normalized[typeof startAt === 'number' ? startAt : 0]
    if (target) {
      const title = (target.meta?.title as string | undefined) ?? undefined
      resetForNewTrack({ ...target.ref, ...(title ? { title } : {}) })
      const idx = normalized.findIndex((it) => it.id === target.id)
      setState((s) => ({ ...s, currentIndex: idx }))
    }
  }, [resetForNewTrack])

  const hydrateFromStorage = useCallback(async () => {
    const saved = await persistence.get<Array<{ id: string; ref: TrackRef; meta?: Record<string, unknown> }>>(PLAYLIST_KEY)
    if (!saved || saved.length === 0) return
    setState((s) => ({ ...s, items: saved }))
  }, [])

  const clearPersistedQueue = useCallback(async () => { await persistence.remove(PLAYLIST_KEY) }, [])

  useEffect(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => { void persistence.set(PLAYLIST_KEY, state.items) }, 200)
    return () => { if (writeTimer.current) clearTimeout(writeTimer.current) }
  }, [state.items])

  const value = useMemo<Ctx>(() => ({
    ...state, play, playSingle, playAlbumEphemeral, playQueueAt,
    togglePlayback, seek, stop, log, applyPlayerEvent, resetForNewTrack,
    setPlaylist, enqueue, dequeue, moveItem, next, prev,
    hydrateFromStorage, clearPersistedQueue,
  }), [state, play, playSingle, playAlbumEphemeral, playQueueAt, togglePlayback, seek, stop, log,
      applyPlayerEvent, resetForNewTrack, setPlaylist, enqueue, dequeue, moveItem, next, prev,
      hydrateFromStorage, clearPersistedQueue])

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer(): Ctx {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}
