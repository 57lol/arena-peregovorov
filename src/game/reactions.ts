// Быстрая реакция по словам игрока. На оценку хода не влияет.
import { isRude } from '../engine/offline/analyze'
import type { OpponentState } from '../engine/types'
import { REACTIONS, reactionAudio, type ReactionFace, type ReactionType } from '../content/reactions'
import type { PortraitEmotion } from './ui/assets'

export type PlayerTone = 'rude' | 'friendly' | 'thanks' | 'apology' | 'interest' | 'offer' | 'pressure' | 'neutral'

// Scribe пишет числа словами («давай за двести»), Яндекс — цифрами.
const NUMBER_WORD = /(?:^|[^а-я])(?:сто|двести|триста|четыреста|(?:пять|шесть|семь|восемь|девять)сот|тысяч[аиу]?|полторы|полтыщи|двадцать|тридцать|сорок|(?:пять|шесть|семь|восемь)десят|девяносто|пятнадцать|десять|косар[ья]?)(?![а-я])/u

// Дело на английском: то же по-английски, в самом простом виде (игрок говорит по-английски как умеет).
const EN = {
  rude: /\b(?:fuck\w*|shit\w*|bullshit|idiot\w*|stupid|moron|crap|bastard|asshole|shut up|screw you|go to hell|are you crazy)\b/,
  pressure: /\b(?:final offer|last offer|take it or leave it|ultimatum|now or never|last chance|no more concessions)\b|\bor (?:i|we) (?:walk|leave|go)\b|\botherwise\b/,
  apology: /\b(?:sorry|apologi[sz]e|my apologies|my fault|my bad|forgive me)\b/,
  interest: /\bwhat(?:'s| is| matters)? (?:most )?important (?:to|for) you\b|\bwhat (?:do you|does your \w+) (?:need|want|care about)\b|\bwhy (?:is|are) .{1,40} (?:important|so important)\b|\bwhat worries you\b|\byour (?:priorit|concern)/,
  laugh: /\b(?:ha(?:-?ha)+|heh|lol|joke|joking|just kidding)\b/,
  thanks: /\b(?:thanks|thank you|appreciate|nice to meet|good to see|pleasure to meet)\b/,
  number: /\b(?:hundred|thousand|million|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/,
  offer: /\b(?:offer|propose|pay|price|give you|deal|let's say|how about|ready to|can do|euros?|eur|percent|weeks?|upfront)\b|[€$%]/,
}

export function classifyTone(text: string): PlayerTone {
  const t = text.slice(0, 1500).toLowerCase().replace(/ё/g, 'е')
  if (isRude(t) || /охрен|офигел|ты ч[ео][,?! ]|не борзей|ты кто такой/u.test(t) || EN.rude.test(t)) return 'rude'
  if (EN.pressure.test(t)) return 'pressure'
  if (EN.apology.test(t)) return 'apology'
  if (EN.interest.test(t)) return 'interest'
  if (EN.laugh.test(t)) return 'friendly'
  if (EN.thanks.test(t)) return 'thanks'
  if (/ультиматум|последн[еия]+ (?:мое )?слово|или (?:я )?(?:у[йх]ду|ухожу)|иначе(?! говоря)|либо.*либо|никаких уступок|время пошло/u.test(t)) return 'pressure'
  if (/извин|прости|простите|прошу прощения|моя вина|виноват/u.test(t)) return 'apology'
  if (/(?:что|чего).*(?:для (?:вас|тебя).*(?:главн|важн)|вам важ(?:н|ен)|тебе важ(?:н|ен)|вы хотите|ты хочешь)|почему.*важ(?:н|ен)|ваши интересы|вас беспокоит|тебя беспокоит/u.test(t)) return 'interest'
  if (/(?:^|[^а-я])(?:ха(?:-ха)*|хаха|хех|ахах)(?![а-я])|(?:^|[^а-я])(?:шутк|спасибо|благодарю|привет|рад вас|рад тебя)|ну ты даешь|приятно познакомиться|улыб/u.test(t)) return 'friendly'
  if ((/\d/u.test(t) || NUMBER_WORD.test(t)) && /дава[йи]|предлага|готов|отдам|бер[еу]м|сделаем|за |по |цена|руб|тысяч|плачу|сумма/u.test(t)) return 'offer'
  if ((/\d/.test(t) || EN.number.test(t)) && EN.offer.test(t)) return 'offer'
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
  if (tone === 'apology' || tone === 'interest' || tone === 'thanks') type = hot ? 'thoughtful' : 'warmth'
  if (tone === 'offer') type = hot ? 'suspicion' : 'surprise'
  // Тот же текст и настроение дают ту же запись, без Math.random.
  let seed = 0
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  const n = seed % 2 + 1
  return { type, emotion: EMOTION[type], face: id, text: REACTIONS[id][type][n - 1], path: reactionAudio(id, type, n) }
}
