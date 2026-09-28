// Палитра Apollo (AdamCYounis, lospec.com/palette-list/apollo), 46 цветов — та же, что в tools/art/apollo.py.
// Весь 3D-кадр после рендера сводится к этим цветам (см. post.ts), поэтому текстуры рисуем тоже только ими.

export const APOLLO = [
  '172038', '253a5e', '3c5e8b', '4f8fba', '73bed3', 'a4dddb',
  '19332d', '25562e', '468232', '75a743', 'a8ca58', 'd0da91',
  '4d2b32', '7a4841', 'ad7757', 'c09473', 'd7b594', 'e7d5b3',
  '341c27', '602c2c', '884b2b', 'be772b', 'de9e41', 'e8c170',
  '241527', '411d31', '752438', 'a53030', 'cf573c', 'da863e',
  '1e1d39', '402751', '7a367b', 'a23e8c', 'c65197', 'df84a5',
  '090a14', '10141f', '151d28', '202e37', '394a50', '577277',
  '819796', 'a8b5b2', 'c7cfcc', 'ebede9',
] as const

export type RGB = readonly [number, number, number]

export const RGB_OF: RGB[] = APOLLO.map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const)

/** Рампы по ролям, от тёмного к светлому — индексы в APOLLO. */
export const RAMP = {
  blue: [0, 1, 2, 3, 4, 5],
  green: [6, 7, 8, 9, 10, 11],
  skin: [12, 13, 14, 15, 16, 17],
  gold: [18, 19, 20, 21, 22, 23],
  red: [24, 25, 26, 27, 28, 29],
  plum: [30, 31, 32, 33, 34, 35],
  grey: [36, 37, 38, 39, 40, 41, 42, 43, 44, 45],
} as const

/** Цвет палитры строкой '#rrggbb'. */
export const hex = (i: number) => `#${APOLLO[i]}`
