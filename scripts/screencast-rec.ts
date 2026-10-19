/// <reference lib="dom" />
// Запись скринкаста для жюри (v2, 18.10): кадры через CDP screencast (JPEG с отметкой времени), голоса собеседника
// перехватываем из <audio> (Blob и куски MediaSource) вместе с моментами старта и паузы, голос игрока — заранее
// записанные mp3, которые подаются в игру через поддельный микрофон (Web Audio → getUserMedia), то есть идут
// настоящим путём: распознавание → движок → ответ. Потом кадры сжимает scripts/screencast-pack.py, монтаж — scripts/screencast-edit.py.
//
// Запуск: релиз-кандидат продовой сборкой (npm run build && npm run build:server && PORT=8090 node dist-server/server.mjs),
// потом npx tsx scripts/screencast-rec.ts <часть> [--url http://127.0.0.1:8090] [--out ~/Arena-materials/final/screencast-v2/raw]
//   части: hub (титул, хаб, бриф), tara (кабинет → живая партия по ссылке команды → разбор → доска; платно ~20 ₽,
//          --strong-only — без слабого хода и «переиграть»), board (доска по room.json),
//          setup (своё дело), english, china (по одному живому ходу), phone (390 px)
// Голоса игрока: --voice <папка с p1..p6.mp3, e1.mp3, c1.mp3>.
// Под navigator.webdriver игра молчит и уходит в 2D, поэтому webdriver подменён; проверку «3D тормозит» гасим,
// иначе на слабом маке во время записи игра сама переключается в 2D. Адрес 127.0.0.1 в кадре подменяется на
// arena-peregovorov.ru, значения key= — точками.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Locator, type Page } from 'playwright'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const PART = process.argv[2]
const URL = arg('url', 'http://127.0.0.1:8090')
const ROOT = arg('out', join(homedir(), 'Arena-materials/final/screencast-v2/raw'))
const VOICE = arg('voice', join(homedir(), 'Arena-materials/final/screencast-v2/voice'))
const HOST = new globalThis.URL(URL).host
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------- то, что живёт в странице (строкой: tsx оборачивает функции в __name, которого в странице нет) ----------
const INIT = (o: { mic: boolean }) => `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  // проверка «3D тормозит → классический вид» (интервал 2,5 с с onClassic('slow')): на записи не нужна
  const _si = window.setInterval;
  window.setInterval = function (fn, ms, ...a) {
    try { if (ms === 2500 && typeof fn === 'function' && /slow/.test(String(fn))) return 0 } catch (e) {}
    return _si.call(window, fn, ms, ...a);
  };
  try {
    if (!sessionStorage.getItem('__init')) {
      sessionStorage.setItem('__init', '1');
      localStorage.setItem('peregovorka.voice.v2', '1');
      localStorage.setItem('peregovorka.input.v1', ${o.mic ? "'voice'" : "'text'"});
      const p = JSON.parse(localStorage.getItem('peregovorka.progress.v2') || '{}');
      p.tutorialDone = true;
      localStorage.setItem('peregovorka.progress.v2', JSON.stringify(p));
    }
  } catch (e) {}

  // адрес и ключи в кадре
  const HOSTRE = /https?:\\/\\/${HOST.replace(/\./g, '\\.')}|${HOST.replace(/\./g, '\\.')}/g;
  const fix = (s) => s.replace(HOSTRE, 'arena-peregovorov.ru').replace(/(key=)[^&\\s]+/g, '$1••••••');
  const mask = () => {
    if (!document.body) return;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (/${HOST.replace(/\./g, '\\.')}|key=(?!•)/.test(n.nodeValue)) n.nodeValue = fix(n.nodeValue);
    for (const el of document.querySelectorAll('input, textarea')) {
      if (/${HOST.replace(/\./g, '\\.')}|key=(?!•)/.test(el.value)) { el.dataset.real = el.value; el.value = fix(el.value); }
    }
  };
  _si.call(window, mask, 100);
  new MutationObserver(mask).observe(document, { subtree: true, childList: true, characterData: true });

  // курсор: CDP screencast его не рисует
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:26px;height:38px;filter:drop-shadow(1px 2px 1px rgba(0,0,0,.45));z-index:2147483647;pointer-events:none;transition:none;' +
      'background:url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'26\\' height=\\'38\\' viewBox=\\'0 0 13 19\\'><path d=\\'M1 1L1 15.5L4.6 12.3L7 18L9.3 17L6.9 11.4L11.6 11.4Z\\' fill=\\'white\\' stroke=\\'black\\' stroke-width=\\'1.1\\' stroke-linejoin=\\'round\\'/></svg>') + '") no-repeat';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    if (window.__noCursor) c.style.display = 'none';
  });

  // звук: события плеера и сами байты (Blob и MediaSource)
  window.__ev = []; window.__aud = {}; window.__playingNow = false;
  const cou = URL.createObjectURL;
  URL.createObjectURL = function (o) {
    const u = cou.call(URL, o);
    try {
      if (typeof MediaSource !== 'undefined' && o instanceof MediaSource) { o.__url = u; window.__aud[u] = { kind: 'ms', chunks: [] }; }
      else if (o instanceof Blob && /audio|mpeg|octet/.test(o.type || 'audio')) window.__aud[u] = { kind: 'blob', blob: o };
    } catch (e) {}
    return u;
  };
  if (typeof MediaSource !== 'undefined') {
    const add = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (t) { const sb = add.call(this, t); sb.__ms = this; return sb; };
    const app = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (d) {
      try {
        const u = this.__ms && this.__ms.__url;
        if (u && window.__aud[u]) window.__aud[u].chunks.push(d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)));
      } catch (e) {}
      return app.call(this, d);
    };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!this.__hooked) {
      this.__hooked = true;
      const ev = (type) => () => {
        const src = this.currentSrc || this.src;
        if (src.startsWith('data:')) return;
        if (type === 'play') window.__playingNow = true; else window.__playingNow = false;
        window.__ev.push({ type, t: Date.now(), src, ct: this.currentTime, vol: this.volume });
      };
      this.addEventListener('playing', ev('play'));
      this.addEventListener('pause', ev('stop'));
      this.addEventListener('waiting', ev('stop'));
      this.addEventListener('ended', ev('stop'));
      this.addEventListener('error', ev('stop'));
    }
    return play.call(this);
  };

  ${
    o.mic
      ? `
  // поддельный микрофон: всё, что подаёт __say, игра слышит как голос игрока
  window.__mic = { ctx: null, dests: [] };
  navigator.mediaDevices.getUserMedia = async () => {
    const m = window.__mic;
    if (!m.ctx) m.ctx = new AudioContext();
    await m.ctx.resume();
    const d = m.ctx.createMediaStreamDestination();
    m.dests.push(d);
    return d.stream;
  };
  window.__say = async (b64) => {
    const m = window.__mic;
    if (!m || !m.ctx) throw new Error('микрофон не открыт');
    await m.ctx.resume();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await m.ctx.decodeAudioData(bytes.buffer);
    const src = m.ctx.createBufferSource();
    src.buffer = buf;
    let n = 0;
    for (const d of m.dests) if (d.stream.getAudioTracks().some((t) => t.readyState === 'live')) { src.connect(d); n++; }
    const t = Date.now();
    src.start();
    return { t, dur: buf.duration, dests: n };
  };`
      : ''
  }
`

