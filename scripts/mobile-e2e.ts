/// <reference lib="dom" />
// Телефоны: вся игра на 390×844, 390×664 (iPhone 14 в Safari), 375×667, 360×800, 430×932 (+ встреча лёжа 844×390)
// и контрольный десктоп 1440×900.
// Встреча — текстом (прогоны Playwright) и голосом (?voiceonly, часть voice: панель микрофона и меню «Сделка»).
// На каждом экране проверяем: нет горизонтальной прокрутки, ничего не вылезает за край и не обрезано,
// кнопки не меньше 44 px и не перекрыты липкими панелями, текст не налезает друг на друга, читаемый текст не мельче 14 px.
// Встреча в 3D (с 18.10): субтитры собеседника не заходят на лицо, имя — над головой, панель внизу узкая.
// Снимки — в ~/Arena-materials/final/mobile-shots/<метка>/<браузер>-<вьюпорт>/.
//
// Запуск: SPEECH=off LLM_PROVIDER=offline npm run dev, потом
//   npx tsx scripts/mobile-e2e.ts [--url http://localhost:5173] [--tag after] [--vp 390,375,360,430,844,1440]
//                                 [--browsers chromium,webkit] [--only static,meeting,story,board]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit, type Browser, type BrowserType, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const TAG = arg('tag', 'after')
const ROOT = join(homedir(), 'Arena-materials', 'final', 'mobile-shots', TAG)
const ONLY = new Set(arg('only', 'static,meeting,voice,story,board').split(','))

interface Vp {
  id: string
  width: number
  height: number
  phone: boolean
}
const VPS: Vp[] = [
  { id: '390', width: 390, height: 844, phone: true },
  { id: '664', width: 390, height: 664, phone: true },
  { id: '375', width: 375, height: 667, phone: true },
  { id: '360', width: 360, height: 800, phone: true },
  { id: '430', width: 430, height: 932, phone: true },
  { id: '844', width: 844, height: 390, phone: true },
  { id: '1440', width: 1440, height: 900, phone: false },
]
const vpIds = arg('vp', '390,664,375,360,430,844,1440').split(',')
const BROWSERS: Record<string, BrowserType> = { chromium, webkit }
const browserIds = arg('browsers', 'chromium').split(',')

const problems: string[] = []
/** первая строка ошибки и какой локатор ждали */
const why = (e: unknown) => {
  const t = String(e).split('\n')
  return [t[0], t.find((l) => /waiting for/.test(l))?.trim()].filter(Boolean).join(' · ')
}
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}

// ——— проверка экрана ———

interface Finding {
  kind: 'hscroll' | 'overflow' | 'tap' | 'covered' | 'overlap' | 'font' | 'clip' | 'zoom'
  what: string
}

