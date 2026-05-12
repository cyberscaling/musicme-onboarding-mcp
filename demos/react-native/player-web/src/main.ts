/**
 * WebView entry. Wraps a Playlist instance and bridges messages to/from RN.
 *
 * RN → web:
 *   { type: 'playlist:setItems', items: PlaylistItem[] }
 *   { type: 'playlist:insert', item, position? }
 *   { type: 'playlist:move', id, position }
 *   { type: 'playlist:remove', id }
 *   { type: 'playlist:clear' }
 *   { type: 'play', at? }
 *   { type: 'pause' } / { type: 'resume' } / { type: 'next' } / { type: 'prev' }
 *   { type: 'destroy' } / { type: 'refresh-token', token }
 *   { type: 'start', workerUrl, ref, mode, token } (legacy single-track, now wraps in 1-item playlist)
 *
 * Web → RN:
 *   { type: 'ready' }
 *   { type: 'playlist:items-change', items }
 *   { type: 'playlist:current-change', curr, prev }
 *   { type: 'playlist:prefetch-state', event }
 *   { type: 'log' | 'progress' | 'state' | 'error' | 'playback' | 'time' | 'metrics' | 'server-timing' }
 */
import { Playlist, type PlaylistItem, type TrackRef } from '@cyberscaling/secure-audio-stream-client'

type IncomingMessage =
  | { type: 'configure'; workerUrl: string; token: string }
  | { type: 'refresh-token'; token: string }
  | { type: 'playlist:setItems'; items: Array<PlaylistItem | TrackRef> }
  | { type: 'playlist:insert'; item: PlaylistItem | TrackRef; position?: number }
  | { type: 'playlist:move'; id: string; position: number }
  | { type: 'playlist:remove'; id: string }
  | { type: 'playlist:clear' }
  | { type: 'play'; at?: number | string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'destroy' }
  | { type: 'seek'; t: number }

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void }
  }
}

function postToNative(payload: Record<string, unknown>): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(payload))
}

const audio = document.getElementById('player') as HTMLAudioElement
audio.removeAttribute('controls')

let playlist: Playlist | null = null
let currentToken = ''
let currentWorkerUrl = ''
let streamFirstSeen = false

function buildPlaylist(): Playlist {
  return new Playlist({
    workerUrl: currentWorkerUrl,
    getToken: async () => {
      if (!currentToken) throw new Error('no token configured')
      return currentToken
    },
    audioElement: audio,
    mode: 'mse',
    metrics: { enabled: true, sampleRate: 1.0 },
    onPlayerMetrics: (report) => postToNative({ type: 'metrics', report }),
    onItemsChange: (items) => postToNative({ type: 'playlist:items-change', items }),
    onCurrentChange: (curr, prev) => {
      streamFirstSeen = false
      postToNative({ type: 'playlist:current-change', curr, prev })
    },
    onPrefetchState: (e) => postToNative({ type: 'playlist:prefetch-state', event: e }),
    onError: (err, ctx) =>
      postToNative({ type: 'error', message: err.message, ctx }),
  })
}

audio.addEventListener('play', () => postToNative({ type: 'playback', playing: true }))
audio.addEventListener('pause', () => postToNative({ type: 'playback', playing: false }))
audio.addEventListener('timeupdate', () => {
  postToNative({ type: 'time', current: audio.currentTime, duration: audio.duration || 0 })
})
audio.addEventListener('canplay', () => {
  postToNative({ type: 'state', state: 'canplay' })
  void audio.play().catch(() => undefined)
})

// Server-Timing interceptor (unchanged from previous build)
function parseAllServerTiming(header: string | null): {
  phases: Record<string, number>
  desc: Record<string, string>
} {
  const phases: Record<string, number> = {}
  const desc: Record<string, string> = {}
  if (!header) return { phases, desc }
  for (const entry of header.split(',')) {
    const trimmed = entry.trim()
    const m = trimmed.match(/^([a-zA-Z0-9_-]+)\s*;\s*dur=(\d+(?:\.\d+)?)/)
    if (m && m[1] && m[2]) phases[m[1]] = Number(m[2])
    const d = trimmed.match(/^([a-zA-Z0-9_-]+)\s*;\s*desc="([^"]+)"/)
    if (d && d[1] && d[2]) desc[d[1]] = d[2]
  }
  return { phases, desc }
}
const origFetch = window.fetch.bind(window)
;(window as { fetch: unknown }).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await origFetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let endpoint: string | null = null
  if (/\/init-stream(?:[/?]|$)/.test(url)) endpoint = 'init-stream'
  else if (/\/key\//.test(url)) endpoint = 'key'
  else if (/\/stream\//.test(url)) {
    if (!streamFirstSeen) {
      streamFirstSeen = true
      endpoint = 'stream-first'
    } else {
      return res
    }
  }
  if (!endpoint) return res
  const { phases, desc } = parseAllServerTiming(res.headers.get('Server-Timing'))
  const xCache = res.headers.get('X-Cache')
  if (xCache) desc.cache = xCache
  if (Object.keys(phases).length > 0 || Object.keys(desc).length > 0) {
    postToNative({ type: 'server-timing', endpoint, phases, desc })
  }
  return res
}

function handleMessage(raw: string): void {
  let msg: IncomingMessage
  try {
    msg = JSON.parse(raw) as IncomingMessage
  } catch {
    return
  }
  if (msg.type === 'configure') {
    currentWorkerUrl = msg.workerUrl
    currentToken = msg.token
    if (!playlist) playlist = buildPlaylist()
    return
  }
  if (msg.type === 'refresh-token') {
    currentToken = msg.token
    return
  }
  if (!playlist) return
  switch (msg.type) {
    case 'playlist:setItems':
      playlist.setItems(msg.items)
      break
    case 'playlist:insert':
      playlist.insert(msg.item, msg.position)
      break
    case 'playlist:move':
      playlist.move(msg.id, msg.position)
      break
    case 'playlist:remove':
      playlist.remove(msg.id)
      break
    case 'playlist:clear':
      playlist.clear()
      break
    case 'play':
      void playlist.play(msg.at)
      break
    case 'pause':
      playlist.pause()
      break
    case 'resume':
      playlist.resume()
      break
    case 'next':
      void playlist.next()
      break
    case 'prev':
      void playlist.prev()
      break
    case 'destroy':
      playlist.destroy()
      playlist = null
      break
    case 'seek':
      audio.currentTime = Math.max(0, msg.t)
      break
  }
}

window.addEventListener('message', (e) => {
  if (typeof e.data === 'string') handleMessage(e.data)
})
document.addEventListener('message', (e) => handleMessage((e as MessageEvent<string>).data))

postToNative({ type: 'ready' })
