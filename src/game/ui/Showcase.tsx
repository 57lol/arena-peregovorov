import { useState } from 'react'
import './tokens.css'
import './ui.css'
import './showcase.css'
import { EMOTIONS, type PortraitEmotion, type PortraitId } from './assets'
import { Button, IssueStepper, Meter, Notebook, OfferSlip, SpeechField, Stamp } from './Controls'
import { DialogBox } from './DialogBox'
import { MeetingClock } from './MeetingClock'
import { PixelIcon, type IconName } from './PixelIcon'
import { EMOTION_RU } from './Portrait'
import { Scene } from './Scene'

// Витрина кита: открывается по ?showcase. Тексты — из настоящих сценариев.

interface Cast {
  id: PortraitId
  name: string
  role: string
  lines: Record<PortraitEmotion, string>
  slip: { from: string; rows: { label: string; value: string }[] }
}

const CAST: Record<'factory' | 'office', Cast> = {
  factory: {
    id: 'rinat',
    slip: {
      from: 'На столе предложение Марата',
      rows: [
        { label: 'Цена', value: '204 ₽' },
        { label: 'Отсрочка', value: '30 дней' },
        { label: 'Срочные', value: 'за 7 дней' },
        { label: 'Отгрузки', value: 'раз в месяц' },
      ],
    },
    name: 'Марат Гимадиев',
    role: 'коммерческий директор',
    lines: {
      neutral: 'Давайте по-взрослому. Восемь тысяч коробов в месяц, пятислойка, профиль BC. Двести двенадцать рублей за короб.',
      pleased: 'Вот это разговор. Срочные за пять дней я вам сделаю, если деньги придут за пятнадцать.',
      happy: 'По рукам. Сто девяносто шесть, отсрочка пятнадцать дней, срочные за пять. Договор пришлю сегодня.',
      thinking: 'Раз в неделю? Хм. Мне казалось, вам удобнее крупными партиями… Сейчас посчитаю.',
      annoyed: 'Вы третий раз называете одну и ту же цифру. От повторения она не становится ближе.',
      angry: 'Так со мной не разговаривают. Давайте сделаем паузу, пока тон не станет рабочим.',
    },
  },
  office: {
    id: 'olga',
    slip: {
      from: 'На столе ваш оффер',
      rows: [
        { label: 'Оклад', value: '160 тыс.' },
        { label: 'Выход', value: '15 декабря' },
        { label: 'Жильё', value: 'квартира на год' },
        { label: 'Переезд', value: 'через 3 мес.' },
      ],
    },
    name: 'Дарина Лукманова',
    role: 'инженер-робототехник',
    lines: {
      neutral: 'М-м… Давайте начнём с задачи. Какие ячейки, сколько роботов и кто их будет пускать?',
      pleased: 'Если честно, про наставника мне важнее, чем про оклад. Спасибо, что спросили.',
      happy: 'Хорошо. Да. Выход пятнадцатого декабря и квартира на первый год — мне подходит.',
      thinking: 'Секунду, я прикину… А переезд вы компенсируете сразу или после испытательного?',
      annoyed: 'Давайте я подумаю. Когда торопят, я обычно отвечаю «нет».',
      angry: 'Мне кажется, разговор ушёл не туда. Я, пожалуй, пойду.',
    },
  },
}

const ISSUES_BY_SCENE: Record<'factory' | 'office', typeof ISSUES> = {
  factory: [],
  office: [
    { title: 'Оклад', options: ['140 тыс.', '150 тыс.', '160 тыс.', '170 тыс.', '180 тыс.'], points: [30, 24, 18, 10, 0] },
    { title: 'Выход', options: ['1 декабря', '15 декабря', '1 января', '15 января'], points: [20, 16, 6, 0] },
    { title: 'Жильё', options: ['без жилья', 'компенсация', 'квартира'], points: [10, 4, 8] },
    { title: 'Переезд', options: ['сразу', 'через 3 мес.', 'без оплаты'], points: [0, 6, 10] },
  ],
}

const ISSUES = [
  { title: 'Цена за короб', options: ['212 ₽', '204 ₽', '196 ₽', '188 ₽', '180 ₽'], points: [0, 8, 16, 24, 32] },
  { title: 'Отсрочка платежа', options: ['по факту', '15 дней', '30 дней', '45 дней', '60 дней'], points: [0, 2, 4, 6, 8] },
  { title: 'Срочная допоставка', options: ['за 10 дней', 'за 7 дней', 'за 5 дней', 'за 3 дня', 'за 48 часов'], points: [0, 6, 13, 21, 28] },
  { title: 'График отгрузок', options: ['раз в месяц', 'раз в 2 недели', 'еженедельно'], points: [0, 12, 24] },
]

