/** Линии с разрывами: отсутствие данных не означает ноль. */
export function chartPath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let previous = false
  return values.map((v, i) => {
    if (v === null) { previous = false; return '' }
    const segment = `${previous ? 'L' : 'M'}${x(i)},${y(v)}`
    previous = true
    return segment
  }).join(' ')
}


/** Ширина графика: во всю колонку (на 1440 — не половина листа), но не теснее 48 px на ход; уже — прокрутка. */
export const trendWidth = (points: number, fit = 0) => Math.max(fit > 0 ? fit : 600, 88 + (points - 1) * 48)
