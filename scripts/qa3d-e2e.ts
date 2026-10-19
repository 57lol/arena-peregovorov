/// <reference lib="dom" />
// Обход всех 3D-встреч: каждое дело и глава на телефоне и ноутбуке — вход, осмотр по сторонам, стол, реплика, уход собеседника.
// Проверяет: собеседник в кадре, облачко реплики на экране и над панелью, листы на столе кликаются, нет ошибок консоли и WebGL,
// слабое устройство уводит в 2D, heap не растёт от пяти встреч подряд.
// Запуск: npm run dev:offline, потом npx tsx scripts/qa3d-e2e.ts [--cases dorm,tara] [--vp 390,1440] [--out каталог] [--no-heap]
// Снимки — ~/Arena-materials/shots/qa3d/<дело>-<вьюпорт>-<ракурс>.png

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const OUT = arg('out', join(homedir(), 'Arena-materials', 'shots', 'qa3d'))
mkdirSync(OUT, { recursive: true })
const CASES = arg('cases', 'dorm,stop,shop,launch,tara,offer,client,istanbul,lagos,china,tara-hard,client-hard').split(',')
const VPS = arg('vp', '390,1440').split(',')
const SIZE: Record<string, { width: number; height: number }> = { '390': { width: 390, height: 844 }, '1440': { width: 1440, height: 900 } }
const ARGS = ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc']

const problems: string[] = []
const fail = (tag: string, m: string) => {
  problems.push(`${tag}: ${m}`)
  console.log('  ПРОБЛЕМА:', m)
}

/** надпись на папке дела — для повторного входа без перезагрузки */
const FOLDER: Record<string, string> = { tara: 'Тара', client: 'клиента', offer: 'Оффер' }

type W = {
  cw: number
  ch: number
  portrait: boolean
  call: boolean
  fps: number
  head: { pose: string }
  company: { lead: { anchor: (k: string) => unknown; leaving: boolean; exited: boolean; tracking: boolean } } | null
  project: (v: unknown) => { x: number; y: number; behind: boolean }
  pick: (x: number, y: number) => string | null
}

// waitForSelector и waitForFunction с объектом в ответе держат handle в DevTools — для замера heap это утечка самого прогона:
// ждём через locator.waitFor и булевы условия
async function enter(page: Page, caseId: string, reload = true) {
  if (reload) {
    await page.goto(`${URL}/?case=${caseId}&view=3d`)
    const toCase = page.getByRole('button', { name: 'К делу' })
    if (await toCase.isVisible({ timeout: 3000 }).catch(() => false)) await toCase.click()
  } else await page.locator('.g-folder').filter({ hasText: FOLDER[caseId] }).getByRole('button', { name: 'Открыть дело' }).click()
  await page.locator('.g-dossier').waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: /^(Войти|Начать разговор)/ }).filter({ visible: true }).last().click()
  await page.waitForFunction(() => !!(window as unknown as { __world?: unknown }).__world, undefined, { timeout: 40_000 })
  // программный рендер медленный: сторож «не тянет 3D» здесь проверяем отдельно
  await page.evaluate(() => Object.defineProperty((window as unknown as { __world: object }).__world, 'fps', { get: () => 60, set: () => {} }))
}

