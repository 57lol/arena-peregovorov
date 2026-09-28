// Разбор хода «на полях»: пометки зелёной и красной ручкой, штампик, итог хода и совет «что дальше».
// На ноутбуке — листок в правой колонке. На телефоне — полоска со штампиком на месте вашей реплики над окном
// собеседника (поле ввода остаётся на первом экране), по тапу листок выезжает снизу, как рентген.

import { effectText, type Ink, type Tip, type TurnFeedback } from '../instant'
import { PixelIcon } from '../ui'

interface Props {
  fb: TurnFeedback | null
  tip: Tip | null
  where: 'stage' | 'side'
  open?: boolean
  dim?: boolean
  onOpen?: (open: boolean) => void
  onExample: (text: string) => void
  onOff: () => void
}

const MARK: Record<Ink, { icon: 'check' | 'cross' | 'pen'; color: string }> = {
  good: { icon: 'check', color: 'var(--c-leaf)' },
  bad: { icon: 'cross', color: 'var(--c-stamp)' },
  plain: { icon: 'pen', color: 'var(--c-steel)' },
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)

/** Коротко для свёрнутой полоски: главный приём хода и сколько ещё. */
function summary(fb: TurnFeedback | null, tip: Tip | null): string {
  if (!fb) return tip?.short ?? tip?.text ?? ''
  const marks = fb.notes.filter((n) => n.ink !== 'plain')
  if (!marks.length) return fb.notes[0]?.title ?? effectText(fb)
  return marks.length > 1 ? `${marks[0].title} и ещё ${marks.length - 1}` : marks[0].title
}

function StampMark({ fb }: { fb: TurnFeedback | null }) {
  const s = fb ? fb.verdict : { ink: 'plain' as Ink, word: 'Совет' }
  return (
    <span key={fb?.turn ?? 0} className={`g-margin-stamp is-${s.ink}`}>
      {s.word}
    </span>
  )
}

function Body({ fb, tip, onExample, onOff }: Pick<Props, 'fb' | 'tip' | 'onExample' | 'onOff'>) {
  return (
    <div className="g-margin-body">
      {fb && (
        <>
          {fb.notes.length > 0 && (
            <ul className="g-margin-notes">
              {fb.notes.map((n) => (
                <li key={n.key} className={`is-${n.ink}`}>
                  <span className="g-margin-mark" aria-hidden="true">
                    <PixelIcon name={MARK[n.ink].icon} px={2} color={MARK[n.ink].color} />
                  </span>
                  <b>{n.title}</b>
                  {n.quote && <q>{n.quote}</q>}
                  <span className="g-margin-why">{n.why}</span>
                </li>
              ))}
            </ul>
          )}
          {fb.empty && <p className="g-margin-plain">Приёмов не заметили: реплика ни помогла, ни помешала.</p>}
          <p className="g-margin-effect">
            {fb.trust === 0 && fb.tension === 0 ? (
              'Ход ничего не сдвинул.'
            ) : (
              <>
                {fb.trust !== 0 && <span className={fb.trust > 0 ? 'is-up' : 'is-down'}>доверие {signed(fb.trust)}</span>}
                {fb.tension !== 0 && <span className={fb.tension < 0 ? 'is-up' : 'is-down'}>напряжение {signed(fb.tension)}</span>}
              </>
            )}
          </p>
          <p className="g-margin-reply">{fb.reply}</p>
        </>
      )}
      {tip && (
        <div className="g-margin-tip">
          <p>
            <b>Дальше:</b> {tip.text}
          </p>
          {tip.example && (
            <button type="button" className="g-link" onClick={() => onExample(tip.example!)}>
              Вставить пример
            </button>
          )}
        </div>
      )}
      <button type="button" className="g-link g-link--quiet g-margin-off" aria-pressed="true" onClick={onOff}>
        Подсказки на ходу: вкл
      </button>
    </div>
  )
}

export function Margin({ fb, tip, where, open = false, dim, onOpen, onExample, onOff }: Props) {
  if (!fb && !tip) return null
  const title = fb ? `Ход ${fb.turn} на полях` : 'Перед первым ходом'
  const cls = `g-margin g-margin--${where}${dim ? ' is-dim' : ''}`

  if (where === 'side')
    return (
      <section className={cls} aria-label={fb ? `Разбор хода ${fb.turn}` : 'Совет'}>
        <p className="g-margin-head">
          <span>{title}</span>
          <StampMark fb={fb} />
        </p>
        <Body fb={fb} tip={tip} onExample={onExample} onOff={onOff} />
      </section>
    )

  return (
    <section className={cls} aria-label={fb ? `Разбор хода ${fb.turn}` : 'Совет'} data-open={open}>
      <button type="button" className="g-margin-bar" aria-expanded={open} aria-controls="g-margin-sheet" onClick={() => onOpen?.(!open)}>
        <StampMark fb={fb} />
        <span className="g-margin-bar-text">{summary(fb, tip)}</span>
        <PixelIcon name="more" px={2} color="var(--c-steel-2)" />
      </button>
      {open && (
        <div id="g-margin-sheet" className="g-margin-sheet">
          <p className="g-margin-head">
            <span>{title}</span>
            <StampMark fb={fb} />
            <button type="button" className="g-margin-close" aria-label="Свернуть разбор хода" onClick={() => onOpen?.(false)}>
              <PixelIcon name="cross" px={2} color="var(--c-steel-2)" />
            </button>
          </p>
          <Body fb={fb} tip={tip} onExample={onExample} onOff={onOff} />
        </div>
      )}
    </section>
  )
}

/** Выключенные подсказки: одна тихая строка, чтобы вернуть их обратно. */
export function MarginOff({ onOn }: { onOn: () => void }) {
  return (
    <button type="button" className="g-link g-link--quiet g-margin-on" aria-pressed="false" onClick={onOn}>
      Подсказки на ходу: выкл
    </button>
  )
}
