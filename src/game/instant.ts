// Разбор хода прямо во встрече: что сработало, что помешало, как это сдвинуло собеседника и что делать дальше.
// Всё считается из того, что уже пришло с ответом (разбор реплики, сдвиги с причинами, решение движка), —
// без второго запроса к нейросети. Поэтому одинаково работает онлайн, офлайн и без сервера.
// Бывшие записки наставника первой партии — часть советов «что дальше» (помечены tutorial).

import { behaviorById } from '../engine/behaviors'
import type { OpponentState, Scenario, TurnRecord } from '../engine/types'
import { initialState } from '../engine/turn'
import { isComplete, score } from '../engine/utility'
import { firstName, g, plural } from './cast'

export type Ink = 'good' | 'bad' | 'plain'

export interface MarginNote {
  key: string
  ink: Ink
  title: string
  why: string
  quote?: string
}

export interface TurnFeedback {
  turn: number
  notes: MarginNote[]      // сначала что сработало, потом что помешало, потом нейтральное
  trust: number            // сумма сдвигов доверия за ход
  tension: number          // сумма сдвигов напряжения
  verdict: { ink: Ink; word: string }
  reply: string            // что сделал собеседник в ответ
  empty: boolean           // ни сильных, ни слабых приёмов
}

export type TipId =
  | 'start' | 'last' | 'below' | 'tone' | 'tension' | 'reveal' | 'hold' | 'clock'
  | 'ask' | 'offer' | 'trade' | 'summary' | 'xray' | 'priority' | 'check'

export interface Tip {
  id: TipId
  text: string
  example?: string         // можно вставить в поле реплики
  short?: string           // для свёрнутой полоски на телефоне, если первая фраза совета не о главном
}

const QUOTE_MAX = 48