/** Что видно на экране: голова собеседника, облачко, панель. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const w = (window as unknown as { __world: W }).__world
    const root = document.querySelector('.w3-stage')!.getBoundingClientRect()
    const lead = w.company?.lead
    const head = lead ? w.project(lead.anchor('head')) : null
    const h = head && { x: head.x, y: head.y, behind: head.behind }
    const chin = lead ? w.project(lead.anchor('chin')) : null
    const c = chin && { x: chin.x, y: chin.y }
    const box = document.querySelector('.w3-them .px-dialog-box') as HTMLElement | null
    const b = box?.getBoundingClientRect()
    const hidden = !box || box.closest('.is-hidden') !== null || !b?.width
    const tray = document.querySelector('.w3-tray')?.getBoundingClientRect()
    return {
      cw: w.cw,
      ch: w.ch,
      pose: w.head.pose,
      call: w.call,
      root: { l: root.left, t: root.top },
      head: h,
      chin: c,
      bubble: hidden ? null : { l: b!.left, t: b!.top, r: b!.right, b: b!.bottom, tail: box!.dataset.tail, off: box!.dataset.off },
      trayTop: tray?.top ?? innerHeight,
      vw: innerWidth,
      vh: innerHeight,
    }
  })
}

function checkFrame(tag: string, m: Awaited<ReturnType<typeof measure>>, what: string) {
  if (!m.head) return fail(tag, `${what}: собеседника нет`)
  if (!m.call && (m.head.behind || m.head.x < 0 || m.head.x > m.cw || m.head.y < 0 || (m.chin && m.chin.y > m.ch)))
    fail(tag, `${what}: голова собеседника вне кадра (${Math.round(m.head.x)},${Math.round(m.head.y)} при ${m.cw}×${m.ch})`)
  const b = m.bubble
  if (b) {
    if (b.l < -1 || b.r > m.vw + 1 || b.t < -1 || b.b > m.vh + 1) fail(tag, `${what}: облачко за экраном ${JSON.stringify(b)}`)
    if (b.b > m.trayTop + 1) fail(tag, `${what}: облачко заходит на панель (${Math.round(b.b)} > ${Math.round(m.trayTop)})`)
    // облачко над головой не должно закрывать лицо
    if (!m.call && b.tail === 'down' && m.chin && b.b > m.root.t + m.head.y + (m.chin.y - m.head.y) * 0.45)
      fail(tag, `${what}: облачко на лице`)
  }
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

async function settle(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('.px-dialog-more') || !!document.querySelector('.w3-end'), undefined, { timeout: 12_000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

async function newPage(b: Browser, vp: string) {
  const size = SIZE[vp]!
  const phone = size.width < 600
  const ctx = await b.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone })
  // tsx оборачивает функции в __name — в странице его нет
  await ctx.addInitScript({ content: 'window.__name = (f) => f' })
  const page = await ctx.newPage()
  const errs: string[] = []
  page.on('pageerror', (e) => errs.push(`pageerror ${String(e).slice(0, 300)}`))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' || (m.type() === 'warning' && /WebGL|GL_|THREE/i.test(t))) errs.push(`${m.type()} ${t.slice(0, 300)}`)
  })
  await page.goto(`${URL}/`)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ cases: {}, tutorialDone: true, endings: {}, runs: [] }))
  })
  return { page, errs, phone, ctx }
}

async function run(b: Browser, caseId: string, vp: string) {
  const tag = `${caseId}-${vp}`
  console.log(tag)
  const { page, errs, phone, ctx } = await newPage(b, vp)
  try {
    await enter(page, caseId)
    await page.waitForTimeout(3500)
    await shot(page, `${tag}-1-вход`)
    checkFrame(tag, await measure(page), 'вход')
    await settle(page)
    checkFrame(tag, await measure(page), 'реплика')
    await shot(page, `${tag}-2-реплика`)
    // осмотреться: стрелки влево и вправо (на телефоне — свайп)
    await blur(page)
    for (const [k, name] of [['ArrowLeft', 'влево'], ['ArrowRight', 'вправо']] as const) {
      if (phone) {
        const dx = k === 'ArrowLeft' ? 160 : -160
        const box = SIZE[vp]!
        await page.mouse.move(box.width / 2, box.height / 3)
        await page.mouse.down()
        await page.mouse.move(box.width / 2 + dx, box.height / 3, { steps: 8 })
        await page.mouse.up()
      } else {
        await page.keyboard.down(k)
        await page.waitForTimeout(900)
        await page.keyboard.up(k)
      }
      await page.waitForTimeout(900)
      await shot(page, `${tag}-3-осмотр-${name}`)
      const m = await measure(page)
      if (m.bubble && (m.bubble.l < -1 || m.bubble.r > m.vw + 1 || m.bubble.t < -1 || m.bubble.b > m.vh + 1)) fail(tag, `осмотр ${name}: облачко за экраном`)
    }
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(1200)
    // стол
    await page.locator('.w3-look').click()
    await page.waitForTimeout(1600)
    await shot(page, `${tag}-4-стол`)
    if (phone && (await page.locator('.w3-look').innerText()).includes('На стол')) {
      await page.locator('.w3-look').click()
      await page.waitForTimeout(1200)
    }
    const m4 = await measure(page)
    if (m4.pose !== 'desk') fail(tag, `кнопка «Стол» не опустила взгляд (${m4.pose})`)
    // ноутбук: склонились к столу — все кнопки на листах в кадре (на телефоне листы берут в руки)
    if (!phone) {
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll('.w3-paper button')]
          .filter((b) => {
            const r = b.getBoundingClientRect()
            return r.width && (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)
          })
          .map((b) => b.getAttribute('aria-label') || b.textContent?.trim()),
      )
      if (cut.length) fail(tag, `стол: кнопки на листах за краем экрана: ${cut.join(', ')}`)
    }
    if (m4.bubble) {
      if (m4.bubble.l < -1 || m4.bubble.r > m4.vw + 1 || m4.bubble.t < -1) fail(tag, 'стол: облачко за экраном')
    }
    // листы на столе кликаются
    for (const id of ['notebook', 'card', 'slip']) {
      const pt = await page.evaluate((id) => {
        const w = (window as unknown as { __world: W }).__world
        const r = document.querySelector('.w3-stage')!.getBoundingClientRect()
        for (let y = 40; y < w.ch - 40; y += 8) for (let x = 8; x < w.cw - 8; x += 8) if (w.pick(x, y) === id) {
          // точка не под кнопками интерфейса
          const el = document.elementFromPoint(x + r.left, y + r.top)
          if (el && !el.closest('.w3-ui, .w3-tray')) return { x: x + r.left, y: y + r.top }
        }
        return null
      }, id)
      if (!pt) {
        if (id !== 'slip') fail(tag, `лист ${id} не найти на столе`)
        continue
      }
      if (phone) {
        await page.mouse.click(pt.x, pt.y)
        await page.waitForTimeout(1300)
        const held = await page.locator('.w3-play').getAttribute('data-held')
        if (held !== id) fail(tag, `тап по листу ${id} не взял его в руки (держим «${held}»)`)
        await shot(page, `${tag}-5-в-руках-${id}`)
        await page.locator('.w3-look').click()
        await page.waitForTimeout(1200)
      } else if (id === 'notebook') {
        // на ноутбуке по листу ходит курсор: кнопки блокнота под пальцем
        const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.w3-paper'), pt)
        if (!hit) fail(tag, `под курсором на блокноте не лист (${pt.x},${pt.y})`)
      }
    }
    await page.keyboard.press('ArrowUp').catch(() => {})
    await blur(page)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(1300)
    // реплика игрока и ответ
    const btn = page.getByRole('button', { name: /^(Написать|Писать текстом)$/ }).first()
    if (await btn.isVisible().catch(() => false)) await btn.click()
    const field = page.locator('#px-speech, .w3-say textarea').first()
    await field.fill('Давайте спокойно: что для вас тут самое важное и почему? Мне правда интересно.')
    await field.press('Enter')
    await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled') || !!document.querySelector('.w3-end'), undefined, { timeout: 60_000 }).catch(() => {})
    await settle(page)
    await blur(page)
    await page.waitForTimeout(800)
    checkFrame(tag, await measure(page), 'ответ')
    await shot(page, `${tag}-6-ответ`)
    // уход собеседника (как если бы он встал из-за стола)
    if (!(await measure(page)).call) {
      await page.evaluate(() => {
        const w = (window as unknown as { __world: W }).__world
        w.company!.lead.leaving = true
      })
      await page.waitForTimeout(1500)
      await shot(page, `${tag}-7-уходит`)
      // облачко идёт за вставшим: рядом с его лицом (а не над пустым стулом) и не на лице
      let far = 0
      for (let k = 0; k < 8; k++) {
        const r = await page.evaluate(() => {
          const w = (window as unknown as { __world: W & { company: { lead: { exitAt: unknown; walking: boolean } } } }).__world
          const f = w.project(w.company.lead.exitAt)
          const root = document.querySelector('.w3-stage')!.getBoundingClientRect()
          const box = document.querySelector('.w3-them .px-dialog-box')
          if (!box || box.closest('.is-hidden') || f.behind || !w.company.lead.walking) return null
          const b = box.getBoundingClientRect()
          const x = f.x + root.left
          const y = f.y + root.top
          // голова в кадре, облачко не сбоку у края («повернитесь»)
          if (x < 0 || x > innerWidth || (box as HTMLElement).dataset.off) return null
          const dx = Math.max(b.left - x, 0, x - b.right)
          const dy = Math.max(b.top - y, 0, y - b.bottom)
          return { on: !dx && !dy, d: Math.hypot(dx, dy) }
        })
        if (r?.on) {
          fail(tag, 'уходит: облачко реплики закрывает лицо вставшего')
          break
        }
        if (r) far = Math.max(far, r.d)
        await page.waitForTimeout(400)
      }
      if (far > 160) fail(tag, `уходит: облачко отстало от лица вставшего на ${Math.round(far)} px`)
      await page.waitForFunction(() => (window as unknown as { __world: W }).__world.company!.lead.exited, undefined, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await shot(page, `${tag}-8-ушёл`)
      const gone = await page.evaluate(() => {
        const l = (window as unknown as { __world: W }).__world.company!.lead
        return { exited: l.exited, tracking: l.tracking }
      })
      if (!gone.exited) fail(tag, `собеседник не ушёл за 15 с (${JSON.stringify(gone)})`)
    }
  } catch (e) {
    fail(tag, `СБОЙ ${String(e).split('\n')[0]}`)
    await shot(page, `${tag}-сбой`).catch(() => {})
  } finally {
    for (const e of errs) fail(tag, e)
    await ctx.close()
  }
}

/** Шесть встреч подряд: вход, выход к папке — heap не должен расти. */
async function heap(b: Browser, vp: string) {
  const tag = `heap-${vp}`
  console.log(tag)
  const { page, errs, ctx } = await newPage(b, vp)
  const cdp = await ctx.newCDPSession(page)
  const used = async () => {
    await page.evaluate(() => (window as unknown as { gc?: () => void }).gc?.())
    await page.waitForTimeout(300)
    await page.evaluate(() => (window as unknown as { gc?: () => void }).gc?.())
    const { metrics } = await cdp.send('Performance.getMetrics')
    const g = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0
    return { heap: Math.round(g('JSHeapUsedSize') / 1e5) / 10, nodes: g('Nodes'), listeners: g('JSEventListeners') }
  }
  await cdp.send('Performance.enable')
  const rows: string[] = []
  try {
    // как игрок: встреча, «Выйти к папке дел», следующее дело — без перезагрузки страницы
    for (let i = 0; i < 6; i++) {
      await enter(page, ['tara', 'client', 'offer'][i % 3]!, i === 0)
      // слабая ссылка на мир: не держит его, но покажет, если мир пережил выход
      await page.evaluate(() => {
        const w = window as unknown as { __world: object; __worlds?: WeakRef<object>[] }
        ;(w.__worlds ??= []).push(new WeakRef(w.__world))
      })
      await page.waitForTimeout(2500)
      await page.getByRole('button', { name: 'Меню' }).click()
      await page.getByRole('button', { name: /Выйти к папке дел/ }).click()
      await page.getByRole('button', { name: /Точно\?/ }).click()
      await page.waitForTimeout(800)
      const u = await used()
      const gl = await page.evaluate(() => document.querySelectorAll('canvas').length)
      const alive = await page.evaluate(() => (window as unknown as { __worlds: WeakRef<object>[] }).__worlds.filter((r) => r.deref()).length)
      rows.push(`${i + 1}: heap ${u.heap} МБ, узлов ${u.nodes}, слушателей ${u.listeners}, canvas ${gl}, живых миров ${alive}`)
      console.log('  ', rows.at(-1))
      if (alive) fail(tag, `после выхода из встречи ${i + 1} в памяти остались миры: ${alive}`)
    }
    // первая встреча — прогрев (модули, текстуры в кэше); дальше рост — утечка
    const h = rows.map((r) => Number(/heap ([\d.]+)/.exec(r)![1]))
    if (h[5]! - h[1]! > 8) fail(tag, `heap растёт от встречи к встрече: ${h.join(' → ')} МБ`)
  } catch (e) {
    fail(tag, `СБОЙ ${String(e).split('\n')[0]}`)
  } finally {
    for (const e of errs) fail(tag, e)
    await ctx.close()
  }
}

