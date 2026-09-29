// Сценарии катсцен кампании «Новенький»: пролог (автобус в Елабугу и памятка в телефоне), переходы между главами
// и финал недели. Правило: одна мысль за раз — на экране телефона заголовок и строка, внизу одна строка субтитров.
// Переход ведёт от главы к следующей по сюжету; тексты — по мостикам глав из src/content/story.ts.

import { getScenario } from '../../content/scenarios'
import { CHAPTERS } from '../../content/story'
import { PORTRAITS, type PortraitId } from '../ui/assets'
import { BUS, SPOTS } from './art'
import type { Card, Cutscene, Shot } from './types'

const S = SPOTS.street
const O = SPOTS.oez

/** Короткое имя приёма главы — для титра. Полное — в карточке главы на карте. */
const SKILL: Record<string, string> = {
  dorm: 'обмен',
  stop: 'не заводиться',
  tara: 'не брать первую цифру',
  shop: 'правила и факты',
  offer: 'что просит и зачем',
  client: 'проверить угрозу',
  launch: 'всё сразу',
}

/** Титр главы из её дня, времени и метки на карте. */
export function chapterCard(id: string): Card {
  const i = CHAPTERS.findIndex((c) => c.id === id)
  const ch = CHAPTERS[i]
  if (!ch) return { kicker: '', title: id }
  const sc = getScenario(id)
  return {
    face: sc && sc.opponent.character.portrait in PORTRAITS ? (sc.opponent.character.portrait as PortraitId) : undefined,
    kicker: `${ch.kind === 'finale' ? 'Финал' : `Глава ${i + 1}`} · ${ch.day}, ${ch.time}`,
    title: ch.label,
    sub: SKILL[id] ? `Приём: ${SKILL[id]}` : undefined,
  }
}

const card = (id: string, dur = 3): Shot => ({ set: 'black', dur, card: chapterCard(id) })
const map = (from: string, to: string, text: string, dur = 3.6): Shot => ({ set: 'map', dur, route: { from, to }, lines: [{ at: 0.3, text }] })

export const PROLOGUE: Cutscene = {
  id: 'prologue',
  title: 'Пролог: дорога в Алабугу',
  shots: [
    {
      set: 'road',
      mood: 'dusk',
      dur: 6.5,
      drive: 90,
      cam: 160,
      fadeIn: 0.8,
      actors: [{ who: 'bus', x: [[0, 118], [6.5, 176]], y: BUS.ground }],
      lines: [
        { at: 0.5, text: 'Воскресенье. Автобус Казань — Елабуга.' },
        { at: 3.4, text: 'Вы едете работать в ОЭЗ «Алабуга».' },
      ],
    },
    {
      set: 'bus',
      mood: 'dusk',
      dur: 4,
      drive: 90,
      sit: 'look',
      lines: [{ at: 0.3, text: 'Ехать ещё сорок минут. Можно полистать памятку.' }],
    },
    {
      set: 'phone',
      mood: 'dusk',
      behind: 'bus',
      dur: 14.8,
      drive: 90,
      phone: [
        { at: 0, kind: 'memo', n: '1/4', title: 'Не драка', text: 'Ищем сделку, где лучше обоим.' },
        { at: 3.7, kind: 'memo', n: '2/4', title: 'Спроси «зачем?»', text: 'За просьбой прячется причина.' },
        { at: 7.4, kind: 'memo', n: '3/4', title: 'Меняйся', text: 'Отдай то, что дёшево тебе, за то, что важно.' },
        { at: 11.1, kind: 'memo', n: '4/4', title: 'Знай, куда уйти', text: 'Плохая сделка хуже, чем никакой.' },
      ],
      lines: [
        { at: 0.2, text: 'Переговоры — не спор. Цель — договориться с выгодой.' },
        { at: 3.9, text: 'Узнаете причину — найдёте, чем её закрыть.' },
        { at: 7.6, text: 'Уступите в мелочи — получите главное.' },
        { at: 11.3, text: 'Помните, что будет, если не договоритесь.' },
      ],
    },
    {
      set: 'street',
      mood: 'dusk',
      dur: 6,
      actors: [{ who: 'case', x: [[0, S.stop], [6, S.stop + 230]] }],
      lines: [{ at: 0.3, text: 'Елабуга. До общаги — пять минут пешком.' }],
    },
    {
      set: 'street',
      mood: 'dusk',
      dur: 5.5,
      actors: [{ who: 'case', x: [[0, S.dorm - 180], [4.6, S.dorm - 4]] }],
      lines: [{ at: 0.3, text: 'Общага, комната 214. Там уже кто-то живёт.' }],
    },
    card('dorm'),
  ],
}

/** Подпись цели на карте недели. */
export const pinLabel = (id: string) => CHAPTERS.find((c) => c.id === id)?.label ?? ''