/** Всё считается в браузере: элементы, их рамки и стили. */
function auditPage(opts: { phone: boolean; scope?: string }): Finding[] {
  const out: Finding[] = []
  // на телефоне слишком широкая страница раздувает раскладку (innerWidth растёт) — меряем по экрану
  const W = document.documentElement.clientWidth
  const H = document.documentElement.clientHeight
  const root = (opts.scope ? document.querySelector(opts.scope) : document.body) ?? document.body
  const label = (el: Element) => {
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    const txt = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` «${txt}»` : ''}`
  }
  const shown = (el: Element) => {
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') return false
    // содержимое свёрнутого <details> в Chromium сохраняет рамки, но не видно
    const fold = el.closest('details:not([open])')
    if (fold && !el.closest('summary')) return false
    for (let p: Element | null = el; p; p = p.parentElement) {
      const ps = getComputedStyle(p)
      if (Number(ps.opacity) < 0.05) return false
      if (p.getAttribute('aria-hidden') === 'true' || (p as HTMLElement).inert) return false
    }
    const r = el.getBoundingClientRect()
    if (r.width <= 1.5 || r.height <= 1.5) return false // «только для чтения с экрана»
    // бумаги 3D-встречи на столе — часть сцены под панелями; проверяем только лист в руках
    const paper = el.closest('.w3-css')
    if (paper && !el.closest('.w3-paper.is-held')) return false
    return true
  }
  /** видимая часть рамки: режем по предкам, которые прокручивают или обрезают */
  const seen = (el: Element) => {
    let r = el.getBoundingClientRect()
    let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom]
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      r = p.getBoundingClientRect()
      ;[l, t, rt, b] = [Math.max(l, r.left), Math.max(t, r.top), Math.min(rt, r.right), Math.min(b, r.bottom)]
    }
    return new DOMRect(l, t, Math.max(0, rt - l), Math.max(0, b - t))
  }
  /** ближайший предок, который сам режет или прокручивает по горизонтали */
  const clipper = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.contain.includes('paint')) return p
    }
    return null
  }
  const ownText = (el: Element) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1)

  const win = window as unknown as { __wide?: number }
  const sw = Math.max(document.documentElement.scrollWidth - W, innerWidth - W, win.__wide ?? 0)
  win.__wide = 0
  if (sw > 1) out.push({ kind: 'hscroll', what: `страница шире экрана на ${sw}px` })
  /** лежит в липкой или фиксированной панели — налезать на прокручиваемый текст ей можно */
  const pinned = (el: Element) => {
    for (let p: Element | null = el; p; p = p.parentElement) {
      const pos = getComputedStyle(p).position
      if (pos === 'fixed' || pos === 'sticky') return p
    }
    return null
  }

  // печать «По рукам» ставят поверх текста нарочно
  const all = Array.from(root.querySelectorAll('*')).filter((el) => !el.closest('svg, canvas, .w3-slip-stamp, .g-stamp, .px-stamp'))
  const vis = all.filter(shown)
  const texts: { el: Element; r: DOMRect }[] = []

  for (const el of vis) {
    const r = el.getBoundingClientRect()
    const c = clipper(el)
    // вылезает за край экрана, и никакой предок его не прокручивает
    if ((r.right > W + 1.5 || r.left < -1.5) && ownText(el)) {
      if (!c) out.push({ kind: 'overflow', what: `${label(el)} за краем: ${Math.round(r.left)}…${Math.round(r.right)}` })
      else {
        const cs = getComputedStyle(c)
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
          const cr = c.getBoundingClientRect()
          if (r.right > cr.right + 1.5 || r.left < cr.left - 1.5) out.push({ kind: 'clip', what: `${label(el)} обрезан в ${label(c).slice(0, 30)}` })
        }
      }
    }
    if (ownText(el)) {
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (opts.phone && fs < 14) out.push({ kind: 'font', what: `${label(el)} ${fs}px` })
      // текст режется многоточием или выходит за свою рамку
      const he = el as HTMLElement
      const s = getComputedStyle(el)
      if (s.overflowX !== 'visible' && he.scrollWidth > he.clientWidth + 2 && s.textOverflow !== 'ellipsis' && !['auto', 'scroll'].includes(s.overflowX))
        out.push({ kind: 'clip', what: `${label(el)} текст шире рамки (${he.scrollWidth}>${he.clientWidth})` })
      const v = seen(el)
      if (v.width > 1 && v.height > 1) texts.push({ el, r: v })
    }
  }

  // налезания: два текстовых элемента без родства пересекаются заметной площадью
  const inView = texts.filter(({ r }) => r.bottom > 0 && r.top < H * 3)
  for (let i = 0; i < inView.length; i++)
    for (let j = i + 1; j < inView.length; j++) {
      const a = inView[i]
      const b = inView[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      if (pinned(a.el) !== pinned(b.el)) continue
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (x > 4 && y > 4) {
        // строчные элементы, перенесённые на две строки, — это несколько рамок, а не один прямоугольник
        const boxes = (el: Element) => Array.from(el.getClientRects())
        const hit = boxes(a.el).some((ra) =>
          boxes(b.el).some((rb) => {
            const bx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
            const by = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
            return bx > 4 && by > 4 && (bx * by) / Math.min(ra.width * ra.height, rb.width * rb.height) > 0.15
          }),
        )
        if (hit) out.push({ kind: 'overlap', what: `${label(a.el)} ⨯ ${label(b.el)} @${Math.round(a.r.left)},${Math.round(a.r.top + scrollY)}` })
      }
    }

  // кнопки: размер и доступность пальцу
  const taps = vis.filter((el) =>
    el.matches('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea, summary, [role=button], [role=tab], label:has(> input[type=checkbox])'),
  )
  for (const el of taps) {
    if ((el as HTMLButtonElement).disabled) continue
    // спрятанное до поры (pointer-events: none) пальцем и не нажать
    if (getComputedStyle(el).pointerEvents === 'none') continue
    const r = el.getBoundingClientRect()
    // iOS приближает страницу, когда фокус попадает в поле со шрифтом мельче 16 px
    if (opts.phone && el.matches('input, textarea, select') && parseFloat(getComputedStyle(el).fontSize) < 16)
      out.push({ kind: 'zoom', what: `${label(el)} шрифт ${getComputedStyle(el).fontSize} — iOS приблизит при вводе` })
    // ссылка внутри абзаца — не кнопка
    if (el.matches('a') && getComputedStyle(el).display === 'inline' && el.parentElement?.closest('p, li, dd, small')) continue
    // невидимая площадка ::before вокруг мелкой кнопки тоже считается
    const pb = getComputedStyle(el, '::before')
    const padW = pb.content !== 'none' && pb.position === 'absolute' ? parseFloat(pb.width) || 0 : 0
    const padH = pb.content !== 'none' && pb.position === 'absolute' ? parseFloat(pb.height) || 0 : 0
    if (opts.phone && (Math.max(r.height, padH) < 43.5 || Math.max(r.width, padW) < 43.5)) out.push({ kind: 'tap', what: `${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}` })
    // перекрыт: в центре кнопки лежит чужой элемент (только то, что сейчас на экране)
    // видимая часть: кнопка, наполовину уехавшая в прокрутке листа, перекрытой не считается
    const v = seen(el)
    if (v.width * v.height > 0.6 * r.width * r.height && v.top >= 0 && v.bottom <= H && v.left >= 0 && v.right <= W) {
      const hit = document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2)
      // под липкой панелью кнопка может лежать, пока страницу ещё можно докрутить
      const more = scrollY + H < document.documentElement.scrollHeight - 2
      const underBar = hit && pinned(hit) && !pinned(el) && more
      if (hit && !underBar && !el.contains(hit) && !hit.contains(el) && !(el as HTMLElement).closest('label')?.contains(hit))
        out.push({ kind: 'covered', what: `${label(el)} перекрыт ${label(hit)}` })
    }
  }
  return out
}

/** Пройти страницу сверху вниз: проверка на каждом экране прокрутки, чтобы поймать перекрытия липкими панелями. */
async function audit(page: Page, vp: Vp, where: string, scope?: string) {
  const seen = new Set<string>()
  const y0 = await page.evaluate(() => scrollY)
  const scrollH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  const steps = Math.min(8, Math.ceil(scrollH / vp.height))
  for (let s = 0; s < steps; s++) {
    await page.evaluate((y) => window.scrollTo(0, y), s * vp.height * 0.85)
    await page.waitForTimeout(120)
    for (const f of await page.evaluate(auditPage, { phone: vp.phone, scope })) {
      const key = `${f.kind}:${f.what}`
      if (seen.has(key)) continue
      seen.add(key)
      if (f.kind === 'font' || f.kind === 'tap') report.push(`${where} ${f.kind}: ${f.what}`)
      else fail(`${where} ${f.kind}: ${f.what}`)
    }
  }
  await page.evaluate((y) => window.scrollTo(0, y), y0)
}
/** Мелкое (шрифт, тап-зоны) — отдельным списком: часть — осознанные подписи. */
const report: string[] = []

// ——— прогон ———

async function context(browser: Browser, vp: Vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.phone ? 3 : 1,
    isMobile: vp.phone,
    hasTouch: vp.phone,
    userAgent: vp.phone
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      : undefined,
  })
  // программный рендер в прогоне — fps ничего не говорит о живом телефоне: проверку «не тянет 3D» отключаем.
  // Кадры при этом идут: субтитры, имя над головой и наставник расставляются, как на живом телефоне
  await ctx.addInitScript({
    content: `setInterval(() => { const w = window.__world; if (w && !w.__pinned) { Object.defineProperty(w, 'fps', { get: () => 60, set: () => {} }); w.__pinned = true } }, 100)`,
  })
  // tsx заворачивает функции в __name — в браузере его нет
  await ctx.addInitScript({ content: 'window.__name = (f) => f' })
  // ширину страницы ловим и между проверками: анимации (печати, «удары») раздувают её на мгновение,
  // а телефон после этого так и остаётся отдалённым
  await ctx.addInitScript({
    content: `window.__wide = 0; setInterval(() => { const d = document.documentElement; if (!d) return;
      const w = Math.max(d.scrollWidth, innerWidth) - d.clientWidth; if (w > window.__wide) window.__wide = w }, 50)`,
  })
  return ctx
}

/** Снимок экрана; перед ним — проверка (снимок целиком сбрасывает раздутую ширину, поэтому сначала проверяем). */
function shooter(page: Page, dir: string, where: string, vp?: Vp) {
  mkdirSync(dir, { recursive: true })
  return async (name: string, full = false) => {
    if (vp) await audit(page, vp, `${where} ${name}`)
    const opts = { path: join(dir, `${name}.png`), fullPage: full, scale: full ? ('css' as const) : ('device' as const) }
    // длинная страница иногда не снимается с первого раза («waiting for fonts») — пробуем ещё раз
    await page.screenshot(opts).catch(() => page.waitForTimeout(500).then(() => page.screenshot(opts)))
    // снимок целиком в Chromium сбрасывает эмуляцию касаний: (pointer: coarse) перестаёт совпадать — включаем обратно
    if (full && vp?.phone && page.context().browser()?.browserType().name() === 'chromium') {
      // сессию не закрываем: с ней уходит и сама эмуляция
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    console.log('  снимок', `${where}/${name}`)
  }
}

async function fresh(page: Page, path: string) {
  await page.goto(`${URL}/`)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(`${URL}${path}`)
  await page.waitForTimeout(700)
}

async function staticScreens(page: Page, vp: Vp, dir: string, tag: string) {
  const shot = shooter(page, dir, tag, vp)
  const step = async (name: string, go: () => Promise<unknown>, full = true) => {
    try {
      await go()
      await page.waitForTimeout(500)
      await shot(name, full)
    } catch (e) {
      fail(`${tag} ${name}: ${why(e)}`)
      await shooter(page, dir, tag)(`${name}-ошибка`).catch(() => {})
    }
  }
  await step('01-титул', () => fresh(page, '/'), false)
  await step('02-жюри', () => fresh(page, '/?jury'))
  await step('03-свое-дело', async () => {
    await fresh(page, '/?jury')
    await page.getByRole('button', { name: /Настроить/ }).first().click()
    await page.waitForSelector('form')
  })
  await step('04-папка-дел', async () => {
    await page.getByRole('button', { name: 'Отмена' }).click().catch(() => {})
    await page.waitForTimeout(300)
  })
  await step('05-бриф', async () => {
    await fresh(page, '/?jury')
    await page.locator('.jr-case').first().click()
    await page.waitForSelector('.g-dossier')
  })
  await step('06-разбор-демо', async () => {
    await fresh(page, '/?jury')
    await page.getByRole('button', { name: /Разбор/ }).first().click()
    await page.waitForSelector('.g-main')
  })
  await step('07-разбор-подробно', async () => {
    await page.locator('.g-report-more > summary').click()
    await page.waitForTimeout(400)
  })
  await step('08-кабинет', async () => {
    await fresh(page, '/?jury')
    await page.getByRole('button', { name: 'Кабинет руководителя', exact: true }).click()
    await page.waitForSelector('.g-folders')
  })
  await step('08b-кабинет-ссылки', async () => {
    await page.locator('.g-folder').filter({ hasText: 'Тара' }).getByRole('button', { name: 'Дать команде' }).click()
    await page.getByLabel(/Как назвать тренировку/).fill('Отдел закупок')
    await page.getByRole('button', { name: 'Открыть тренировку' }).click()
    await page.waitForSelector('.g-linkfield')
  })
  await step('09-личное-дело', async () => {
    await fresh(page, '/?jury')
    await page.getByRole('button', { name: 'Личное дело', exact: true }).click()
    await page.waitForTimeout(500)
  })
  await step('10-карта-недели', async () => {
    await fresh(page, '/?jury')
    await page.getByRole('button', { name: 'Карта недели' }).first().click()
    await page.waitForSelector('.mp-map')
  })
  await step('11-катсцены', async () => {
    await fresh(page, '/')
    await page.locator('.tt-corner').getByRole('button', { name: 'Катсцены' }).click()
    await page.waitForTimeout(800)
  })
  await step('12-катсцена-пролог', async () => {
    await fresh(page, '/?cutscene=prologue&t=6')
    await page.waitForTimeout(1500)
  }, false)
}

// ——— встреча ———

async function waitReply(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled') || document.querySelector('.w3-end'), undefined, {
    timeout: 120_000,
  })
  await page.waitForTimeout(300)
  const box = page.locator('.w3-them .px-dialog-box')
  if (await box.isVisible()) await box.click()
  await page.waitForTimeout(700)
}
async function say(page: Page, text: string) {
  await page.locator('.w3-say textarea').fill(text)
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await waitReply(page)
}
async function paperPoint(page: Page, id: string) {
  return page.evaluate((id) => {
    const w = (window as unknown as { __world: { pick: (x: number, y: number) => string | null } }).__world
    for (let y = 40; y < innerHeight - 60; y += 8) for (let x = 16; x < innerWidth - 16; x += 8) if (w.pick(x, y) === id) return { x, y }
    return null
  }, id)
}
async function lookDesk(page: Page) {
  const btn = page.locator('.w3-look')
  const t = await btn.innerText()
  if (t.includes('Стол') || t.includes('предложение')) await btn.click()
  await page.waitForTimeout(1400)
}
async function lookFace(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const btn = page.locator('.w3-look')
  const label = async () => (await btn.getAttribute('aria-label').catch(() => '')) ?? ''
  // лист в руках — сначала на стол, потом глаза на собеседника
  if (/Положить/.test(await label())) {
    await btn.click()
    await page.waitForTimeout(300)
  }
  if (/Поднять глаза/.test(await label())) await btn.click()
  else await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(1200)
}
async function hold(page: Page, id: string, phone: boolean) {
  if (!phone) return
  if (await page.locator(`.w3-paper--${id === 'notebook' ? 'notebook' : 'slip'}`).isVisible().catch(() => false)) return
  const p = await paperPoint(page, id)
  if (!p) return fail(`не нашли лист ${id} на столе`)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(1100)
}

/** Субтитры не заходят на лицо собеседника, имя висит над головой, панель внизу не выше 72 px. */
async function sceneCheck(page: Page, vp: Vp, tag: string) {
  const r = await page.evaluate(() => {
    type V = { x: number; y: number; z: number; set: (x: number, y: number, z: number) => V }
    const vec = (): V => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this } })
    const w = (window as unknown as { __world?: { head: { pose: string }; company?: { lead?: { anchor: (k: string, v: V) => V } }; project: (v: V, o: { x: number; y: number; behind: boolean }) => unknown } }).__world
    const lead = w?.company?.lead
    if (!w || !lead || w.head.pose !== 'face') return null
    const at = (k: string) => {
      const o = { x: 0, y: 0, behind: false }
      w.project(lead.anchor(k, vec()), o)
      return o
    }
    const box = (s: string) => {
      const e = document.querySelector(s)
      if (!e || getComputedStyle(e).opacity === '0' || e.classList.contains('is-hidden')) return null
      const b = e.getBoundingClientRect()
      return b.width ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height } : null
    }
    return { head: at('head'), chin: at('chin'), them: box('.w3-them'), name: box('.w3-name'), bar: box('.w3-bar') }
  })
  if (!r) return
  if (r.them && !r.chin.behind && r.them.top < r.chin.y - 2) fail(`${tag}: субтитры заходят на лицо (верх ${Math.round(r.them.top)} < подбородок ${Math.round(r.chin.y)})`)
  if (r.name && r.name.bottom > r.head.y + r.name.height + 2) fail(`${tag}: имя ниже макушки собеседника`)
  if (vp.phone && r.bar && r.bar.height > 72) fail(`${tag}: панель внизу высотой ${Math.round(r.bar.height)} px`)
}

/** «Сделка» → «Согласиться», если собеседник положил условия; иначе меню закрываем. */
async function acceptByDeal(page: Page) {
  await page.locator('.w3-deal-btn').click()
  await page.waitForTimeout(200)
  const item = page.getByRole('menuitem', { name: /Согласиться/ })
  if (!(await item.isVisible().catch(() => false)) || (await item.isDisabled())) {
    await page.locator('.w3-deal-btn').click()
    return false
  }
  await item.click()
  const sure = page.getByRole('menuitem', { name: /Всё равно согласиться/ })
  await page.waitForTimeout(200)
  if (await sure.isVisible().catch(() => false)) await sure.click()
  await waitReply(page)
  return true
}

async function meeting(page: Page, vp: Vp, tag: string, shot: (n: string, full?: boolean) => Promise<void>, lines: string[], dir: string) {
  await page.waitForSelector('.w3-canvas', { timeout: 40_000 })
  await page.waitForTimeout(2500)
  await sceneCheck(page, vp, `${tag} m1`)
  await shot('m1-вход')
  // клавиатура: поле ввода в фокусе, видимая область сжата
  await page.locator('.w3-say textarea').focus()
  if (vp.phone) {
    // экранной клавиатуры в эмуляции нет: подставляем её высоту так же, как это делает visualViewport
    const kb = Math.round(vp.height * (vp.width > vp.height ? 0.55 : 0.4))
    await page.evaluate((kb) => {
      const play = document.querySelector('.w3-play') as HTMLElement | null
      play?.style.setProperty('--kb', `${kb}px`)
      play?.setAttribute('data-kb', '')
    }, kb)
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)?.getBoundingClientRect()
      return { field: box('.w3-say textarea'), send: box('.w3-say .w3-send'), them: box('.w3-them') }
    })
    const top = vp.height - kb
    if (!r.field || r.field.bottom > top + 1) fail(`${tag} m2: поле ввода под клавиатурой`)
    if (!r.send || r.send.bottom > top + 1) fail(`${tag} m2: «Сказать» под клавиатурой`)
    if (r.them && r.field && r.them.bottom > r.field.top + 1 && r.them.top < r.field.bottom) fail(`${tag} m2: реплика собеседника под полем ввода`)
  }
  await shot('m2-ввод')
  await page.evaluate(() => {
    const play = document.querySelector('.w3-play') as HTMLElement | null
    play?.style.setProperty('--kb', '0px')
    play?.removeAttribute('data-kb')
  })
  await lookFace(page)
  await say(page, lines[0])
  await sceneCheck(page, vp, `${tag} m3`)
  await shot('m3-ответ')
  // «Сделка»: меню над панелью — предложить, согласиться, уйти
  await page.locator('.w3-deal-btn').click()
  await page.waitForTimeout(300)
  const items = await page.getByRole('menuitem').count()
  if (items < 2) fail(`${tag}: в меню «Сделка» ${items} пунктов`)
  // меню поверх сцены нарочно — снимок без проверки налезаний
  await page.screenshot({ path: join(dir, 'm3b-сделка.png') })
  await page.locator('.w3-deal-btn').click()
  await lookDesk(page)
  await shot('m4-стол')
  await hold(page, 'notebook', vp.phone)
  await shot('m5-блокнот')
  await page.locator('.w3-paper--notebook').getByRole('button', { name: /Предложить|Положить на стол/ }).click()
  await page.waitForTimeout(300)
  const sure = page.locator('.w3-paper--notebook').getByRole('button', { name: /Всё равно (положить|предложить)/ })
  if (await sure.isVisible().catch(() => false)) await sure.click()
  await waitReply(page)
  await shot('m6-ответ-на-предложение')
  for (let k = 0; k < 6; k++) {
    if (await page.locator('.w3-end').isVisible()) break
    // листок собеседника — в руки (телефон) для снимка, согласие — из «Сделки»
    if (k === 0 && vp.phone && (await page.locator('.w3-paper--slip button').count()) > 0) {
      await lookDesk(page)
      if (/На стол/.test(await page.locator('.w3-look').innerText())) await page.locator('.w3-look').click()
      await page.waitForTimeout(600)
      await hold(page, 'slip', vp.phone)
      await shot('m7-листок')
      await lookFace(page)
    }
    if (await acceptByDeal(page)) break
    await lookFace(page)
    await say(page, lines[1 + (k % (lines.length - 1))])
  }
  await page.waitForTimeout(900)
  if (!(await page.locator('.w3-end').isVisible())) fail(`${tag}: встреча не закончилась`)
  await shot('m8-конец')
}

const TARA = [
  'Добрый день, Марат. Прежде чем говорить о цене, скажите: что для вас в этом договоре главное и почему?',
  'Если вы берёте на себя срочные допоставки за 48 часов, то мы готовы платить по факту отгрузки. Для нас главное — чтобы конвейер не встал.',
  'Давайте посмотрим целиком: что вы готовы положить на стол по всем пунктам?',
]

async function meetingRun(page: Page, vp: Vp, dir: string, tag: string) {
  const shot = shooter(page, dir, tag, vp)
  try {
    await fresh(page, '/?jury&view=3d')
    await page.locator('.jr-case').filter({ hasText: /Тара/ }).click()
    await page.waitForSelector('.g-dossier')
    await page.getByRole('button', { name: /^(Войти|Начать разговор)/ }).filter({ visible: true }).last().click()
    await meeting(page, vp, tag, shot, TARA, dir)
    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    await page.waitForSelector('.g-main')
    await page.waitForTimeout(800)
    await shot('m9-разбор', true)
  } catch (e) {
    fail(`${tag} встреча: ${why(e)}`)
    await shooter(page, dir, tag)('m-ошибка').catch(() => {})
  }
  // классический вид — то же дело
  try {
    await fresh(page, '/?jury&view=classic')
    await page.locator('.jr-case').filter({ hasText: /Тара/ }).click()
    await page.getByRole('button', { name: /^(Войти|Начать разговор)/ }).filter({ visible: true }).last().click()
    await page.waitForSelector('textarea')
    await page.waitForTimeout(800)
    await shot('c1-классика')
    await page.locator('textarea').fill(TARA[0])
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('textarea')?.hasAttribute('disabled'), undefined, { timeout: 60_000 })
    await page.waitForTimeout(800)
    await shot('c2-классика-ход', true)
  } catch (e) {
    fail(`${tag} классика: ${why(e)}`)
    await shooter(page, dir, tag)('c-ошибка').catch(() => {})
  }
}

// ——— голосовой режим (основной): поле ввода нет, панель микрофона ———

async function voiceRun(page: Page, vp: Vp, dir: string, tag: string) {
  const shot = shooter(page, dir, tag, vp)
  // офлайн-сервер без ключей распознавания: говорим игре, что оно есть; гудки фейкового микрофона — «не расслышал»
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, mode: 'offline', provider: 'offline', model: 'rules', scenarios: 7, speech: { tts: false, stt: true } } }))
  await page.route('**/api/stt', (r) => r.fulfill({ json: { text: '' } }))
  for (const view of ['3d', 'classic'] as const) {
    try {
      await fresh(page, `/?case=tara&view=${view}&voiceonly`)
      await page.getByRole('button', { name: 'К делу' }).click()
      await page.getByRole('button', { name: /^(Войти|Начать разговор)/ }).filter({ visible: true }).last().click()
      await page.waitForSelector(view === '3d' ? '.w3-bar[data-voice]' : '.g-voiceonly', { timeout: 40_000 })
      await page.waitForTimeout(2500)
      if ((await page.locator('textarea:visible').count()) > 0) fail(`${tag} голос ${view}: есть поле ввода`)
      if (view === '3d') await sceneCheck(page, vp, `${tag} голос`)
      await shot(`v-${view}-голос`)
      // меню встречи: «голосом / текстом» и пауза
      if (view === '3d') {
        await page.locator('.w3-menu-btn').click()
        await page.waitForTimeout(300)
        // модальное меню перекрывает встречу нарочно — снимок без проверки налезаний
        await page.screenshot({ path: join(dir, 'v-3d-меню.png') })
        await page.getByRole('button', { name: /Вернуться за стол/ }).click()
        // «Написать» поверх сцены: поле открывается, крестик возвращает голос
        await page.getByRole('button', { name: 'Написать' }).click()
        await page.waitForTimeout(300)
        if (!(await page.locator('#px-speech').isVisible())) fail(`${tag} голос 3d: «Написать» не открыло поле`)
        await shot('v-3d-написать')
        await page.getByRole('button', { name: /Закрыть поле/ }).click()
        await page.waitForSelector('.w3-bar[data-voice]', { timeout: 5000 }).catch(() => fail(`${tag} голос 3d: крестик не вернул голос`))
      }
    } catch (e) {
      fail(`${tag} голос ${view}: ${why(e)}`)
      await shooter(page, dir, tag)(`v-${view}-ошибка`).catch(() => {})
    }
  }
}

// ——— сюжет с катсценами ———

async function storyRun(page: Page, vp: Vp, dir: string, tag: string) {
  const shot = shooter(page, dir, tag, vp)
  try {
    await fresh(page, '/?cutscenes=1&view=3d')
    await page.getByRole('button', { name: /Сюжет/ }).first().click()
    await page.waitForSelector('.cs-root', { timeout: 15_000 })
    await page.waitForTimeout(2500)
    await shot('s1-пролог')
    // пропуск катсцены — доступен пальцу
    const skip = page.getByRole('button', { name: /Пропустить|Дальше/ }).first()
    for (let k = 0; k < 30 && (await page.locator('.cs-root').isVisible().catch(() => false)); k++) {
      if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {})
      else await page.locator('.cs-root').click().catch(() => {})
      await page.waitForTimeout(400)
    }
    await page.waitForSelector('.g-dossier', { timeout: 20_000 })
    await page.waitForTimeout(500)
    await shot('s2-бриф-главы', true)
  } catch (e) {
    fail(`${tag} сюжет: ${why(e)}`)
    await shooter(page, dir, tag)('s-ошибка').catch(() => {})
  }
}

// ——— кабинет, доска, «Играют сейчас», карточка, согласие ———

async function boardRun(page: Page, vp: Vp, dir: string, tag: string) {
  const shot = shooter(page, dir, tag, vp)
  try {
    const room = (await (await fetch(`${URL}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'tara', name: 'Отдел закупок' }) })).json()) as {
      id: string
      key: string
    }
    // двое уже сыграли (через участника в браузере — нужен его clientId для согласия), один играет сейчас
    const player = await context(page.context().browser()!, vp)
    const pp = await player.newPage()
    await pp.goto(`${URL}/?case=tara&room=${room.id}&view=3d`)
    await pp.waitForSelector('.tt-name input')
    await pp.locator('.tt-name input').fill('Боря')
    await shooter(pp, dir, tag, vp)('b0-приглашение')
    await pp.getByRole('button', { name: /К делу/ }).click()
    await pp.waitForSelector('.g-dossier')
    await pp.getByRole('button', { name: /^(Войти|Начать разговор)/ }).filter({ visible: true }).last().click()
    await pp.waitForSelector('.w3-canvas', { timeout: 40_000 })
    await pp.waitForTimeout(2000)
    await say(pp, TARA[0])
    // доска, пока Боря за столом
    await fresh(page, `/?board=${room.id}&key=${room.key}`)
    await page.waitForSelector('.g-board .g-sheet-title')
    await page.waitForTimeout(1500)
    await shot('b1-доска-играют', true)
    // Боря доигрывает
    const pshot = shooter(pp, dir, tag, vp)
    const silent = async () => {}
    await lookDesk(pp)
    await hold(pp, 'notebook', vp.phone)
    await pp.locator('.w3-paper--notebook').getByRole('button', { name: /Предложить|Положить на стол/ }).click()
    await pp.waitForTimeout(300)
    const sure = pp.locator('.w3-paper--notebook').getByRole('button', { name: /Всё равно (положить|предложить)/ })
    if (await sure.isVisible().catch(() => false)) await sure.click()
    await waitReply(pp)
    for (let k = 0; k < 8 && !(await pp.locator('.w3-end').isVisible()); k++) {
      await lookFace(pp)
      if (await acceptByDeal(pp)) break
      await say(pp, TARA[1 + (k % 2)])
    }
    void silent
    await pp.getByRole('button', { name: 'Разбор встречи' }).click()
    await pp.waitForSelector('.g-receipt:not(:has-text("Записываем"))', { timeout: 20_000 })
    // руководитель: доска с итогом, карточка, запрос переписки
    await page.reload()
    await page.waitForSelector('.g-board .g-sheet-title')
    await page.waitForTimeout(1200)
    await shot('b2-доска-итоги', true)
    await page.locator('.g-roll-open').filter({ hasText: 'Боря' }).click()
    await page.waitForTimeout(800)
    await page.locator('.g-roll-card').scrollIntoViewIfNeeded()
    await shot('b3-карточка')
    const ask = page.getByRole('button', { name: /Попросить доступ к переписке/ })
    if (await ask.isVisible().catch(() => false)) {
      await ask.click()
      await page.waitForTimeout(600)
    } else fail(`${tag}: в карточке нет запроса переписки`)
    // участник видит запрос на своём разборе
    await pp.waitForSelector('text=Руководитель просит посмотреть', { timeout: 30_000 })
    await pp.locator('text=Руководитель просит посмотреть').scrollIntoViewIfNeeded()
    await pshot('b4-запрос-согласия')
    await pp.getByRole('button', { name: /Разрешить|Открыть/ }).first().click()
    await pp.waitForTimeout(800)
    await page.waitForTimeout(6000)
    await page.locator('.g-roll-card').scrollIntoViewIfNeeded().catch(() => {})
    await shot('b5-карточка-переписка')
    await player.close()
  } catch (e) {
    fail(`${tag} доска: ${why(e)}`)
    await shooter(page, dir, tag)('b-ошибка').catch(() => {})
  }
}

