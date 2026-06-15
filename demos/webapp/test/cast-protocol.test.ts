import { describe, expect, it } from 'vitest'
import { CAST_NAMESPACE, parseSenderMessage } from '../public/cast/protocol'

describe('cast protocol', () => {
  it('namespace uses the custom cast urn scheme', () => {
    expect(CAST_NAMESPACE).toMatch(/^urn:x-cast:/)
  })

  it('accepts well-formed control messages', () => {
    expect(parseSenderMessage({ type: 'PLAY' })).toEqual({ type: 'PLAY' })
    expect(parseSenderMessage({ type: 'SEEK', time: 12.5 })).toEqual({ type: 'SEEK', time: 12.5 })
    expect(parseSenderMessage({ type: 'SET_TOKEN', token: 'tok' })).toEqual({
      type: 'SET_TOKEN',
      token: 'tok',
    })
  })

  it('accepts LOAD with token and items', () => {
    const m = parseSenderMessage({
      type: 'LOAD',
      token: 'tok',
      items: [{ id: 'a', ref: { cb: 1, disc: 1, track: 1 }, meta: { title: 'T' } }],
    })
    expect(m?.type).toBe('LOAD')
  })

  it('accepts LOAD with autoplay flag', () => {
    const m = parseSenderMessage({
      type: 'LOAD',
      token: 'tok',
      items: [{ id: 'a', ref: { cb: 1, disc: 1, track: 1 }, meta: { title: 'T' } }],
      startId: 'a',
      positionSec: 5,
      autoplay: false,
    })
    expect(m).not.toBeNull()
    expect((m as { autoplay?: boolean }).autoplay).toBe(false)
  })

  it('rejects malformed messages', () => {
    expect(parseSenderMessage(null)).toBeNull()
    expect(parseSenderMessage('PLAY')).toBeNull()
    expect(parseSenderMessage({ type: 'NOPE' })).toBeNull()
    expect(parseSenderMessage({ type: 'LOAD', items: [] })).toBeNull()
    expect(parseSenderMessage({ type: 'SEEK', time: 'x' })).toBeNull()
    expect(parseSenderMessage({ type: 'SET_TOKEN' })).toBeNull()
  })
})
