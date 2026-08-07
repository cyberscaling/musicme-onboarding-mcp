import type { PlaylistOptions } from '@cyberscaling/secure-audio-stream-client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { __setTestCastStore, CastStore } from '../public/cast-sender'
import { mountTopNav } from '../public/components/top-nav'
import { PREVIEW_MODE_KEY, playlistStore } from '../public/playlist-store'
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

let framework: FakeCastFramework

beforeAll(async () => {
  document.body.innerHTML = '<div id="top-nav"></div><audio id="player"></audio>'
  localStorage.clear()
  playlistStore.reset()
  framework = new FakeCastFramework()
  const cast = new CastStore({ framework, mintToken: vi.fn().mockResolvedValue('tok') })
  __setTestCastStore(cast)
  await cast.init('APPID', 3600)
  mountTopNav(document.getElementById('top-nav') as HTMLElement)
})

afterAll(() => {
  playlistStore.reset()
  __setTestCastStore(null)
})

describe('top-nav preview toggle', () => {
  it('selects the next-track mode and disables the control while Cast is connected', () => {
    const full = document.querySelector<HTMLButtonElement>('[data-mode="full"]')!
    const preview = document.querySelector<HTMLButtonElement>('[data-mode="preview"]')!

    expect(full.getAttribute('aria-pressed')).toBe('true')
    expect(preview.getAttribute('aria-pressed')).toBe('false')

    localStorage.setItem(PREVIEW_MODE_KEY, 'preview')
    playlistStore.init(
      document.getElementById('player') as HTMLAudioElement,
      'https://stream.example',
      async () => 'tok',
      playerFactory,
    )

    expect(full.getAttribute('aria-pressed')).toBe('false')
    expect(preview.getAttribute('aria-pressed')).toBe('true')

    full.click()
    expect(playlistStore.previewEnabled).toBe(false)

    preview.click()

    expect(playlistStore.previewEnabled).toBe(true)
    expect(full.getAttribute('aria-pressed')).toBe('false')
    expect(preview.getAttribute('aria-pressed')).toBe('true')

    framework.connect()

    expect(full.disabled).toBe(true)
    expect(preview.disabled).toBe(true)
    expect(preview.title).toBe('Déconnectez Cast pour modifier le mode de lecture')
  })
})
