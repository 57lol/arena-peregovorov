// Встреча от первого лица: мы сидим за столом, напротив собеседник и пара коллег.
// Мир — во весь экран (world3d/*). Над головой собеседника — плашка с именем, его реплика — субтитрами внизу кадра,
// под ними — узкая панель: стол, «Написать», «Говорить» (голос — основной), «Сделка» (предложить, согласиться, уйти).
// На столе лежат блокнот (предложение), листок собеседника («Принять») и карточка с делами — всё нажимается
// прямо на столе. Разбор хода — плашки, которые гаснут сами. Остальное — в меню (Esc).
// Логика встречи та же, что в классическом виде: useMeeting.

import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Vector3 } from 'three'
import { isComplete, sameOffer, score } from '../../engine/utility'
import { g, meetingClock, plural, portraitFor, sceneFor } from '../cast'
import { effectText, type Tip, type TurnFeedback } from '../instant'
import { mentorLine, type Tutorial, type TutorStep } from '../tutorial'
import { endText, type Meeting, type MeetingProps } from '../useMeeting'
import { Button, DialogBox, IssueStepper, PixelIcon, SpeechField, Stamp, type IconName } from '../ui'
import type { useVoiceTurn } from '../useVoiceTurn'
import { attachInput, isTyping } from '../world3d/input'
import type { Pose } from '../world3d/head'
import type { PaperId } from '../world3d/papers'
import { World } from '../world3d/stage'
import { placeBubble, type BubbleSpot, type Rect } from '../world3d/bubble'
import { Margin } from './Margin'
import { Mentor } from './Mentor'
import { VoiceMenuItems } from './VoiceSettings'
import { canRecord } from '../speech'
import { VolumeSlider } from './Volume'
import { sfx } from '../audio/engine'
import { Notes, XRay } from './meetingParts'
import '../world3d/world3d.css'
import '../world3d/play3d.css'

