import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Playlist, __setTestPlayerFactory } from '@cyberscaling/secure-audio-stream-client'
import { LS_KEY, type TrackMeta, playlistStore } from '../public/playlist-store'

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

function makeAudio(): HTMLAudioElement {
  return document.createElement('audio')
}

beforeEach(() => {
  localStorage.clear()
  __setTestPlayerFactory((opts) => makeMockPlayer(opts.audioElement as HTMLAudioElement) as never)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ refs_warmed: 0 }), { status: 200 })),
  )
  playlistStore.reset()
})

afterEach(() => {
  __setTestPlayerFactory(null)
  vi.unstubAllGlobals()
})

describe('playlistStore — init + accessors', () => {
  it('starts empty before init', () => {
    expect(playlistStore.items).toEqual([])
    expect(playlistStore.currentIndex).toBe(-1)
  })

  it('init creates an underlying Playlist tied to the supplied audio', () => {
    const audio = makeAudio()
    playlistStore.init(audio, 'https://x', async () => 't')
    expect(playlistStore.audio).toBe(audio)
  })
})

describe('playlistStore — enqueue / remove / move', () => {
  it('enqueue adds an item with meta and persists to localStorage', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't')
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A', coverCb: '1' })
    expect(playlistStore.items).toHaveLength(1)
    expect(playlistStore.items[0]!.meta).toMatchObject({ title: 'A' })
    const stored = JSON.parse(localStorage.getItem(LS_KEY)!) as { items: unknown[] }
    expect(stored.items).toHaveLength(1)
  })

  it('remove deletes by id', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't')
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A' })
    playlistStore.enqueue({ cb: 2, disc: 1, track: 1 }, { title: 'B' })
    const id = playlistStore.items[0]!.id
    playlistStore.remove(id)
    expect(playlistStore.items).toHaveLength(1)
    expect(playlistStore.items[0]!.meta?.title).toBe('B')
  })
})

describe('playlistStore — change subscription', () => {
  it('onChange fires on mutation', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't')
    const handler = vi.fn()
    const off = playlistStore.onChange(handler)
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A' })
    expect(handler).toHaveBeenCalled()
    off()
    handler.mockClear()
    playlistStore.enqueue({ cb: 2, disc: 1, track: 1 }, { title: 'B' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('playlistStore — persist / restore', () => {
  it('restore loads previously stored items but does NOT autoplay', () => {
    const meta: TrackMeta = { title: 'Saved', coverCb: '1' }
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        items: [{ id: 'fixed-id', ref: { cb: 1, disc: 1, track: 1 }, meta }],
        currentIndex: -1,
      }),
    )
    playlistStore.init(makeAudio(), 'https://x', async () => 't')
    expect(playlistStore.items).toHaveLength(1)
    expect(playlistStore.items[0]!.meta?.title).toBe('Saved')
    // No autoplay : currentIndex stays -1 even though we persisted 0 earlier.
    expect(playlistStore.currentIndex).toBe(-1)
  })

  it('clear empties the playlist and removes LS entry', () => {
    playlistStore.init(makeAudio(), 'https://x', async () => 't')
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A' })
    playlistStore.clear()
    expect(playlistStore.items).toEqual([])
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })
})
