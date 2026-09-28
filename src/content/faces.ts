// Лица для своих дел. У Марата и Дарины из папки свои портреты, а собеседнику из сгенерированного дела
// лицо подбираем из пула: по полу, по сфере и должности, по возрасту, если модель его назвала.
// Спрайты рисует tools/art/people.py, картинки перечислены в src/game/ui/assets.ts.

export interface Face {
  id: string
  female: boolean
  age: number
  /** сфера, должность или компания, под которые этот типаж подходит лучше других */
  fits: RegExp
}

export const FACES = [
  { id: 'foreman', female: false, age: 50, fits: /стро|подряд|ремонт|монтаж|прораб|бригад|склад|логист|завод|цех|производ|клининг/i },
  { id: 'dev', female: false, age: 28, fits: /(^|[^\p{L}])it|айти|разработ|стартап|программ|тимлид|техническ|сайт|приложен|продукт|цифр|маркетинг|дизайн/iu },
  { id: 'official', female: false, age: 60, fits: /госзаказ|гос\.|государ|муницип|администрац|бюджет|тендер|44-фз|учрежден|министер|департамент|ведомств/i },
  { id: 'hr', female: true, age: 42, fits: /найм|(^|[^\p{L}])hr|кадр|персонал|рекрут|ваканс|оклад|сотрудник|оффер/iu },
  { id: 'realtor', female: true, age: 34, fits: /аренд|недвиж|помещени|офис|бизнес-центр|риелт|квартир|собственни/i },
  { id: 'buyer', female: true, age: 52, fits: /закуп|ритейл|магазин|сеть|поставк|поставщ|торгов|продаж|опт|товар/i },
] as const satisfies readonly Face[]

export type FaceId = (typeof FACES)[number]['id']

const FEMALE = /(ова|ева|ёва|ина|ына|ая|ская|цкая)$/i

/** Пол по имени и фамилии — для старых дел, где модель его не назвала. */
export function looksFemale(name: string): boolean {
  const [first = '', last = ''] = name.trim().split(/[\s,]+/)
  return FEMALE.test(last) || (/[ая]$/i.test(first) && !/(илья|никита|фома|лука|кузьма|савва)$/i.test(first))
}

/**
 * Лицо для дела. Детерминированно: то же дело — то же лицо, разные дела — чаще разные.
 * Подходящий по сфере типаж и близкий возраст весят больше, но остальные лица того же пола тоже выпадают,
 * иначе три дела про аренду подряд дали бы одно и то же лицо.
 */
export function pickFace(o: { id: string; female: boolean; text: string; age?: number }): FaceId {
  const pool = FACES.filter((f) => f.female === o.female)
  const byAge = (a: number) => (!o.age ? 1 : Math.abs(o.age - a) <= 8 ? 3 : Math.abs(o.age - a) <= 15 ? 1.5 : 0.5)
  const weights = pool.map((f) => (f.fits.test(o.text) ? 8 : 1) * byAge(f.age))
  // id своего дела — «gen-» и hex-хэш: его хвост и есть число от 0 до 1
  const u = parseInt(o.id.replace(/[^0-9a-f]/gi, '').slice(-8) || '0', 16) / 2 ** 32
  let n = u * weights.reduce((s, w) => s + w, 0)
  for (let i = 0; i < pool.length; i++) {
    n -= weights[i]
    if (n < 0) return pool[i].id
  }
  return pool[0].id
}