type Props = MeetingProps & {
  m: Meeting
  v: ReturnType<typeof useVoiceTurn>
  tut: Tutorial
  onVoicePause: (paused: boolean) => void
  /** «Как играть» из меню: знакомство с экраном встречи */
  onHowTo?: () => void
  /** в запасной 2D-вид: WebGL отвалился или устройство не тянет (сам игрок вид не выбирает) */
  onClassic: (why: 'slow') => void
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function Play3D(props: Props) {
  const { history, onFinish, onQuit, onClassic, m, v, tut, onVoicePause, onHowTo } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [world, setWorld] = useState<World | null>(null)
  const [pose, setPose] = useState<Pose>('face')
  const [menu, setMenu] = useState(false)
  useEffect(() => onVoicePause(menu), [menu, onVoicePause])
  // «Сделка» внизу: предложить, согласиться, уйти
  const [deal, setDeal] = useState(false)
  const [detail, setDetail] = useState(false)
  const [looked, setLooked] = useState(false)
  // лист в руках (телефон): поднят со стола и стоит перед глазами
  const [held, setHeld] = useState<PaperId | null>(null)
  const { sc, state, last, done, pending, line, emotion, talking, xray, stamp, canAccept } = m
  // первая встреча — обучающая: бумаги и кнопки появляются по одной, когда впервые нужны
  const notebookOn = tut.shows('notebook')
  // взгляд на стол — шорох бумаг
  useEffect(() => {
    if (pose === 'desk') sfx('page', { gain: 0.5 })
  }, [pose])
  const slipOn = tut.shows('slip')
  const cardOn = tut.shows('card')
  useEffect(() => {
    if (!world) return
    world.desk.show('notebook', notebookOn)
    world.desk.show('slip', slipOn)
    world.desk.show('card', cardOn)
  }, [world, notebookOn, slipOn, cardOn])

  // Мир владеет DOM и RAF: останавливаем его в layout-cleanup до удаления узлов и сброса refs.
  // Passive cleanup может выполниться уже после следующего кадра.
  // ---------- мир ----------
  useLayoutEffect(() => {
    const el = rootRef.current!
    let w: World
    try {
      w = new World(el, { kind: sceneFor(sc), caseId: sc.id, opponent: portraitFor(sc), reducedMotion: reduced() })
    } catch {
      // can3d() проверяет WebGL один раз, а контекст может не создаться и позже (Chrome заблокировал GPU, драйвер)
      onClassic('slow')
      return
    }
    w.start()
    setWorld(w)
    // для проверок из Playwright (они ходят на дев-сервер)
    if (import.meta.env.DEV) (window as unknown as { __world?: World }).__world = w
    const off = attachInput(w, el, {
      onLook: () => setLooked(true),
      onTap: (x, y) => tapRef.current(x, y),
    })
    // WebGL отвалился (драйвер, нехватка памяти) — продолжаем в классическом виде
    const lost = (e: Event) => {
      e.preventDefault()
      onClassic('slow')
    }
    w.canvas.addEventListener('webglcontextlost', lost)
    return () => {
      w.canvas.removeEventListener('webglcontextlost', lost)
      off()
      w.dispose()
      if (import.meta.env.DEV) {
        const debug = window as unknown as { __world?: World }
        if (debug.__world === w) delete debug.__world
      }
    }
    // мир строится один раз на встречу
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // слабое железо: сначала крупнее пиксель, потом — классический вид
  useEffect(() => {
    if (!world) return
    let strikes = 0
    const t = setInterval(() => {
      if (document.hidden) return
      if (world.fps >= 22) return void (strikes = 0)
      strikes++
      if (strikes === 2 && world.quality > 0.6) {
        world.quality = 0.6
        world.resize()
        strikes = 0
      } else if (strikes >= 3) onClassic('slow')
    }, 2500)
    return () => clearInterval(t)
  }, [world, onClassic])

  // настроение за столом, рентген, часы
  useEffect(() => {
    world?.company?.setMood(done && state.status === 'deal' ? 'happy' : emotion, talking && !pending)
  }, [world, emotion, talking, pending, done, state.status])
  useEffect(() => {
    if (world) world.xrayTarget = xray ? 1 : 0
  }, [world, xray])
  useEffect(() => {
    const c = meetingClock(sc)
    if (world) world.clockTarget = c.start + (c.minutes * Math.min(state.turn, sc.turnLimit)) / sc.turnLimit
  }, [world, state.turn, sc])
  // игрок сказал — все смотрят на него; собеседник отвечает — на собеседника
  useEffect(() => {
    if (pending) world?.company?.stir('you', 3)
  }, [world, pending])
  // собеседник начал отвечать — кладём бумаги и поднимаем глаза на него. С началом реплики (ход потоком — с первых
  // слов), а не когда пришёл ход целиком: иначе камера ехала посреди реплики, и облачко перепрыгивало
  const turns = history.length
  const prevTurns = useRef(turns)
  const reply = pending && m.lineKey !== 'pending' ? m.lineKey : null
  const replyKey = useRef(m.lineKey)
  replyKey.current = m.lineKey
  const facedFor = useRef<unknown>(null)
  useEffect(() => {
    if (!world || !reply || facedFor.current === reply) return
    facedFor.current = reply
    setHeld(null)
    world.look('face')
    world.company?.stir('table', 3.5)
  }, [world, reply])
  useEffect(() => {
    if (!world) return
    if (turns > prevTurns.current && facedFor.current !== replyKey.current) {
      setHeld(null)
      world.look('face')
      world.company?.stir('table', 3.5)
    }
    facedFor.current = null
    prevTurns.current = turns
  }, [world, turns])
  // по рукам: смотрим на стол, где на листок ложится штамп (на телефоне листок сам поднимается к глазам)
  const dealt = state.status === 'deal'
  useEffect(() => {
    if (!world || !dealt || !history.length) return
    const t = setTimeout(() => {
      world.look('desk')
      if (world.portrait) setHeld('slip')
    }, 1600)
    return () => clearTimeout(t)
  }, [world, dealt, history.length])

  // собеседник встал из-за стола — уходит к двери; ушли мы — встаём и оборачиваемся к двери
  useEffect(() => {
    if (!world) return
    const lead = world.company?.lead
    if (lead) lead.leaving = state.status === 'walked_away' && state.endedBy === 'opponent'
    const we = state.status === 'walked_away' && state.endedBy !== 'opponent'
    const wasStanding = world.standTarget === 1
    world.standTarget = we ? 1 : 0
    if (we) {
      world.head.ty = world.exitYaw
      world.head.tp = -4 * (Math.PI / 180)
    } else if (wasStanding) world.look('face') // отменили уход — садимся обратно
  }, [world, state.status, state.endedBy])

  // листок на столе: появился или сменился — едет по столу от того, кто положил
  const offerKey = JSON.stringify(state.tableOffer ?? {})
  const theirs = m.theirsOnTable
  const hasSlip = sc.issues.some((i) => typeof state.tableOffer?.[i.id] === 'number')
  const prevOffer = useRef(offerKey)
  useEffect(() => {
    if (!world) return
    world.desk.slipVisible = hasSlip
    if (offerKey !== prevOffer.current && hasSlip) world.desk.slideSlip(theirs ? 'them' : 'me')
    prevOffer.current = offerKey
  }, [world, offerKey, hasSlip, theirs])

  // касание мира: лист на столе — посмотреть на стол или взять в руки (телефон); мимо листа — положить
  const tapRef = useRef((_x: number, _y: number) => {})
  tapRef.current = (x, y) => {
    if (!world) return
    const id = world.pick(x, y)
    if (held) {
      if (id !== held) setHeld(null)
      return
    }
    if (!id) return
    if (world.head.pose === 'face') world.look('desk')
    if (world.portrait) setHeld(id)
  }
  useEffect(() => {
    world?.desk.hold(held)
  }, [world, held])
  useEffect(() => {
    if (pose === 'face') setHeld(null)
  }, [pose])
  // телефон повернули боком: в альбомной раскладке листов в руках нет — кладём на стол, иначе поле ввода так и не покажется
  useEffect(() => {
    if (!world || !held) return
    return world.on(() => {
      if (!world.portrait) setHeld(null)
    })
  }, [world, held])

  // ---------- оверлеи, привязанные к миру ----------
  const lineRef = useRef<HTMLDivElement>(null)
  const lineKeyRef = useRef<unknown>(null)
  lineKeyRef.current = m.lineKey
  const xrayRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!world) return
    const head = new Vector3()
    const p = { x: 0, y: 0, behind: false }
    let lastPose: Pose = 'face'
    let lastLine: unknown = null
    let lastTail: BubbleSpot['tail'] = ''
    return world.on(() => {
      const lead = world.company?.lead
      const box = lineRef.current
      const pose = world.head.pose
      if (pose !== lastPose) setPose((lastPose = pose))
      // лист в руках или (на телефоне) взгляд на стол — реплика ждёт, иначе закрывает бумаги
      const lineHidden = world.desk.heldAmount > 0.3 || (world.portrait && pose === 'desk')
      box?.classList.toggle('is-hidden', lineHidden)
      if (!lead) return
      let bubble: Rect | null = null
      const cw = world.cw
      const ch = world.ch
      const rootBox = rootRef.current!.getBoundingClientRect()
      const trayTop = trayRef.current ? trayRef.current.getBoundingClientRect().top - rootBox.top : ch
      // телефон стоя: голова собеседника высоко — наставник встаёт внизу, над панелью, и лицо остаётся открытым
      const mentorEl = document.querySelector<HTMLElement>('.w3-mentor')
      const at = !mentorEl ? '' : world.portrait ? 'bottom' : pose === 'face' ? 'top' : 'beside'
      if (mentorEl) placeMentor(mentorEl, rootBox, cw, trayTop, at)
      // лист в руках встаёт между кнопкой меню (или наставником сверху) и панелью (или наставником снизу)
      const mentor = mentorEl?.getBoundingClientRect()
      world.desk.freeTop = Math.max(64, mentor && at === 'top' ? mentor.bottom - rootBox.top + 10 : 0) / ch
      world.desk.freeBottom = (Math.min(trayTop, mentor && at === 'bottom' ? mentor.top - rootBox.top : ch) - 8) / ch
      // реплика — облачком у головы собеседника: над макушкой, сбоку или под подбородком, с хвостиком к нему;
      // голова за кадром — облачко прижато к краю, стрелка на имени показывает, куда повернуться
      if (box && !lineHidden) {
        const narrow = cw < 700
        const obstacles: Rect[] = []
        for (const sel of ['.w3-toasts', '.w3-toast-chip', '.w3-sheet', '.w3-mentor', '.w3-rotate', '.w3-top', ...(narrow ? ['.w3-xray'] : [])]) {
          const r = document.querySelector(sel)?.getBoundingClientRect()
          if (r && r.width) obstacles.push({ l: r.left - rootBox.left, t: r.top - rootBox.top, r: r.right - rootBox.left, b: r.bottom - rootBox.top })
        }
        const proj = (k: 'head' | 'chin' | 'chest') => {
          const o = { x: 0, y: 0, behind: false }
          world.project(lead.anchor(k, head), o)
          return o
        }
        // ширина — по CSS; суженное между плашками облачко сначала возвращаем к обычной
        if (box.style.width) box.style.width = ''
        const spot = placeBubble({
          cw,
          trayTop,
          w: box.offsetWidth,
          h: box.offsetHeight,
          head: proj('head'),
          chin: proj('chin'),
          // видеозвонок: облачко под экраном, лицо на экране открыто
          under: world.call ? proj('chest') : undefined,
          desk: pose === 'desk',
          obstacles,
          // пока идёт одна реплика, облачко не перепрыгивает (ушла плашка сверху — остаётся, где было)
          keep: lineKeyRef.current === lastLine ? lastTail : undefined,
        })
        lastLine = lineKeyRef.current
        lastTail = spot.tail
        if (spot.w) box.style.width = `${Math.round(spot.w)}px`
        bubble = { l: spot.x, t: spot.y, r: spot.x + box.offsetWidth, b: spot.y + box.offsetHeight }
        box.dataset.tail = spot.tail
        box.dataset.off = spot.off
        box.style.setProperty('--tail', `${Math.round(spot.tail === 'left' || spot.tail === 'right' ? spot.ty : spot.tx)}px`)
        box.style.transform = `translate3d(${Math.round(spot.x)}px, ${Math.round(spot.y)}px, 0)`
      }
      const xr = xrayRef.current
      if (xr) {
        world.project(lead.anchor('head', head), p)
        const w = xr.offsetWidth
        const narrow = cw < 700
        const x = narrow ? 12 : Math.min(Math.max(p.x + 170, 12), cw - w - 12)
        // на телефоне — под карточкой наставника, если она сверху
        let y = narrow ? (mentor && at === 'top' ? mentor.bottom - rootBox.top + 8 : 12) : Math.max(p.y - 20, 12)
        // на ноутбуке «что чувствует» не наезжает на облачко реплики
        if (!narrow && bubble && x < bubble.r + 8 && x + w > bubble.l - 8 && y < bubble.b + 8) y = Math.max(y, bubble.b + 8)
        xr.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      }
    })
  }, [world])

  // ---------- клавиши: Esc — меню, поле ввода не крутит голову ----------
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isTyping(e.target)) return (e.target as HTMLElement).blur()
      if (detail) return setDetail(false)
      if (deal) return setDeal(false)
      setMenu((o) => !o)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [detail, deal])

  // клавиатура телефона: поле ввода поднимаем над ней
  useVisualViewport(rootRef)

  const lookAt = (p: Pose) => {
    world?.look(p)
    setLooked(true)
  }
  const toggleXray = () => {
    m.setXray(!xray)
    m.setXrayUsed(true)
    // включили с карточки на столе — поднимаем глаза: «что чувствует» висит рядом с собеседником
    if (!xray && world?.head.pose === 'desk') {
      setHeld(null)
      lookAt('face')
    }
  }

  const name = m.name
  const host = world?.desk.sheets
  const newOffer = canAccept && pose === 'face' && slipOn
  // что сейчас говорит наставник и что подсвечивает
  const mentor = tut.on
    ? mentorLine(tut.step, { sc, pose, phone: !!world?.portrait, held, theirs: m.theirsOnTable, batna: m.P.batna, voice: m.voiceMode })
    : props.tutorial && done && history.length > 0
      ? { text: 'Встреча окончена. Нажмите «Разбор встречи»: там коротко о том, что получилось и что попробовать в следующий раз.' }
      : null
  const lit = (t: string) => (mentor?.target === t ? ' is-tutor' : '')

  return (
    <div
      className="px-root w3-play"
      data-desk={sceneFor(sc)}
      data-pose={pose}
      data-xray={xray}
      data-done={done}
      data-held={held ?? ''}
      data-tutor={tut.on ? tut.step : undefined}
    >
      <div ref={rootRef} className="w3-root w3-stage" aria-label={`Переговорная: напротив ${sc.opponent.character.name}`} />

      {/* бумаги на столе — DOM в плоскости листов */}
      {host &&
        createPortal(
          <NotebookPage m={m} tut={tut} lit={lit('notebook')} litOffer={lit('offer')} />,
          host.notebook.host,
        )}
      {host && createPortal(<SlipPage m={m} lit={lit('slip')} />, host.slip.host)}
      {host &&
        createPortal(
          <ActionCard
            m={m}
            tut={tut}
            lit={lit}
            onXray={toggleXray}
            onProtocol={() => setMenu(true)}
            onMenu={() => setMenu(true)}
          />,
          host.card.host,
        )}

      {/* реплика собеседника — облачком у его головы: имя заголовком, говорит — рядом мигает динамик */}
      <div ref={lineRef} className={`w3-them w3-ui${talking && !pending ? ' is-talking' : ''}`} data-nodrag>
        <div className="w3-them-name" aria-hidden="true" title={sc.opponent.character.role}>
          <span>{sc.opponent.character.name}</span>
          <PixelIcon name="sound" px={2} />
        </div>
        <DialogBox
          key={m.lineKey}
          name={sc.opponent.character.name}
          role={sc.opponent.character.role}
          text={line}
          onTalkingChange={m.setTalking}
          cps={m.lineCps}
          waiting={m.lineWaiting}
          growing={m.lineGrowing}
        />
      </div>

      {xray && (
        <div ref={xrayRef} className="w3-xray w3-ui" data-nodrag>
          <XRay sc={sc} state={state} last={last} name={name} onClose={() => m.setXray(false)} />
        </div>
      )}

      {/* сделка — штамп ложится на листок на столе; остальные концовки — оттиск поверх комнаты */}
      {stamp && stamp !== 'deal' && <Stamp kind={stamp} />}

      {/* разбор хода — плашки, гаснут сами */}
      {mentor && (
        <Mentor
          className="w3-mentor w3-ui"
          line={mentor}
          fb={tut.step === 'talk' ? null : m.feedback}
          n={stepNo(tut.step)}
          onAck={tut.ack}
          onExample={(t) => {
            m.setDraft(t)
            document.getElementById('px-speech')?.focus()
          }}
          onSkip={tut.on ? tut.skip : undefined}
        />
      )}
      {m.instantOn && !detail && !tut.on && (
        <TurnToasts
          key={last?.turn ?? 0}
          fb={m.feedback}
          tip={m.tip}
          dim={!!pending}
          onMore={() => setDetail(true)}
          onExample={(t) => {
            m.setDraft(t)
            document.getElementById('px-speech')?.focus()
          }}
        />
      )}
      {detail && (
        <aside className="w3-sheet w3-ui" data-nodrag aria-label="Разбор хода">
          <button type="button" className="w3-sheet-close" aria-label="Закрыть разбор хода" onClick={() => setDetail(false)}>
            <PixelIcon name="cross" px={2} />
          </button>
          <Margin
            fb={m.feedback}
            tip={m.tip}
            where="side"
            onExample={(t) => {
              m.setDraft(t)
              setDetail(false)
              document.getElementById('px-speech')?.focus()
            }}
            onOff={() => {
              m.switchInstant(false)
              setDetail(false)
            }}
          />
        </aside>
      )}

      {/* верх экрана: меню, под ним — сколько реплик осталось (часы на стене показывают то же время) */}
      <div className="w3-top w3-ui" data-nodrag>
        <Button variant="paper" icon="menu" className="w3-menu-btn" aria-label="Меню" aria-expanded={menu} onClick={() => setMenu(true)}>
          <span className="w3-menu-label">Меню</span>
        </Button>
        {m.soundBlocked && (
          <Button variant="brass" icon="sound" className="w3-menu-btn" disabled={!!pending} onClick={m.enableSound}>
            Включить звук
          </Button>
        )}
        {tut.shows('desk') && !done && (
          <p className="w3-clock-line">
            <PixelIcon name="clock" px={2} />
            <MeetingTime turn={state.turn} limit={sc.turnLimit} clock={meetingClock(sc)} />
          </p>
        )}
      </div>

      <div ref={trayRef} className="w3-tray w3-ui" data-nodrag>
        {done ? (
          <div className="w3-end">
            <p className="w3-end-text">{endText(state, sc, g)}</p>
            <div className="w3-say-row">
              <Button variant="brass" icon="stamp" className={props.tutorial ? 'is-tutor' : undefined} onClick={onFinish}>
                Разбор встречи
              </Button>
              <Button variant="ghost" icon="rewind" onClick={m.undo}>
                Отменить последний ход
              </Button>
            </div>
          </div>
        ) : (
          <ControlBar
            m={m}
            v={v}
            hint={
              pose === 'desk' && !held && world?.portrait && !tut.on ? (
                'Нажмите на листок — возьмёте его в руки'
              ) : !looked && history.length === 0 && !tut.on ? (
                <>
                  <span className="w3-hint-mouse">Осмотреться — мышью или стрелками, на стол — стрелка вниз</span>
                  <span className="w3-hint-touch">Осмотреться — проведите пальцем</span>
                </>
              ) : null
            }
            look={
              tut.shows('desk') && (
                <LookButton
                  pose={pose}
                  held={held}
                  name={name}
                  lit={lit('look')}
                  onDesk={() => {
                    lookAt('desk')
                    if (world?.portrait && !tut.on) setHeld('notebook')
                  }}
                  onFace={() => {
                    setHeld(null)
                    lookAt('face')
                  }}
                  onPutDown={() => setHeld(null)}
                />
              )
            }
            deal={
              <DealMenu
                m={m}
                tut={tut}
                open={deal}
                setOpen={setDeal}
                fresh={newOffer}
                onNotebook={() => {
                  lookAt('desk')
                  if (world?.portrait) setHeld('notebook')
                }}
              />
            }
          />
        )}
      </div>

      {history.length === 0 && !tut.on && <RotateHint />}

      {menu && (
        <Menu
          m={m}
          onClose={() => setMenu(false)}
          onQuit={onQuit}
          onXray={toggleXray}
          onHowTo={
            onHowTo &&
            (() => {
              setMenu(false)
              onHowTo()
            })
          }
        />
      )}
    </div>
  )
}

