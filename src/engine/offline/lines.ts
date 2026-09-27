// Шаблонные реплики оппонента: озвучивают решение движка в характере персонажа.
// Вариант выбирается по номеру хода — без случайности, чтобы повтор давал тот же текст.

import type { Decision, Emotion, OpponentState, Scenario, Tone } from '../types'
import { formatOffer } from '../utility'

type Kind = Decision['kind'] | 'final' | 'no_offer' | 'no_movement' | 'not_ready_to_reveal' | 'player_left' | 'timeout'

const T: Record<Kind, Partial<Record<Tone, string[]>> & { any: string[] }> = {
  accept: {
    any: ['Договорились: {offer}. Готовлю документы.', 'Хорошо, принимаю: {offer}. По рукам.', 'Идёт. Фиксируем: {offer}.'],
    friendly: ['Отлично, договорились! {offer}. Приятно с вами работать.', 'По рукам: {offer}. Вот это разговор.'],
    cold: ['Принято. {offer}. Договор пришлю сегодня.', 'Годится. {offer}.'],
    aggressive: ['Ладно. {offer}. Но это предел.', 'Хорошо, забирайте: {offer}.'],
  },
  counter: {
    any: ['Смотрите, что могу: {offer}.', 'Давайте так: {offer}.', 'Моё предложение — {offer}.', 'Могу подвинуться: {offer}.'],
    friendly: ['Слушайте, давайте попробуем так: {offer}. Как вам?', 'Я вас услышал. Предлагаю: {offer}.'],
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
  no_offer: {
    any: ['Хорошо, а что конкретно вы предлагаете?', 'Давайте к цифрам. Что предлагаете?', 'Понял. Жду от вас конкретики.'],
    friendly: ['Понимаю. А какие цифры вам бы подошли?'],
    cold: ['Конкретнее, пожалуйста.'],
    aggressive: ['Слова. Цифры где?'],
    evasive: ['Ну, это всё понятно... А по сути что?'],
  },
  no_movement: {
    any: ['Нет, так не могу. Моё предложение то же: {offer}.', 'Не вижу, куда тут двигаться. Остаюсь на своём: {offer}.'],
    aggressive: ['Нет. {offer}. Повторять не буду.'],
    friendly: ['Понимаю вас, но сдвинуться пока не могу. {offer}.'],
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
  player_left: { any: ['Что ж, ваше право. Если передумаете — звоните.', 'Понял. Жаль, что не договорились.'] },
  timeout: { any: ['Время вышло. Жаль, не успели.', 'Всё, мне пора. Без сделки.'] },
}

function kindOf(d: Decision, state: OpponentState): Kind {
  if (state.status === 'timeout') return 'timeout'
  if (d.kind === 'hold') return d.reason ?? 'hold'
  if (d.kind === 'counter' && d.final) return 'final'
  return d.kind
}

export function emotionFor(d: Decision, state: OpponentState): Emotion {
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

export function templateLine(sc: Scenario, d: Decision, state: OpponentState): { line: string; emotion: Emotion } {
  const k = kindOf(d, state)
  const tone = sc.opponent.character.tone
  const pool = [...(T[k][tone] ?? []), ...T[k].any]
  let line = pool[state.turn % pool.length]
  const offer =
    d.kind === 'counter' ? d.offer
    : d.kind === 'accept' ? state.deal ?? state.tableOffer
    : state.lastOpponentOffer ?? {}
  line = line.replace('{offer}', formatOffer(sc, offer))
  if (d.kind === 'reveal') {
    const it = sc.opponent.profile.interests.find((i) => i.id === d.interestId)
    line = line.replace('{interest}', lowerFirst(it?.text ?? ''))
    if (d.offer) line += ` Поэтому могу так: ${formatOffer(sc, d.offer)}.`
  }
  return { line, emotion: emotionFor(d, state) }
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
