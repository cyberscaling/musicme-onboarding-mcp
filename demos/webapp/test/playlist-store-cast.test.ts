/**
 * @vitest-environment happy-dom
 */

import type { PlaylistOptions } from '@cyberscaling/secure-audio-stream-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setTestCastStore, CastStore } from '../public/cast-sender'
import { playlistStore } from '../public/playlist-store'
import { FakeCastFramework } from './helpers-cast'

function makeMockPlayer(audio: HTMLAudioElement) {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    loadPrefetched: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    destroy: vi.fn(),
    audio,
  }
}

let fw: FakeCastFramework
let store: CastStore
let players: ReturnType<typeof makeMockPlayer>[]

beforeEach(async () => {
  document.body.innerHTML = '<audio id="player"></audio>'
  localStorage.clear()
  players = []
  const playerFactory: NonNullable<PlaylistOptions['playerFactory']> = (opts) => {
    const p = makeMockPlayer(opts.audioElement as HTMLAudioElement)
    players.push(p)
    return p as never
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ refs_warmed: 0 }), { status: 200 })),
  )
  playlistStore.reset()
  fw = new FakeCastFramework()
  store = new CastStore({ framework: fw, mintToken: vi.fn().mockResolvedValue('tok') })
  __setTestCastStore(store)
  await store.init('APPID', 3600)
  playlistStore.init(
    document.getElementById('player') as HTMLAudioElement,
    'https://stream.example',
    async () => 'tok',
    playerFactory,
  )
})

afterEach(() => {
  __setTestCastStore(null)
  vi.unstubAllGlobals()
  playlistStore.reset()
})

const REF = { cb: 1, disc: 1, track: 1, context: 'on_demand' as const }

describe('playlist-store cast routing', () => {
  it('playTrack while connected sends LOAD (autoplay) and does not drive the local player', async () => {
    fw.connect()
    const before = players.length
    playlistStore.playTrack(REF, { title: 'A' })
    await vi.waitFor(() => expect(fw.sent.some((m) => m.type === 'LOAD')).toBe(true))
    const load = fw.sent.filter((m) => m.type === 'LOAD').at(-1) as { autoplay?: boolean }
    expect(load.autoplay).toBe(true)
    expect(players.length).toBe(before)
  })

  it('enqueue while casting the queue reconciles (LOAD with startId=current, no positionSec)', async () => {
    fw.connect()
    playlistStore.enqueue(REF, { title: 'A' })
    playlistStore.playQueueAt()
    await vi.waitFor(() => expect(fw.sent.some((m) => m.type === 'LOAD')).toBe(true))
    fw.pushMessage({
      type: 'STATUS',
      state: 'playing',
      itemId: playlistStore.items[0].id,
      index: 0,
      currentTime: 1,
      duration: 100,
      meta: { title: 'A' },
    })
    fw.sent.length = 0
    playlistStore.enqueue({ cb: 1, disc: 1, track: 2, context: 'on_demand' as const }, { title: 'B' })
    await vi.waitFor(() => expect(fw.sent.some((m) => m.type === 'LOAD')).toBe(true))
    const m = fw.sent.filter((x) => x.type === 'LOAD').at(-1) as {
      startId?: string
      positionSec?: number
    }
    expect(m.startId).toBe(playlistStore.items[0].id)
    expect(m.positionSec).toBeUndefined()
  })

  it('next/prev/toggle route to cast control while connected', () => {
    fw.connect()
    fw.pushMessage({
      type: 'STATUS',
      state: 'playing',
      itemId: 'a',
      index: 0,
      currentTime: 0,
      duration: 10,
      meta: { title: 'A' },
    })
    playlistStore.next()
    expect(fw.sent.at(-1)).toEqual({ type: 'NEXT' })
    playlistStore.prev()
    expect(fw.sent.at(-1)).toEqual({ type: 'PREV' })
    playlistStore.toggle()
    expect(fw.sent.at(-1)).toEqual({ type: 'PAUSE' })
  })

  it('on connect hands off the active track and tears down the local player', async () => {
    playlistStore.playTrack(REF, { title: 'A' })
    const localPlayer = players.at(-1)
    fw.connect()
    await vi.waitFor(() => expect(fw.sent.some((m) => m.type === 'LOAD')).toBe(true))
    expect(localPlayer?.destroy).toHaveBeenCalled()
  })

  it('on disconnect rebuilds a local player paused at the remote position', async () => {
    playlistStore.playTrack(REF, { title: 'A' })
    fw.connect()
    await vi.waitFor(() => expect(fw.sent.some((m) => m.type === 'LOAD')).toBe(true))
    fw.pushMessage({
      type: 'STATUS',
      state: 'playing',
      itemId: playlistStore.items[0]?.id ?? 'x',
      index: 0,
      currentTime: 30,
      duration: 100,
      meta: { title: 'A' },
    })
    const builtBefore = players.length
    fw.disconnect()
    await vi.waitFor(() => expect(players.length).toBe(builtBefore + 1))
    expect(playlistStore.userPaused).toBe(true)
  })
})