/**
 * Карточка наставника. Ноутбук: смотрим на собеседника — слева вверху, где потом будут плашки разбора хода;
 * взгляд на стол — рядом с тем, что подсвечено, как выноска: справа, снизу, слева или сверху, где влезает.
 * Телефон стоя — внизу: над субтитрами (bottom) или, у стола, над панелью — вверху лицо собеседника или его листок.
 */
function placeMentor(el: HTMLElement, root: DOMRect, cw: number, trayTop: number, at: string, bottom = trayTop) {
  el.dataset.at = at
  let x = 12
  let y = at === 'bottom' ? bottom - el.offsetHeight - 10 : 12
  const t = at === 'beside' ? document.querySelector<HTMLElement>('.is-tutor') : null
  const paper = t?.closest('.w3-paper')
  if (t && (!paper || paper.classList.contains('is-live'))) {
    const r = t.getBoundingClientRect()
    const L = r.left - root.left
    const R = r.right - root.left
    const T = r.top - root.top
    const B = r.bottom - root.top
    const w = el.offsetWidth
    const h = el.offsetHeight
    const menu = document.querySelector('.w3-top')?.getBoundingClientRect()
    const along = (v: number) => Math.min(Math.max(v, 12), trayTop - h - 8)
    const spots = [
      { x: R + 16, y: along(T) },
      { x: (L + R) / 2 - w / 2, y: B + 16 },
      { x: L - 16 - w, y: along(T) },
      { x: (L + R) / 2 - w / 2, y: T - 16 - h },
    ]
    const fits = (o: { x: number; y: number }) =>
      o.x >= 12 &&
      o.x + w <= cw - 12 &&
      o.y >= 12 &&
      o.y + h <= trayTop - 8 &&
      !(menu && o.x + w > menu.left - root.left - 8 && o.y < menu.bottom - root.top + 8)
    const ok = spots.find(fits)
    if (ok) {
      x = ok.x
      y = ok.y
    }
  }
  el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
}

