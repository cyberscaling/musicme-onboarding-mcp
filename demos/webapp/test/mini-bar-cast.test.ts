/**
 * @vitest-environment happy-dom
 */

import type { PlaylistOptions } from '@cyberscaling/secure-audio-stream-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setTestCastStore, CastStore } from '../public/cast-sender'
import { mountMiniBar } from '../public/components/mini-bar'
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

const playerFactory: NonNullable<PlaylistOptions['playerFactory']> = (opts) =>
  makeMockPlayer(opts.audioElement as HTMLAudioElement) as never

let fw: FakeCastFramework
let store: CastStore

beforeEach(async () => {
  document.body.innerHTML =
    '<div id="player-bar"></div><div id="queue-panel" hidden></div><audio id="player"></audio>'
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ refs_warmed: 0 }), { status: 200 })),
  )
  playlistStore.reset()
  fw = new FakeCastFramework()
  store = new CastStore({ framework: fw, mintToken: vi.fn().mockResolvedValue('tok') })
  __setTestCastStore(store)
  await store.init('APPID', 3600)
})

afterEach(() => {
  __setTestCastStore(null)
  vi.unstubAllGlobals()
})

function mount(): HTMLElement {
  const root = document.getElementById('player-bar') as HTMLElement
  mountMiniBar(root)
  return root
}

describe('mini-bar cast integration', () => {
  it('shows the cast button once the framework is available', () => {
    const root = mount()
    const btn = root.querySelector<HTMLButtonElement>('button[data-action="cast"]')!
    expect(btn.hidden).toBe(false)
  })

  it('hides Cast while preview mode is selected', () => {
    playlistStore.setPreviewEnabled(true)
    const root = mount()
    expect(root.querySelector<HTMLButtonElement>('button[data-action="cast"]')?.hidden).toBe(true)
  })

  it('hands off the local queue on connect (LOAD sent, local paused)', async () => {
    const audio = document.getElementById('player') as HTMLAudioElement
    playlistStore.init(audio, 'https://stream.example', async () => 'tok', playerFactory)
    playlistStore.playTrack({ cb: 1, disc: 1, track: 1 }, { title: 'A' })
    mount()
    fw.connect()
    await vi.waitFor(() => {
      expect(fw.sent.some((m) => m.type === 'LOAD')).toBe(true)
    })
    expect(playlistStore.userPaused).toBe(true)
  })

  it('routes transport controls to the receiver while connected', () => {
    const root = mount()
    fw.connect()
    root.querySelector<HTMLButtonElement>('button[data-action="next"]')!.click()
    expect(fw.sent.at(-1)).toEqual({ type: 'NEXT' })
  })

  it('toggle sends PAUSE when remote is playing', () => {
    const root = mount()
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
    root.querySelector<HTMLButtonElement>('button[data-action="toggle"]')!.click()
    expect(fw.sent.at(-1)).toEqual({ type: 'PAUSE' })
  })
})
