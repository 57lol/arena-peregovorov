// Реестр пиксельной графики. Исходники и генераторы — tools/art/*.py.

/** Порядок строк в листе портрета (совпадает с Emotion из движка). */
export const EMOTIONS = ['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry'] as const
type SpriteEmotion = (typeof EMOTIONS)[number]
export type PortraitEmotion = SpriteEmotion | 'hurt' | 'surprised' | 'suspicious'

// Новые реакции используют готовые кадры и отдельный наклон головы.
export const spriteEmotion = (e: PortraitEmotion): SpriteEmotion => e === 'hurt' ? 'annoyed' : e === 'surprised' || e === 'suspicious' ? 'thinking' : e
export const emotionTilt = (e: PortraitEmotion) => e === 'hurt' ? -3 : e === 'surprised' ? 3 : e === 'suspicious' ? -5 : 0

/** Кадры в строке: обычный, рот открыт, моргание. */
export const FRAMES = { idle: 0, talk: 1, blink: 2 } as const
export type PortraitFrame = keyof typeof FRAMES

export const PORTRAIT_SIZE = 96

/** id портрета = Character.portrait в сценарии. Пул для своих дел — src/content/faces.ts. */
export const PORTRAITS = {
  china: { sheet: '/assets/portraits/china.png', label: 'Ли Вэй, торговец из Шэньчжэня', female: false },
  rinat: { sheet: '/assets/portraits/rinat.png', label: 'Марат Гимадиев', female: false },
  olga: { sheet: '/assets/portraits/olga.png', label: 'Дарина Лукманова', female: true },
  foreman: { sheet: '/assets/portraits/foreman.png', label: 'Прораб, 50', female: false },
  dev: { sheet: '/assets/portraits/dev.png', label: 'Айтишник, 28', female: false },
  official: { sheet: '/assets/portraits/official.png', label: 'Госзаказчик, 60', female: false },
  hr: { sheet: '/assets/portraits/hr.png', label: 'Кадровик, 42', female: true },
  realtor: { sheet: '/assets/portraits/realtor.png', label: 'Арендодатель, 34', female: true },
  buyer: { sheet: '/assets/portraits/buyer.png', label: 'Закупщица, 52', female: true },
  // кампания «Новенький» (src/content/story.ts, рисует tools/art/people_story.py); в пул своих дел не входят
  sosed: { sheet: '/assets/portraits/sosed.png', label: 'Тимур, сосед по общаге', female: false },
  gopnik: { sheet: '/assets/portraits/gopnik.png', label: 'Серый', female: false },
  admin: { sheet: '/assets/portraits/admin.png', label: 'Лариса Петровна, администратор', female: true },
  pacan: { sheet: '/assets/portraits/pacan.png', label: 'Кирюха', female: false },
  babka: { sheet: '/assets/portraits/babka.png', label: 'Бабушка на остановке', female: true },
  cashier: { sheet: '/assets/portraits/cashier.png', label: 'Диляра, кассир', female: true },
  guard: { sheet: '/assets/portraits/guard.png', label: 'Охранник магазина', female: false },
  worker: { sheet: '/assets/portraits/worker.png', label: 'Андрей, рабочий цеха', female: false },
  workerf: { sheet: '/assets/portraits/workerf.png', label: 'Оксана, рабочая цеха', female: true },
  student: { sheet: '/assets/portraits/student.png', label: 'Аня, соседка из 215-й', female: true },
  vahter: { sheet: '/assets/portraits/vahter.png', label: 'Галина Ивановна, комендант', female: true },
  palych: { sheet: '/assets/portraits/palych.png', label: 'Палыч, бригадир', female: false },
  // английские дела в Лагосе и Стамбуле; в пул своих дел не входят
  lagos: { sheet: '/assets/portraits/lagos.png', label: 'Адебайо Адейеми', female: false },
  emre: { sheet: '/assets/portraits/emre.png', label: 'Эмре Кая', female: false },
} as const satisfies Record<string, { sheet: string; label: string; female: boolean }>
export type PortraitId = keyof typeof PORTRAITS

export const SCENE_W = 192
export const SCENE_H = 108

export const SCENES = {
  factory: { bg: '/assets/scenes/factory.png', desk: '/assets/scenes/factory-desk.png', title: 'Кабинет на гофрокомбинате' },
  office: { bg: '/assets/scenes/office.png', desk: '/assets/scenes/office-desk.png', title: 'Переговорная в бизнес-центре' },
  // места кампании «Новенький» (src/content/story.ts), картинки — tools/art/scenes_story.py
  dorm: { bg: '/assets/scenes/dorm.png', desk: '/assets/scenes/dorm-desk.png', title: 'Комната в общежитии' },
  street: { bg: '/assets/scenes/street.png', desk: '/assets/scenes/street-desk.png', title: 'Остановка у ларька' },
  shop: { bg: '/assets/scenes/shop.png', desk: '/assets/scenes/shop-desk.png', title: 'Магазин у общежития' },
  bytovka: { bg: '/assets/scenes/bytovka.png', desk: '/assets/scenes/bytovka-desk.png', title: 'Бытовка цеха' },
  inei: { bg: '/assets/scenes/inei.png', desk: '/assets/scenes/inei-desk.png', title: 'Кабинет закупок «Инея»' },
  // английские дела в Лагосе и Стамбуле
  lagos: { bg: '/assets/scenes/lagos.png', desk: '/assets/scenes/lagos-desk.png', title: 'Meridian Industrial Partners · Виктория-Айленд, Лагос' },
  istanbul: { bg: '/assets/scenes/istanbul.png', desk: '/assets/scenes/istanbul-desk.png', title: 'Офис Marmara Coating Systems в Ускюдаре' },
  // видеозвонок (дело «Поставщик из Шэньчжэня»): большой экран в переговорной «Кама», картинки — tools/art/call_screen.py
  meet: { bg: '/assets/scenes/meet.png', desk: '/assets/scenes/meet-desk.png', title: 'Переговорная «Кама», видеозвонок' },
} as const
export type SceneId = keyof typeof SCENES

/** Неизвестную эмоцию от LLM сводим к ближайшей из листа. */
export function toPortraitEmotion(e: string | undefined): PortraitEmotion {
  return (EMOTIONS as readonly string[]).includes(e ?? '') ? (e as PortraitEmotion) : 'neutral'
}