if (process.env.DUMP_INIT) {
  writeFileSync(process.env.DUMP_INIT, INIT({ mic: true }))
  process.exit(0)
}

// ---------- запись одной страницы ----------
interface Rec {
  name: string
  dir: string
  page: Page
  cdp: CDPSession
  frames: { f: string; t: number }[]
  marks: { name: string; t: number; data?: unknown }[]
  says: { key: string; t: number; dur: number; file: string }[]
  mark: (name: string, data?: unknown) => void
  stop: () => Promise<void>
}

async function record(page: Page, name: string, o: { w?: number; h?: number; nth?: number } = {}): Promise<Rec> {
  const dir = join(ROOT, name)
  mkdirSync(join(dir, 'frames'), { recursive: true })
  mkdirSync(join(dir, 'audio'), { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  const r: Rec = {
    name,
    dir,
    page,
    cdp,
    frames: [],
    marks: [],
    says: [],
    mark: (n, data) => {
      r.marks.push({ name: n, t: Date.now(), data })
      log(`[${name}] ${n}`, data ?? '')
    },
    stop: async () => {
      await cdp.send('Page.stopScreencast').catch(() => {})
      await wait(200)
      writeFileSync(join(dir, 'marks.json'), JSON.stringify({ marks: r.marks, frames: r.frames, says: r.says }, null, 0))
      log(`[${name}] кадров ${r.frames.length}`)
    },
  }
  let i = 0
  cdp.on('Page.screencastFrame', (f) => {
    const file = `${String(++i).padStart(6, '0')}.jpg`
    writeFileSync(join(dir, 'frames', file), Buffer.from(f.data, 'base64'))
    r.frames.push({ f: file, t: Math.round((f.metadata.timestamp ?? Date.now() / 1000) * 1000) })
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: o.w ?? 1920, maxHeight: o.h ?? 1080, everyNthFrame: o.nth ?? 1 })
  r.mark('start')
  return r
}

/** Всё, что звучало на странице: события и байты. Звать до ухода со страницы — потом она всё забудет. */
async function dumpAudio(r: Rec) {
  const p = r.page
  const ev = (await p.evaluate(() => (window as unknown as { __ev: unknown[] }).__ev)) as { src: string }[]
  const files: Record<string, string> = {}
  let k = 0
  for (const src of [...new Set(ev.map((e) => e.src))]) {
    const name = `a${String(++k).padStart(3, '0')}.mp3`
    if (src.startsWith('blob:')) {
      const b64 = (await p.evaluate(async (u) => {
        const a = (window as unknown as { __aud: Record<string, { kind: string; blob?: Blob; chunks: Uint8Array[] }> }).__aud[u]
        if (!a) return null
        let bytes: Uint8Array
        if (a.kind === 'blob') bytes = new Uint8Array(await a.blob!.arrayBuffer())
        else {
          const n = a.chunks.reduce((s, c) => s + c.length, 0)
          bytes = new Uint8Array(n)
          let at = 0
          for (const c of a.chunks) {
            bytes.set(c, at)
            at += c.length
          }
        }
        let s = ''
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(s)
      }, src)) as string | null
      if (!b64) continue
      writeFileSync(join(r.dir, 'audio', name), Buffer.from(b64, 'base64'))
    } else {
      const res = await p.request.get(src).catch(() => null)
      if (!res || !res.ok()) continue
      writeFileSync(join(r.dir, 'audio', name), await res.body())
    }
    files[src] = name
  }
  writeFileSync(join(r.dir, 'audio.json'), JSON.stringify({ ev, files }, null, 0))
  log(`[${r.name}] звуков ${Object.keys(files).length}, событий ${ev.length}`)
}

// ---------- браузер ----------
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
async function newCtx(o: { mic?: boolean; phone?: boolean } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext(
    o.phone
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: 'ru-RU',
          userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        }
      : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'ru-RU' },
  )
  await ctx.grantPermissions(['microphone'], { origin: URL }).catch(() => {})
  await ctx.addInitScript(INIT({ mic: !!o.mic }))
  return ctx
}

