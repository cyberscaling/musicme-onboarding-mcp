import type {
  PlaylistOptions,
  SecureAudioPlayerOptions,
} from '@cyberscaling/secure-audio-stream-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setTestCastStore, CastStore } from '../public/cast-sender'
import {
  LS_KEY,
  PREVIEW_MODE_KEY,
  type PreviewPlayerFactory,
  playlistStore,
  type TrackMeta,
} from '../public/playlist-store'
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

const previewPlayerFactory: PreviewPlayerFactory = (opts, _ref, _onReady) =>
  makeMockPlayer(opts.audioElement as HTMLAudioElement) as never

function makeAudio(): HTMLAudioElement {
  return document.createElement('audio')
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ refs_warmed: 0 }), { status: 200 })),
  )
  playlistStore.reset()
  __setTestCastStore(null)
})

afterEach(() => {
  __setTestCastStore(null)
  vi.unstubAllGlobals()
})

describe('playlistStore — init + accessors', () => {
  it('starts empty before init', () => {
    expect(playlistStore.items).toEqual([])
    expect(playlistStore.currentIndex).toBe(-1)
  })

  it('init creates an underlying Playlist tied to the supplied audio', () => {
    const audio = makeAudio()
    playlistStore.init(audio, 'https://x', async () => 't', playerFactory)
    expect(playlistStore.audio).toBe(audio)
  })
})

describe('playlistStore — enqueue / remove / move', () => {
  it('enqueue adds an item with meta and persists to localStorage', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'A', coverCb: '1' })
    expect(playlistStore.items).toHaveLength(1)
    expect(playlistStore.items[0]!.meta).toMatchObject({ title: 'A' })
    const stored = JSON.parse(localStorage.getItem(LS_KEY)!) as { items: unknown[] }
    expect(stored.items).toHaveLength(1)
  })

  it('remove deletes by id', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'A' })
    playlistStore.enqueue({ cb: 2, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'B' })
    const id = playlistStore.items[0]!.id
    playlistStore.remove(id)
    expect(playlistStore.items).toHaveLength(1)
    expect(playlistStore.items[0]!.meta?.title).toBe('B')
  })
})

describe('playlistStore — change subscription', () => {
  it('onChange fires on mutation', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory)
    const handler = vi.fn()
    const off = playlistStore.onChange(handler)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'A' })
    expect(handler).toHaveBeenCalled()
    off()
    handler.mockClear()
    playlistStore.enqueue({ cb: 2, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'B' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('playlistStore — persist / restore', () => {
  it('restore loads previously stored items but does NOT autoplay', () => {
    const meta: TrackMeta = { title: 'Saved', coverCb: '1' }
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        items: [{ id: 'fixed-id', ref: { cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, meta }],
        currentIndex: -1,
      }),
    )
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory)
    expect(playlistStore.items).toHaveLength(1)
    expect(playlistStore.items[0]!.meta?.title).toBe('Saved')
    // No autoplay : currentIndex stays -1 even though we persisted 0 earlier.
    expect(playlistStore.currentIndex).toBe(-1)
  })

  it('clear empties the playlist and removes LS entry', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'A' })
    playlistStore.clear()
    expect(playlistStore.items).toEqual([])
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })
})

describe('playlistStore — preview mode', () => {
  it('defaults to full playback and restores the persisted preview selection', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory)
    expect(playlistStore.previewEnabled).toBe(false)

    playlistStore.reset()
    localStorage.setItem(PREVIEW_MODE_KEY, 'preview')
    playlistStore.init(
      makeAudio(),
      'https://x',
      async () => 't',
      playerFactory,
      previewPlayerFactory,
    )

    expect(playlistStore.previewEnabled).toBe(true)
  })

  it('persists preview selection without changing the active track', async () => {
    const normalFactory = vi.fn((opts: SecureAudioPlayerOptions) =>
      makeMockPlayer(opts.audioElement as HTMLAudioElement),
    ) as NonNullable<PlaylistOptions['playerFactory']>
    const previewFactory = vi.fn(previewPlayerFactory)
    playlistStore.init(makeAudio(), 'https://x', async () => 't', normalFactory, previewFactory)
    playlistStore.playTrack({ cb: 1, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'Current' })
    await vi.waitFor(() => expect(normalFactory).toHaveBeenCalledTimes(1))

    expect(playlistStore.setPreviewEnabled(true)).toBe(true)

    expect(playlistStore.previewEnabled).toBe(true)
    expect(playlistStore.activePreviewSeconds).toBeNull()
    expect(normalFactory).toHaveBeenCalledTimes(1)
    expect(previewFactory).not.toHaveBeenCalled()
    expect(localStorage.getItem(PREVIEW_MODE_KEY)).toBe('preview')
  })

  it('uses the preview factory for the next track and reports its duration', async () => {
    const normalFactory = vi.fn(playerFactory)
    const previewFactory = vi.fn(previewPlayerFactory)
    playlistStore.init(makeAudio(), 'https://x', async () => 't', normalFactory, previewFactory)
    playlistStore.setPreviewEnabled(true)

    playlistStore.playTrack({ cb: 2, disc: 1, track: 4, context: 'on_demand' as const }, { title: 'Preview' })

    await vi.waitFor(() => expect(previewFactory).toHaveBeenCalledTimes(1))
    expect(previewFactory.mock.calls[0]?.[1]).toEqual({ cb: 2, disc: 1, track: 4, context: 'on_demand' as const })
    previewFactory.mock.calls[0]?.[2](90)
    expect(playlistStore.activePreviewSeconds).toBe(90)
    expect(normalFactory).not.toHaveBeenCalled()
  })

  it('keeps the active preview badge when full mode is selected for the next track', async () => {
    const previewFactory = vi.fn(previewPlayerFactory)
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory, previewFactory)
    playlistStore.setPreviewEnabled(true)
    playlistStore.playTrack({ cb: 3, disc: 1, track: 1, context: 'on_demand' as const }, { title: 'Preview' })
    await vi.waitFor(() => expect(previewFactory).toHaveBeenCalledTimes(1))
    previewFactory.mock.calls[0]?.[2](60)

    playlistStore.setPreviewEnabled(false)

    expect(playlistStore.previewEnabled).toBe(false)
    expect(playlistStore.activePreviewSeconds).toBe(60)
  })

  it('refuses preview mode while Cast is connected', async () => {
    const framework = new FakeCastFramework()
    const cast = new CastStore({ framework, mintToken: vi.fn().mockResolvedValue('tok') })
    __setTestCastStore(cast)
    await cast.init('APPID', 3600)
    framework.connect()
    playlistStore.init(makeAudio(), 'https://x', async () => 't', playerFactory)

    expect(playlistStore.setPreviewEnabled(true)).toBe(false)
    expect(playlistStore.previewEnabled).toBe(false)
    expect(localStorage.getItem(PREVIEW_MODE_KEY)).toBeNull()
  })
})