/** Слабое устройство: fps низкий — сначала крупнее пиксель, потом 2D без ошибок. */
async function slow(b: Browser, vp: string) {
  const tag = `slow-${vp}`
  console.log(tag)
  const { page, errs, ctx } = await newPage(b, vp)
  try {
    await enter(page, 'tara')
    await page.waitForTimeout(1500)
    await page.evaluate(() => Object.defineProperty((window as unknown as { __world: object }).__world, 'fps', { get: () => 10, set: () => {} }))
    await page.waitForSelector('.w3-play', { state: 'detached', timeout: 15_000 })
    await page.waitForTimeout(1500)
    await shot(page, `${tag}-2d`)
    const ok = await page.evaluate(() => !document.querySelector('.w3-canvas') && !!document.querySelector('.px-root'))
    if (!ok) fail(tag, 'после низкого fps нет 2D-встречи')
  } catch (e) {
    fail(tag, `СБОЙ ${String(e).split('\n')[0]}`)
    await shot(page, `${tag}-сбой`).catch(() => {})
  } finally {
    for (const e of errs) fail(tag, e)
    await ctx.close()
  }
}

// CHROMIUM=/opt/pw-browsers/chromium — свой Chromium, если скачанный не той версии, что playwright
const b = await chromium.launch({ args: ARGS, executablePath: process.env.CHROMIUM || undefined })
try {
  for (const c of CASES) for (const vp of VPS) await run(b, c, vp)
  for (const vp of VPS) await slow(b, vp)
  if (!process.argv.includes('--no-heap')) for (const vp of VPS) await heap(b, vp)
} finally {
  await b.close()
}
console.log(problems.length ? `\nПроблем: ${problems.length}\n${problems.join('\n')}` : '\nПроблем нет')
console.log('снимки:', OUT)
process.exit(problems.length ? 1 : 0)