// ---------- помощники ----------
/** Клик с видимым движением курсора. */
const cursor = (p: Page, on: boolean) =>
  p.evaluate((v) => { const c = document.getElementById('__cursor'); if (c) c.style.visibility = v ? 'visible' : 'hidden' }, on).catch(() => {})
async function click(p: Page, l: Locator, o: { steps?: number; pause?: number } = {}) {
  await cursor(p, true)
  await l.scrollIntoViewIfNeeded().catch(() => {})
  const b = await l.boundingBox()
  if (b) {
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: o.steps ?? 18 })
    await wait(o.pause ?? 250)
  }
  await l.click()
}
async function hover(p: Page, l: Locator, ms = 700) {
  const b = await l.boundingBox()
  if (b) await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 })
  await wait(ms)
}
const away = (p: Page) => p.mouse.move(1900, 1070, { steps: 10 })
async function smoothTo(p: Page, top: number, ms = 1600) {
  await p.evaluate((y) => window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }), top)
  await wait(ms)
}
const yOf = (_p: Page, l: Locator) => l.evaluate((e) => e.getBoundingClientRect().top + window.scrollY)
async function typeIn(p: Page, l: Locator, text: string, delay = 35) {
  await click(p, l)
  await l.fill('')
  await l.pressSequentially(text, { delay })
  await wait(250)
}

