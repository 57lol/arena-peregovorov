// Встреча от первого лица: мы сидим за столом, напротив собеседник и пара коллег.
// Мир — во весь экран (world3d/*). Реплика собеседника висит под ним, наша — поле ввода поверх экрана.
// На столе лежат блокнот (предложение), листок собеседника («Принять») и карточка с делами — всё нажимается
// прямо на столе. Разбор хода — плашки, которые гаснут сами. Остальное — в меню (Esc).
// Логика встречи та же, что в классическом виде: useMeeting.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Vector3 } from 'three'
import { isComplete, sameOffer, score } from '../../engine/utility'
import { g, meetingClock, plural, portraitFor, sceneFor } from '../cast'
import { effectText, type Tip, type TurnFeedback } from '../instant'
import { mentorLine, useTutorial, type Tutorial, type TutorStep } from '../tutorial'
import { endText, useMeeting, type Meeting, type MeetingProps } from '../useMeeting'
import { Button, DialogBox, IssueStepper, PixelIcon, SpeechField, Stamp, type IconName } from '../ui'
import { attachInput, isTyping } from '../world3d/input'
import type { Pose } from '../world3d/head'
import type { PaperId } from '../world3d/papers'
import { World } from '../world3d/stage'
import { Margin } from './Margin'
import { Mentor } from './Mentor'
import { MicButton } from './Mic'
import { VolumeSlider } from './Volume'
import { Notes, XRay } from './meetingParts'
import '../world3d/world3d.css'
import '../world3d/play3d.css'

