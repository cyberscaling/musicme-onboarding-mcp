/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setTestPlayerFactory } from '@cyberscaling/secure-audio-stream-client'
import { mountQueuePanel } from '../public/components/queue-panel'
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
  document.body.innerHTML = '<div id="queue-panel"></div><audio id="player"></audio>'
  localStorage.clear()
  __setTestPlayerFactory((opts) => makeMockPlayer(opts.audioElement as HTMLAudioElement) as never)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
  playlistStore.reset()
  const audio = document.getElementById('player') as HTMLAudioElement
  playlistStore.init(audio, 'https://x', async () => 't')
  mountQueuePanel(document.getElementById('queue-panel') as HTMLElement)
})

afterEach(() => {
  __setTestPlayerFactory(null)
  vi.unstubAllGlobals()
})

describe('queue-panel', () => {
  it('renders empty state', () => {
    expect(document.querySelector('#queue-panel .muted')!.textContent).toContain('empty')
  })

  it('renders one row per item with cover + title + remove', () => {
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A', coverCb: '1' })
    playlistStore.enqueue({ cb: 2, disc: 1, track: 1 }, { title: 'B', coverCb: '2' })
    const rows = document.querySelectorAll('#queue-panel .qrow')
    expect(rows.length).toBe(2)
    expect(rows[0]!.querySelector('.t')!.textContent).toContain('A')
    expect(rows[1]!.querySelector('img.cv')!.getAttribute('src')).toContain('/jpgr90/u0000000000002.jpg')
  })

  it('click on remove (✕) calls playlistStore.remove(id)', () => {
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A' })
    const removeBtn = document.querySelector<HTMLElement>('.qrow [data-action="remove"]')!
    removeBtn.click()
    expect(playlistStore.items).toHaveLength(0)
  })

  it('click on row body calls playlistStore.jumpTo(id)', () => {
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A' })
    playlistStore.enqueue({ cb: 2, disc: 1, track: 1 }, { title: 'B' })
    const spy = vi.spyOn(playlistStore, 'jumpTo')
    const row = document.querySelectorAll<HTMLElement>('.qrow')[1]!
    row.querySelector<HTMLElement>('.t')!.click()
    expect(spy).toHaveBeenCalledWith(playlistStore.items[1]!.id)
  })

  it('drop on another row triggers playlistStore.move(draggedId, targetIdx)', () => {
    playlistStore.enqueue({ cb: 1, disc: 1, track: 1 }, { title: 'A' })
    playlistStore.enqueue({ cb: 2, disc: 1, track: 1 }, { title: 'B' })
    playlistStore.enqueue({ cb: 3, disc: 1, track: 1 }, { title: 'C' })
    const rows = document.querySelectorAll<HTMLElement>('.qrow')
    const draggedId = rows[2]!.dataset.id!

    // Simulate dragstart on row 2 → drop on row 0
    const dt = new (globalThis as { DataTransfer: new () => DataTransfer }).DataTransfer()
    dt.setData('text/plain', draggedId)

    const dropEvent = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
    rows[0]!.dispatchEvent(dropEvent)

    expect(playlistStore.items[0]!.meta!.title as string).toBe('C')
  })
})
