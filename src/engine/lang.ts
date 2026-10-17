// Язык дела. Русский по умолчанию; 'en' — разговор на английском, а интерфейс, разбор и подсказки остаются русскими.

import type { Scenario } from './types'

export type Lang = 'ru' | 'en'
export const langOf = (sc: Pick<Scenario, 'lang'>): Lang => sc.lang ?? 'ru'
export const isEn = (sc: Pick<Scenario, 'lang'>) => sc.lang === 'en'

/** Служебные реплики игрока от кнопок: их слышит собеседник, поэтому на языке дела. */
export const BUTTON_LINES = {
  ru: { offer: 'Предлагаю так: ', accept: 'Согласен. Принимаю ваше предложение.', leave: 'Спасибо за время, но так мы не договоримся. Я ухожу.' },
  en: { offer: 'My offer: ', accept: 'Agreed. I accept your offer.', leave: 'Thank you for your time, but we will not agree like this. I am leaving.' },
} as const satisfies Record<Lang, { offer: string; accept: string; leave: string }>

export const buttonLines = (sc: Pick<Scenario, 'lang'>) => BUTTON_LINES[langOf(sc)]

/** Латиница без кириллицы — английский текст: ему не нужны русские ударения и правила чтения. */
export const looksEnglish = (text: string) => !/[а-яё]/iu.test(text) && /[a-z]/i.test(text)