/**
 * «на часах 10:15 · осталось 9 реплик» — то же время, что показывают часы на стене. «10:05, ещё 11» читали как
 * секундомер, который почему-то растёт: теперь видно, что это время встречи, а считаются реплики.
 */
function MeetingTime({ turn, limit, clock }: { turn: number; limit: number; clock: { start: number; minutes: number } }) {
  const left = Math.max(0, limit - turn)
  const now = clock.start + (clock.minutes * Math.min(turn, limit)) / limit
  const t = `${Math.floor(now / 60)}:${String(Math.floor(now % 60)).padStart(2, '0')}`
  const tail = left === 0 ? 'время вышло' : `осталось ${left} ${plural(left, 'реплика', 'реплики', 'реплик')}`
  return (
    <span className={left <= 2 ? 'is-late' : undefined} title={`Время на часах встречи — ${t}. Каждая реплика — несколько минут; ${tail}.`}>
      <span className="w3-wide">на часах </span>
      {t} · {tail}
    </span>
  )
}

type Line = { text: ReactNode; kind?: 'error' | 'you' | 'note' }

interface BarProps {
  m: Meeting
  v: ReturnType<typeof useVoiceTurn>
  /** подсказка, когда сказать больше нечего: «осмотреться», «возьмите лист» */
  hint: ReactNode
  look: ReactNode
  deal: ReactNode
}

