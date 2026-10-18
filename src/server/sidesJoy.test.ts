import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS, harder } from '../content/scenarios'
import generated from '../engine/__fixtures__/generatedScenario.json'
import { templateLine } from '../engine/offline'
import { openingAnchor } from '../engine/policy'
import { initialState } from '../engine/turn'
import type { Decision, Issue, Offer, Scenario } from '../engine/types'
import { bestOption } from '../engine/utility'
import { checkOpener, openerPrompt } from './opener'
import { checkPiece, frameFor, system, wrongJoy } from './voice'

// «Кто чему рад» (SIDES5, 19.10): по очкам движка — его уступка, его выигрыш, шаг игрока. Капитан: «персонажи постоянно
// радуются тому, что им не выгодно». Эмре: «Delivery in eight weeks, I take it, we agree here. For this I move the price».

const CASES: Scenario[] = [...ALL_SCENARIOS.flatMap((sc) => [sc, harder(sc)]), generated as unknown as Scenario]
const ctx = { said: '', heard: '', mine: [] }
const O = (sc: Scenario, id: string) => sc.opponent.profile.points[id]
const P = (sc: Scenario, id: string) => sc.player.profile.points[id]
const deal = (sc: Scenario) => sc.issues.filter((i) => i.kind !== 'compatible')
/** его листок целиком: лучшее по каждому пункту, совместимый — в выгодном обоим */
const sheet = (sc: Scenario): Offer => ({ ...openingAnchor(sc), ...Object.fromEntries(sc.issues.filter((i) => i.kind === 'compatible').map((i) => [i.id, bestOption(sc.opponent.profile, i.id)])) })
const title = (i: Issue) => `«${i.title.toLowerCase()}»`

function counterFrame(sc: Scenario, i: Issue, a: number, b: number, named: Offer) {
  const prev = { ...sheet(sc), [i.id]: a }
  const d: Decision = { kind: 'counter', offer: { ...prev, [i.id]: b } }
  return frameFor(sc, d, { ...initialState(sc), playerStance: named, lastOpponentOffer: prev }, prev, {})
}

