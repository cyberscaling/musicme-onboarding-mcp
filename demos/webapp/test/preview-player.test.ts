import {
  LoadAbortedError,
  type PrefetchedSession,
  SecureAudioPlayer,
  type SecureAudioPlayerOptions,
  StreamError,
  type TrackRef,
} from '@cyberscaling/secure-audio-stream-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewAudioPlayer } from '../public/preview-player'

const TARGET_REF: TrackRef = { cb: 12, disc: 1, track: 3, context: 'on_demand' as const }
const DIRECT_REF: TrackRef = { cb: 34, disc: 2, track: 5, context: 'on_demand' as const }
const FULL_BUNDLE = {} as PrefetchedSession

const baseOptions: SecureAudioPlayerOptions = {
  workerUrl: 'https://stream.example/',
  getToken: vi.fn().mockResolvedValue('jwt'),
  audioElement: document.createElement('audio'),
}

function previewResult(previewSeconds: 60 | 90 = 60) {
  return {
    sessionId: 'preview-1',
    expiresAt: 999,
    previewSeconds,
  }
}

describe('PreviewAudioPlayer', () => {
  beforeEach(() => {
    vi.spyOn(SecureAudioPlayer.prototype, 'loadPreview').mockResolvedValue(previewResult())
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('PreviewAudioPlayer must not fetch directly')
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads a preview through the SDK and reports its duration', async () => {
    const ready = vi.fn()
    const player = new PreviewAudioPlayer(baseOptions, TARGET_REF, ready)

    await player.load(DIRECT_REF)

    expect(SecureAudioPlayer.prototype.loadPreview).toHaveBeenCalledWith(DIRECT_REF)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(ready).toHaveBeenCalledWith(60)
  })

  it('loads the captured target for a prefetched bundle', async () => {
    vi.mocked(SecureAudioPlayer.prototype.loadPreview).mockResolvedValue(previewResult(90))
    const ready = vi.fn()
    const player = new PreviewAudioPlayer(baseOptions, TARGET_REF, ready)

    await player.loadPrefetched(FULL_BUNDLE)

    expect(SecureAudioPlayer.prototype.loadPreview).toHaveBeenCalledWith(TARGET_REF)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(ready).toHaveBeenCalledWith(90)
  })

  it('waits for the SDK preview promise before reporting readiness', async () => {
    let resolvePreview: ((result: ReturnType<typeof previewResult>) => void) | undefined
    const loading = new Promise<ReturnType<typeof previewResult>>((resolve) => {
      resolvePreview = resolve
    })
    vi.mocked(SecureAudioPlayer.prototype.loadPreview).mockReturnValue(loading)
    const ready = vi.fn()
    const player = new PreviewAudioPlayer(baseOptions, TARGET_REF, ready)

    const load = player.load(DIRECT_REF)
    await Promise.resolve()

    expect(ready).not.toHaveBeenCalled()

    const resolve = resolvePreview
    if (!resolve) throw new Error('Deferred preview resolver was not initialized')
    resolve(previewResult(90))
    await load

    expect(ready).toHaveBeenCalledWith(90)
  })

  it.each([
    new LoadAbortedError(),
    new StreamError(503, 'unavailable'),
  ])('propagates SDK errors unchanged', async (error) => {
    vi.mocked(SecureAudioPlayer.prototype.loadPreview).mockRejectedValue(error)
    const ready = vi.fn()
    const player = new PreviewAudioPlayer(baseOptions, TARGET_REF, ready)

    await expect(player.load(DIRECT_REF)).rejects.toBe(error)
    expect(ready).not.toHaveBeenCalled()
  })

  it('does not report readiness after base preview loading is destroyed', async () => {
    vi.mocked(SecureAudioPlayer.prototype.loadPreview).mockRestore()
    let resolveToken: ((token: string) => void) | undefined
    const getToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve
        }),
    )
    const ready = vi.fn()
    const player = new PreviewAudioPlayer({ ...baseOptions, getToken }, TARGET_REF, ready)

    const load = player.load(DIRECT_REF)
    await Promise.resolve()
    player.destroy()

    const resolve = resolveToken
    if (!resolve) throw new Error('Deferred token resolver was not initialized')
    const rejected = expect(load).rejects.toBeInstanceOf(LoadAbortedError)
    resolve('jwt')

    await rejected

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
  })

  it('inherits the SDK destroy lifecycle', () => {
    const player = new PreviewAudioPlayer(baseOptions, TARGET_REF, vi.fn())

    expect(Object.hasOwn(PreviewAudioPlayer.prototype, 'destroy')).toBe(false)
    expect(() => player.destroy()).not.toThrow()
  })
})
