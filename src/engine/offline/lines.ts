import { lowerFirst } from '../text'
import { upsellLine } from '../upsells'
// Шаблонные реплики оппонента: озвучивают решение движка в характере персонажа.
// Вариант выбирается по номеру хода — без случайности, чтобы повтор давал тот же текст.

import type { Decision, Emotion, Offer, OpponentState, Scenario, Tone } from '../types'
import { formatOffer } from '../utility'
import { isEn } from '../lang'

type Kind = Decision['kind'] | 'final' | 'no_offer' | 'no_news' | 'no_movement' | 'not_ready_to_reveal' | 'player_left' | 'timeout' | 'respond_back'

const T: Record<Kind, Partial<Record<Tone, string[]>> & { any: string[] }> = {
  accept: {
    any: ['Договорились: {offer}. Готовлю документы.', 'Хорошо, принимаю: {offer}. По рукам.', 'Идёт. Фиксируем: {offer}.'],
    friendly: ['Отлично, договорились! {offer}. Приятно с вами работать.', 'По рукам: {offer}. Вот это разговор.'],
    cold: ['Принято. {offer}. Договор пришлю сегодня.', 'Годится. {offer}.'],
    aggressive: ['Ладно. {offer}. Но это предел.', 'Хорошо, забирайте: {offer}.'],
  },
  counter: {
    any: ['Смотрите, что могу: {offer}.', 'Давайте так: {offer}.', 'Моё предложение — {offer}.', 'Могу подвинуться: {offer}.'],
    friendly: ['Слушайте, давайте попробуем так: {offer}. Как вам?', 'Слышу вас. Предлагаю: {offer}.'],
    cold: ['Встречное: {offer}.', 'Могу так: {offer}. Не больше.'],
    aggressive: ['Нет. Вот как будет: {offer}.', 'Так не пойдёт. {offer} — и это уже щедро.'],
    evasive: ['Ну, допустим... {offer}. Надо ещё подумать, конечно.', 'Скажем так: {offer}. Пока так.'],
  },
  final: {
    any: ['Время у нас кончается. Последнее, что могу: {offer}. Да или нет?', 'Финальное предложение: {offer}. Дальше двигаться не буду.'],
    aggressive: ['Всё, последний раз: {offer}. Не устраивает — расходимся.'],
  },
  reveal: {
    any: ['Скажу честно: {interest}.', 'Ладно, раз уж спросили: {interest}.', 'Между нами: {interest}.'],
    friendly: ['Хороший вопрос. Если честно — {interest}.'],
    cold: ['Если вам это поможет: {interest}.'],
    evasive: ['Ну... если совсем откровенно, {interest}.'],
  },
  hold: { any: ['Моё предложение в силе.'] },
  // ответ человеку без сдвига сделки: коротко отреагировать, условия не трогать
  respond: {
    any: ['Понял вас.', 'Ясно. Ладно.', 'Ну, допустим.'],
    friendly: ['Ха, ну ты даёшь.', 'Да ладно, всё нормально.', 'Ну смешно, да.'],
    cold: ['Так.', 'Понятно.'],
    aggressive: ['Ну-ну.', 'Ладно, проехали.'],
    evasive: ['Ну… бывает.', 'Ну, это как посмотреть.'],
  },
  respond_back: {
    any: ['Ладно, давайте к делу. Что предлагаете?', 'Хорошо. А по сделке что?'],
    friendly: ['Ха, ладно. Давай к делу: как делаем?'],
    cold: ['Хорошо. Вернёмся к цифрам.'],
    aggressive: ['Ладно, хорош болтать. По делу что?'],
    evasive: ['Ну ладно… А по делу-то что скажете?'],
  },
  no_offer: {
    any: ['Хорошо, а что конкретно вы предлагаете?', 'Давайте к цифрам. Что предлагаете?', 'Ясно. Жду от вас конкретики.'],
    friendly: ['Понимаю. А какие цифры вам бы подошли?'],
    cold: ['Конкретнее, пожалуйста.'],
    aggressive: ['Слова. Цифры где?'],
    evasive: ['Ну, это всё понятно... А по сути что?'],
  },
  // Держим позицию без пересказа всех условий: листок и так на столе.
  // предложение игрока уже на столе, а нового он ничего не сказал
  no_news: {
    any: ['Ваше предложение у меня перед глазами. Что ещё можете дать?', 'Ясно. Жду от вас шага — тогда и я подвинусь.', 'Так. А по сути что-то новое будет?'],
    friendly: ['Слышу вас. Но чтобы я сдвинулся, нужен шаг с вашей стороны.'],
    aggressive: ['Это уже было. Дальше что?'],
    evasive: ['Ну... ваше предложение у меня есть. Посмотрим, что вы ещё скажете.'],
  },
  no_movement: {
    any: ['Нет, так не могу. Моё предложение в силе.', 'Не вижу, куда тут двигаться: {main}, остальное как было.'],
    aggressive: ['Нет. Всё как было. Повторять не буду.'],
    friendly: ['Понимаю вас, но сдвинуться пока не могу. Дайте что-то взамен — тогда поговорим.'],
  },
  not_ready_to_reveal: {
    any: ['Это наша внутренняя кухня.', 'Давайте я пока оставлю это при себе.', 'Скажем так: у нас есть причины.'],
    aggressive: ['Это вас не касается.'],
    evasive: ['Ну, там много всего... Сложно сказать.'],
  },
  warn_tone: {
    any: ['Давайте без этого. Ещё раз — и разговор закончен.', 'Такой тон мне не подходит. Держите себя в руках.', 'Стоп. Или по-деловому, или никак.'],
    friendly: ['Эй, давайте спокойнее. Мы же договориться хотим.'],
    aggressive: ['Ещё раз так скажете — я встаю и ухожу.'],
  },
  walk_away: {
    any: ['Всё, с меня хватит. Всего доброго.', 'На этом закончим. Сделки не будет.'],
    aggressive: ['Я своё время дороже ценю. До свидания.'],
    friendly: ['Жаль, но так я работать не могу. Всего хорошего.'],
  },
  player_left: { any: ['Что ж, ваше право. Если передумаете — звоните.', 'Ясно. Жаль, что не договорились.'] },
  timeout: { any: ['Время вышло. Жаль, не успели.', 'Всё, мне пора. Без сделки.'] },
}

