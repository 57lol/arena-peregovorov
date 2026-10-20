import { type PrepareCounts, type PrepareReason } from '../shared/prepareDiag'
// Голосовой ход игрока без браузера: микрофон открыт заранее (micStream.ts), но звук идёт в распознавание только с конца
// реплики собеседника — всё, что раньше, это эхо его голоса из колонок. Начало фразы не теряется: последние кадры лежат
// в кольце, и с первого громкого кадра в распознавание уходят ещё PREROLL_MS до него.
// Поток Scribe открывают заранее (prepare) к концу реплики собеседника, а закрывают, как только он не нужен.

import { SttError } from './recording'
import { noiseFloor, QUIET_LOUD, speechPause } from './silence'

/** 16 кГц: отсчётов в мс */
const PER_MS = 16
/** кольцо последних кадров: сколько звука помним до решения «игрок заговорил» и до запоздавшего open() */
const RING_MS = 1000
/** столько звука до первого громкого кадра уходит в распознавание: первый слог мягкий */
const PREROLL_MS = 300
/** громкость речи (RMS) в тихой комнате; в шумной порог выше — над шумом (noiseFloor в silence.ts) */
const LOUD = QUIET_LOUD
/**
 * Текст от Scribe не меняется столько сверх паузы конца реплики — игрок замолчал, даже если микрофон слышит шум:
 * Scribe пишет слова, а гул и стук не пишет. Запас — на задержку промежуточного текста (~0,3–0,6 с).
 */
const TEXT_STALE_MS = 1000
/** громкого набралось столько (с провалами не дольше GAP_MS) — игрок заговорил */
const ONSET_MS = 60
const GAP_MS = 120
/** «заговорил», а 160 мс речи так и не набралось за это время — шум, слушаем дальше */
const FALSE_START_MS = 2500
/** заранее открытый поток без речи столько — закрываем: воркер держит соединение 35 с от подключения, а Scribe считает время */
export const IDLE_MS = 6000
/** не дольше стольких мс звука за реплику: у воркера 30 с звука и 35 с жизни соединения от подключения */
const MAX_SPEECH_MS = 29_500
const SESSION_LIFE_MS = 34_000
/** кусок в Scribe — 200 мс */
const CHUNK = 200 * PER_MS
/** столько «не расслышал» подряд — дальше только по кнопке: шум не должен гонять распознавание по кругу */
export const EMPTY_LIMIT = 3
/** поток не подключился ни разу — столько не пробуем, сразу Яндекс */
const SCRIBE_DOWN_MS = 60_000
/** ранних commit на одну реплику не больше: дальше — как раньше, один в конце */
export const EARLY_LIMIT = 3
/** кусок без текста от Scribe, но и речи в нём меньше этого — щелчок, а не потерянные слова */
const TINY_MS = 300

/** idle — не слушаем (говорит собеседник); listen — ждём речь; speak — игрок говорит; busy — распознаём; failed — не вышло. */
export type ListenPhase = 'idle' | 'listen' | 'speak' | 'busy' | 'failed'

export interface Session {
  push(pcm: ArrayBuffer): void
  finish(): Promise<string | null>
  cancel(): void
  readonly text: string
  readonly ready: boolean
  readonly ended: boolean
}

