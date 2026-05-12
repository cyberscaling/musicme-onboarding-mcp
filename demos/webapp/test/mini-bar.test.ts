/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setTestPlayerFactory } from '@cyberscaling/secure-audio-stream-client'
import { mountMiniBar } from '../public/components/mini-bar'
import { playlistStore } from '../public/playlist-store'

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

beforeEach(() => {
  document.body.innerHTML = '<div id="player-bar"></div><div id="queue-panel" hidden></div><audio id="player"></audio>'
  localStorage.clear()
  __setTestPlayerFactory((opts) => makeMockPlayer(opts.audioElement as HTMLAudioElement) as never)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
  playlistStore.reset()
})

afterEach(() => {
  __setTestPlayerFactory(null)
  vi.unstubAllGlobals()
})

describe('mini-bar', () => {
  it('mounts hidden when queue is empty', () => {
    const audio = document.getElementById('player') as HTMLAudioElement
    playlistStore.init(audio, 'https://x', async () => 't')
    mountMiniBar(document.getElementById('player-bar') as HTMLElement)
    expect(document.getElementById('player-bar')!.classList.contains('visible')).toBe(false)
  })

  it('shows after enqueue', () => {
    const audio = document.getElementById('player') as HTMLAudioElement
    playlistStore.init(audio, 'https://x', async () => 't')
    mountMiniBar(document.getElementById('player-bar') as HTMLElement)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'Hello', coverCb: '1' })
    expect(document.getElementById('player-bar')!.classList.contains('visible')).toBe(true)
    expect(document.querySelector('.mini-bar .meta .t')!.textContent).toBe('Hello')
  })

  it('toggle button calls playlistStore.toggle', () => {
    const audio = document.getElementById('player') as HTMLAudioElement
    playlistStore.init(audio, 'https://x', async () => 't')
    mountMiniBar(document.getElementById('player-bar') as HTMLElement)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'Hello' })
    const spy = vi.spyOn(playlistStore, 'toggle')
    document.querySelector<HTMLButtonElement>('.mini-bar button[data-action="toggle"]')!.click()
    expect(spy).toHaveBeenCalled()
  })

  it('queue button toggles #queue-panel hidden attribute via the open class', () => {
    const audio = document.getElementById('player') as HTMLAudioElement
    playlistStore.init(audio, 'https://x', async () => 't')
    mountMiniBar(document.getElementById('player-bar') as HTMLElement)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'Hello' })
    const panel = document.getElementById('queue-panel') as HTMLElement
    expect(panel.hidden).toBe(true)
    document.querySelector<HTMLButtonElement>('.mini-bar button[data-action="queue"]')!.click()
    expect(panel.hidden).toBe(false)
    expect(panel.classList.contains('open')).toBe(true)
  })
})