/** панель голосового хода: 2D — .g-voiceonly, 3D — нижняя панель встречи в голосовом режиме */
const VOICE_PANEL = '.g-voiceonly, .w3-bar[data-voice]'
type W = { __playingNow: boolean; __ev: { type: string; src: string; t: number }[] }
const evCount = (p: Page) => p.evaluate(() => (window as unknown as W).__ev.length)
const ended = (p: Page) => p.getByRole('button', { name: 'Разбор встречи' }).isVisible().catch(() => false)

/** Тишина: звук не играет, и игра ждёт игрока (слушает) или встреча кончилась. */
async function waitQuiet(p: Page, ms = 1000, timeout = 120_000) {
  const end = Date.now() + timeout
  let since = 0
  while (Date.now() < end) {
    const st = await p.evaluate(() => {
      const v = document.querySelector('.g-voiceonly') as HTMLElement | null
      return {
        playing: (window as unknown as W).__playingNow,
        // 2D — фаза панели и лампа «Слушаю»; 3D — лампа-микрофон в панели .w3-bar[data-voice]
        ready: (!!v && v.dataset.phase === 'listen' && !!document.querySelector('.g-voice-state.is-on')) || !!document.querySelector('.w3-bar[data-voice] .w3-talk.is-on'),
        typed: !!document.querySelector('#px-speech') && !document.querySelector('#px-speech')!.hasAttribute('disabled'),
        ended: [...document.querySelectorAll('button')].some((b) => /Разбор встречи/.test(b.textContent ?? '')),
      }
    })
    if (!st.playing && (st.ready || st.typed || st.ended)) {
      if (!since) since = Date.now()
      if (Date.now() - since >= ms) return true
    } else since = 0
    await wait(120)
  }
  log('не дождались тишины')
  return false
}

/** Сказать в поддельный микрофон заготовленную реплику и дождаться ответа собеседника целиком. */
async function say(r: Rec, key: string) {
  const p = r.page
  const file = join(VOICE, `${key}.mp3`)
  const b64 = readFileSync(file).toString('base64')
  const before = await evCount(p)
  const turns = await p.evaluate(() => document.querySelectorAll('.w3-protocol li, .g-history li').length)
  const s = (await p.evaluate((b) => (window as unknown as { __say: (b: string) => Promise<{ t: number; dur: number; dests: number }> }).__say(b), b64)) as {
    t: number
    dur: number
    dests: number
  }
  r.says.push({ key, t: s.t, dur: s.dur, file })
  r.mark(`say-${key}`, { dur: s.dur, dests: s.dests })
  // распознано и ушло: собеседник думает или ответ уже звучит
  const sent = await p
    .waitForFunction((k) => (window as unknown as W).__ev.slice(k).some((e) => e.type === 'play' && e.src.startsWith('blob:')), before, { timeout: 60_000 + s.dur * 1000 })
    .then(() => true)
    .catch(() => false)
  r.mark(`line-${key}`, { voiced: sent, turns })
  await waitQuiet(p, 1100)
  r.mark(`done-${key}`)
}

async function waitListen(r: Rec, timeout = 90_000) {
  const ok = await waitQuiet(r.page, 700, timeout)
  r.mark('listen', { ok })
}

