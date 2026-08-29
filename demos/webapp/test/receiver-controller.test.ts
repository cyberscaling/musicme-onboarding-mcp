/**
 * @vitest-environment happy-dom
 */

import type { SecureAudioPlayerOptions } from '@cyberscaling/secure-audio-stream-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReceiverMessage } from '../public/cast/protocol'
import { ReceiverController } from '../public/cast/receiver-controller'

type MockPlayer = {
  load: ReturnType<typeof vi.fn>
  loadPrefetched: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  audio: HTMLAudioElement
}

let players: MockPlayer[] = []
let playerOpts: SecureAudioPlayerOptions[] = []

function makeMockPlayer(audio: HTMLAudioElement): MockPlayer {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    loadPrefetched: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    destroy: vi.fn(),
    audio,
  }
}

beforeEach(() => {
  players = []
  playerOpts = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ refs_warmed: 0 }), { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeController() {
  const sent: ReceiverMessage[] = []
  const audio = document.createElement('audio')
  const ctrl = new ReceiverController({
    workerUrl: 'https://stream.example',
    audioElement: audio,
    send: (m) => sent.push(m),
    playerFactory: (opts) => {
      playerOpts.push(opts)
      const p = makeMockPlayer(opts.audioElement as HTMLAudioElement)
      players.push(p)
      return p as never
    },
  })
  return { ctrl, sent, audio }
}

const ITEMS = [
  { id: 'a', ref: { cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, meta: { title: 'A' } },
  { id: 'b', ref: { cb: 1, disc: 1, track: 2, context: 'on_demand' as const }, meta: { title: 'B' } },
]

describe('ReceiverController', () => {
  it('LOAD sets the queue, plays the requested item and reports status', async () => {
    const { ctrl, sent } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't1', items: ITEMS, startId: 'b' })
    expect(players.length).toBe(1)
    expect(players[0]?.load).toHaveBeenCalledWith({ cb: 1, disc: 1, track: 2, context: 'on_demand' as const })
    const statuses = sent.filter((m) => m.type === 'STATUS')
    expect(statuses.at(-1)).toMatchObject({ itemId: 'b', index: 1, meta: { title: 'B' } })
  })

  it('getToken resolves to the latest token (LOAD then SET_TOKEN)', async () => {
    const { ctrl } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't1', items: ITEMS })
    expect(await playerOpts[0]?.getToken()).toBe('t1')
    await ctrl.handleMessage({ type: 'SET_TOKEN', token: 't2' })
    expect(await playerOpts[0]?.getToken()).toBe('t2')
  })

  it('PAUSE and PLAY route to the underlying player', async () => {
    const { ctrl } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS })
    await ctrl.handleMessage({ type: 'PAUSE' })
    expect(players.at(-1)?.pause).toHaveBeenCalled()
    await ctrl.handleMessage({ type: 'PLAY' })
    expect(players.at(-1)?.play).toHaveBeenCalled()
  })

  it('NEXT advances to the following item', async () => {
    const { ctrl, sent } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS })
    await ctrl.handleMessage({ type: 'NEXT' })
    const last = sent.filter((m) => m.type === 'STATUS').at(-1)
    expect(last).toMatchObject({ itemId: 'b', index: 1 })
  })

  it('STOP clears the queue and reports idle', async () => {
    const { ctrl, sent } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS })
    await ctrl.handleMessage({ type: 'STOP' })
    expect(sent.at(-1)).toMatchObject({ type: 'STATUS', state: 'idle', itemId: null })
  })

  it('statusNow emits an idle status before any LOAD', () => {
    const { ctrl, sent } = makeController()
    ctrl.statusNow()
    expect(sent.at(-1)).toMatchObject({ type: 'STATUS', state: 'idle', itemId: null })
  })

  it('LOAD with startId === current reconciles without rebuilding the player', async () => {
    const { ctrl } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS, startId: 'a' })
    const playersAfterFirst = players.length
    await ctrl.handleMessage({
      type: 'LOAD',
      token: 't',
      items: [
        { id: 'a', ref: { cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, meta: { title: 'A' } },
        { id: 'c', ref: { cb: 1, disc: 1, track: 3, context: 'on_demand' as const }, meta: { title: 'C' } },
      ],
      startId: 'a',
    })
    expect(players.length).toBe(playersAfterFirst) // reconciled, no new player
  })

  it('auto-plays on canplay after a LOAD (default autoplay)', async () => {
    const { ctrl, audio } = makeController()
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue(undefined)
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS, startId: 'a' })
    audio.dispatchEvent(new Event('canplay'))
    expect(playSpy).toHaveBeenCalled()
  })

  it('does not auto-play on canplay when autoplay is false', async () => {
    const { ctrl, audio } = makeController()
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue(undefined)
    await ctrl.handleMessage({
      type: 'LOAD',
      token: 't',
      items: ITEMS,
      startId: 'a',
      autoplay: false,
    })
    audio.dispatchEvent(new Event('canplay'))
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('auto-plays on canplay after NEXT (advance starts playback)', async () => {
    const { ctrl, audio } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS, startId: 'a' })
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue(undefined)
    await ctrl.handleMessage({ type: 'NEXT' })
    audio.dispatchEvent(new Event('canplay'))
    expect(playSpy).toHaveBeenCalled()
  })

  it('LOAD with a different startId rebuilds and plays', async () => {
    const { ctrl } = makeController()
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS, startId: 'a' })
    const n = players.length
    await ctrl.handleMessage({ type: 'LOAD', token: 't', items: ITEMS, startId: 'b' })
    expect(players.length).toBe(n + 1)
    expect(players.at(-1)?.load).toHaveBeenCalledWith({ cb: 1, disc: 1, track: 2, context: 'on_demand' as const })
  })
})