/** Переход после главы: ключ — id главы, которую только что сыграли. */
export const BRIDGES: Record<string, Cutscene> = {
  dorm: {
    id: 'to-stop',
    title: 'Понедельник: на остановку',
    shots: [
      map('dorm', 'stop', 'Понедельник. Служебный автобус в ОЭЗ — в 7:52.'),
      {
        set: 'street',
        mood: 'morning',
        dur: 5.5,
        actors: [{ who: 'newbie', x: [[0, S.dorm], [5.2, S.dorm - 210]] }],
        lines: [
          { at: 0.3, text: 'Утром новый чайник потёк прямо на стол.' },
          { at: 2.8, who: 'Тимур', text: 'Неси обратно. По закону обязаны вернуть.' },
        ],
      },
      {
        set: 'street',
        mood: 'morning',
        dur: 5,
        actors: [{ who: 'newbie', x: [[0, S.stop + 200], [4.6, S.stop + 14]] }],
        lines: [{ at: 0.3, text: 'Это вечером. А сейчас — на остановку.' }],
      },
      {
        set: 'phone',
        mood: 'morning',
        behind: 'street',
        cam: S.stop,
        dur: 4.6,
        phone: [{ at: 0, kind: 'memo', n: 'приём дня', title: 'Не заводись', text: 'Спокойный тон — сильная позиция.' }],
        lines: [{ at: 0.3, text: 'И заранее решите, куда отступить.' }],
      },
      card('stop'),
    ],
  },
  stop: {
    id: 'to-tara',
    title: 'Понедельник: первый рабочий день',
    shots: [
      map('stop', 'tara', 'Двадцать минут на служебном автобусе — и вы в ОЭЗ.'),
      {
        set: 'road',
        mood: 'morning',
        dur: 4.2,
        drive: 110,
        cam: 160,
        actors: [{ who: 'bus', x: [[0, 150], [4.2, 172]], y: BUS.ground }],
        lines: [{ at: 0.3, text: 'В автобусе вы наконец выдыхаете.' }],
      },
      {
        set: 'phone',
        mood: 'morning',
        behind: 'bus',
        drive: 110,
        dur: 8.8,
        phone: [
          { at: 0, kind: 'chat', from: 'Начальница', face: 'hr', text: 'Новенький? Закупщик на больничном, а через два часа — поставщик коробок. Кроме тебя некому.' },
          { at: 4.4, kind: 'memo', n: 'приём дня', title: 'Первая цифра — не последняя', text: 'Её всегда называют с запасом.' },
        ],
        lines: [
          { at: 0.3, text: 'Пишет начальница.' },
          { at: 4.6, text: 'Не соглашайтесь сразу. Ищите, что обменять.' },
        ],
      },
      {
        set: 'oez',
        dur: 5.2,
        actors: [{ who: 'newbie', x: [[0, O.vodogrey - 190], [4.8, O.vodogrey - 4]] }],
        lines: [{ at: 0.3, text: '«Водогрей». Работа начинается с папки.' }],
      },
      card('tara'),
    ],
  },
  tara: {
    id: 'to-shop',
    title: 'Вторник: вернуть чайник',
    shots: [
      map('tara', 'shop', 'Вторник, вечер. Чайник так и стоит в коробке.'),
      {
        set: 'street',
        mood: 'dusk',
        dur: 4.6,
        actors: [{ who: 'box', x: [[0, S.dorm], [4.6, S.dorm - 180]] }],
        lines: [{ at: 0.3, text: 'Чек выброшен. Зато коробка цела.' }],
      },
      {
        set: 'phone',
        mood: 'dusk',
        behind: 'street',
        cam: S.shop + 120,
        dur: 4.6,
        phone: [{ at: 0, kind: 'memo', n: 'приём дня', title: 'Факты сильнее эмоций', text: 'Закон, упаковка, сроки.' }],
        lines: [{ at: 0.3, text: '«Я же прав» не работает. Работают правила.' }],
      },
      {
        set: 'street',
        mood: 'dusk',
        dur: 4.2,
        actors: [{ who: 'box', x: [[0, S.shop + 150], [3.8, S.shop + 2]] }],
        lines: [{ at: 0.3, text: '«Семёрочка». Администратор уже смотрит.' }],
      },
      card('shop'),
    ],
  },
  shop: {
    id: 'to-offer',
    title: 'Среда: звонок начальницы',
    shots: [
      {
        set: 'street',
        mood: 'night',
        dur: 4.6,
        cam: S.dorm,
        actors: [
          { who: 'newbie', x: S.dorm - 22, face: 'right' },
          { who: 'timur', x: S.dorm + 26, face: 'left', pose: 'cheers' },
        ],
        lines: [{ at: 0.4, who: 'Тимур', text: 'Уважаю. Чай будешь?' }],
      },
      {
        set: 'phone',
        mood: 'night',
        behind: 'street',
        cam: S.dorm,
        dur: 8.8,
        phone: [
          { at: 0, kind: 'chat', from: 'Начальница', face: 'hr', text: 'Завтра в 11 — «Штамп-К». Лучший кандидат за три месяца ждёт финала. Проведёшь.' },
          { at: 4.4, kind: 'memo', n: 'приём дня', title: 'Что просит — и зачем', text: 'Деньги — не всегда про деньги.' },
        ],
        lines: [
          { at: 0.3, text: 'Пишет начальница.' },
          { at: 4.6, text: 'Узнайте, зачем человеку то, что он просит.' },
        ],
      },
      map('shop', 'offer', 'Среда. «Штамп-К», переговорная.'),
      card('offer'),
    ],
  },
  offer: {
    id: 'to-client',
    title: 'Четверг: «Иней» грозит уйти',
    shots: [
      {
        set: 'oez',
        dur: 4,
        cam: O.parking,
        actors: [{ who: 'newbie', x: O.parking, face: 'right', pose: 'look' }],
        lines: [{ at: 0.3, text: 'Парковка «Штамп-К». Телефон пищит.' }],
      },
      {
        set: 'phone',
        mood: 'day',
        behind: 'oez',
        cam: O.parking,
        dur: 8.8,
        phone: [
          { at: 0, kind: 'chat', from: 'Начальница', face: 'hr', text: '«Иней» грозит уйти к китайцам. Роза ждёт завтра в три. Ты у нас теперь переговорщик.' },
          { at: 4.4, kind: 'memo', n: 'приём дня', title: 'Угроза — это вопрос', text: 'Проверьте её, прежде чем уступать.' },
        ],
        lines: [
          { at: 0.3, text: 'Опять начальница.' },
          { at: 4.6, text: 'На давление не отвечайте скидкой.' },
        ],
      },
      map('offer', 'client', 'Четверг. «Иней», кабинет закупок.'),
      {
        set: 'oez',
        dur: 4.6,
        actors: [{ who: 'newbie', x: [[0, O.inei - 170], [4.4, O.inei - 4]] }],
        lines: [{ at: 0.3, text: 'На столе у Розы — письмо из Нинбо.' }],
      },
      card('client'),
    ],
  },
  client: {
    id: 'to-launch',
    title: 'Пятница: ночная смена',
    shots: [
      map('client', 'launch', 'Пятница, ночь. Линия стартует в понедельник.'),
      {
        set: 'phone',
        mood: 'dusk',
        behind: 'oez',
        cam: O.vodogrey,
        dur: 8.8,
        phone: [
          { at: 0, kind: 'chat', from: 'Директор «Водогрея»', face: 'official', text: 'Ночная смена отказывается выходить. Палыч с конторскими не говорит. С тобой, может, станет.' },
          { at: 4.4, kind: 'memo', n: 'финал', title: 'Всё сразу', text: 'Спроси. Обменяй. Не заводись.' },
        ],
        lines: [
          { at: 0.3, text: 'Вас зовут к директору.' },
          { at: 4.6, text: 'Всё, чему научились за неделю, — в одной встрече.' },
        ],
      },
      {
        set: 'oez',
        mood: 'night',
        dur: 5,
        actors: [{ who: 'newbie', x: [[0, O.vodogrey + 170], [4.6, O.vodogrey + 4]] }],
        lines: [{ at: 0.3, text: 'Бытовка нового цеха. Внутри — бригада.' }],
      },
      card('launch'),
    ],
  },
  launch: {
    id: 'finale',
    title: 'Финал: неделя позади',
    shots: [
      {
        set: 'oez',
        mood: 'morning',
        dur: 5,
        actors: [{ who: 'newbie', x: [[0, O.vodogrey], [4.8, O.vodogrey + 180]] }],
        lines: [{ at: 0.3, text: 'Понедельник. Новая линия запущена.' }],
      },
      {
        set: 'road',
        dur: 5,
        drive: 90,
        cam: 160,
        actors: [{ who: 'bus', x: [[0, 140], [5, 180]], y: BUS.ground }],
        lines: [{ at: 0.3, text: 'Неделю назад вы ехали сюда с одним чемоданом.' }],
      },
      {
        set: 'street',
        dur: 4.6,
        cam: S.dorm,
        actors: [
          { who: 'newbie', x: S.dorm - 22, face: 'right' },
          { who: 'timur', x: S.dorm + 26, face: 'left', pose: 'cheers' },
        ],
        lines: [{ at: 0.4, who: 'Тимур', text: 'Ну что, переговорщик? Новеньким тебя больше не зовут.' }],
      },
      { set: 'black', dur: 3.6, card: { kicker: 'Неделя позади', title: 'Спасибо, что сыграли', sub: 'Любую встречу можно сыграть заново' } },
    ],
  },
}

export const CUTSCENES: Cutscene[] = [PROLOGUE, ...CHAPTERS.flatMap((c) => (BRIDGES[c.id] ? [BRIDGES[c.id]] : []))]

export const cutsceneById = (id: string) => CUTSCENES.find((c) => c.id === id)