// ---------- части ----------
async function partHub() {
  const ctx = await newCtx()
  const p = await ctx.newPage()
  await p.goto(`${URL}/`)
  await p.waitForSelector('.tt-btn.is-jury')
  await wait(1500)
  const r = await record(p, 'hub')
  await p.mouse.move(1500, 500)
  await wait(6000)
  r.mark('title-click')
  await click(p, p.locator('.tt-btn.is-jury'), { steps: 30, pause: 600 })
  await p.waitForSelector('text=Для жюри')
  r.mark('hub')
  await wait(1500)
  for (const t of ['Настроить', 'Провести', 'Разбор', 'Команда']) await hover(p, p.locator('button', { hasText: t }).first(), 900)
  await hover(p, p.locator('button', { hasText: 'English: поставщик' }).first(), 900)
  await hover(p, p.locator('button', { hasText: 'Поставщик из Шэньчжэня' }).first(), 900)
  r.mark('to-tara')
  await click(p, p.locator('button', { hasText: 'Тара к запуску' }).first())
  await p.waitForSelector('.g-dossier')
  r.mark('brief')
  await away(p)
  await wait(5500)
  r.mark('end')
  await r.stop()
  await ctx.close()
}

async function partTara() {
  // руководитель открывает тренировку
  const cctx = await newCtx()
  const cap = await cctx.newPage()
  await cap.goto(`${URL}/?jury`)
  await cap.waitForSelector('text=Для жюри')
  await wait(1000)
  const rc = await record(cap, 'cabinet')
  await wait(800)
  await click(cap, cap.getByRole('button', { name: 'Кабинет руководителя', exact: true }))
  await wait(1800)
  const folder = cap.locator('.g-folder').filter({ has: cap.getByRole('heading', { name: 'Тара к запуску', exact: true }) })
  await hover(cap, folder, 900)
  await click(cap, folder.getByRole('button', { name: 'Дать команде', exact: true }))
  await wait(1200)
  rc.mark('form')
  await typeIn(cap, cap.getByPlaceholder('Отдел закупок, октябрь'), 'Закупки, октябрь', 45)
  await click(cap, cap.getByRole('button', { name: 'Открыть тренировку', exact: true }))
  const teamBox = cap.getByRole('textbox', { name: 'Ссылка для команды', exact: true })
  await teamBox.waitFor()
  rc.mark('links')
  await away(cap)
  await wait(3500)
  const real = async (l: Locator) => (await l.getAttribute('data-real')) ?? (await l.inputValue())
  const team = await real(teamBox)
  const board = await real(cap.getByRole('textbox', { name: 'Ваша ссылка на доску результатов', exact: true }))
  writeFileSync(join(ROOT, 'room.json'), JSON.stringify({ team, board }))
  await click(cap, cap.getByRole('button', { name: 'Открыть доску', exact: true }))
  await wait(3000)
  rc.mark('board-empty')
  await wait(2500)
  rc.mark('end')
  await rc.stop()

  // игрок: по ссылке команды, голосом, в 3D
  const pctx = await newCtx({ mic: true })
  const p = await pctx.newPage()
  p.on('pageerror', (e) => log('pageerror', e.message.slice(0, 200)))
  await p.goto(team.replace(/^https?:\/\/[^/]+/, URL))
  await p.getByPlaceholder('Имя или псевдоним').fill('Алексей Смирнов')
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('К делу') && !(b as HTMLButtonElement).disabled))
  await p.getByRole('button', { name: 'К делу', exact: true }).click()
  await p.getByRole('button', { name: 'Войти в переговорку', exact: true }).first().waitFor()
  await wait(1500)
  const r = await record(p, 'tara', { nth: 2 })
  await wait(1500)
  await click(p, p.getByRole('button', { name: 'Войти в переговорку', exact: true }).first())
  r.mark('enter')
  await p.waitForSelector(VOICE_PANEL, { timeout: 60_000 })
  await cursor(p, false)
  if (!process.argv.includes('--strong-only')) {
    // слабый ход (ультиматум) → «Переиграть с этого хода»
    await waitListen(r)
    await say(r, 'p1')
    await wait(2500)
    r.mark('rewind-menu')
    await p.keyboard.press('Escape')
    await wait(1200)
    await click(p, p.locator('.w3-protocol > summary'))
    await wait(1500)
    r.mark('rewind-click')
    await click(p, p.getByRole('button', { name: /Переиграть с этого хода/ }).first())
    r.mark('rewound')
    await cursor(p, false)
  }
  // сильная линия: интерес → свой интерес и размен → пакет → размен «по факту за 48 часов» и «по рукам».
  // Каждый живой ход ~5 ₽ (Sonnet через AITunnel + YandexGPT + озвучка), поэтому путь короткий; проверен офлайн-движком.
  for (const key of ['p2', 'p3', 'p4', 'p5b', 'p5']) {
    if (await ended(p)) break
    await waitListen(r)
    await say(r, key)
    await wait(1200)
  }
  for (let k = 0; k < 1 && !(await ended(p)); k++) {
    // предложение на столе: принять
    r.mark('desk')
    await click(p, p.locator('.w3-look').first())
    await wait(2200)
    const acc = p.locator('.w3-paper--slip').getByRole('button', { name: /Принять|Согласиться/ }).first()
    if (await acc.count()) {
      await acc.evaluate((el) => (el as HTMLElement).click())
      await wait(400)
      const sure = p.locator('.w3-paper--slip').getByRole('button', { name: /Всё равно/ })
      if (await sure.count()) await sure.first().evaluate((el) => (el as HTMLElement).click())
      r.mark('accept')
      await waitQuiet(p, 1000)
    } else {
      await click(p, p.locator('.w3-look').first())
      await cursor(p, false)
      await waitListen(r)
      await say(r, 'p6')
    }
  }
  r.mark('deal')
  await wait(6000)
  await dumpAudio(r)

  // разбор
  await click(p, p.getByRole('button', { name: 'Разбор встречи' }))
  await p.waitForSelector('#main-h', { timeout: 30_000 })
  await away(p)
  r.mark('debrief')
  await wait(4500)
  const more = p.locator('details.g-report-more > summary')
  await click(p, more)
  await p.waitForSelector('.g-analytics', { timeout: 30_000 })
  await away(p)
  await wait(600)
  r.mark('analytics')
  await smoothTo(p, (await yOf(p, p.locator('.g-analytics'))) - 40, 2500)
  const pts = p.locator('.g-trend svg g[tabindex="0"]')
  const n = await pts.count()
  r.mark('points', { n })
  for (let i = 0; i < Math.min(n, 6); i++) await hover(p, pts.nth(i), 900)
  for (let i = 0; i < Math.min(n, 3); i++) await click(p, pts.nth(i), { steps: 8, pause: 600 }).then(() => wait(700))
  await wait(1000)
  const prof = p.locator('.g-profile-row').first()
  if (await prof.count()) {
    r.mark('profile')
    await smoothTo(p, (await yOf(p, prof)) - 220, 2500)
    await click(p, prof.locator('summary'))
    await wait(3500)
    await smoothTo(p, (await yOf(p, prof)) + 120, 3000)
    await wait(2000)
  }
  r.mark('end')
  await r.stop()
  writeFileSync(join(r.dir, 'debrief.txt'), await p.locator('body').innerText())

  // доска у руководителя: результат уже там
  await partBoard(cap)
}