/** Один вьюпорт: каждая часть — в своём браузере (программный WebGL за долгий прогон выдыхается). */
async function runVp(bid: string, vp: Vp) {
  const bt = BROWSERS[bid]
  const tag = `${bid}-${vp.id}`
  const dir = join(ROOT, tag)
  console.log(`\n${tag} (${vp.width}×${vp.height})`)
  // лёжа проверяем встречу и катсцену — остальное на телефоне читают стоя
  const landscape = vp.width > vp.height && vp.phone
  const parts: [string, (page: Page) => Promise<void>][] = [
    ['static', (page) => staticScreens(page, vp, dir, tag)],
    ['meeting', (page) => meetingRun(page, vp, dir, tag)],
    ['voice', (page) => voiceRun(page, vp, dir, tag)],
    ['story', (page) => storyRun(page, vp, dir, tag)],
    ['board', (page) => boardRun(page, vp, dir, tag)],
  ]
  for (const [part, run] of parts) {
    if (!ONLY.has(part) || (landscape && (part === 'static' || part === 'board'))) continue
    const b = await bt.launch(bt === chromium ? { args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } : {})
    const ctx = await context(b, vp)
    if (part === 'voice' && bt === chromium) await ctx.grantPermissions(['microphone'], { origin: new globalThis.URL(URL).origin })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await run(page)
    if (errors.length) fail(`${tag} ${part}: ошибки страницы: ${errors.slice(0, 3).join(' | ')}`)
    await b.close()
  }
}

// вьюпорты гоняем по нескольку сразу: --jobs 2
const queue = browserIds.flatMap((bid) => VPS.filter((v) => vpIds.includes(v.id)).map((vp) => [bid, vp] as const))
const JOBS = Number(arg('jobs', '2'))
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await runVp(...next)
  }),
)

if (report.length) {
  console.log(`\nМелкое (шрифт < 14 px, кнопки < 44 px) — ${report.length}:`)
  for (const r of [...new Set(report.map((r) => r.replace(/^\S+ \S+ /, '')))].slice(0, 200)) console.log('  ', r)
}
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё чисто')
process.exit(problems.length ? 1 : 0)