const SWATCHES: { name: string; v: string; role: string }[] = [
  { name: 'ink', v: '--c-ink', role: 'текст, контуры' },
  { name: 'night', v: '--c-night', role: 'окно реплики' },
  { name: 'denim', v: '--c-denim', role: 'ручка в блокноте' },
  { name: 'paper', v: '--c-paper', role: 'бумага, текст на тёмном' },
  { name: 'mist', v: '--c-mist', role: 'вторичный текст' },
  { name: 'wood-2', v: '--c-wood-2', role: 'стол на заводе' },
  { name: 'fog', v: '--c-fog', role: 'стол в офисе' },
  { name: 'brass', v: '--c-brass', role: 'главное действие' },
  { name: 'stamp', v: '--c-stamp', role: 'ушёл, тон, штамп' },
  { name: 'leaf', v: '--c-leaf-hi', role: 'доверие' },
  { name: 'coral', v: '--c-coral', role: 'напряжение, поля' },
  { name: 'grid', v: '--c-grid', role: 'остаток времени' },
]

const ICONS: IconName[] = ['send', 'notebook', 'clock', 'eye', 'leave', 'stamp', 'pen', 'rewind', 'check', 'cross']

export default function Showcase() {
  const [scene, setScene] = useState<'factory' | 'office'>('factory')
  const [emotion, setEmotion] = useState<PortraitEmotion>('neutral')
  const [talking, setTalking] = useState(false)
  const [turn, setTurn] = useState(4)
  const [xray, setXray] = useState(true)
  const [notebook, setNotebook] = useState(false)
  const [stamp, setStamp] = useState<null | 'deal' | 'walked' | 'timeout'>(null)
  const [picks, setPicks] = useState([1, 2, 2, 2])
  const [draft, setDraft] = useState('')
  const cast = CAST[scene]
  const issues = scene === 'office' ? ISSUES_BY_SCENE.office : ISSUES
  const safePicks = picks.map((v, i) => Math.min(v, issues[i].options.length - 1))
  const total = safePicks.reduce((s, v, i) => s + issues[i].points[v], 0)

  return (
    <div className="px-root sc" data-desk={scene}>
      <main className="px-desk sc-desk">
        <div className="sc-screen">
          <div className="sc-stage">
            <div className="sc-hud">
              <MeetingClock turn={turn} turnLimit={12} />
              <div className="sc-hud-actions">
                <Button variant={xray ? 'brass' : 'paper'} icon="eye" aria-pressed={xray} onClick={() => setXray(!xray)}>
                  Рентген
                </Button>
                <Button variant="ghost" icon="leave" className="sc-leave" aria-label="Встать и уйти">
                  <span className="sc-leave-label">Уйти</span>
                </Button>
              </div>
            </div>

            <Scene scene={scene} character={cast.id} emotion={emotion} talking={talking} maxScale={4}>
              {stamp && <Stamp kind={stamp} />}
            </Scene>

            <DialogBox name={cast.name} role={cast.role} text={cast.lines[emotion]} onTalkingChange={setTalking} />

            <OfferSlip from={cast.slip.from} rows={cast.slip.rows} />

            <form
              className="sc-say"
              onSubmit={(e) => {
                e.preventDefault()
                setDraft('')
                setTurn((t) => Math.min(12, t + 1))
              }}
            >
              <SpeechField
                label="Ваша реплика"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                hint="Enter — сказать, Shift+Enter — новая строка"
              />
              <div className="sc-say-row">
                <Button variant="brass" icon="send" type="submit">
                  Сказать
                </Button>
                <Button
                  icon="notebook"
                  className="sc-only-mobile"
                  aria-expanded={notebook}
                  aria-controls="sc-side"
                  onClick={() => setNotebook(!notebook)}
                >
                  {notebook ? 'Закрыть блокнот' : 'Блокнот'}
                </Button>
              </div>
            </form>
          </div>

          <aside id="sc-side" className="sc-side" data-open={notebook}>
            <Notebook
              title="Моё предложение"
              footer={
                <>
                  <Button variant="brass" icon="pen">
                    Положить на стол
                  </Button>
                  <span className="sc-total">
                    в мою пользу <b>{total}</b>
                  </span>
                </>
              }
            >
              <p className="px-note">
                {scene === 'office'
                  ? 'Запасной вариант: интегратор на пусконаладку за 1,4 млн. Он даёт мне 12, меньше брать нет смысла.'
                  : 'Запасной вариант: Казань, 212 ₽, отсрочка 30 дней. Он даёт мне 26, меньше брать нет смысла.'}
              </p>
              {issues.map((it, i) => (
                <IssueStepper
                  key={it.title}
                  title={it.title}
                  options={it.options}
                  points={it.points}
                  value={safePicks[i]}
                  onChange={(v) => setPicks((p) => p.map((x, k) => (k === i ? v : x)))}
                />
              ))}
            </Notebook>

            {xray && (
              <section className="sc-xray" aria-label="Рентген: что чувствует собеседник">
                <h2 className="sc-xray-title">
                  <PixelIcon name="eye" px={2} color="var(--c-grid)" color2="var(--c-coral)" />
                  Рентген: что под столом
                </h2>
                <Meter label="Доверие" value={62} tone="trust" />
                <Meter label="Напряжение" value={35} tone="tension" />
                <p className="sc-xray-note">
                  {scene === 'office'
                    ? 'Расскажет про пусконаладку и дедлайн 15 декабря, если спросить без нажима.'
                    : 'Расскажет, зачем ему быстрые деньги, если спросить прямо.'}
                </p>
              </section>
            )}
          </aside>
        </div>
      </main>

      <section className="sc-kit" aria-label="Детали кита">
        <div className="sc-kit-inner">
          <h1 className="sc-h1">Пиксельный кит «Переговорки»</h1>
          <p className="sc-lead">Витрина для команды. Переключите сцену и эмоцию, чтобы проверить портреты и тексты.</p>

          <div className="sc-controls">
            <fieldset className="sc-group">
              <legend>Сцена</legend>
              <Button variant={scene === 'factory' ? 'brass' : 'paper'} onClick={() => setScene('factory')}>
                Гофрокомбинат
              </Button>
              <Button variant={scene === 'office' ? 'brass' : 'paper'} onClick={() => setScene('office')}>
                Переговорная
              </Button>
            </fieldset>
            <fieldset className="sc-group">
              <legend>Эмоция</legend>
              {EMOTIONS.map((e) => (
                <Button key={e} variant={emotion === e ? 'brass' : 'paper'} onClick={() => setEmotion(e)}>
                  {EMOTION_RU[e]}
                </Button>
              ))}
            </fieldset>
            <fieldset className="sc-group">
              <legend>Конец встречи</legend>
              <Button variant={stamp === 'deal' ? 'brass' : 'paper'} onClick={() => setStamp(stamp === 'deal' ? null : 'deal')}>
                Сделка
              </Button>
              <Button variant={stamp === 'walked' ? 'brass' : 'paper'} onClick={() => setStamp(stamp === 'walked' ? null : 'walked')}>
                Уход
              </Button>
              <Button variant={stamp === 'timeout' ? 'brass' : 'paper'} onClick={() => setStamp(stamp === 'timeout' ? null : 'timeout')}>
                Время
              </Button>
              <Button onClick={() => setTurn((t) => (t >= 12 ? 0 : t + 1))}>Ход +1</Button>
            </fieldset>
          </div>

          <h2 className="sc-h2">Палитра: Apollo, 12 ролей из 46 цветов</h2>
          <ul className="sc-swatches">
            {SWATCHES.map((s) => (
              <li key={s.name}>
                <span className="sc-chip" style={{ background: `var(${s.v})` }} />
                <b>{s.name}</b>
                <span>{s.role}</span>
              </li>
            ))}
          </ul>

          <h2 className="sc-h2">Шрифты</h2>
          <div className="sc-type">
            <p className="sc-type-read">Ark Pixel 24: «Давайте по-взрослому. Восемь тысяч коробов в месяц».</p>
            <p className="sc-type-ui">Pixeloid 18: интерфейс, блокнот, кнопки. 0123456789 ₽ № «»</p>
            <p className="sc-type-big">Pixeloid Bold 27: 10:40</p>
          </div>

          <h2 className="sc-h2">Кнопки и иконки</h2>
          <div className="sc-row">
            <Button variant="brass" icon="send">
              Сказать
            </Button>
            <Button icon="notebook">Блокнот</Button>
            <Button variant="stamp" icon="leave">
              Встать и уйти
            </Button>
            <Button disabled>Нельзя</Button>
            <Button variant="ghost" icon="rewind">
              Переиграть с этого хода
            </Button>
          </div>
          <div className="sc-row sc-icons">
            {ICONS.map((n) => (
              <span key={n} className="sc-icon" title={n}>
                <PixelIcon name={n} px={4} color="var(--c-paper)" color2="var(--c-brass)" />
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