// То же для дел на английском: заготовки по тону, если у персонажа нет своих.
const T_EN: Record<Kind, Partial<Record<Tone, string[]>> & { any: string[] }> = {
  accept: {
    any: ['Deal: {offer}. I will prepare the papers.', 'Okay, I accept: {offer}. Let\'s shake hands.', 'Good. We fix it: {offer}.'],
    friendly: ['Deal! {offer}. Nice working with you.'],
    cold: ['Accepted. {offer}. You get the contract today.'],
  },
  counter: {
    any: ['Here is what I can do: {offer}.', 'Let\'s do it like this: {offer}.', 'My offer: {offer}.', 'I can move a bit: {offer}.'],
    friendly: ['Look, let\'s try this: {offer}. How does it sound?'],
    cold: ['Counteroffer: {offer}.'],
    aggressive: ['No. Here is how it goes: {offer}.'],
  },
  final: { any: ['We are out of time. My last offer: {offer}. Yes or no?', 'Final offer: {offer}. I don\'t move further.'] },
  reveal: {
    any: ['Honestly: {interest}.', 'Okay, since you ask: {interest}.', 'Between us: {interest}.'],
    friendly: ['Good question. To be honest, {interest}.'],
  },
  hold: { any: ['My offer stands.'] },
  respond: {
    any: ['I hear you.', 'Okay. Fair enough.', 'Well, maybe.'],
    friendly: ['Ha, you are something.', 'No problem, really.', 'Okay, that was funny.'],
    cold: ['I see.', 'Right.'],
  },
  respond_back: {
    any: ['Okay, back to business. What do you offer?', 'Good. And about the deal?'],
    friendly: ['Ha, okay. Back to business: how do we do it?'],
  },
  no_offer: {
    any: ['Okay, and what exactly do you offer?', 'Let\'s go to numbers. What do you propose?', 'I see. I am waiting for something concrete.'],
    friendly: ['I understand. And which numbers would work for you?'],
  },
  no_news: {
    any: ['Your offer is in front of me. What else can you give?', 'I see. Make a step, then I move too.', 'Okay. Anything new on the deal?'],
    friendly: ['I hear you. But to move, I need a step from your side.'],
  },
  no_movement: {
    any: ['No, I can\'t do this. My offer stands.', 'I don\'t see where to move: {main}, the rest as before.'],
    friendly: ['I understand you, but I can\'t move yet. Give me something back, then we talk.'],
  },
  not_ready_to_reveal: {
    any: ['That\'s our kitchen.', 'Let me keep this for myself for now.', 'Let\'s say we have our reasons.'],
  },
  warn_tone: {
    any: ['Let\'s not do this. One more time and the meeting is over.', 'This tone doesn\'t work for me.', 'Stop. Business, or nothing.'],
    friendly: ['Hey, calm down. We want to agree, no?'],
  },
  walk_away: { any: ['That\'s enough for me. Goodbye.', 'We stop here. No deal.'] },
  player_left: { any: ['Your choice. If you change your mind, call me.', 'I see. Pity we didn\'t agree.'] },
  timeout: { any: ['Time is up. Pity, we didn\'t make it.', 'I have to go. No deal.'] },
}

function kindOf(d: Decision, state: OpponentState): Kind {
  if (state.status === 'timeout') return 'timeout'
  if (d.kind === 'hold' && d.reason === 'no_offer' && Object.keys(state.playerStance ?? {}).length) return 'no_news'
  if (d.kind === 'hold') return d.reason ?? 'hold'
  if (d.kind === 'respond') return d.back ? 'respond_back' : 'respond'
  if (d.kind === 'counter' && d.final) return 'final'
  return d.kind
}