export interface ListenIO {
  /** новый поток Scribe (подключение начинается сразу); null — только Яндекс */
  session: ((partial: (text: string) => void) => Session | null) | null
  /** запасной путь: вся запись в Яндекс с хеджем */
  recognize: (pcm: ArrayBuffer, signal: AbortSignal) => Promise<string>
  /** пауза конца реплики по тому, что уже распознано */
  pauseMs: (text: string) => number
  /**
   * Ранний commit: игрок молчит столько мс — сказанное отдаём Scribe, не дожидаясь паузы конца реплики. Текст со знаками
   * приходит за ~0,25 с, а не через 0,9–1,4 с (до них фраза считалась «непонятной» и действовал длинный порог), и ход
   * можно готовить, пока идёт пауза. Заговорил снова — новый поток, текст склеивается. Нет — один commit в конце.
   */
  earlyMs?: number
  /** промежуточный или финальный текст, пока игрок молчит: ход можно готовить; исправленный финал меняет ключ */
  onEarly?: (text: string) => void
  onPrepareStats?: (counts: PrepareCounts) => void
  onPhase: (p: ListenPhase) => void
  onPartial: (text: string) => void
  onText: (text: string) => void
  /** retry — запись сохранена, «Ещё раз» отправит её же */
  onError: (e: unknown, retry: boolean) => void
  /** ничего не расслышали — слушаем дальше */
  onEmpty?: () => void
  trace?: (kind: string, detail?: unknown) => void
  now?: () => number
}

interface Frame {
  pcm: Int16Array
  /** время первого отсчёта, мс (часы performance.now) */
  t: number
  end: number
}

const level = (pcm: Int16Array) => {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
  return pcm.length ? Math.sqrt(sum / pcm.length) / 32768 : 0
}

