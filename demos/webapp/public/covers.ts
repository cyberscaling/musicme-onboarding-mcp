/**
 * Cover art helpers.
 *
 * URL pattern (per docs/musicme-api.md) :
 *   https://covers-ng4.hosting-media.net/jpgr<size>/u<cb_padded_13>.jpg
 *
 * - `cb_padded_13` : EAN on 13 digits with leading zeros. `/search/global`
 *   sometimes returns cb without leading zeros — pad systematically.
 * - Valid sizes (variants) : 60 / 90 / 120 / 175 / 250 / 295 / 500 / 600 / 1000.
 *   Other widths 404 on the CDN.
 * - Recommended :
 *     90  — mini-bar / queue rows
 *     175 — grid cards
 *     295 — album header
 *     500 — hero / fullscreen
 */
const CDN_BASE = 'https://covers-ng4.hosting-media.net'

export type CoverSize = 60 | 90 | 120 | 175 | 250 | 295 | 500 | 600 | 1000

export function coverUrl(cb: string, size: CoverSize = 175): string {
  const padded = cb.padStart(13, '0')
  return `${CDN_BASE}/jpgr${size}/u${padded}.jpg`
}

/**
 * Artist avatar URL.
 * Pattern : https://covers-ng4.hosting-media.net/art/r<size>/<id>.jpg
 * (different prefix from album covers — `art/` segment + raw artist id, no padding.)
 * Sizes observed in the wild : r80, r120, r176, r240.
 */
export type AvatarSize = 80 | 120 | 176 | 240
export function artistAvatarUrl(artistId: number, size: AvatarSize = 176): string {
  return `${CDN_BASE}/art/r${size}/${artistId}.jpg`
}

export function placeholderDataUrl(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#222"/>' +
    '<text x="50" y="55" font-family="monospace" font-size="14" fill="#666" text-anchor="middle">♪</text>' +
    '</svg>'
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