type Props = MeetingProps & {
  /** в классический 2D-вид: выбор игрока или устройство не тянет */
  onClassic: (why: 'choice' | 'slow') => void
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function Play3D(props: Props) {
  const { history, onFinish, onQuit, onClassic } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [world, setWorld] = useState<World | null>(null)
  const [pose, setPose] = useState<Pose>('face')
  const [menu, setMenu] = useState(false)
  const [detail, setDetail] = useState(false)
  const [looked, setLooked] = useState(false)
  // лист в руках (телефон): поднят со стола и стоит перед глазами
  const [held, setHeld] = useState<PaperId | null>(null)
  const m = useMeeting(props, {
    afterSend: () => {
      // ответ пришёл — кладём бумаги и поднимаем глаза на собеседника
      setHeld(null)
      worldRef.current?.look('face')
    },
  })
  const worldRef = useRef<World | null>(null)
  worldRef.current = world
  const { sc, state, last, done, pending, line, emotion, talking, xray, stamp, canAccept } = m
  // первая встреча — обучающая: бумаги и кнопки появляются по одной, когда впервые нужны
  const tut = useTutorial(props.tutorial, props.onTutorialOff, m)
  const notebookOn = tut.shows('notebook')
  const slipOn = tut.shows('slip')
  const cardOn = tut.shows('card')
  useEffect(() => {
    if (!world) return
    world.desk.show('notebook', notebookOn)
    world.desk.show('slip', slipOn)
    world.desk.show('card', cardOn)
  }, [world, notebookOn, slipOn, cardOn])

  // ---------- мир ----------
  useEffect(() => {
    const el = rootRef.current!
    const w = new World(el, { kind: sceneFor(sc), caseId: sc.id, opponent: portraitFor(sc), reducedMotion: reduced() })
    w.start()
    setWorld(w)
    // для проверок из Playwright
    ;(window as unknown as { __world?: World }).__world = w
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
  const turns = history.length
  const prevTurns = useRef(turns)
  useEffect(() => {
    if (!world) return
    if (turns > prevTurns.current) world.company?.stir('table', 3.5)
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
      world.head.ty = 55 * (Math.PI / 180)
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

  // ---------- оверлеи, привязанные к миру ----------
  const lineRef = useRef<HTMLDivElement>(null)
  const xrayRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!world) return
    const head = new Vector3()
    const chin = new Vector3()
    const p = { x: 0, y: 0, behind: false }
    let lastPose: Pose = 'face'
    return world.on(() => {
      const lead = world.company?.lead
      const box = lineRef.current
      const pose = world.head.pose
      if (pose !== lastPose) setPose((lastPose = pose))
      // лист в руках или (на телефоне) взгляд на стол — реплика ждёт, иначе закрывает бумаги
      box?.classList.toggle('is-hidden', world.desk.heldAmount > 0.3 || (world.portrait && pose === 'desk'))
      if (!lead) return
      const cw = world.cw
      const ch = world.ch
      const rootBox = rootRef.current!.getBoundingClientRect()
      const trayTop = trayRef.current ? trayRef.current.getBoundingClientRect().top - rootBox.top : ch
      const mentorEl = document.querySelector<HTMLElement>('.w3-mentor')
      const at = !mentorEl ? '' : pose === 'face' ? 'top' : world.portrait ? 'bottom' : 'beside'
      if (mentorEl) placeMentor(mentorEl, rootBox, cw, trayTop, at)
      // лист в руках встаёт между кнопкой меню (или наставником сверху) и полем ввода (или наставником снизу)
      const mentor = mentorEl?.getBoundingClientRect()
      world.desk.freeTop = Math.max(64, mentor && at === 'top' ? mentor.bottom - rootBox.top + 10 : 0) / ch
      world.desk.freeBottom = (Math.min(trayTop, mentor && at === 'bottom' ? mentor.top - rootBox.top : ch) - 8) / ch
      if (box) {
        world.project(lead.anchor('chest', chin), p)
        const w = box.offsetWidth
        const h = box.offsetHeight
        const off = p.behind || p.x < -w * 0.3 || p.x > cw + w * 0.3
        // склонились к столу на ноутбуке — реплика уходит в левый верхний угол, над блокнотом: листок в центре открыт
        let x = pose === 'desk' && !world.portrait ? 12 : Math.min(Math.max(p.x - w / 2, 12), cw - w - 12)
        // на телефоне реплика стоит прямо над полем ввода: так лицо собеседника остаётся открытым
        const y = world.portrait && pose === 'face' ? trayTop - h - 10 : Math.min(Math.max(p.behind ? 12 : p.y, 12), trayTop - h - 10)
        // наверху слева плашки разбора, справа «Меню» — реплика встаёт между ними, если хватает ширины
        const root = rootRef.current!.getBoundingClientRect()
        for (const sel of ['.w3-toasts', '.w3-toast-chip', '.w3-sheet', '.w3-xray', '.w3-mentor']) {
          const r = document.querySelector(sel)?.getBoundingClientRect()
          if (!r || y > r.bottom - root.top || r.left - root.left > cw / 2) continue
          const right = r.right - root.left + 12
          if (right + w + 12 <= cw) x = Math.max(x, right)
        }
        const menuBtn = document.querySelector('.w3-top')?.getBoundingClientRect()
        if (menuBtn && y < menuBtn.bottom - root.top && x + w > menuBtn.left - root.left - 12) x = Math.max(12, menuBtn.left - root.left - 12 - w)
        box.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
        box.dataset.off = off ? (p.behind ? 'behind' : p.x < cw / 2 ? 'left' : 'right') : ''
      }
      const xr = xrayRef.current
      if (xr) {
        world.project(lead.anchor('head', head), p)
        const w = xr.offsetWidth
        const narrow = cw < 700
        const x = narrow ? 12 : Math.min(Math.max(p.x + 170, 12), cw - w - 12)
        const y = narrow ? 12 : Math.max(p.y - 20, 12)
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
      setMenu((o) => !o)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [detail])

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
    ? mentorLine(tut.step, { sc, pose, phone: !!world?.portrait, held, theirs: m.theirsOnTable, batna: m.P.batna })
    : props.tutorial && done && history.length > 0
      ? { text: 'Встреча окончена. Жми «Разбор встречи»: там коротко, что получилось и что попробовать в следующий раз.' }
      : null
  const lit = (t: string) => (mentor?.target === t ? ' is-tutor' : '')

  return (
    <div className="px-root w3-play" data-desk={sceneFor(sc)} data-pose={pose} data-xray={xray} data-done={done} data-held={held ?? ''}>
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

      {/* реплика собеседника — под ним, в мире */}
      <div ref={lineRef} className="w3-them w3-ui" data-nodrag>
        <DialogBox
          key={m.voiced?.text === line ? m.voiced.n : 0}
          name={sc.opponent.character.name}
          role={sc.opponent.character.role}
          text={line}
          onTalkingChange={m.setTalking}
          cps={m.voiced?.text === line ? m.voiced.cps : undefined}
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

      {/* верх экрана: меню; взгляд — стол/собеседник */}
      <div className="w3-top w3-ui" data-nodrag>
        <Button variant="paper" icon="menu" className="w3-menu-btn" aria-label="Меню" aria-expanded={menu} onClick={() => setMenu(true)}>
          <span className="w3-menu-label">Меню</span>
        </Button>
      </div>

      <div ref={trayRef} className="w3-tray w3-ui" data-nodrag>
        {tut.shows('desk') && (
        <div className="w3-tray-row">
          <p className="w3-clock-line">
            <PixelIcon name="clock" px={2} />
            <MeetingTime turn={state.turn} limit={sc.turnLimit} clock={meetingClock(sc)} />
          </p>
          {held ? (
            <Button variant="ghost" icon="down" className="w3-look" onClick={() => setHeld(null)}>
              На стол
            </Button>
          ) : pose === 'face' ? (
            <Button variant={newOffer ? 'brass' : 'ghost'} icon="down" className={`w3-look${newOffer ? ' is-new' : ''}${lit('look')}`} onClick={() => lookAt('desk')}>
              {newOffer ? <>Стол<span className="w3-wide">: новое предложение</span></> : 'Стол'}
            </Button>
          ) : (
            <Button variant="ghost" icon="up" className="w3-look" onClick={() => lookAt('face')}>
              {name}
            </Button>
          )}
        </div>
        )}
        {(pending || last) && !done && (
          <p className="w3-you">
            <b>Вы:</b> {pending ?? last!.playerText}
          </p>
        )}
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
          <SayForm m={m} />
        )}
        {pose === 'desk' && !held && !done && world?.portrait && !tut.on && (
          <p className="w3-hint w3-hint--desk" aria-hidden="true">
            Нажмите на лист — возьмёте в руки
          </p>
        )}
        {!looked && !done && history.length === 0 && !tut.on && (
          <p className="w3-hint" aria-hidden="true">
            <span className="w3-hint-mouse">Осмотреться — мышью или стрелками, на стол — стрелка вниз</span>
            <span className="w3-hint-touch">Осмотреться — проведите пальцем по экрану</span>
          </p>
        )}
      </div>

      {menu && (
        <Menu
          m={m}
          onClose={() => setMenu(false)}
          onClassic={() => onClassic('choice')}
          onQuit={onQuit}
          onXray={toggleXray}
        />
      )}
    </div>
  )
}

/**
 * Карточка наставника. Смотрим на собеседника — слева вверху, где потом будут плашки разбора хода.
 * Ноутбук, взгляд на стол — рядом с тем, что подсвечено, как выноска: справа, снизу, слева или сверху, где влезает.
 * Телефон, взгляд на стол — над полем ввода: вверху лежит листок собеседника.
 */
function placeMentor(el: HTMLElement, root: DOMRect, cw: number, trayTop: number, at: string) {
  el.dataset.at = at
  let x = 12
  let y = at === 'bottom' ? trayTop - el.offsetHeight - 10 : 12
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

/** «10:15, ещё 9 реплик» — то же время, что показывают часы на стене. */
function MeetingTime({ turn, limit, clock }: { turn: number; limit: number; clock: { start: number; minutes: number } }) {
  const left = Math.max(0, limit - turn)
  const now = clock.start + (clock.minutes * Math.min(turn, limit)) / limit
  const t = `${Math.floor(now / 60)}:${String(Math.floor(now % 60)).padStart(2, '0')}`
  return (
    <span className={left <= 2 ? 'is-late' : undefined}>
      {t}, {left === 0 ? 'время вышло' : <>ещё {left}<span className="w3-wide"> {plural(left, 'реплика', 'реплики', 'реплик')}</span></>}
    </span>
  )
}

/** Поле ввода и «Сказать» — парят над миром. */
function SayForm({ m }: { m: Meeting }) {
  // сказали с клавиатуры — после ответа курсор снова в поле: пишем дальше, не хватаясь за мышь
  const byKey = useRef(false)
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !m.pending && byKey.current) document.getElementById('px-speech')?.focus()
    wasPending.current = !!m.pending
  }, [m.pending])
  return (
    <form
      className="w3-say"
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
      <div className="w3-say-row">
        <Button variant="brass" icon="send" type="submit" disabled={!!m.pending || !m.draft.trim()}>
          {m.pending ? 'Слушает…' : 'Сказать'}
        </Button>
        {m.canMic && (
          <MicButton
            disabled={!!m.pending}
            onText={(t) => {
              m.setError(null)
              m.setDraft((d) => (d.trim() ? `${d.trim()} ${t}` : t))
              document.getElementById('px-speech')?.focus()
            }}
            onError={m.setError}
            onOff={() => m.setMicOff(true)}
          />
        )}
      </div>
      {m.error && (
        <p className="w3-error" role="alert">
          {m.error}
        </p>
      )}
      {m.source === 'local' && <p className="w3-source">Играем офлайн: сервер недоступен</p>}
    </form>
  )
}

/** Мой блокнот на столе: условия договора, сколько каждое вам даёт, и «Предложить эти условия». */
function NotebookPage({ m, tut, lit, litOffer }: { m: Meeting; tut: Tutorial; lit: string; litOffer: string }) {
  const { sc, P, state, picks, myTotal, lowSure, done, pending, name, revealedNow } = m
  return (
    <div className={`w3-note${lit}`}>
      <div className="w3-note-head">
        <h2 className="w3-note-title">Мой блокнот</h2>
        <p className="w3-note-batna" title="Столько вам даст «не договориться»: меньше брать нет смысла">
          без сделки <b>{P.batna}</b>
        </p>
      </div>
      <p className="w3-note-legend" aria-hidden="true">
        выгода
      </p>
      <div className="w3-note-body" data-scroll>
        <Notes sc={sc} state={state} issue={undefined} fresh={revealedNow} name={name} />
        {sc.issues.map((i) => (
          <div key={i.id} className="w3-issue">
            <IssueStepper
              title={i.title}
              options={i.options}
              points={P.points[i.id]}
              value={picks[i.id]}
              onChange={(v) => {
                m.pick(i.id, v)
                tut.picked()
              }}
            />
            <Notes sc={sc} state={state} issue={i.id} fresh={revealedNow} name={name} />
          </div>
        ))}
        {isComplete(sc, state.lastOpponentOffer) && !sameOffer(picks, state.lastOpponentOffer) && (
          <button type="button" className="g-link w3-copy" onClick={() => m.setPicks({ ...(state.lastOpponentOffer as Record<string, number>) })}>
            Переписать условия с листка
          </button>
        )}
      </div>
      {lowSure && (
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
function SlipPage({ m, lit }: { m: Meeting; lit: string }) {
  const { sc, P, state, theirsOnTable, name, canAccept, acceptSure, pending } = m
  const offer = state.tableOffer ?? {}
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
              Выгода вам <b className={mine < P.batna ? 'is-low' : undefined}>{mine}</b>, без сделки {P.batna}
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
    { icon: m.voiceOn ? 'sound' : 'mute', label: 'Голос', on: m.voiceOn, click: m.toggleVoice, show: m.canVoice && extras },
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

/** Меню по Esc: протокол с перемоткой, настройки, классический вид, выход. */
function Menu({ m, onClose, onClassic, onQuit, onXray }: { m: Meeting; onClose: () => void; onClassic: () => void; onQuit: () => void; onXray: () => void }) {
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
                <PixelIcon name={m.voiceOn ? 'sound' : 'mute'} px={2} /> Голос собеседника: {m.voiceOn ? 'вкл' : 'выкл'}
              </button>
            </li>
          )}
          {m.canVoice && m.voiceOn && (
            <li>
              <VolumeSlider />
            </li>
          )}
          <li>
            <button type="button" className="w3-menu-item" onClick={onClassic}>
              <PixelIcon name="notebook" px={2} /> Классический вид
            </button>
          </li>
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
          Осмотреться — перетащить мышью или пальцем, стрелки ← →. Стол — ↓, собеседник — ↑. Меню — Esc.
        </p>
      </div>
    </div>
  )
}

/** Клавиатура телефона закрывает низ экрана — поднимаем поле ввода над ней. */
function useVisualViewport(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      ref.current?.parentElement?.style.setProperty('--kb', `${Math.round(kb)}px`)
    }
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    on()
    return () => {
      vv.removeEventListener('resize', on)
      vv.removeEventListener('scroll', on)
    }
  }, [ref])
}


const TUTOR_STEPS: TutorStep[] = ['talk', 'notebook', 'offer', 'slip', 'feel', 'leave']
/** «Шаг 2 из 6» для карточки наставника. */
const stepNo = (s: TutorStep): [number, number] | undefined => (TUTOR_STEPS.includes(s) ? [TUTOR_STEPS.indexOf(s) + 1, TUTOR_STEPS.length] : undefined)