/** Доска тренировки: по ссылке из room.json (отдельной частью — если запись партии оборвалась после разбора). */
async function partBoard(cap?: Page) {
  if (!cap) {
    const { board } = JSON.parse(readFileSync(join(ROOT, 'room.json'), 'utf8')) as { board: string }
    cap = await (await newCtx()).newPage()
    await cap.goto(board.replace(/^https?:\/\/[^/]+/, URL))
  }
  const rb = await record(cap, 'board')
  await cap.reload()
  await cap.waitForSelector('text=Ведомость', { timeout: 40_000 }).catch(() => log('ведомость не появилась'))
  await wait(2500)
  rb.mark('board')
  const roll = await cap.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('Ведомость'))
    return h ? h.getBoundingClientRect().top + scrollY : null
  })
  if (roll) await smoothTo(cap, roll - 90, 3000)
  await wait(3000)
  rb.mark('end')
  await rb.stop()
  await cap.screenshot({ path: join(rb.dir, 'board-full.png'), fullPage: true })
}

async function partSetup() {
  const ctx = await newCtx()
  const p = await ctx.newPage()
  await p.goto(`${URL}/?jury`)
  await p.waitForSelector('text=Для жюри')
  await wait(1000)
  const r = await record(p, 'setup')
  await click(p, p.getByRole('button', { name: /Своё дело/ }).first())
  await wait(1500)
  r.mark('form')
  const chip = (t: string) => click(p, p.locator('button', { hasText: new RegExp(`^${t}$`) }).first(), { steps: 10, pause: 200 }).then(() => wait(250))
  const field = (label: string) => p.locator('label', { hasText: label }).locator('input')
  await chip('Закупки')
  await typeIn(p, field('О чём договариваемся'), 'поставка подшипников для нового цеха')
  await typeIn(p, field('Кто вы'), 'закупщик завода в ОЭЗ «Алабуга»')
  await chip('холодный')
  await typeIn(p, field('Кто напротив'), 'менеджер поставщика из Набережных Челнов')
  await typeIn(p, field('Цель другой стороны'), 'продать дороже и получить предоплату')
  await chip('торгуется')
  await typeIn(p, field('Что хотите потренировать'), 'не уступать в цене сразу')
  await wait(600)
  r.mark('submit')
  await click(p, p.getByRole('button', { name: 'Собрать дело' }))
  r.mark('building')
  await p.waitForFunction(() => !document.querySelector('.g-writing'), undefined, { timeout: 120_000 })
  await p.waitForSelector('.g-dossier', { timeout: 120_000 }).catch(() => log('бриф не появился'))
  r.mark('built')
  await away(p)
  await wait(4000)
  await smoothTo(p, 380, 2500)
  await wait(2500)
  r.mark('end')
  await r.stop()
  await p.screenshot({ path: join(r.dir, 'built-full.png'), fullPage: true })
}

