import { expect, it } from 'vitest'
import { offer } from '../content/scenarios/offer'
import { tara } from '../content/scenarios/tara'
import { istanbul } from '../content/scenarios/istanbul'
import { BEHAVIOR_DICT } from './behaviors'
import { groundAnalysis } from './offerEvidence'
import { groundedOffline } from './offline'
import type { Offer, Scenario } from './types'

// Отказ от числа собеседника — не предложение этого числа (SIDES5, партия капитана в «Оффере» 19.10): «210, к сожалению,
// никто щас не предоставляет» правила и быстрый Яндекс читали как оклад 210, и Дарина радовалась «шагу», которого не было.
const refused: [Scenario, string, Offer][] = [
  [offer, '210, к сожалению, никто щас не предоставляет.', { salary: 4 }],
  [offer, 'Двести десять, к сожалению, никто сейчас не даёт.', { salary: 4 }],
  [offer, '210 — это много, никто столько не платит.', { salary: 4 }],
  [offer, '210 мы не потянем.', { salary: 4 }],
  [offer, 'Таких денег, 210, у нас нет.', { salary: 4 }],
  [offer, 'Вы просите 210, но это нереально.', { salary: 4 }],
  [tara, 'Ваши 212 — это перебор.', { price: 0 }],
  [tara, '212 мы не тянем.', { price: 0 }],
  [tara, 'За 212 не возьмём.', { price: 0 }],
  [tara, '212? Да вы что.', { price: 0 }],
  [tara, 'Двести двенадцать — дорого.', { price: 0 }],
  [tara, 'Два года — слишком долго.', { term: 3 }],
  [istanbul, 'Nobody gives 480 these days.', { price: 0 }],
  [istanbul, '480 is crazy.', { price: 0 }],
  [istanbul, '16 weeks is way too long.', { delivery: 0 }],
  [istanbul, "We can't wait 16 weeks.", { delivery: 0 }],
  [istanbul, 'Forget about 100% upfront.', { payment: 0 }],
  [istanbul, 'One year warranty is not enough.', { warranty: 0 }],
  [istanbul, '480 is too much for us.', { price: 0 }],
]
it.each(refused)('%#: отказ — не предложение: правила и метка модели пусты', (sc, text, label) => {
  expect(groundedOffline(sc, text, BEHAVIOR_DICT).offer ?? {}).toEqual({})
  expect(groundAnalysis(sc, text, { behaviors: [], offer: label }).offer ?? {}).toEqual({})
})

const own: [Scenario, string, Offer][] = [
  [tara, 'Давайте 196, а 212 — это много.', { price: 2 }],
  [tara, 'Цена 196, это не слишком много.', { price: 2 }],
  [istanbul, "Let's do 450, 480 is too much.", { price: 2 }],
  [offer, 'Квартиру на шесть месяцев, но зарплата будет 150. 210, к сожалению, никто щас не предоставляет.', { housing: 2, salary: 0 }],
]
it.each(own)('%#: своё предложение рядом с отказом остаётся', (sc, text, want) => {
  expect(groundedOffline(sc, text, BEHAVIOR_DICT).offer).toEqual(want)
})
