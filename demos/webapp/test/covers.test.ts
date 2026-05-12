import { describe, expect, it } from 'vitest'
import { coverUrl, placeholderDataUrl } from '../public/covers'

describe('coverUrl', () => {
  it('builds the CDN URL with default size 175 and pads cb to 13 digits', () => {
    expect(coverUrl('5400863209100')).toBe(
      'https://covers-ng4.hosting-media.net/jpgr175/u5400863209100.jpg',
    )
  })

  it('pads short cb with leading zeros', () => {
    expect(coverUrl('1', 90)).toBe('https://covers-ng4.hosting-media.net/jpgr90/u0000000000001.jpg')
  })

  it('accepts all documented variants', () => {
    expect(coverUrl('1', 60)).toMatch(/\/jpgr60\//)
    expect(coverUrl('1', 90)).toMatch(/\/jpgr90\//)
    expect(coverUrl('1', 175)).toMatch(/\/jpgr175\//)
    expect(coverUrl('1', 295)).toMatch(/\/jpgr295\//)
    expect(coverUrl('1', 500)).toMatch(/\/jpgr500\//)
    expect(coverUrl('1', 1000)).toMatch(/\/jpgr1000\//)
  })
})

describe('placeholderDataUrl', () => {
  it('returns a data: URL', () => {
    expect(placeholderDataUrl()).toMatch(/^data:image\/svg\+xml/)
  })
})