async function partCase(name: 'english' | 'china') {
  const ctx = await newCtx({ mic: true })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => log('pageerror', e.message.slice(0, 200)))
  await p.goto(`${URL}/?jury`)
  await p.waitForSelector('text=Для жюри')
  await wait(800)
  const r = await record(p, name, { nth: 2 })
  await click(p, p.locator('button', { hasText: name === 'english' ? 'English: поставщик' : 'Поставщик из Шэньчжэня' }).first())
  await p.waitForSelector('.g-dossier')
  r.mark('brief')
  await away(p)
  await wait(4000)
  await click(p, p.getByRole('button', { name: 'Войти в переговорку', exact: true }).first())
  r.mark('enter')
  await p.waitForSelector(VOICE_PANEL, { timeout: 60_000 })
  await cursor(p, false)
  await waitListen(r)
  await say(r, name === 'english' ? 'e1' : 'c1')
  await wait(3000)
  r.mark('end')
  await dumpAudio(r)
  await r.stop()
}

async function partPhone() {
  const ctx = await newCtx({ phone: true })
  const p = await ctx.newPage()
  await p.goto(`${URL}/?jury`)
  await p.waitForSelector('text=Для жюри')
  await wait(1000)
  await p.evaluate(() => document.getElementById('__cursor')?.remove())
  const r = await record(p, 'phone', { w: 780, h: 1688, nth: 2 })
  await wait(1500)
  for (let k = 0; k < 6; k++) {
    await p.mouse.wheel(0, 160)
    await wait(350)
  }
  await wait(800)
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(1200)
  await p.locator('button', { hasText: 'Тара к запуску' }).first().tap()
  await p.waitForSelector('.g-dossier')
  r.mark('brief')
  await wait(3000)
  await p.getByRole('button', { name: 'Войти в переговорку', exact: true }).first().tap()
  r.mark('enter')
  await wait(14_000)
  r.mark('end')
  await dumpAudio(r)
  await r.stop()
}

try {
  mkdirSync(ROOT, { recursive: true })
  if (PART === 'hub') await partHub()
  else if (PART === 'tara') await partTara()
  else if (PART === 'board') await partBoard()
  else if (PART === 'setup') await partSetup()
  else if (PART === 'english' || PART === 'china') await partCase(PART)
  else if (PART === 'phone') await partPhone()
  else console.log('части: hub, tara, setup, english, china, phone')
} catch (e) {
  console.log('ОШИБКА', String(e).split('\n').slice(0, 4).join(' | '))
  process.exitCode = 1
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: join(ROOT, `error-${PART}-${Date.now()}.png`) }).catch(() => {})
} finally {
  await browser.close()
}
