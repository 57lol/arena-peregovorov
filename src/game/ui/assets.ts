// Реестр пиксельной графики. Исходники и генераторы — tools/art/*.py.

/** Порядок строк в листе портрета (совпадает с Emotion из движка). */
export const EMOTIONS = ['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry'] as const
export type PortraitEmotion = (typeof EMOTIONS)[number]

/** Кадры в строке: обычный, рот открыт, моргание. */
export const FRAMES = { idle: 0, talk: 1, blink: 2 } as const
export type PortraitFrame = keyof typeof FRAMES

export const PORTRAIT_SIZE = 96

/** id портрета = Character.portrait в сценарии */
export const PORTRAITS = {
  rinat: { sheet: '/assets/portraits/rinat.png', label: 'Марат Гимадиев' },
  olga: { sheet: '/assets/portraits/olga.png', label: 'Дарина Лукманова' },
} as const
export type PortraitId = keyof typeof PORTRAITS

export const SCENE_W = 192
export const SCENE_H = 108

export const SCENES = {
  factory: { bg: '/assets/scenes/factory.png', desk: '/assets/scenes/factory-desk.png', title: 'Кабинет на гофрокомбинате' },
  office: { bg: '/assets/scenes/office.png', desk: '/assets/scenes/office-desk.png', title: 'Переговорная в бизнес-центре' },
} as const
export type SceneId = keyof typeof SCENES

/** Неизвестную эмоцию от LLM сводим к ближайшей из листа. */
export function toPortraitEmotion(e: string | undefined): PortraitEmotion {
  return (EMOTIONS as readonly string[]).includes(e ?? '') ? (e as PortraitEmotion) : 'neutral'
}
