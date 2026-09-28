import { useEffect, useRef, useState } from 'react'
import { isComplete, sameOffer } from '../../engine/utility'
import { g, meetingClock, plural, portraitFor, sceneFor } from '../cast'
import { stopAudio } from '../speech'
import { endText, useMeeting, type MeetingProps } from '../useMeeting'
import { Button, DialogBox, IssueStepper, MeetingClock, Notebook, PixelIcon, Scene, SpeechField, Stamp } from '../ui'
import { MicButton } from './Mic'
import { Margin, MarginOff } from './Margin'
import { Notes, Slip, XRay } from './meetingParts'

type Props = MeetingProps & {
  /** переключиться на 3D-вид (кнопки нет, если 3D недоступно) */
  on3d?: () => void
}

export function Play(props: Props) {
  const { history, setHistory, onFinish, on3d } = props
  const [notebook, setNotebook] = useState(false)
  const [marginOpen, setMarginOpen] = useState(false)
  const notebookRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const maxScale = useSceneMax()
  const m = useMeeting(props, {
    afterSend: (o) => {
      if (o.offer) setNotebook(false)
      // на ноутбуке после ответа показываем верх правой колонки: там новый листок и кнопка «Принять»
      sideRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    },
  })
  const {
    sc, P, last, state, done, name, draft, setDraft, picks, pending, error, setError, talking, setTalking,
    xray, setXray, setXrayUsed, leaving, instantOn, switchInstant, source, voiceOn, toggleVoice, voiced, setMicOff,
    lowSure, acceptSure, line, emotion, theirsOnTable, canAccept, myTotal, revealedNow, canVoice, canMic, theirsForMe,
    stamp, feedback, tip, send, putOnTable, accept, walk,
  } = m

  const openNotebook = () => {
    setNotebook((o) => !o)
    setTimeout(() => notebookRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const margin = (where: 'stage' | 'side') =>
    instantOn ? (
      <Margin
        fb={feedback}
        tip={tip}
        where={where}
        open={marginOpen}
        dim={!!pending}
        onOpen={(o) => {
          setMarginOpen(o)
          // на телефоне разбор и рентген — шторки снизу, двум сразу там тесно
          if (o) setXray(false)
        }}
        onExample={(t) => {
          setDraft(t)
          document.getElementById('px-speech')?.focus()
        }}
        onOff={() => switchInstant(false)}
      />
    ) : (
      where === 'side' && <MarginOff onOn={() => switchInstant(true)} />
    )

  const voiceBtn = canVoice && (
    <Button
      className="g-voice-btn"
      aria-label="Голос собеседника"
      variant={voiceOn ? 'brass' : 'paper'}
      icon={voiceOn ? 'sound' : 'mute'}
      aria-pressed={voiceOn}
      onClick={toggleVoice}
    >
      <span className="g-voice-btn-label">Голос</span>
    </Button>
  )

  return (
    <div className="px-root g-page" data-desk={sceneFor(sc)}>
      <main className="px-desk g-desk g-play">
        <div className="g-play-grid">
          <div className="g-stage">
            <div className="g-hud">
              <MeetingClock turn={state.turn} turnLimit={sc.turnLimit} startAt={meetingClock(sc).start} minutes={meetingClock(sc).minutes} />
              <div className="g-hud-actions">
                {voiceBtn}
                <Button
                  className="g-xray-btn"
                  aria-label="Рентген"
                  variant={xray ? 'brass' : 'paper'}
                  icon="eye"
                  aria-pressed={xray}
                  onClick={() => {
                    setXray(!xray)
                    setXrayUsed(true)
                    if (!xray) setMarginOpen(false)
                    // на ноутбуке рентген встаёт сразу под листком — покажем его, не заставляя листать колонку
                    if (!xray) setTimeout(() => sideRef.current?.scrollTo({ top: 0 }), 0)
                  }}
                >
                  <span className="g-xray-btn-label">Рентген</span>
                </Button>
                {!done && (
                  <Button variant="ghost" icon="leave" className={`g-leave${leaving ? ' is-sure' : ''}`} onClick={walk} aria-label="Встать и уйти">
                    <span className="g-leave-label">{leaving ? 'Точно уйти?' : 'Уйти'}</span>
                  </Button>
                )}
              </div>
            </div>

            <Scene scene={sceneFor(sc)} character={portraitFor(sc)} emotion={emotion} talking={talking && !pending} maxScale={maxScale}>
              {stamp && <Stamp kind={stamp} />}
            </Scene>

            {margin('stage')}

            {(pending || last) && (
              <p className="g-you">
                <b>Вы:</b> {pending ?? last!.playerText}
              </p>
            )}

            <DialogBox
              key={voiced?.text === line ? voiced.n : 0}
              name={sc.opponent.character.name}
              role={sc.opponent.character.role}
              text={line}
              onTalkingChange={setTalking}
              cps={voiced?.text === line ? voiced.cps : undefined}
              onSkip={stopAudio}
              extra={voiceBtn}
            />

            <Slip sc={sc} state={state} theirs={theirsOnTable} name={name} canAccept={canAccept && !pending} onAccept={accept} sure={acceptSure} where="stage" />

            {done ? (
              <div className="g-end">
                <p className="g-end-text">{endText(state, sc, g)}</p>
                <div className="g-say-row">
                  <Button variant="brass" icon="stamp" className="g-big" onClick={onFinish}>
                    Разбор встречи
                  </Button>
                  <Button variant="ghost" icon="rewind" onClick={() => setHistory((h) => h.slice(0, -1))}>
                    Отменить последний ход
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="g-say"
                onSubmit={(e) => {
                  e.preventDefault()
                  send(draft)
                }}
              >
                {canAccept && theirsForMe !== null && (
                  <div className="g-ontable">
                    {/* телефон: главное с листка — прямо над полем ввода; сам листок ниже */}
                    <button
                      type="button"
                      className="g-ontable-text"
                      aria-label="Показать листок на столе"
                      onClick={() => document.querySelector('.g-slip--stage')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    >
                      На столе вам <b className={theirsForMe < P.batna ? 'is-low' : undefined}>{theirsForMe}</b>
                      <span className="g-ontable-batna">{acceptSure ? ' — меньше запасного' : `, запасной ${P.batna}`}</span>
                    </button>
                    <Button variant={acceptSure ? 'stamp' : 'paper'} icon="check" disabled={!!pending} onClick={accept}>
                      {acceptSure ? 'Всё равно' : 'Принять'}
                    </Button>
                  </div>
                )}
                <SpeechField
                  label={pending ? `${name} думает…` : 'Ваша реплика'}
                  value={pending ?? draft}
                  disabled={!!pending}
                  maxLength={1500}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      send(draft)
                    }
                  }}
                  hint="Enter — сказать, Shift+Enter — новая строка"
                />
                {error && (
                  <p className="g-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="g-say-row">
                  <Button variant="brass" icon="send" type="submit" disabled={!!pending || !draft.trim()}>
                    {pending ? 'Слушает…' : 'Сказать'}
                  </Button>
                  {canMic && (
                    <MicButton
                      disabled={!!pending}
                      onText={(t) => {
                        setError(null)
                        setDraft((d) => (d.trim() ? `${d.trim()} ${t}` : t))
                        document.getElementById('px-speech')?.focus()
                      }}
                      onError={setError}
                      onOff={() => setMicOff(true)}
                    />
                  )}
                  <Button icon="notebook" className="g-only-mobile" aria-expanded={notebook} aria-controls="g-notebook" onClick={openNotebook}>
                    {notebook ? 'Закрыть блокнот' : 'Блокнот'}
                  </Button>
                  {source === 'local' && <span className="g-source">сервер недоступен, играем офлайн</span>}
                </div>
              </form>
            )}
          </div>

          <aside className="g-side" data-xray={xray} ref={sideRef}>
            {margin('side')}
            <Slip sc={sc} state={state} theirs={theirsOnTable} name={name} canAccept={canAccept && !pending} onAccept={accept} sure={acceptSure} where="side" />
            <div id="g-notebook" ref={notebookRef} className="g-notebook-wrap" data-open={notebook}>
              <Notebook
                title="Мой блокнот"
                footer={
                  <>
                    <Button variant={lowSure ? 'stamp' : 'brass'} icon="pen" disabled={done || !!pending} onClick={putOnTable}>
                      {lowSure ? 'Всё равно положить' : 'Положить на стол'}
                    </Button>
                    <span className={`g-total${myTotal < P.batna ? ' is-low' : ''}`}>
                      мне <b>{myTotal}</b>
                    </span>
                  </>
                }
              >
                <p className="px-note">
                  Запасной вариант даёт мне <b>{P.batna}</b>. Меньше брать нет смысла.
                </p>
                {lowSure && (
                  <p className="g-low" role="alert">
                    Это предложение даёт вам {myTotal} — меньше, чем запасной вариант ({P.batna}). Если {name} согласится, вы
                    проиграете по сравнению с тем, чтобы просто уйти.
                  </p>
                )}
                <Notes sc={sc} state={state} issue={undefined} fresh={revealedNow} name={name} />
                {sc.issues.map((i) => (
                  <div key={i.id} className="g-issue">
                    <IssueStepper
                      title={i.title}
                      options={i.options}
                      points={P.points[i.id]}
                      value={picks[i.id]}
                      onChange={(v) => m.pick(i.id, v)}
                    />
                    <Notes sc={sc} state={state} issue={i.id} fresh={revealedNow} name={name} />
                  </div>
                ))}
                {isComplete(sc, state.lastOpponentOffer) && !sameOffer(picks, state.lastOpponentOffer) && (
                  <button type="button" className="g-link g-copy" onClick={() => m.setPicks({ ...(state.lastOpponentOffer as Record<string, number>) })}>
                    Переписать с листка на столе
                  </button>
                )}
              </Notebook>
            </div>

            {xray && <XRay sc={sc} state={state} last={last} name={name} onClose={() => setXray(false)} />}

            {history.length > 0 && (
              <details className="g-protocol">
                <summary>
                  Протокол встречи: {history.length} {plural(history.length, 'ход', 'хода', 'ходов')}
                </summary>
                <ol>
                  {history.map((h) => (
                    <li key={h.turn}>
                      <p className="g-protocol-you">
                        <b>Вы:</b> {h.playerText}
                      </p>
                      <p className="g-protocol-them">
                        <b>{name}:</b> {h.opponentLine}
                      </p>
                      <button
                        type="button"
                        className="g-link"
                        onClick={() => m.rewind(h.turn)}
                      >
                        <PixelIcon name="rewind" px={2} /> Переиграть с этого хода
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {on3d && (
              <button type="button" className="g-link g-link--quiet g-view-3d" onClick={on3d}>
                Сесть за стол в 3D
              </button>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}

/** На ноутбуке с невысоким экраном сцена ×3, на невысоком телефоне ×2 — иначе поле ввода уезжает за край. */
function useSceneMax() {
  const pick = () => {
    if (typeof window === 'undefined') return 4
    const { innerWidth: w, innerHeight: h } = window
    if (w < 900) return h < 760 ? 2 : 4
    return h >= 1000 ? 4 : 3
  }
  const [m, setM] = useState(pick)
  useEffect(() => {
    const on = () => setM(pick())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return m
}

