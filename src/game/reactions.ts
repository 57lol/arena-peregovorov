// Быстрая реакция по словам игрока. На оценку хода не влияет.
import { isRude } from '../engine/offline/analyze'
import type { OpponentState } from '../engine/types'
import { REACTIONS, reactionAudio, type ReactionFace, type ReactionType } from '../content/reactions'
import type { PortraitEmotion } from './ui/assets'

export type PlayerTone = 'rude' | 'friendly' | 'apology' | 'interest' | 'offer' | 'pressure' | 'neutral'

export function classifyTone(text: string): PlayerTone {
  const t = text.slice(0, 1500).toLowerCase().replace(/ё/g, 'е')
  if (isRude(t) || /охрен|офигел|ты ч[ео][,?! ]|не борзей|ты кто такой/u.test(t)) return 'rude'
  if (/ультиматум|последн[еия]+ (?:мое )?слово|или (?:я )?(?:у[йх]ду|ухожу)|иначе(?! говоря)|либо.*либо|никаких уступок|время пошло/u.test(t)) return 'pressure'
  if (/извин|прости|простите|прошу прощения|моя вина|виноват/u.test(t)) return 'apology'
  if (/(?:что|чего).*(?:для (?:вас|тебя).*(?:главн|важн)|вам важ(?:н|ен)|тебе важ(?:н|ен)|вы хотите|ты хочешь)|почему.*важ(?:н|ен)|ваши интересы|вас беспокоит|тебя беспокоит/u.test(t)) return 'interest'
  if (/(?:^|[^а-я])(?:ха(?:-ха)*|хаха|хех|ахах)(?![а-я])|(?:^|[^а-я])(?:шутк|спасибо|благодарю|привет|рад вас|рад тебя)|ну ты даешь|приятно познакомиться|улыб/u.test(t)) return 'friendly'
  if (/\d/u.test(t) && /дава[йи]|предлага|готов|отдам|бер[еу]м|сделаем|за |по |цена|руб|тысяч|плачу|сумма/u.test(t)) return 'offer'
  return 'neutral'
}

export interface Reaction {
  type: ReactionType
  emotion: PortraitEmotion
  face: ReactionFace
  text: string
  path: string
}
const EMOTION: Record<ReactionType, PortraitEmotion> = {
  anger: 'angry', hurt: 'hurt', chuckle: 'happy', warmth: 'pleased',
  surprise: 'surprised', suspicion: 'suspicious', thoughtful: 'thinking',
}

export function chooseReaction(text: string, mood: Pick<OpponentState, 'trust' | 'tension'>, face: string): Reaction | undefined {
  if (!Object.hasOwn(REACTIONS, face)) return undefined
  const id = face as ReactionFace
  const tone = classifyTone(text)
  const hot = mood.tension >= 60 || mood.trust < 25
  const tough = id === 'gopnik' || id === 'buyer' || id === 'palych'
  let type: ReactionType = 'thoughtful'
  if (tone === 'rude') type = hot || tough ? 'anger' : 'hurt'
  if (tone === 'pressure') type = 'suspicion'
  if (tone === 'friendly') type = hot ? 'suspicion' : tough && mood.trust < 45 ? 'thoughtful' : 'chuckle'
  if (tone === 'apology' || tone === 'interest') type = hot ? 'thoughtful' : 'warmth'
  if (tone === 'offer') type = hot ? 'suspicion' : 'surprise'
  // Тот же текст и настроение дают ту же запись, без Math.random.
  let seed = 0
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  const n = seed % 2 + 1
  return { type, emotion: EMOTION[type], face: id, text: REACTIONS[id][type][n - 1], path: reactionAudio(id, type, n) }
}