describe('рамка: кто кому уступает — по очкам, на каждом варианте каждого пункта', () => {
  for (const sc of CASES) {
    it(`${sc.id}: своя уступка — «уступка ему, нехотя», шаг игрока — «его шаг», а не «сходишься, как согласие»`, () => {
      for (const i of deal(sc)) for (const a of i.options.keys()) for (const b of i.options.keys()) {
        if (a === b) continue
        // игрок просил ровно b — как Эмре на «восемь недель»; и игрок просил другое — движок сам дал b
        for (const named of [{ [i.id]: b }, { [i.id]: a }]) {
          const f = counterFrame(sc, i, a, b, named)
          const at = `${sc.id}/${i.id} ${i.options[a]} → ${i.options[b]}`
          expect(f.text, at).not.toMatch(/сходишься с тем, что он предлагал|как согласие/)
          if (O(sc, i.id)[b] < O(sc, i.id)[a]) {
            expect(f.text, at).toContain(`${title(i)} — твоя уступка ему`)
            expect(f.text, at).toMatch(/не радуйся, не благодари/)
          } else expect(f.text, at).not.toMatch(new RegExp(`${title(i).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*— тво(я|и) уступк`))
          if (O(sc, i.id)[b] > O(sc, i.id)[a] && named[i.id] === b) expect(f.text, at).toContain(`По ${title(i)} он сам предложил тебе больше`)
          else expect(f.text, at).not.toContain(`По ${title(i)} он сам предложил тебе больше`)
        }
      }
    })

    it(`${sc.id}: согласие на сделку подписывает, что в ней его уступка, а что ему отдал игрок`, () => {
      for (const i of deal(sc)) for (const x of i.options.keys()) {
        const d = { ...sheet(sc), [i.id]: x }
        const f = frameFor(sc, { kind: 'accept' }, { ...initialState(sc), status: 'deal', deal: d, tableOffer: d, playerStance: d }, d, d)
        const item = `«${i.title.toLowerCase()}: ${i.options[x]}»`
        const gave = /Тут ты уступил: (.*?) — о (нём|них)/.exec(f.text)?.[1] ?? ''
        const got = /Он тебе отдал: (.*?) — этим/.exec(f.text)?.[1] ?? ''
        expect(gave.includes(item), `${sc.id}/${i.id}=${i.options[x]} уступил`).toBe(O(sc, i.id)[x] < Math.max(...O(sc, i.id)))
        expect(got.includes(item), `${sc.id}/${i.id}=${i.options[x]} отдал`).toBe(O(sc, i.id)[x] >= Math.max(...O(sc, i.id)) && P(sc, i.id)[x] < Math.max(...P(sc, i.id)))
      }
    })

    it(`${sc.id}: проверка реплики — радость своей уступке вырезается, радость шагу игрока — нет`, () => {
      for (const i of deal(sc)) for (const x of i.options.keys()) {
        const prev = sheet(sc)
        const best = prev[i.id]!
        if (x === best) continue
        // движок уступил x (ему хуже листка): «x — отлично, беру» — ошибка
        const f = counterFrame(sc, i, best, x, { [i.id]: x })
        const at = `${sc.id}/${i.id}=${i.options[x]}`
        // «нет» — слишком коротко, чтобы узнать вариант по тексту: такой держит рамка, а не проверка
        if (!/\p{L}{4,}|\d/u.test(i.options[x])) continue
        expect(wrongJoy(sc, f, `${i.options[x]} — отлично, беру.`), at).toBe(O(sc, i.id)[x] < O(sc, i.id)[best])
        expect(checkPiece(sc, f, `Ладно, ${i.options[x]} — так и быть.`, ctx).hard.filter((h) => /радуешься/.test(h)), at).toEqual([])
        // игрок сам уступил ему его лучшее — радоваться можно
        const g = frameFor(sc, { kind: 'hold', reason: 'no_movement' }, { ...initialState(sc), playerStance: { [i.id]: best }, lastOpponentOffer: prev }, prev, { [i.id]: x })
        expect(wrongJoy(sc, g, `${i.options[best]} — отлично, спасибо.`), at).toBe(false)
      }
    })
  }

  it('Эмре 19.10: «восемь недель — беру, сошлись» на свою уступку; рамка говорит, что это его уступка', () => {
    const sc = CASES.find((s) => s.id === 'istanbul')!
    const i = sc.issues.find((x) => x.id === 'delivery')!
    const f = counterFrame(sc, i, 2, 4, { delivery: 4 })
    expect(f.text).toContain('«delivery» — твоя уступка ему (как он и просил)')
    expect(f.text).toContain('«I take it»')
    expect(checkPiece(sc, f, 'Eight weeks… okay, tamam. Delivery in eight weeks, I take it, we agree here.', ctx).hard).toContain('ты радуешься тому, что тебе невыгодно: свою уступку отдаёшь нехотя, без радости, «беру» и «спасибо»')
    expect(checkPiece(sc, f, 'Eight weeks… okay, tamam. Eight weeks I can do, but it costs me.', ctx).hard).toEqual([])
  })

  it('вежливый отказ, «беру на себя», «рад бы, но», «спасибо за честность» — не радость своей уступке', () => {
    const ist = CASES.find((s) => s.id === 'istanbul')!
    const f = counterFrame(ist, ist.issues.find((x) => x.id === 'delivery')!, 2, 4, { delivery: 4 })
    for (const ok of ["Eight weeks — I'll take that on, but the price stays.", 'Eight weeks, thanks, but no.', 'Eight weeks? Thank you for the honesty.', 'I take it you want eight weeks.', 'Eight weeks — not great, but okay.'])
      expect(wrongJoy(ist, f, ok), ok).toBe(false)
    for (const bad of ['Eight weeks, thank you.', 'Eight weeks — great.', 'Eight weeks, I take it.']) expect(wrongJoy(ist, f, bad), bad).toBe(true)
    const dorm = CASES.find((s) => s.id === 'dorm')!
    const g = counterFrame(dorm, dorm.issues.find((x) => x.id === 'quiet')!, 1, 3, { quiet: 3 })
    for (const ok of ['Тихо с 23:00 — беру на себя, ладно.', 'Рад бы дать тихо с 23:00, но не могу.', 'Тихо с 23:00? Спасибо, но нет.', 'Тихо с 23:00 — не рад, но ладно.'])
      expect(wrongJoy(dorm, g, ok), ok).toBe(false)
    for (const bad of ['Тихо с 23:00 — беру.', 'Тихо с 23:00 — отлично!', 'Тихо с 23:00, спасибо.']) expect(wrongJoy(dorm, g, bad), bad).toBe(true)
  })

  it('Дарина 19.10: «Вот это уже цифра, спасибо» на 150 тысяч — благодарит ни за что', () => {
    const sc = CASES.find((s) => s.id === 'offer')!
    const prev = { ...sheet(sc), salary: 3 }
    const f = frameFor(sc, { kind: 'counter', offer: { ...prev, salary: 1 } }, { ...initialState(sc), playerStance: { salary: 0 }, lastOpponentOffer: prev }, prev, {})
    expect(checkPiece(sc, f, 'Вот это уже цифра, спасибо.', ctx).hard).toContain('ты благодаришь, хотя он тебе ничего не дал')
    // а за шаг к ней — можно
    const g = frameFor(sc, { kind: 'counter', offer: { ...prev, salary: 2 } }, { ...initialState(sc), playerStance: { salary: 2 }, lastOpponentOffer: prev }, prev, { salary: 0 })
    expect(checkPiece(sc, g, 'Сто восемьдесят — уже ближе, спасибо.', ctx).hard).toEqual([])
  })

  it('в промпте правило «радуешься только выгодному» по-русски и по-английски', () => {
    for (const sc of CASES) expect(system(sc)).toMatch(/Радуешься, хвалишь и благодаришь только за то, что выгодно тебе|You are glad, praise or thank only for what is good for you/)
  })
})

