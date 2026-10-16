// Каталог голосов SpeechKit: его читают и сервер (роли под эмоцию, проверка голоса), и игра (кто кем говорит).

export interface VoiceInfo {
  id: string
  name: string
  female: boolean
  /** роли (амплуа) SpeechKit, которые голос умеет */
  roles?: string[]
  /** только API v3 */
  v3only?: boolean
  note?: string
  /** модель SpeechKit v3: без поля — general; livetts не знает темпа, амплуа у него свои (casual, formal…) */
  model?: 'livetts'
}

/**
 * Русские голоса SpeechKit (https://aistudio.yandex.ru/docs/ru/speechkit/tts/voices, каждый проверен запросом).
 * Тон в Гц мерили на одной фразе — ~/Arena-materials/VOICES.md.
 */
export const YANDEX_VOICES: VoiceInfo[] = [
  { id: 'filipp', name: 'Филипп', female: false, roles: [], note: '121 Гц, средний, живой' },
  { id: 'ermil', name: 'Ермил', female: false, roles: ['good'], note: '87 Гц, самый низкий, спокойный' },
  { id: 'zahar', name: 'Захар', female: false, roles: ['good'], note: '142 Гц, молодой' },
  { id: 'madirus', name: 'Мадирус', female: false, roles: [], note: '92 Гц, низкий, с хрипотцой' },
  { id: 'anton', name: 'Антон', female: false, roles: ['good'], v3only: true, note: '98 Гц, низкий, ровный' },
  { id: 'kirill', name: 'Кирилл', female: false, roles: ['strict', 'good'], v3only: true, note: '105 Гц, умеет «строго»' },
  { id: 'alexander', name: 'Александр', female: false, roles: ['good'], v3only: true, note: '108 Гц, тёплый, разговорный' },
  { id: 'alena', name: 'Алёна', female: true, roles: ['good'], note: '180 Гц, живой, тёплый' },
  { id: 'jane', name: 'Джейн', female: true, roles: ['good', 'evil'], note: '200 Гц, выразительный' },
  { id: 'omazh', name: 'Омаж', female: true, roles: ['evil'], note: '235 Гц, резкий' },
  { id: 'marina', name: 'Марина', female: true, roles: ['friendly', 'whisper'], note: '232 Гц, мягкий' },
  { id: 'dasha', name: 'Даша', female: true, roles: ['good', 'friendly'], v3only: true, note: '180 Гц, молодой, разговорный' },
  { id: 'lera', name: 'Лера', female: true, roles: ['friendly'], v3only: true, note: '195 Гц, лёгкий' },
  { id: 'masha', name: 'Маша', female: true, roles: ['good', 'strict', 'friendly'], v3only: true, note: '211 Гц, по умолчанию «добрая»' },
  { id: 'julia', name: 'Юлия', female: true, roles: ['strict'], v3only: true, note: '219 Гц, деловой, умеет «строго»' },
  { id: 'saule_ru', name: 'Сауле', female: true, roles: ['strict', 'whisper'], v3only: true, note: 'русский с казахским акцентом' },
  { id: 'zhanar_ru', name: 'Жанар', female: true, roles: ['strict', 'friendly'], v3only: true, note: 'русский с казахским акцентом' },
  { id: 'zamira_ru', name: 'Замира', female: true, roles: ['strict', 'friendly'], v3only: true, note: 'русский с узбекским акцентом' },
  { id: 'yulduz_ru', name: 'Юлдуз', female: true, roles: ['strict', 'friendly', 'whisper'], v3only: true, note: 'русский с узбекским акцентом' },
  // модель livetts (v3): самая «живая» и на треть дороже general; темп не принимает (400), амплуа — свои (проверено 29.09)
  { id: 'denis', name: 'Денис', female: false, v3only: true, model: 'livetts', roles: ['casual', 'formal', 'neutral', 'sales'], note: 'livetts' },
  { id: 'sergey', name: 'Сергей', female: false, v3only: true, model: 'livetts', roles: ['support', 'sales'], note: 'livetts' },
  { id: 'vasily', name: 'Василий', female: false, v3only: true, model: 'livetts', roles: ['support', 'sales'], note: 'livetts' },
  { id: 'sofia', name: 'София', female: true, v3only: true, model: 'livetts', roles: ['casual', 'support'], note: 'livetts' },
  { id: 'vera', name: 'Вера', female: true, v3only: true, model: 'livetts', roles: ['casual', 'support'], note: 'livetts' },
  { id: 'irina', name: 'Ирина', female: true, v3only: true, model: 'livetts', roles: ['formal', 'support', 'narrator', 'sales', 'neutral'], note: 'livetts' },
]


