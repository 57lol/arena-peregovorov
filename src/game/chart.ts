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