function emotionFor(d: Decision, state: OpponentState): Emotion {
  switch (d.kind) {
    case 'accept': return 'happy'
    case 'walk_away':
    case 'warn_tone': return 'angry'
    case 'reveal': return 'thinking'
    default:
      if (state.tension >= 60) return 'annoyed'
      if (state.trust >= 60) return 'pleased'
      return d.kind === 'hold' && d.reason === 'not_ready_to_reveal' ? 'thinking' : 'neutral'
  }
}

/**
 * `prev` — прошлое предложение собеседника: во встречном он называет только то, что изменилось,
 * а не зачитывает весь листок заново («остальное как было»).
 */
export function templateLine(sc: Scenario, d: Decision, state: OpponentState, prev?: Offer): { line: string; emotion: Emotion } {
  const k = kindOf(d, state)
  const tone = sc.opponent.character.tone
  // Свои реплики персонажа (из сценария) важнее общих по тону.
  const own = sc.opponent.character.lines?.[k as keyof NonNullable<typeof sc.opponent.character.lines>]
  const en = isEn(sc)
  const table = en ? T_EN : T
  const pool = own?.length ? own : [...(table[k][tone] ?? []), ...table[k].any]
  let line = pool[state.turn % pool.length]
  const offer =
    d.kind === 'counter' ? d.offer
    : d.kind === 'accept' ? state.deal ?? state.tableOffer
    : state.lastOpponentOffer ?? {}
  const text = d.kind === 'counter' && !d.final ? changesOnly(sc, offer, prev) : formatOffer(sc, offer)
  const say = en ? sc.opponent.character.nativeEnglish ? EN_NATIVE_SAY : EN_SAY : RU_SAY
  line = line.replace('{offer}', text).replace('{main}', mainTerm(sc, offer))
  if (d.kind === 'reveal') {
    const it = sc.opponent.profile.interests.find((i) => i.id === d.interestId)
    line = d.again ? `${say.again}${lowerFirst(it?.text ?? '')}.` : line.replace('{interest}', lowerFirst(it?.text ?? ''))
    if (d.offer) {
      if (d.final) {
        const final = sc.opponent.character.lines?.final ?? table.final.any
        line += ` ${final[state.turn % final.length].replace('{offer}', formatOffer(sc, d.offer))}`
      } else line += `${say.so}${changesOnly(sc, d.offer, prev)}.`
    }
  }
  if ((d.kind === 'counter' || d.kind === 'reveal') && d.offer && d.feigned?.length) {
    const offer = d.offer
    const what = d.feigned
      .map((id) => sc.issues.find((i) => i.id === id)!)
      .map((i) => `${i.title.toLowerCase()} — ${i.options[offer[i.id]!]}`)
      .join(', ')
    line += say.feigned(what)
  }
  return { line: [line, upsellLine(sc, state)].filter(Boolean).join(' '), emotion: emotionFor(d, state) }
}

function changesOnly(sc: Scenario, offer: Offer, prev: Offer | undefined): string {
  if (!prev) return formatOffer(sc, offer)
  const changed = sc.issues.filter((i) => typeof prev[i.id] === 'number' && offer[i.id] !== prev[i.id])
  const same = sc.issues.filter((i) => typeof prev[i.id] === 'number' && offer[i.id] === prev[i.id])
  if (!changed.length || !same.length) return formatOffer(sc, offer)
  // новые пункты (которых в прошлом листке не было) тоже называем
  const shown = Object.fromEntries(sc.issues.filter((i) => !same.includes(i)).map((i) => [i.id, offer[i.id]]))
  return `${formatOffer(sc, shown)}${isEn(sc) ? EN_SAY.rest : RU_SAY.rest}`
}

/** Главный пункт одной фразой: «цена за короб — 212 ₽». */
function mainTerm(sc: Scenario, offer: Partial<Record<string, number>>): string {
  const i = sc.issues.find((x) => x.kind === 'distributive' && typeof offer[x.id] === 'number') ?? sc.issues.find((x) => typeof offer[x.id] === 'number')
  return i ? `${i.title.toLowerCase()} — ${i.options[offer[i.id]!]}` : isEn(sc) ? EN_SAY.mine : RU_SAY.mine
}

const RU_SAY = {
  feigned: (what: string) => ` И заметьте: ${what} — это я вам уступаю.`,
  again: 'Я ж говорил: ',
  so: ' Поэтому могу так: ',
  rest: ', остальное как было',
  mine: 'моё предложение',
}
const EN_SAY: typeof RU_SAY = {
  feigned: (what: string) => ` And note: ${what}. This I give you.`,
  again: 'Like I told you: ',
  so: ' So I can do this: ',
  rest: ', the rest as before',
  mine: 'my offer',
}
const EN_NATIVE_SAY: typeof RU_SAY = {
  ...EN_SAY,
  feigned: (what: string) => ` Please note this concession: ${what}.`,
  again: 'As I mentioned earlier: ',
}