/**
 * Кто как говорит: голос SpeechKit livetts, его амплуа и подача. Общий для игры (кто кем говорит) и сервера
 * (амплуа и описание для внешнего TTS, который понимает манеру словами — TTS_PROVIDER в .env).
 * - role — амплуа livetts по умолчанию; когда собеседник раздражён, сервер берёт formal, где голос его умеет.
 * - rate — темп в браузере (livetts темпа не принимает): <1 медленнее. deeper — заодно ниже тон, ~1,2 полутона
 *   на 0,93; так Палыч звучит старше Серого, хотя голос у них один.
 * - style — характер и манера словами: для внешних TTS, которые понимают инструкции (OpenAI, ElevenLabs v3, Gemini).
 * Замеры 16.10 (тон, разброс интонации, темп) и сэмплы — ~/Arena-materials/voice-test/.
 */
export interface Persona {
  voice: string
  role?: string
  rate?: number
  deeper?: boolean
  style: string
}

export const PERSONAS: Record<string, Persona> = {
  // кампания «Новенький», по порядку глав
  sosed: { voice: 'vasily', style: 'парень 19 лет, студент: весело, по-свойски, с подколкой, молодёжный говорок' },
  gopnik: { voice: 'sergey', role: 'sales', rate: 1.03, style: 'парень 21 года с района: напористо, с понтами, уличный говор, но без злобы, сам на нервах' },
  rinat: { voice: 'denis', role: 'neutral', rate: 0.95, style: 'коммерческий директор, 54 года: сухо, уверенно, неторопливо, с лёгкой иронией, считает вслух' },
  admin: { voice: 'vera', role: 'casual', rate: 0.96, style: 'администратор магазина, 47 лет: устало, сухо и коротко, двенадцатый час на ногах' },
  olga: { voice: 'sofia', style: 'молодой инженер, 27 лет: живо, искренне, деловито' },
  buyer: { voice: 'irina', rate: 0.97, style: 'опытная закупщица, 52 года: по-деловому, прямо, с нажимом' },
  palych: { voice: 'sergey', role: 'support', rate: 0.93, deeper: true, style: 'бригадир, 56 лет: низко, твёрдо, спокойно, без крика, весомо' },
  // свои дела и массовка
  official: { voice: 'sergey', role: 'support', rate: 0.95, deeper: true, style: 'чиновник, 60 лет: размеренно, официально, свысока' },
  foreman: { voice: 'denis', role: 'formal', rate: 0.96, style: 'прораб, 50 лет: по-рабочему прямо, коротко' },
  dev: { voice: 'vasily', style: 'айтишник, 28 лет: расслабленно, быстро, с иронией' },
  hr: { voice: 'vera', role: 'support', style: 'HR-менеджер, 42 года: доброжелательно, по-деловому, с улыбкой в голосе' },
  realtor: { voice: 'sofia', style: 'арендодатель, 34 года: бойко, приветливо, но себе на уме' },
  pacan: { voice: 'vasily', role: 'sales', style: 'пацан с района: дерзко, быстро' },
  guard: { voice: 'sergey', role: 'support', deeper: true, rate: 0.95, style: 'охранник, за 50: лениво, басом, по уставу' },
  worker: { voice: 'denis', style: 'рабочий: просто, по-свойски' },
  workerf: { voice: 'vera', style: 'работница: просто, по-свойски' },
  student: { voice: 'sofia', style: 'студентка: живо, весело' },
  cashier: { voice: 'sofia', role: 'casual', style: 'кассирша: буднично, устало' },
  babka: { voice: 'vera', rate: 0.92, deeper: true, style: 'бабушка: ворчливо, неторопливо' },
  vahter: { voice: 'irina', role: 'formal', rate: 0.95, style: 'вахтёрша: строго, недоверчиво' },
}
