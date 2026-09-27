import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { PixelIcon, type IconName } from './PixelIcon'

type Variant = 'brass' | 'paper' | 'stamp' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: IconName
  children?: ReactNode
}

/** Кнопка-клавиша: при нажатии проседает на один пиксель. */
export function Button({ variant = 'paper', icon, children, className, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`px-btn px-btn--${variant}${className ? ' ' + className : ''}`} {...rest}>
      {icon && <PixelIcon name={icon} px={2} />}
      {children && <span>{children}</span>}
    </button>
  )
}

interface FieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}

/** Поле реплики игрока: лист бумаги. Enter — отправить, Shift+Enter — перенос. */
export function SpeechField({ label, hint, id = 'px-speech', ...rest }: FieldProps) {
  return (
    <div className="px-field">
      <label className="px-visually-hidden" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="px-field-input" rows={2} placeholder={label} {...rest} />
      {hint && <p className="px-field-hint">{hint}</p>}
    </div>
  )
}

interface StepperProps {
  title: string
  options: string[]
  value: number
  onChange: (i: number) => void
  /** мои очки за каждый вариант — пишутся в блокноте карандашом */
  points?: number[]
}

/** Строка блокнота: пункт договора и выбор варианта стрелками. */
export function IssueStepper({ title, options, value, onChange, points }: StepperProps) {
  const p = points?.[value]
  return (
    <div className="px-issue">
      <span className="px-issue-title">{title}</span>
      <div className="px-issue-ctrl">
        <button
          type="button"
          className="px-step"
          onClick={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
          aria-label={`${title}: предыдущий вариант`}
        >
          <PixelIcon name="left" px={2} />
        </button>
        <output className="px-issue-value" aria-live="polite">
          {options[value]}
        </output>
        <button
          type="button"
          className="px-step"
          onClick={() => onChange(Math.min(options.length - 1, value + 1))}
          disabled={value === options.length - 1}
          aria-label={`${title}: следующий вариант`}
        >
          <PixelIcon name="right" px={2} />
        </button>
      </div>
      {p !== undefined && (
        <span className={`px-issue-points${p < 0 ? ' is-neg' : ''}`} title="сколько это даёт вам">
          {p > 0 ? `+${p}` : p}
        </span>
      )}
    </div>
  )
}

interface NotebookProps {
  title: string
  children: ReactNode
  footer?: ReactNode
}

/** Блокнот игрока: тетрадь в клетку на пружине, поля справа, как в школьной. */
export function Notebook({ title, children, footer }: NotebookProps) {
  return (
    <section className="px-notebook" aria-label={title}>
      <div className="px-notebook-rings" aria-hidden="true" />
      <div className="px-notebook-page">
        <h2 className="px-notebook-title">{title}</h2>
        {children}
        {footer && <div className="px-notebook-footer">{footer}</div>}
      </div>
    </section>
  )
}

interface SlipProps {
  from: string
  rows: { label: string; value: string }[]
}

/** «На столе»: последнее формальное предложение, как листок, придавленный стаканом. */
export function OfferSlip({ from, rows }: SlipProps) {
  return (
    <aside className="px-slip" aria-label="Предложение на столе">
      <p className="px-slip-from">{from}</p>
      <dl className="px-slip-rows">
        {rows.map((r) => (
          <div key={r.label} className="px-slip-row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}

interface MeterProps {
  label: string
  value: number // 0..100
  tone: 'trust' | 'tension'
}

/** Шкала из десяти делений для режима «рентгена». */
export function Meter({ label, value, tone }: MeterProps) {
  const lit = Math.round(Math.max(0, Math.min(100, value)) / 10)
  return (
    <div className={`px-meter px-meter--${tone}`}>
      <span className="px-meter-label">{label}</span>
      <span className="px-meter-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < lit ? 'on' : undefined} />
        ))}
      </span>
      <span className="px-meter-num">{value}</span>
    </div>
  )
}

interface StampProps {
  kind: 'deal' | 'walked' | 'timeout'
}

const STAMP_TEXT = { deal: 'По рукам', walked: 'Без сделки', timeout: 'Время вышло' }


/** Штамп поверх сцены в конце встречи. */
export function Stamp({ kind }: StampProps) {
  return (
    <div className={`px-stamp px-stamp--${kind}`} role="status">
      <span>{STAMP_TEXT[kind]}</span>
    </div>
  )
}