/** Фрагмент реплики для пометки на полях: до ~64 знаков, по границе слова. */
export function fragment(q: string): string {
  const s = q.replace(/\s+/g, ' ').trim().replace(/[.,;:—-]+$/u, '')
  if (s.length <= QUOTE_MAX) return s
  const cut = s.slice(0, QUOTE_MAX)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > 30 ? cut.slice(0, sp) : cut).replace(/[.,;:—-]+$/u, '')}…`
}

// Сдвиги, которые движок ставит не за приём, а за само предложение или тон (причины — из turn.ts).
const OTHER: Record<string, { ink: Ink; title: string; why: (sc: Scenario) => string }> = {
  'Нарушен деловой тон': {
    ink: 'bad',
    title: 'Резкий тон',
    why: () => 'Грубость здесь прощают один раз. Второй — и встреча окончена.',
  },
  'Предложение хуже их запасного варианта': {
    ink: 'bad',
    title: 'Перегнули',
    why: (sc) => `Такое предложение хуже, чем у ${g(sc, 'него', 'неё')} есть без вас: проще уйти, чем согласиться.`,
  },
  'Шаг навстречу в предложении': {
    ink: 'good',
    title: 'Шаг навстречу',
    why: () => 'Сдвинулись в сторону собеседника, и он это видит.',
  },
  'Третий раз то же самое предложение': {
    ink: 'bad',
    title: 'Одно и то же',
    why: () => 'Третий раз то же предложение: собеседник слышит, что торга не будет.',
  },
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

/** «доверие +4, напряжение −2» — или «ничего не сдвинулось». */
export function effectText(fb: Pick<TurnFeedback, 'trust' | 'tension'>): string {
  const parts: string[] = []
  if (fb.trust) parts.push(`доверие ${signed(fb.trust)}`)
  if (fb.tension) parts.push(`напряжение ${signed(fb.tension)}`)
  return parts.length ? parts.join(', ') : 'ничего не сдвинулось'
}

/** Карточка «на полях» для одного хода. */
export function turnFeedback(sc: Scenario, rec: TurnRecord): TurnFeedback {
  const notes: MarginNote[] = []
  const seen = new Set<string>()
  for (const hit of rec.analysis.behaviors) {
    const b = behaviorById(hit.id)
    if (!b || seen.has(b.id)) continue
    seen.add(b.id)
    const ink: Ink = b.polarity === 'strong' ? 'good' : b.polarity === 'weak' ? 'bad' : 'plain'
    // движок пометил повтор или спираль — скажем и об этом, одним хвостиком
    const note = rec.deltas.find((d) => d.because.startsWith(b.title))?.because ?? ''
    const tail = note.includes('(повтор') ? ' Второй раз подряд — работает вдвое слабее.' : note.includes('(спираль') ? ' Уже второй промах подряд — бьёт сильнее.' : ''
    const raw = hit.quote?.trim() || rec.playerText
    notes.push({ key: b.id, ink, title: b.title, why: b.moment + tail, quote: raw ? fragment(raw) : undefined })
  }
  for (const d of rec.deltas) {
    const o = OTHER[d.because]
    if (!o || seen.has(d.because)) continue
    seen.add(d.because)
    notes.push({ key: d.because, ink: o.ink, title: o.title, why: o.why(sc) })
  }
  // сколько даёт вам то, что вы положили на стол (или подписали)
  const P = sc.player.profile
  const st = rec.stateAfter
  const offer = st.status === 'deal' ? st.deal : rec.analysis.offer && Object.keys(rec.analysis.offer).length ? st.playerStance : undefined
  if (isComplete(sc, offer)) {
    const mine = score(P, offer)
    const deal = st.status === 'deal'
    notes.push(
      mine < P.batna
        ? { key: 'offer', ink: 'bad', title: deal ? 'Сделка себе в убыток' : 'Себе в убыток', why: `Вам это даёт ${mine}, а запасной вариант — ${P.batna}. Уйти было бы выгоднее.` }
        : { key: 'offer', ink: 'plain', title: deal ? 'Сделка' : 'Ваше предложение', why: `Вам это даёт ${mine}, запасной вариант — ${P.batna}.` },
    )
  }
  const order: Record<Ink, number> = { good: 0, bad: 1, plain: 2 }
  notes.sort((a, b) => order[a.ink] - order[b.ink])
  // та же фраза уже процитирована пометкой выше — второй раз не повторяем
  notes.forEach((n, k) => {
    if (n.quote && notes.slice(0, k).some((m) => m.quote?.slice(0, 16) === n.quote!.slice(0, 16))) n.quote = undefined
  })

  const trust = rec.deltas.filter((d) => d.field === 'trust').reduce((s, d) => s + d.by, 0)
  const tension = rec.deltas.filter((d) => d.field === 'tension').reduce((s, d) => s + d.by, 0)
  const good = notes.some((n) => n.ink === 'good')
  const bad = notes.some((n) => n.ink === 'bad')
  const verdict: TurnFeedback['verdict'] =
    good && !bad ? { ink: 'good', word: 'В точку' }
    : bad && !good ? { ink: 'bad', word: 'Мимо' }
    : good && bad ? { ink: 'plain', word: 'Спорно' }
    : { ink: 'plain', word: 'Ровно' }

  return { turn: rec.turn, notes, trust, tension, verdict, reply: replyText(sc, rec), empty: !good && !bad }
}

function replyText(sc: Scenario, rec: TurnRecord): string {
  const n = firstName(sc)
  const P = sc.player.profile
  const d = rec.decision
  switch (d.kind) {
    case 'accept':
      return `${n} ${g(sc, 'согласился', 'согласилась')}. Сделка.`
    case 'counter': {
      const mine = isComplete(sc, d.offer) ? score(P, d.offer) : null
      const what = d.final ? 'последнее предложение' : 'встречное'
      return mine === null
        ? `${n} ${g(sc, 'положил', 'положила')} ${what}.`
        : `${n} ${g(sc, 'положил', 'положила')} ${what}: вам ${mine}, запасной ${P.batna}.`
    }
    case 'reveal':
      return `${n} ${g(sc, 'рассказал', 'рассказала')}, что ${g(sc, 'ему', 'ей')} на самом деле важно. Записано в блокноте.`
    case 'warn_tone':
      return `${n} ${g(sc, 'одёрнул', 'одёрнула')} вас за тон. Ещё раз — и встанет из-за стола.`
    case 'walk_away':
      return `${n} ${g(sc, 'встал', 'встала')} из-за стола.`
    case 'hold':
      switch (d.reason) {
        case 'not_ready_to_reveal':
          return `${n} не ${g(sc, 'стал', 'стала')} рассказывать: доверия пока мало.`
        case 'no_movement':
          return `${n} ${g(sc, 'упёрся', 'упёрлась')}: взамен пока мало.`
        case 'player_left':
          return 'Вы ушли из-за стола.'
        case 'timeout':
          return 'Время встречи вышло.'
        default:
          return `${n} ждёт от вас конкретных цифр.`
      }
  }
}

const used = (h: TurnRecord, id: string) => h.analysis.behaviors.some((b) => b.id === id)
const offered = (h: TurnRecord) => !!h.analysis.offer && Object.keys(h.analysis.offer).length > 0

/** Все советы, которые подходят к положению партии, от самого срочного. */
function candidates(sc: Scenario, history: TurnRecord[], ctx: { tutorial: boolean; xrayUsed: boolean }): Tip[] {
  const n = firstName(sc)
  const him = g(sc, 'ему', 'ей')
  const he = g(sc, 'он', 'она')
  const P = sc.player.profile
  const last = history[history.length - 1]
  const state: OpponentState = last?.stateAfter ?? initialState(sc)
  const out: Tip[] = []
  if (state.status !== 'open') return out

  if (!history.length) {
    out.push({
      id: 'start',
      text: `Пишите как в жизни. Для начала спросите, что для ${g(sc, 'него', 'неё')} в этой сделке главное и почему: вопрос стоит дёшево, а узнать можно много.`,
      example: 'Добрый день. Прежде чем обсуждать цифры, хочу понять: что для вас в этой договорённости главное и почему?',
      short: `Спросите, что для ${g(sc, 'него', 'неё')} главное и почему`,
    })
    return out
  }

  if (state.lastCall && isComplete(sc, state.lastOpponentOffer)) {
    const mine = score(P, state.lastOpponentOffer)
    out.push({
      id: 'last',
      text:
        `Это последнее предложение, дальше торга не будет. Вам оно даёт ${mine}, запасной вариант — ${P.batna}. ` +
        (mine >= P.batna ? 'Больше запасного — можно принимать.' : 'Меньше запасного — выгоднее уйти.'),
    })
  }

  if (offered(last) && isComplete(sc, state.playerStance)) {
    const mine = score(P, state.playerStance)
    if (mine < P.batna)
      out.push({
        id: 'below',
        text: `Поднимите планку. Ваше предложение даёт вам ${mine}, запасной вариант — ${P.batna}: если ${n} согласится, вы проиграете. Ниже ${P.batna} брать нет смысла.`,
      })
  }

  if (last.decision.kind === 'warn_tone')
    out.push({
      id: 'tone',
      text: `Ещё одна резкость — и ${n} уйдёт. Сбавьте тон: признайте, что в ${g(sc, 'его', 'её')} словах есть резон, и вернитесь к делу.`,
      example: 'Извините, это было лишнее. Давайте вернёмся к делу: что для вас сейчас главное?',
    })

  if (state.tension >= 60)
    out.push({
      id: 'tension',
      text: `${n} на взводе. Сейчас давление сорвёт встречу. Спросите, что ${g(sc, 'его', 'её')} беспокоит, или перескажите ${g(sc, 'его', 'её')} позицию своими словами.`,
      example: 'Похоже, вас что-то в нашем разговоре беспокоит. Правильно ли я понимаю, что для вас сейчас главное — ',
    })

  if (last.decision.kind === 'reveal')
    out.push({
      id: 'reveal',
      text: `Теперь есть что менять: где ${him} важно, а вам не очень, уступите в обмен на своё — «если вы…, то мы…».`,
    })

  if (last.decision.kind === 'hold' && last.decision.reason === 'not_ready_to_reveal')
    out.push({
      id: 'hold',
      text: `Сначала покажите, что слушаете: перескажите ${g(sc, 'его', 'её')} слова или скажите, что важно вам. Потом спросите ещё раз.`,
    })

  const left = sc.turnLimit - state.turn
  if (left > 0 && left <= 2 && !state.lastCall)
    out.push({
      id: 'clock',
      text: `До конца встречи ${left} ${plural(left, 'ход', 'хода', 'ходов')}. Хотите сделку — кладите полное предложение или принимайте то, что на столе.`,
    })

  if (!history.some((h) => used(h, 'ask_interest'))) {
    const ask = askAbout(sc, history, state)
    if (ask)
      out.push({
        id: 'ask',
        text: `Вы ещё ни разу не спросили, зачем ${him} то, что ${he} просит. Например, почему ${him} важно «${ask.option}» в пункте «${ask.title}».`,
        example: `${ask.title}: почему для вас важно именно «${ask.option}»?`,
      })
  }

  const anyOffer = history.some(offered)
  if (!anyOffer && ctx.tutorial)
    out.push({
      id: 'offer',
      text: 'Когда будете готовы, соберите предложение в блокноте стрелками — цифра справа показывает, сколько это даёт вам — и положите на стол.',
    })
  else if (!anyOffer && (history.length >= 3 || (last.decision.kind === 'hold' && last.decision.reason === 'no_offer')))
    out.push({
      id: 'offer',
      text: `${n} ждёт цифр. Соберите в блокноте пакет сразу по всем пунктам и положите на стол: так проще менять одно на другое.`,
    })

  const firstReveal = history.findIndex((h) => h.decision.kind === 'reveal')
  if (firstReveal >= 0 && last.decision.kind !== 'reveal' && !history.slice(firstReveal).some((h) => used(h, 'package') || used(h, 'meso')))
    out.push({
      id: 'trade',
      text: `Вы уже знаете, что ${him} важно, — это в блокноте. Предложите размен: уступите там, где ${him} важнее, в обмен на своё.`,
      example: 'Если вы берёте на себя ',
    })

  if (history.length >= 5 && !history.slice(-4).some((h) => used(h, 'summarize')))
    out.push({
      id: 'summary',
      text: 'Давно не подводили итог. Скажите, о чём уже договорились и что осталось открытым: так видно, что ещё можно разменять.',
      example: 'Давайте сверимся, на чём мы сейчас: ',
    })

  if (ctx.tutorial && history.length >= 2 && !ctx.xrayUsed)
    out.push({
      id: 'xray',
      text: 'Кнопка «Рентген» наверху показывает, что собеседник чувствует и почему. В жизни такого нет, а для учёбы полезно.',
    })

  // запасные — если в реплике не нашлось ни одного приёма и больше сказать нечего
  if (!history.slice(-2).some((h) => used(h, 'priority')))
    out.push({
      id: 'priority',
      text: `Скажите, что вам важно, а что не очень. Тогда ${n} поймёт, что вам можно предложить.`,
      example: 'Скажу честно: для нас главное — ',
    })
  out.push({
    id: 'check',
    text: `Перескажите своими словами, как вы поняли ${g(sc, 'его', 'её')} позицию, и спросите, так ли это.`,
    example: 'Правильно ли я понимаю, что для вас главное — ',
  })
  return out
}

const FALLBACK: TipId[] = ['priority', 'check']
const ONCE: TipId[] = ['start', 'xray', 'offer']

/** О чём спросить: пункт, где ставка собеседника вам дороже всего и о чём ещё не спрашивали. */
function askAbout(sc: Scenario, history: TurnRecord[], state: OpponentState) {
  const theirs = state.lastOpponentOffer ?? {}
  const P = sc.player.profile
  const asked = new Set(history.flatMap((h) => h.analysis.asksAbout ?? []))
  const withInterest = new Set(
    sc.opponent.profile.interests.filter((i) => i.issue && !state.revealed.includes(i.id)).map((i) => i.issue!),
  )
  const gap = (id: string) => {
    const v = theirs[id]
    return typeof v === 'number' ? Math.max(...P.points[id]) - P.points[id][v] : -1
  }
  const pool = sc.issues.filter((i) => typeof theirs[i.id] === 'number' && !asked.has(i.id) && gap(i.id) > 0)
  const best = [...pool].sort((a, b) => Number(withInterest.has(b.id)) - Number(withInterest.has(a.id)) || gap(b.id) - gap(a.id))[0]
  return best ? { title: best.title, option: best.options[theirs[best.id]!] } : null
}

/**
 * Совет «что дальше» после истории ходов: не больше одного, без повтора подряд.
 * Разовые (первый ход, рентген, блокнот) — один раз за партию. Запасные — только если в последней реплике
 * не нашлось ни одного приёма. Чистая функция: тот же ход — тот же совет.
 */
export function nextTip(sc: Scenario, history: TurnRecord[], ctx: { tutorial: boolean; xrayUsed: boolean }): Tip | null {
  const shown: (Tip | null)[] = []
  for (let k = 0; k <= history.length; k++) {
    const h = history.slice(0, k)
    const prev = shown[k - 1]?.id
    const empty = k > 0 && turnFeedback(sc, h[k - 1]).empty
    const pick =
      candidates(sc, h, ctx).find(
        (t) =>
          t.id !== prev &&
          !(ONCE.includes(t.id) && shown.some((s) => s?.id === t.id)) &&
          (!FALLBACK.includes(t.id) || empty),
      ) ?? null
    shown.push(pick)
  }
  return shown[history.length]
}

// ——— переключатель «Подсказки на ходу»: по умолчанию включены, выключают для честного экзамена ———

const KEY = 'peregovorka.instant.v1'

export function loadInstantOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function saveInstantOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // нет хранилища — настройка живёт до перезагрузки
  }
}
