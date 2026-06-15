/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CastStore } from '../public/cast-sender'
import { FakeCastFramework } from './helpers-cast'

describe('CastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function make() {
    const fw = new FakeCastFramework()
    const mintToken = vi.fn().mockResolvedValue('tok-1')
    const store = new CastStore({ framework: fw, mintToken })
    return { fw, store, mintToken }
  }

  it('stays unavailable when the framework fails to load', async () => {
    const { fw, store } = make()
    fw.failLoad = true
    await store.init('APPID', 3600)
    expect(store.state).toBe('unavailable')
  })

  it('becomes available after init, connected on session start', async () => {
    const { fw, store } = make()
    await store.init('APPID', 3600)
    expect(store.state).toBe('available')
    fw.connect()
    expect(store.state).toBe('connected')
    fw.disconnect()
    expect(store.state).toBe('available')
  })

  it('sendLoad mints a token and sends LOAD with the snapshot', async () => {
    const { fw, store, mintToken } = make()
    await store.init('APPID', 3600)
    fw.connect()
    await store.sendLoad({
      items: [{ id: 'a', ref: { cb: 1, disc: 1, track: 1 }, meta: { title: 'A' } }],
      startId: 'a',
      positionSec: 42,
    })
    expect(mintToken).toHaveBeenCalled()
    expect(fw.sent.at(-1)).toMatchObject({
      type: 'LOAD',
      token: 'tok-1',
      startId: 'a',
      positionSec: 42,
    })
  })

  it('pushes a fresh token periodically while connected', async () => {
    const { fw, store, mintToken } = make()
    await store.init('APPID', 100)
    fw.connect()
    mintToken.mockClear()
    await vi.advanceTimersByTimeAsync(81_000)
    expect(mintToken).toHaveBeenCalled()
    expect(fw.sent.some((m) => m.type === 'SET_TOKEN')).toBe(true)
  })

  it('stops the token refresh after disconnect (no leaked interval)', async () => {
    const { fw, store, mintToken } = make()
    await store.init('APPID', 100)
    fw.connect()
    fw.disconnect()
    fw.connect()
    mintToken.mockClear()
    await vi.advanceTimersByTimeAsync(200_000)
    // One running interval → at most one mint per 80s window; never a doubled
    // count from a leaked timer. A disconnect with no reconnect must stay silent.
    fw.disconnect()
    mintToken.mockClear()
    await vi.advanceTimersByTimeAsync(200_000)
    expect(mintToken).not.toHaveBeenCalled()
  })

  it('mirrors receiver STATUS messages and clears them on disconnect', async () => {
    const { fw, store } = make()
    await store.init('APPID', 3600)
    fw.connect()
    fw.pushMessage({
      type: 'STATUS',
      state: 'playing',
      itemId: 'a',
      index: 0,
      currentTime: 1,
      duration: 10,
      meta: { title: 'A' },
    })
    expect(store.lastStatus?.state).toBe('playing')
    fw.disconnect()
    expect(store.lastStatus).toBeNull()
  })

  it('control sends simple commands only while connected', async () => {
    const { fw, store } = make()
    await store.init('APPID', 3600)
    store.control('PLAY')
    expect(fw.sent.length).toBe(0)
    fw.connect()
    store.control('NEXT')
    expect(fw.sent.at(-1)).toEqual({ type: 'NEXT' })
  })

  it('sendLoad forwards autoplay', async () => {
    const { fw, store } = make()
    await store.init('APPID', 3600)
    fw.connect()
    await store.sendLoad({
      items: [{ id: 'a', ref: { cb: 1, disc: 1, track: 1 }, meta: { title: 'A' } }],
      startId: 'a',
      autoplay: false,
    })
    expect(fw.sent.at(-1)).toMatchObject({ type: 'LOAD', startId: 'a', autoplay: false })
  })

  it('sendReconcile sends LOAD with startId=currentId and no positionSec', async () => {
    const { fw, store } = make()
    await store.init('APPID', 3600)
    fw.connect()
    await store.sendReconcile(
      [
        { id: 'a', ref: { cb: 1, disc: 1, track: 1 }, meta: { title: 'A' } },
        { id: 'b', ref: { cb: 1, disc: 1, track: 2 }, meta: { title: 'B' } },
      ],
      'b',
    )
    const m = fw.sent.at(-1) as { type: string; startId?: string; positionSec?: number }
    expect(m.type).toBe('LOAD')
    expect(m.startId).toBe('b')
    expect(m.positionSec).toBeUndefined()
  })

  it('seek sends SEEK only while connected', async () => {
    const { fw, store } = make()
    await store.init('APPID', 3600)
    store.seek(42)
    expect(fw.sent.length).toBe(0)
    fw.connect()
    store.seek(42)
    expect(fw.sent.at(-1)).toEqual({ type: 'SEEK', time: 42 })
  })
})
