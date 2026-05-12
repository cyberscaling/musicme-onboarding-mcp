/**
 * Cover CDN URL builder.
 *
 * Pattern: https://covers-ng4.hosting-media.net/jpgr<size>/u<cb_padded_13>.jpg
 * - cb padded to 13 digits with leading zeros (global search may return shorter cb).
 * - Valid sizes: 60 / 90 / 120 / 175 / 250 / 295 / 500 / 600 / 1000. Others 404.
 */
const CDN_BASE = 'https://covers-ng4.hosting-media.net'

export type CoverSize = 60 | 90 | 120 | 175 | 250 | 295 | 500 | 600 | 1000

export function coverUrl(cb: string | number, size: CoverSize = 175): string {
  const padded = String(cb).padStart(13, '0')
  return `${CDN_BASE}/jpgr${size}/u${padded}.jpg`
}

export type AvatarSize = 80 | 120 | 176 | 240

export function artistAvatarUrl(artistId: number, size: AvatarSize = 176): string {
  return `${CDN_BASE}/art/r${size}/${artistId}.jpg`
}
