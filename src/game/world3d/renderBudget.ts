/** Размер буфера в игровых точках, без множителя devicePixelRatio. */
export function renderSize(cw: number, ch: number, quality = 1) {
  const base = cw >= ch ? Math.max(2, Math.round(ch / 230)) : Math.max(2, Math.round(cw / 130))
  let px = Math.max(2, Math.round(base / Math.max(0.4, Math.min(1, quality))))
  // Ограничиваем и широкие мониторы, и экраны необычных пропорций.
  while (Math.ceil(cw / px) * Math.ceil(ch / px) > 120_000) px++
  return { base, px, w: Math.ceil(cw / px), h: Math.ceil(ch / px) }
}