/**
 * Панель внизу — одна строка кнопок: «Стол», «Написать», «Говорить», «Сделка». Над ней — строка состояния
 * (ваши слова, ошибка, подсказка), когда есть что сказать, и поле ввода, когда пишем текстом.
 */
function ControlBar(p: BarProps) {
  if (p.m.voiceMode) return <VoiceBar {...p} />
  const { m } = p
  const canVoice = m.canMic && canRecord()
  const status: Line | null = m.error
    ? { text: m.error, kind: 'error' }
    : m.voiceNote
      ? {
          text: m.voiceNote,
          kind: 'note',
        }
      : null
  return (
    <Bar
      {...p}
      status={status}
      talk={
        canVoice && (
          <Key
            icon="mic"
            label="Говорить"
            className="w3-talk"
            aria-label="Говорить голосом"
            onClick={() => {
              m.setMicBlocked(null)
              m.setInputMode('voice')
            }}
          />
        )
      }
    />
  )
}

/** Голосовой режим: микрофон слушает сам, как только собеседник договорил; пауза в речи отправляет реплику. */
function VoiceBar(p: BarProps) {
  const { m, v } = p
  const theirs = !m.pending && !m.done && !v.myTurn && !m.heard
  let talk: ReactNode
  if (theirs) talk = <Key icon="mic" label="Перебить" className="w3-talk" aria-label="Перебить и ответить" onClick={v.interrupt} />
  else if (v.phase === 'speak')
    talk = <Key icon="mic" label="Готово" className="w3-talk is-rec" aria-label="Готово, отправить реплику" onClick={v.finish} />
  else if (v.phase === 'failed') talk = <Key icon="mic" label="Ещё раз" className="w3-talk" aria-label="Сказать ещё раз" onClick={v.again} />
  else {
    const on = v.phase === 'listen' && v.mic === 'on' && !m.pending
    talk = (
      // микрофон и так слушает: это не кнопка, а лампочка
      <span className={`w3-key w3-talk is-lamp${on ? ' is-on' : ''}`} role="status">
        <PixelIcon name="mic" px={2} />
        <span className="w3-key-label">{v.phase === 'busy' ? 'Распознаю' : m.pending ? 'Ждём ответа' : v.mic === 'opening' ? 'Включаю' : 'Говорите'}</span>
      </span>
    )
  }
  const status: Line | null = m.error
    ? {
        kind: 'error',
        text: (
          <>
            {m.error}
            {v.retryable && (
              <>
                {' '}
                <button type="button" className="g-link" onClick={v.retry}>
                  Распознать ту же запись
                </button>
              </>
            )}
          </>
        ),
      }
    : v.partial
      ? { kind: 'you', text: <><b>Вы:</b> {v.partial}</> }
      : m.pending
        ? { kind: 'you', text: <><b>Вы:</b> {m.pending}</> }
        : v.note
          ? { kind: 'note', text: v.note }
          : m.draft && v.phase !== 'speak'
            ? { text: <>Скажите, например: «{m.draft}»</> }
            : v.phase === 'failed'
              ? { kind: 'note', text: 'Не вышло — скажите ещё раз или напишите.' }
              : m.history.length === 0 && !theirs
                ? { text: 'Говорите — пауза отправит реплику.' }
                : null
  return <Bar {...p} status={status} talk={talk} />
}

function Bar({ m, hint, look, deal, status, talk }: BarProps & { status: Line | null; talk: ReactNode }) {
  const line: Line | null = status ?? (hint ? { text: hint } : m.source === 'local' ? { kind: 'note', text: 'Играем офлайн: сервер недоступен' } : null)
  return (
    <>
      {line && (
        <p className={`w3-status${line.kind ? ` is-${line.kind}` : ''}`} role={line.kind === 'error' ? 'alert' : 'status'}>
          {line.text}
        </p>
      )}
      <WriteSheet m={m} />
      <div className="w3-bar" data-voice={m.voiceMode || undefined}>
        {look}
        {/* без микрофона поле открыто всегда — кнопка ни к чему */}
        {(m.voiceMode || (m.canMic && canRecord())) && <Key
          icon="pen"
          label="Написать"
          className={`w3-write-btn${m.voiceMode ? '' : ' is-on'}`}
          aria-pressed={!m.voiceMode}
          onClick={() => {
            if (m.voiceMode) m.setInputMode('text')
            // фокус — прямо в нажатии: иначе iPhone не откроет клавиатуру
            document.querySelector('.w3-write')?.removeAttribute('hidden')
            document.getElementById('px-speech')?.focus()
          }}
        />}
        {talk}
        {deal}
      </div>
    </>
  )
}