describe('заход не выражает оценку: он звучит до решения движка', () => {
  it('оценка, радость, благодарность и возмущение — не проходят', () => {
    for (const bad of ['Вот это разговор!', 'Отлично…', 'Спасибо…', 'Друг, Alipay — без проблем…', 'Предложение интересное…', 'Interesting proposal…', 'Now we’re talking…', 'Great…', 'Thanks, my friend…', 'Ну красавчик…', 'Уже лучше…', 'Издеваешься?', 'Are you kidding?', 'Приятно слышать…', 'Наконец-то…', 'Fair enough…', 'I’m glad…'])
      expect(checkOpener(bad), bad).toBeUndefined()
  })
  it('удивление, раздумье, переспрос его слов — проходят', () => {
    for (const ok of ['Хм… интересно…', 'Восемь недель?..', 'Ё-моё, серьёзно?', 'Секунду…', 'Eight weeks…', 'Let me see…', 'Аккредитив, говоришь?…', 'Ого, братан…'])
      expect(checkOpener(ok, 'Давайте восемь недель, eight weeks'), ok).toBe(ok)
  })
  it('промпт захода запрещает оценку на обоих языках', () => {
    for (const sc of CASES) {
      const p = openerPrompt(sc, [], '…', initialState(sc))
      expect(p.system).toMatch(/без оценки — не радуйся, не хвали, не благодари|no judgement: don't be glad, don't praise, don't thank/)
    }
  })
})

describe('заготовки без модели не врут, кто уступил', () => {
  for (const sc of CASES) {
    it(`${sc.id}: встречное без уступки — не «могу подвинуться»; держит после шага игрока — не «дайте что-то взамен»`, () => {
      const prev = sheet(sc)
      for (let turn = 1; turn <= 6; turn++) {
        const state = { ...initialState(sc), turn, playerStance: { [deal(sc)[0].id]: bestOption(sc.player.profile, deal(sc)[0].id) }, lastOpponentOffer: prev }
        const same = templateLine(sc, { kind: 'counter', offer: prev }, state, prev).line
        expect(same, `${sc.id} ход ${turn}`).not.toMatch(/подвин|сбавл|навстречу|уступ|сдвин|can move|move a (bit|little)|move to|meet you|concession/iu)
        // игрок согласился на его главное, а движок держит
        const top = [...deal(sc)].sort((a, b) => Math.max(...O(sc, b.id)) - Math.min(...O(sc, b.id)) - (Math.max(...O(sc, a.id)) - Math.min(...O(sc, a.id))))[0]
        if (P(sc, top.id)[prev[top.id]!] >= Math.max(...P(sc, top.id))) continue
        const held = templateLine(sc, { kind: 'hold', reason: 'no_movement' }, { ...state, playerStance: { [top.id]: prev[top.id]! } }, prev, {}).line
        expect(held, `${sc.id} ход ${turn}`).not.toMatch(/взамен|ваша очередь|ничего не|in return|your turn|something back|from your side/iu)
      }
    })
  }
})