export function createListener(io: ListenIO) {
  const now = io.now ?? (() => performance.now())
  const trace = io.trace ?? (() => {})
  let phase: ListenPhase = 'idle'
  /** с этого момента звук — игрока; null — не слушаем */
  let from: number | null = null
  const ring: Frame[] = []
  // начало речи
  let run = 0, runStart = 0, lastLoud = -Infinity
  // реплика
  let speech: Int16Array[] = []
  let samples = 0
  let voiced = 0
  let limit = MAX_SPEECH_MS
  let paused: ReturnType<typeof speechPause> | null = null
  let chunk = new Int16Array(CHUNK)
  let chunkLen = 0
  // поток Scribe
  let session: Session | null = null
  let sessionAt = 0
  let used = false
  /** поток на этот ход уже открывали (заранее или на open) — второй раз до речи не открываем */
  let opened = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let downUntil = 0
  // ранний commit: куски реплики, уже отданные Scribe (по порядку), и ожидание, заговорит ли игрок снова
  let segs: { text: Promise<string | null>; voiced: number; done?: string | null }[] = []
  let segVoiced = 0
  let parked = false
  let lost = false
  let rRun = 0, rStart = 0, rLast = -Infinity
  // распознавание
  let gen = 0
  let job: AbortController | null = null
  let kept: ArrayBuffer | null = null
  let empties = 0
  let dead = false
  let heardAny = false
  // шум комнаты и порог речи над ним
  const noise = noiseFloor()
  let thr = LOUD
  // когда последний раз менялся распознанный текст реплики
  let lastText = ''
  let textAt = 0
  let earlyText = ''
  let prepCounts: PrepareCounts = {}
  let sawPartial = false
  let reachedPause = false
  const notePrepare = (why: PrepareReason) => { prepCounts[why] = Math.min(999, (prepCounts[why] ?? 0) + 1) }

  // Промежуточный текст уже годится для заготовки: финал commit может прийти позже короткой паузы.
  // Повтор с тем же текстом не тратит запрос; исправленный финал обязан получить отдельный ключ.
  const offerEarly = (text: string) => {
    const t = text.trim()
    if (!t || t === earlyText) return
    earlyText = t
    io.onEarly?.(t)
  }

  const set = (p: ListenPhase) => {
    if (phase === p) return
    phase = p
    trace('phase', p)
    if (!dead) io.onPhase(p)
  }

  const dropSession = () => {
    clearTimeout(idleTimer)
    session?.cancel()
    session = null
    used = false
  }

  function openSession() {
    if (!io.session || now() < downUntil) return
    const s = io.session((text) => {
      if (session === s && phase === 'speak') io.onPartial(text)
    })
    if (!s) return
    session = s
    sessionAt = now()
    used = false
    opened = true
    trace('session', 'open')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (session === s && !used) {
        trace('session', 'idle-close')
        dropSession()
      }
    }, IDLE_MS)
  }

  const pushChunk = (pcm: Int16Array) => {
    let at = 0
    while (at < pcm.length) {
      const n = Math.min(CHUNK - chunkLen, pcm.length - at)
      chunk.set(pcm.subarray(at, at + n), chunkLen)
      chunkLen += n
      at += n
      if (chunkLen === CHUNK) flushChunk()
    }
  }
  const flushChunk = () => {
    if (!chunkLen) return
    const out = chunk.slice(0, chunkLen)
    chunkLen = 0
    chunk = new Int16Array(CHUNK)
    session?.push(out.buffer)
  }

  /** Что уже распознано в этой реплике: куски раннего commit и промежуточный текст текущего потока. */
  const heardText = () => [...segs.map((x) => x.done ?? ''), session?.text ?? ''].join(' ').trim()

  /** Кадр звука игрока (после from): копим, считаем громкость и паузу. */
  function hear(pcm: Int16Array, t: number, end: number) {
    speech.push(pcm)
    samples += pcm.length
    const r = level(pcm)
    if (parked) {
      // после раннего commit игрок заговорил снова — новый поток, с PREROLL_MS до первого громкого кадра
      if (r >= thr) {
        if (!rRun) rStart = t
        rRun += end - t
        rLast = end
      } else if (end - rLast > GAP_MS) rRun = 0
      if (rRun >= ONSET_MS) resume()
    } else if (used) pushChunk(pcm)
    if (r >= thr) {
      voiced += end - t
      lastLoud = end
      if (used) segVoiced += end - t
    } else if (voiced < 160) voiced = 0
    if (heardText().trim()) sawPartial = true
    if (io.earlyMs && voiced >= 160 && end - lastLoud >= io.earlyMs) reachedPause = true
    if (io.earlyMs && voiced >= 160 && end - lastLoud >= io.earlyMs && !lost &&
        session?.ready && !session.ended && segs.every((x) => x.done !== undefined && (x.done !== null || x.voiced < TINY_MS))) {
      offerEarly(heardText())
    }
    if (paused?.(r, end)) return void finish('pause')
    if (samples / PER_MS >= limit) return void finish('limit')
    // шум не даёт тишины, а Scribe давно не пишет новых слов — игрок договорил
    // После обрыва потока старый текст уже не свидетельствует о тишине: всю запись ждёт запасной Яндекс.
    const h = heardText()
    if (h !== lastText) {
      lastText = h
      textAt = end
    } else if (h && !lost && (!session || (session.ready && !session.ended)) && end - textAt >= io.pauseMs(h) + TEXT_STALE_MS) return void finish('text')
    if (!parked && used && io.earlyMs && session?.ready && segVoiced >= 160 && end - lastLoud >= io.earlyMs && segs.length < EARLY_LIMIT) commitEarly()
    // щелчок или шум, а не речь: поток с мусором закрываем, слушаем дальше
    if (voiced < 160 && end - lastLoud > FALSE_START_MS) {
      trace('false-start')
      dropSession()
      speech = []
      samples = 0
      chunkLen = 0
      run = 0
      set('listen')
    }
  }

  /** Игрок замолчал на earlyMs: отдаём сказанное Scribe сейчас, а не в конце паузы. */
  function commitEarly() {
    const s = session!
    flushChunk()
    session = null
    used = false
    parked = true
    rRun = 0
    clearTimeout(idleTimer)
    trace('early')
    const seg: (typeof segs)[number] = { text: s.finish(), voiced: segVoiced }
    segVoiced = 0
    segs.push(seg)
    const g = gen
    void seg.text.then((t) => {
      seg.done = t
      if (g !== gen || !parked || phase !== 'speak' || segs.some((x) => x.done === undefined)) return
      const text = joined(segs.map((x) => x.done!), segs.map((x) => x.voiced))
      if (text) offerEarly(text)
    })
  }

  /** После раннего commit игрок продолжил: новый поток (подключение идёт, звук копится), начало — из кольца. */
  function resume() {
    parked = false
    rRun = 0
    trace('resume')
    openSession()
    if (!session) {
      lost = true
      return
    }
    used = true
    segVoiced = 0
    clearTimeout(idleTimer)
    const begin = rStart - PREROLL_MS
    for (const g of ring) {
      if (g.end <= begin) continue
      const cut = g.t < begin ? Math.round((begin - g.t) * PER_MS) : 0
      pushChunk(cut ? g.pcm.subarray(cut) : g.pcm)
    }
  }

  /** Тексты кусков в одну реплику; null — кусок с речью не распознан: тогда вся запись уйдёт в Яндекс. */
  function joined(texts: (string | null)[], voicedMs: number[]): string | null {
    if (lost || texts.some((t, i) => t === null && voicedMs[i] >= TINY_MS)) return null
    return texts.map((t) => t?.trim() ?? '').filter(Boolean).join(' ')
  }

  /** Игрок заговорил на кадре f: начало — из кольца, PREROLL_MS до первого громкого, но не раньше from. */
  function onset(f: Frame) {
    const begin = Math.max(from!, runStart - PREROLL_MS)
    trace('onset', { at: runStart, begin, thr: +thr.toFixed(4) })
    if (session && session.ended) dropSession()
    if (!session) openSession()
    used = !!session
    clearTimeout(idleTimer)
    limit = Math.min(MAX_SPEECH_MS, session ? SESSION_LIFE_MS - (now() - sessionAt) : MAX_SPEECH_MS)
    speech = []
    samples = 0
    voiced = 0
    chunkLen = 0
    segs = []
    segVoiced = 0
    parked = false
    lost = false
    paused = speechPause(() => io.pauseMs(heardText()), () => thr)
    lastText = ''
    earlyText = ''
    prepCounts = {}
    sawPartial = false
    reachedPause = false
    textAt = runStart
    set('speak')
    for (const g of ring) {
      if (g.t > f.t || g.end <= begin) continue
      const cut = g.t < begin ? Math.round((begin - g.t) * PER_MS) : 0
      const pcm = cut ? g.pcm.subarray(cut) : g.pcm
      if (pcm.length) hear(pcm, Math.max(g.t, begin), g.end)
      if (phase !== 'speak') return
    }
  }

  /** Кадр после from: ждём начала речи или слушаем речь. */
  function accept(f: Frame) {
    if ((phase !== 'listen' && phase !== 'speak') || from === null || f.end <= from) return
    if (!heardAny) {
      heardAny = true
      trace('first-frame', { from, t: Math.max(f.t, from), at: Math.round(now()) })
    }
    if (phase === 'speak') {
      const cut = f.t < from ? Math.round((from - f.t) * PER_MS) : 0
      return hear(cut ? f.pcm.subarray(cut) : f.pcm, Math.max(f.t, from), f.end)
    }
    const r = level(f.pcm)
    if (r >= thr) {
      if (!run) runStart = Math.max(f.t, from)
      run += f.end - Math.max(f.t, from)
      lastLoud = f.end
    } else if (f.end - lastLoud > GAP_MS) run = 0
    if (run >= ONSET_MS) onset(f)
  }

  async function finish(why: string) {
    if (phase !== 'speak') return
    trace('finish', why)
    if (!earlyText) {
      if (!sawPartial) notePrepare('noPartial')
      if (!reachedPause) notePrepare('shortPause')
      if (why === 'button') notePrepare('manual')
      if (why === 'limit' || segs.length >= EARLY_LIMIT) notePrepare('limit')
      if (sawPartial && reachedPause) notePrepare('unavailable')
    }
    set('busy')
    const g = gen
    from = null
    run = 0
    flushChunk()
    const all = new Int16Array(samples)
    let at = 0
    for (const p of speech) {
      all.set(p, at)
      at += p.length
    }
    speech = []
    samples = 0
    const s = used ? session : null
    clearTimeout(idleTimer)
    session = null
    used = false
    const parts = segs
    const tailVoiced = segVoiced
    segs = []
    parked = false
    let text: string | null = null
    if (s || parts.length) {
      // куски раннего commit обычно уже распознаны: без нового потока ждать нечего
      const got = await Promise.all([...parts.map((x) => x.text), s ? s.finish() : Promise.resolve('')])
      if (g !== gen) return
      if (s && !s.ready) downUntil = now() + SCRIBE_DOWN_MS
      text = joined(got, [...parts.map((x) => x.voiced), s ? tailVoiced : 0])
      lost = false
      trace('scribe', text === null ? 'fallback' : 'final')
    }
    if (text?.trim()) return done(text.trim())
    kept = all.buffer
    await send(g)
  }

  function done(text: string) {
    empties = 0
    kept = null
    set('idle')
    io.onPrepareStats?.({ ...prepCounts })
    io.onText(text)
  }

  async function send(g: number) {
    const ctl = (job = new AbortController())
    set('busy')
    try {
      const text = (await io.recognize(kept!, ctl.signal)).trim()
      if (g !== gen) return
      if (text) return done(text)
      kept = null
      if (++empties >= EMPTY_LIMIT) {
        set('failed')
        io.onError(new SttError('Не расслышал. Нажмите «Говорить» и скажите ещё раз — или напишите текстом.'), false)
      } else {
        io.onEmpty?.()
        listenFrom(now())
      }
    } catch (e) {
      if (g !== gen) return
      const retry = e instanceof SttError && e.retry
      if (!retry) kept = null
      set('failed')
      io.onError(e, retry)
    } finally {
      if (job === ctl) job = null
    }
  }

  function listenFrom(at: number) {
    from = at
    heardAny = false
    run = 0
    set('listen')
    // open() мог запоздать: кадры после from уже в кольце
    for (const f of ring.slice()) {
      if (phase !== 'listen' && phase !== 'speak') break
      accept(f)
    }
  }

  function close() {
    gen++
    job?.abort()
    job = null
    from = null
    run = 0
    speech = []
    samples = 0
    chunkLen = 0
    kept = null
    dropSession()
    opened = false
    segs = []
    parked = false
    lost = false
    set('idle')
  }

  return {
    /** Кадр с микрофона: 16 кГц mono, t — время первого отсчёта (performance.now). */
    frame(pcm: Int16Array, t: number) {
      if (dead) return
      const f = { pcm, t, end: t + pcm.length / PER_MS }
      noise.push(level(pcm), t)
      thr = noise.loud()
      ring.push(f)
      while (ring.length > 1 && f.end - ring[0].end > RING_MS) ring.shift()
      accept(f)
    },
    /** Заранее подключить поток Scribe: реплика собеседника вот-вот кончится. */
    prepare() {
      if (dead || (session && !session.ended)) return
      openSession()
    },
    /** Собеседник замолчал в момент at: звук игрока — с at (раньше — эхо). */
    open(at: number) {
      if (dead || phase === 'listen' || phase === 'speak' || phase === 'busy') return
      empties = phase === 'failed' ? 0 : empties
      kept = null
      trace('open', { at, late: Math.round(now() - at) })
      // поток на этот ход ещё не подключали (реплика без голоса) — подключаем, пока игрок собирается с мыслями
      if (!opened) openSession()
      listenFrom(at)
    },
    /** Ход ушёл, собеседник заговорил, пауза: всё недослушанное и недораспознанное — в мусор, поток закрыть. */
    close,
    /** «Готово»: игрок закончил, не дожидаясь паузы. */
    finish: () => finish('button'),
    /** «Ещё раз»: та же запись в распознавание. */
    retry() {
      if (phase === 'failed' && kept) void send(gen)
    },
    dispose() {
      dead = true
      close()
      ring.length = 0
    },
    get phase() {
      return phase
    },
    /** поток Scribe подключён и ждёт речь */
    get warm() {
      return !!session && session.ready && !session.ended
    },
  }
}

export type Listener = ReturnType<typeof createListener>