/** Кнопка панели: значок и короткая подпись под ним (на ноутбуке — рядом). */
function Key({ icon, label, className = '', ...rest }: { icon: IconName; label: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'>) {
  return (
    <button type="button" className={`w3-key ${className}`} {...rest}>
      <PixelIcon name={icon} px={2} />
      <span className="w3-key-label">{label}</span>
    </button>
  )
}

/** «Стол»: опустить взгляд к бумагам (на телефоне блокнот сразу в руки); у стола — обратно к собеседнику. */
function LookButton({ pose, held, name, lit, onDesk, onFace, onPutDown }: {
  pose: Pose
  held: PaperId | null
  name: string
  lit: string
  onDesk: () => void
  onFace: () => void
  onPutDown: () => void
}) {
  if (held) return <Key icon="down" label="На стол" className={`w3-look${lit}`} aria-label="Положить листок на стол" onClick={onPutDown} />
  if (pose === 'face') return <Key icon="notebook" label="Стол" className={`w3-look${lit}`} aria-label="Стол: блокнот и предложения" onClick={onDesk} />
  return <Key icon="up" label={name} className={`w3-look${lit}`} aria-label={`Посмотреть вперёд: ${name}`} onClick={onFace} />
}

/** «Сделка»: предложить условия (блокнот), согласиться на условия собеседника, встать и уйти. */
function DealMenu({ m, tut, open, setOpen, fresh, onNotebook }: {
  m: Meeting
  tut: Tutorial
  open: boolean
  setOpen: (o: boolean) => void
  /** собеседник только что положил свои условия */
  fresh: boolean
  onNotebook: () => void
}) {
  const { name, canAccept, acceptSure, theirsForMe, P, leaving, pending } = m
  const below = theirsForMe !== null && theirsForMe < P.batna
  return (
    <div className="w3-deal">
      <Key
        icon="stamp"
        label="Сделка"
        className={`w3-deal-btn${fresh ? ' is-new' : ''}${open ? ' is-on' : ''}`}
        aria-label={fresh ? `Сделка: ${name} предлагает условия` : 'Сделка: предложить, согласиться, уйти'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      />
      {open && (
        <>
          <div className="w3-deal-scrim" onPointerDown={() => setOpen(false)} />
          <div className="w3-deal-pop" role="menu" aria-label="Сделка">
            {tut.shows('offer') && (
              <button
                type="button"
                role="menuitem"
                className="w3-deal-item"
                onClick={() => {
                  setOpen(false)
                  onNotebook()
                }}
              >
                <PixelIcon name="pen" px={2} />
                <span>
                  Предложить условия<small>выбрать в блокноте</small>
                </span>
              </button>
            )}
            {tut.shows('slip') &&
              (canAccept ? (
                <button
                  type="button"
                  role="menuitem"
                  className={`w3-deal-item${acceptSure ? ' is-sure' : fresh ? ' is-new' : ''}`}
                  disabled={!!pending}
                  onClick={() => {
                    m.accept()
                    if (!below || acceptSure) setOpen(false)
                  }}
                >
                  <PixelIcon name="check" px={2} />
                  <span>
                    {acceptSure ? 'Всё равно согласиться' : `Согласиться на условия: ${name}`}
                    <small>
                      {acceptSure ? `меньше, чем без сделки: ${theirsForMe} против ${P.batna}` : `выгода вам ${theirsForMe}, без сделки ${P.batna}`}
                    </small>
                  </span>
                </button>
              ) : (
                <button type="button" role="menuitem" className="w3-deal-item is-off" disabled>
                  <PixelIcon name="check" px={2} />
                  <span>
                    Согласиться<small>когда {name} предложит условия</small>
                  </span>
                </button>
              ))}
            {tut.shows('leave') && (
              <button
                type="button"
                role="menuitem"
                className={`w3-deal-item is-stamp${leaving ? ' is-sure' : ''}`}
                disabled={!!pending}
                onClick={() => {
                  m.walk()
                  if (leaving) setOpen(false)
                }}
              >
                <PixelIcon name="leave" px={2} />
                <span>
                  {leaving ? 'Точно уйти?' : 'Встать и уйти'}
                  <small>{leaving ? 'нажмите ещё раз' : `без сделки у вас ${P.batna}`}</small>
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** «Написать»: компактное поле поверх сцены, над панелью; клавиатура телефона поднимает его над собой. */
function WriteSheet({ m }: { m: Meeting }) {
  // сказали с клавиатуры — после ответа курсор снова в поле: пишем дальше, не хватаясь за мышь
  const byKey = useRef(false)
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !m.pending && byKey.current) document.getElementById('px-speech')?.focus()
    wasPending.current = !!m.pending
  }, [m.pending])
  const canVoice = m.canMic && canRecord()
  return (
    <form
      className="w3-say w3-write"
      hidden={m.voiceMode}
      onSubmit={(e) => {
        e.preventDefault()
        byKey.current = false
        m.send(m.draft)
      }}
    >
      <SpeechField
        label={m.pending ? `${m.name} думает…` : 'Ваша реплика'}
        value={m.pending ?? m.draft}
        disabled={!!m.pending}
        maxLength={1500}
        rows={1}
        onChange={(e) => m.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            byKey.current = true
            m.send(m.draft)
          }
        }}
        onPointerDown={() => (byKey.current = false)}
      />
      <Button variant="brass" icon="send" type="submit" className="w3-send" aria-label="Сказать" disabled={!!m.pending || !m.draft.trim()}>
        <span className="w3-send-label">Сказать</span>
      </Button>
      {canVoice && (
        <button type="button" className="w3-write-close" aria-label="Закрыть поле: отвечать голосом" onClick={() => m.setInputMode('voice')}>
          <PixelIcon name="cross" px={2} />
        </button>
      )}
    </form>
  )
}

/** Мой блокнот на столе: условия договора, сколько каждое вам даёт, и «Предложить эти условия». */
export function NotebookPage({ m, tut, lit, litOffer }: { m: Meeting; tut: Tutorial; lit: string; litOffer: string }) {
  const { sc, P, state, picks, myTotal, lowSure, done, pending, name, revealedNow } = m
  // ниже есть ещё пункты, которые не влезли (телефон, пять условий): подсказываем, что лист листается
  const body = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const check = () => {
    const b = body.current
    if (b) setMore(b.scrollTop + b.clientHeight < b.scrollHeight - 4)
  }
  // содержимое меняется с каждым ходом (заметки, раскрытые условия) — сверяем после каждой отрисовки
  useEffect(check)
  return (
    <div className={`w3-note${lit}`}>
      <div className="w3-note-head">
        <h2 className="w3-note-title">Мой блокнот</h2>
        <p className="w3-note-batna" title="Ваша выгода без сделки: меньше брать нет смысла">
          без сделки <b>{P.batna}</b>
        </p>
      </div>
      <p className="w3-note-legend" aria-hidden="true">
        выгода
      </p>
      <div className={`w3-note-body${more ? ' is-more' : ''}`} data-scroll ref={body} onScroll={check}>
        <Notes sc={sc} state={state} issue={undefined} fresh={revealedNow} name={name} />
        {sc.issues.map((i) => (
          <div key={i.id} className="w3-issue">
            <IssueStepper
              title={i.title}
              options={i.options}
              points={P.points[i.id]}
              value={picks[i.id]}
              disabled={state.status === 'deal'}
              onChange={(v) => {
                m.pick(i.id, v)
                tut.picked()
              }}
            />
            <Notes sc={sc} state={state} issue={i.id} fresh={revealedNow} name={name} />
          </div>
        ))}
        {!done && isComplete(sc, state.lastOpponentOffer) && !sameOffer(picks, state.lastOpponentOffer) && (
          <button type="button" className="g-link w3-copy" onClick={() => m.setPicks({ ...(state.lastOpponentOffer as Record<string, number>) })}>
            Переписать условия с листка
          </button>
        )}
      </div>
      {more && (
        <p className="w3-note-more" aria-hidden="true">
          ▼ ещё условия — листайте
        </p>
      )}
      {!done && lowSure && (
        <p className="w3-low" role="alert">
          Выгода {myTotal} — меньше, чем без сделки ({P.batna}). Если {name} согласится, вы проиграете.
        </p>
      )}
      <p className={`w3-total${myTotal < P.batna ? ' is-low' : ''}`}>
        Ваша выгода <b>{myTotal}</b> из {m.max}
      </p>
      {tut.shows('offer') && (
        <div className="w3-note-foot">
          <Button variant={lowSure ? 'stamp' : 'brass'} icon="pen" className={litOffer || undefined} disabled={done || !!pending} onClick={m.putOnTable}>
            {lowSure ? 'Всё равно предложить' : 'Предложить'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Листок с предложением, который лежит посреди стола. «Согласиться» — на нём. */
export function SlipPage({ m, lit }: { m: Meeting; lit: string }) {
  const { sc, P, state, theirsOnTable, name, canAccept, acceptSure, pending } = m
  const offer = (state.status === 'deal' ? state.deal : undefined) ?? state.tableOffer
  const rows = sc.issues.filter((i) => typeof offer[i.id] === 'number')
  const silent = sc.issues.filter((i) => typeof offer[i.id] !== 'number')
  const full = isComplete(sc, offer)
  const mine = full ? score(P, offer) : null
  const from =
    state.status === 'deal' ? 'Подписано' : theirsOnTable ? (state.lastCall ? `${name}: последнее предложение` : `Предлагает ${name}`) : 'Вы предложили'
  return (
    <div className={`w3-slip${state.lastCall ? ' is-last' : ''}${state.status === 'deal' ? ' is-signed' : ''}${lit}`}>
      <p className="w3-slip-from">{from}</p>
      <dl className="w3-slip-rows">
        {rows.map((i) => (
          <div key={i.id} className="w3-slip-row">
            <dt>{i.title}</dt>
            <dd>
              {i.options[offer[i.id]!]} <span className="w3-slip-pts">{P.points[i.id][offer[i.id]!]}</span>
            </dd>
          </div>
        ))}
      </dl>
      {state.status === 'deal' && (
        <span className="w3-slip-stamp" role="status">
          По рукам
        </span>
      )}
      <div className="w3-slip-foot">
        <p>
          {mine !== null ? (
            <>
              Ваша выгода <b className={mine < P.batna ? 'is-low' : undefined}>{mine}</b>, без сделки {P.batna}
            </>
          ) : (
            <>Про {silent.map((i) => `«${i.title.toLowerCase()}»`).join(', ')} пока ни слова</>
          )}
        </p>
        {canAccept && (
          <Button variant={acceptSure ? 'stamp' : 'paper'} icon="check" disabled={!!pending} onClick={m.accept}>
            {acceptSure ? 'Всё равно согласиться' : 'Согласиться'}
          </Button>
        )}
      </div>
      {canAccept && acceptSure && mine !== null && (
        <p className="w3-low" role="alert">
          Это меньше, чем без сделки: {mine} против {P.batna}. Выгоднее встать и уйти.
        </p>
      )}
    </div>
  )
}

/** Карточка с делами: что чувствует собеседник, голос, подсказки, запись разговора, уйти. */
function ActionCard({
  m,
  tut,
  lit,
  onXray,
  onProtocol,
  onMenu,
}: {
  m: Meeting
  tut: Tutorial
  lit: (t: string) => string
  onXray: () => void
  onProtocol: () => void
  onMenu: () => void
}) {
  const extras = tut.shows('extras')
  const items: { icon: IconName; label: ReactNode; on?: boolean; tone?: 'stamp'; click: () => void; show?: boolean; lit?: string }[] = [
    { icon: 'eye', label: 'Что чувствует', on: m.xray, click: onXray, lit: lit('feel') },
    { icon: m.voiceOn ? 'sound' : 'mute', label: m.voiceOn ? 'Голос: вкл.' : 'Голос: выкл.', on: m.voiceOn, click: m.toggleVoice, show: m.canVoice },
    { icon: 'pen', label: 'Подсказки', on: m.instantOn, click: () => m.switchInstant(!m.instantOn), show: extras },
    { icon: 'rewind', label: 'Запись разговора', click: onProtocol, show: m.history.length > 0 && extras },
    { icon: 'menu', label: 'Меню', click: onMenu, show: extras },
    { icon: 'leave', label: m.leaving ? 'Точно уйти?' : 'Встать и уйти', tone: 'stamp', click: m.walk, show: !m.done && tut.shows('leave'), lit: lit('leave') },
  ]
  return (
    <div className="w3-card">
      <p className="w3-card-title">Под рукой</p>
      <ul className="w3-card-list">
        {items
          .filter((i) => i.show !== false)
          .map((i) => (
            <li key={i.icon}>
              <button
                type="button"
                className={`w3-card-btn${i.on ? ' is-on' : ''}${i.tone === 'stamp' ? ' is-stamp' : ''}${i.tone === 'stamp' && m.leaving ? ' is-sure' : ''}${i.lit ?? ''}`}
                aria-pressed={i.on === undefined ? undefined : i.on}
                disabled={!!m.pending && i.tone === 'stamp'}
                onClick={i.click}
              >
                <PixelIcon name={i.icon} px={2} />
                <span>{i.label}</span>
                {i.on !== undefined && <i className="w3-card-mark">{i.on ? 'вкл' : 'выкл'}</i>}
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}

/** Разбор хода: полупрозрачные плашки сверху, гаснут сами; «Подробнее» — весь разбор. */
function TurnToasts({ fb, tip, dim, onMore, onExample }: { fb: TurnFeedback | null; tip: Tip | null; dim: boolean; onMore: () => void; onExample: (t: string) => void }) {
  const [gone, setGone] = useState(false)
  // сколько живёт стопка: дольше, если пометок много; наведение ставит на паузу (CSS)
  const life = fb ? 8 + fb.notes.length * 1.6 : 14
  if (!fb && !tip) return null
  if (gone)
    return (
      <button type="button" className="w3-toast-chip w3-ui" data-nodrag onClick={onMore}>
        {fb ? <span className={`w3-stamp-mini is-${fb.verdict.ink}`}>{fb.verdict.word}</span> : null}
        {fb ? `Ход ${fb.turn}: разбор` : 'Совет перед первым ходом'}
      </button>
    )
  const marks = fb ? fb.notes.filter((n) => n.ink !== 'plain').slice(0, 3) : []
  return (
    <section
      className={`w3-toasts w3-ui${dim ? ' is-dim' : ''}`}
      data-nodrag
      aria-live="polite"
      aria-label={fb ? `Разбор хода ${fb.turn}` : 'Совет'}
      style={{ '--life': `${life}s` } as CSSProperties}
      onAnimationEnd={(e) => e.animationName === 'w3-life' && e.target === e.currentTarget && setGone(true)}
    >
      {fb && (
        <div className="w3-toast w3-toast--verdict" style={{ animationDelay: '0ms' }}>
          <span className={`w3-stamp-mini is-${fb.verdict.ink}`}>{fb.verdict.word}</span>
          <span>
            <span className="w3-toast-turn">Ход {fb.turn}: </span>
            <span className="w3-toast-effect">{effectText(fb)}</span>
          </span>
        </div>
      )}
      {marks.map((n, k) => (
        <div key={n.key} className={`w3-toast is-${n.ink}`} style={{ animationDelay: `${180 + k * 160}ms` }}>
          <PixelIcon name={n.ink === 'good' ? 'check' : 'cross'} px={2} />
          <span>
            <b>{n.title}</b>
            {n.quote && <q>{n.quote}</q>}
          </span>
        </div>
      ))}
      {tip && (
        <div className="w3-toast w3-toast--tip" style={{ animationDelay: `${220 + marks.length * 160}ms` }}>
          <span>
            <b>Дальше:</b> {tip.short ?? tip.text}
          </span>
          {tip.example && (
            <button type="button" className="g-link" onClick={() => onExample(tip.example!)}>
              Вставить пример
            </button>
          )}
        </div>
      )}
      <button type="button" className="w3-toast-more g-link" onClick={onMore}>
        Подробнее
      </button>
    </section>
  )
}

/** Меню по Esc: протокол с перемоткой, настройки, выход. */
function Menu({ m, onClose, onQuit, onXray, onHowTo }: { m: Meeting; onClose: () => void; onQuit: () => void; onXray: () => void; onHowTo?: () => void }) {
  const [quit, setQuit] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => card.current?.querySelector('button')?.focus(), [])
  const h = m.history
  return (
    <div className="w3-menu w3-ui" data-nodrag role="dialog" aria-modal="true" aria-label="Меню встречи" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={card} className="w3-menu-card">
        <p className="w3-menu-title">Встреча идёт</p>
        <p className="w3-menu-sub">
          {m.sc.title}. Напротив {m.sc.opponent.character.name}.
        </p>
        <Button variant="brass" icon="send" onClick={onClose}>
          Вернуться за стол
        </Button>
        <ul className="w3-menu-list">
          <li>
            <button type="button" className="w3-menu-item" aria-pressed={m.xray} onClick={onXray}>
              <PixelIcon name="eye" px={2} /> Что чувствует {m.name}: {m.xray ? 'показывать' : 'не показывать'}
            </button>
          </li>
          <li>
            <button type="button" className="w3-menu-item" aria-pressed={m.instantOn} onClick={() => m.switchInstant(!m.instantOn)}>
              <PixelIcon name="pen" px={2} /> Подсказки на ходу: {m.instantOn ? 'вкл' : 'выкл'}
            </button>
          </li>
          {m.canVoice && (
            <li>
              <button type="button" className="w3-menu-item" aria-pressed={m.voiceOn} onClick={m.toggleVoice}>
                <PixelIcon name={m.voiceOn ? 'sound' : 'mute'} px={2} /> Голос {g(m.sc, 'собеседника', 'собеседницы')}: {m.voiceOn ? 'вкл' : 'выкл'}
              </button>
            </li>
          )}
          {m.canVoice && m.voiceOn && (
            <li>
              <VolumeSlider />
            </li>
          )}
          {m.canMic && canRecord() && <VoiceMenuItems />}
          {onHowTo && (
            <li>
              <button type="button" className="w3-menu-item" onClick={onHowTo}>
                <PixelIcon name="notebook" px={2} /> Как играть
              </button>
            </li>
          )}
          <li>
            <button type="button" className={`w3-menu-item is-stamp${quit ? ' is-sure' : ''}`} onClick={() => (quit ? onQuit() : setQuit(true))}>
              <PixelIcon name="leave" px={2} /> {quit ? 'Точно? Встреча не сохранится' : 'Выйти к папке дел'}
            </button>
          </li>
        </ul>
        {h.length > 0 && (
          <details className="w3-protocol">
            <summary>
              Запись разговора: {h.length} {plural(h.length, 'ход', 'хода', 'ходов')}
            </summary>
            <ol>
              {h.map((x) => (
                <li key={x.turn}>
                  <p>
                    <b>Вы:</b> {x.playerText}
                  </p>
                  <p className="w3-protocol-them">
                    <b>{m.name}:</b> {x.opponentLine}
                  </p>
                  <button
                    type="button"
                    className="g-link"
                    disabled={!!m.pending}
                    onClick={() => {
                      m.rewind(x.turn)
                      onClose()
                    }}
                  >
                    <PixelIcon name="rewind" px={2} /> Переиграть с этого хода
                  </button>
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="w3-menu-keys">
          Осмотреться — перетащить мышью или пальцем, стрелки ← →. Стол — ↓, взгляд вперёд — ↑. Меню — Esc.
        </p>
      </div>
    </div>
  )
}

/** Телефон боком: стол и блокнот в высоту не помещаются — до первого хода предлагаем повернуть. CSS показывает только лёжа. */
function RotateHint() {
  const KEY = 'peregovorka.rotate.v1'
  const [off, setOff] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  if (off) return null
  // погасла сама — уходит из DOM: место слева сверху нужно плашкам разбора
  return (
    <p className="w3-rotate" role="status" onAnimationEnd={(e) => e.target === e.currentTarget && setOff(true)}>
      Удобнее вертикально
      <Button
        variant="ghost"
        icon="cross"
        aria-label="Понятно"
        onClick={() => {
          setOff(true)
          try {
            sessionStorage.setItem(KEY, '1')
          } catch {
            // до перезагрузки
          }
        }}
      />
    </p>
  )
}

/** Клавиатура телефона закрывает низ экрана — поднимаем поле ввода над ней. */
function useVisualViewport(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const play = ref.current?.parentElement
    const on = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      play?.style.setProperty('--kb', `${Math.round(kb)}px`)
      // клавиатура открыта: плашки разбора хода прячем, иначе реплика собеседника упирается в них
      play?.toggleAttribute('data-kb', kb > 80)
    }
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    on()
    return () => {
      vv.removeEventListener('resize', on)
      vv.removeEventListener('scroll', on)
      play?.style.removeProperty('--kb')
      play?.removeAttribute('data-kb')
    }
  }, [ref])
}


const TUTOR_STEPS: TutorStep[] = ['talk', 'notebook', 'offer', 'slip', 'feel', 'leave']
/** «Шаг 2 из 6» для карточки наставника. */
const stepNo = (s: TutorStep): [number, number] | undefined => (TUTOR_STEPS.includes(s) ? [TUTOR_STEPS.indexOf(s) + 1, TUTOR_STEPS.length] : undefined)
