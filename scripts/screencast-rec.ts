/// <reference lib="dom" />
// Запись скринкаста: кадры через CDP screencast (JPEG), реплики озвучки перехватываем из <audio>, метки сцен — в marks.json.
// Запуск: npm run dev, потом npx tsx scripts/screencast-rec.ts <часть> [--url http://localhost:5173] [--out папка]
//   части: gate, intro, setup, meeting, board

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const PART = process.argv[2]
const URL = arg('url', 'http://localhost:5173')
const OUT = join(arg('out', '/tmp/screencast'), PART)
mkdirSync(join(OUT, 'frames'), { recursive: true })
mkdirSync(join(OUT, 'audio'), { recursive: true })

const marks: { name: string; t: number }[] = []
const frames: { file: string; t: number }[] = []
const audio: { kind: string; t: number; src?: string; file?: string }[] = []
const mark = (name: string) => {
  marks.push({ name, t: Date.now() })
  console.log(`  [${((Date.now() - marks[0].t) / 1000).toFixed(1)}] ${name}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const b = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await b.newContext({ viewport: { width: Number(arg('vw', '1280')), height: Number(arg('vh', '720')) }, deviceScaleFactor: 1.5, acceptDownloads: true })
// строкой, а не функцией: tsx оборачивает функции в __name(), которого в странице нет
await ctx.addInitScript(`
  ${process.argv.includes('--robot') ? '' : "Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });"}
  (() => {
    const rec = (k, src, d) => window.__rec && window.__rec(k, src, d);
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const src = this.src || this.currentSrc;
      try {
        if (src && !src.startsWith('data:')) {
          if (src.startsWith('blob:'))
            fetch(src).then((r) => r.blob()).then((bl) => new Promise((res) => {
              const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(bl);
            })).then((d) => rec('play', src, d)).catch(() => {});
          else rec('play', src, '');
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    const origPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function () {
      try { if (!this.paused) rec("pause", this.src || this.currentSrc, ""); } catch (e) {}
      return origPause.apply(this, arguments);
    };
  })();
`)
let n = 0
await ctx.exposeFunction('__rec', (kind: string, src: string, data: string) => {
  const t = Date.now()
  const e: { kind: string; t: number; src?: string; file?: string } = { kind, t, src }
  if (data.startsWith('data:')) {
    const file = join(OUT, 'audio', `${String(++n).padStart(3, '0')}.mp3`)
    writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
    e.file = file
  }
  audio.push(e)
})

const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  pageerror', String(e).slice(0, 200)))
const cdp = await ctx.newCDPSession(page)
let fi = 0
cdp.on('Page.screencastFrame', (f) => {
  const file = join(OUT, 'frames', `${String(++fi).padStart(6, '0')}.jpg`)
  writeFileSync(file, Buffer.from(f.data, 'base64'))
  frames.push({ file, t: Math.round((f.metadata.timestamp ?? Date.now() / 1000) * 1000) })
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
const startRec = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })

function save() {
  writeFileSync(join(OUT, 'marks.json'), JSON.stringify({ marks, frames, audio }, null, 1))
}

// ——— помощники из play3d-e2e ———
async function waitReply() {
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled') || document.querySelector('.w3-end'), undefined, {
    timeout: 120_000,
  })
}
async function skipMentor() {
  const b = page.getByRole('button', { name: 'Я уже умею' }).locator('visible=true').first()
  if (await b.isVisible().catch(() => false)) {
    await b.click().catch(() => {})
    await wait(500)
  }
}
async function typeSay(text: string) {
  await skipMentor()
  const ta = page.locator('.w3-say textarea')
  await ta.click()
  await ta.pressSequentially(text, { delay: 18 })
  await wait(400)
  mark('sent')
  await page.getByRole('button', { name: 'Сказать', exact: true }).click()
  await waitReply()
  mark('replied')
}
async function lookDesk() {
  const btn = page.locator('.w3-look')
  const t = await btn.innerText()
  if (t.includes('Стол') || t.includes('предложение')) await btn.click()
  await wait(1500)
  await skipMentor()
}
async function lookFace() {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('ArrowUp')
  await wait(1300)
}
async function bestPicks() {
  const rows = page.locator('.w3-paper--notebook .px-issue')
  const cnt = await rows.count()
  const pts = async (row: ReturnType<typeof rows.nth>) => Number((await row.locator('.px-issue-points').innerText()).replace('+', '').replace('−', '-'))
  for (let i = 0; i < cnt; i++) {
    const row = rows.nth(i)
    for (const dir of [1, 0]) {
      for (let k = 0; k < 6; k++) {
        const btn = row.locator('.px-step').nth(dir)
        if (!(await btn.isVisible()) || (await btn.isDisabled())) break
        const before = await pts(row)
        await btn.click()
        await wait(120)
        if ((await pts(row)) < before) {
          await row.locator('.px-step').nth(1 - dir).click()
          break
        }
      }
    }
  }
}
async function fresh(path = '/') {
  await page.goto(`${URL}${path}`)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
}

try {
  if (PART === 'gate') {
    await page.goto('https://arena-peregovorov.ru/')
    await wait(1500)
    await startRec()
    mark('gate')
    await wait(5000)
    mark('end')
  }

  if (PART === 'intro') {
    await fresh()
    await page.goto(`${URL}/?view=3d`)
    await startRec()
    mark('title')
    await page.waitForSelector('.tt-btn.is-story')
    await wait(9000)
    mark('story-click')
    await page.locator('.tt-btn.is-story').click()
    let last = Date.now()
    for (let i = 0; i < 200; i++) {
      await wait(500)
      if (await page.locator('.mp-map').isVisible().catch(() => false)) break
      if (i % 10 === 0) await page.screenshot({ path: join(OUT, `probe-${i}.png`) })
      if (Date.now() - last > 75_000) {
        await page.getByRole('button', { name: 'Пропустить' }).click().catch(() => {})
        mark('skip')
        last = Date.now()
        continue
      }
      const nxt = page
        .getByRole('button', { name: /^(Смотреть приёмы|Дальше|Далее|Продолжить|Понятно|Поехали|К карте|Вперёд|Начать|Выйти|Ясно|Хорошо|Открыть карту)/ })
        .locator('visible=true')
        .first()
      if ((await nxt.isVisible().catch(() => false)) && Date.now() - last > 4500) {
        mark(`next:${(await nxt.innerText().catch(() => '')).slice(0, 20)}`)
        await nxt.click().catch(() => {})
        last = Date.now()
      }
    }
    mark('map')
    await wait(3000)
    const first = page.locator('.mp-list button').first()
    if (await first.isVisible().catch(() => false)) {
      await first.hover()
      await wait(800)
      await first.click()
      mark('map-card')
    }
    await wait(5000)
    mark('end')
  }

  if (PART === 'setup') {
    await fresh()
    await page.goto(`${URL}/?view=3d`)
    await page.waitForSelector('.tt-btn.is-jury')
    await startRec()
    mark('title')
    await wait(1500)
    await page.locator('.tt-btn.is-jury').click()
    mark('jury')
    await wait(3500)
    await page.locator('.jr-step').filter({ hasText: 'Настроить' }).click()
    await wait(1200)
    const fill = page.getByRole('button', { name: 'Заполнить бриф' })
    if (await fill.isVisible().catch(() => false)) {
      await fill.click()
      await wait(800)
    }
    mark('form')
    const chip = async (text: string) => {
      await page.locator('.g-chips button, .g-chips [role=button], .g-chips label').filter({ hasText: text }).first().click()
      await wait(500)
    }
    const typeIn = async (label: string, text: string) => {
      const inp = page.locator('.g-input').filter({ hasText: label }).locator('input')
      await inp.scrollIntoViewIfNeeded()
      await inp.click()
      await inp.fill('')
      await inp.pressSequentially(text, { delay: 22 })
      await wait(300)
    }
    await chip('Аренда')
    await typeIn('О чём договариваемся', 'аренда склада под запчасти на два года')
    await typeIn('Кто вы', 'логист компании-резидента ОЭЗ')
    await chip('напористый')
    await typeIn('Кто напротив', 'владелец складского комплекса')
    await typeIn('Чего он добивается', 'поднять ставку и получить предоплату за полгода')
    await chip('торгуется')
    await typeIn('Что хотите потренировать', 'не уступать в цене сразу')
    await wait(800)
    mark('submit')
    await page.getByRole('button', { name: 'Собрать дело' }).click()
    await wait(1500)
    mark('building')
    await page.waitForFunction(() => !document.querySelector('.g-writing'), undefined, { timeout: 120_000 })
    mark('built')
    await wait(1500)
    await page.screenshot({ path: join(OUT, 'probe-built.png') })
    await page.mouse.wheel(0, 300)
    await wait(3000)
    mark('end')
  }

  if (PART === 'meeting') {
    await fresh()
    await page.goto(`${URL}/?view=3d`)
    await page.waitForSelector('.tt-btn.is-jury')
    await page.locator('.tt-btn.is-jury').click()
    await wait(800)
    await page.locator('.jr-case').filter({ hasText: /Тара|тар/i }).first().click()
    await wait(1000)
    await startRec()
    mark('brief')
    await wait(2500)
    await page.getByRole('button', { name: /^(Войти в переговорку|Войти|Начать разговор)/ }).last().click()
    await page.waitForSelector('.w3-canvas', { timeout: 30_000 })
    mark('enter')
    await wait(2500)
    await skipMentor()
    await wait(1500)
    // осмотреться
    await page.locator('body').click({ position: { x: 640, y: 250 } })
    mark('look')
    await page.keyboard.down('ArrowLeft')
    await wait(900)
    await page.keyboard.up('ArrowLeft')
    await wait(600)
    await page.keyboard.down('ArrowRight')
    await wait(1800)
    await page.keyboard.up('ArrowRight')
    await wait(600)
    await page.keyboard.down('ArrowLeft')
    await wait(900)
    await page.keyboard.up('ArrowLeft')
    await lookFace()
    mark('say1')
    await typeSay('Добрый день, Марат. Прежде чем говорить о цене, скажите: что для вас в этом договоре главное и почему?')
    await wait(6000)
    mark('margin1')
    await wait(3000)
    mark('say2')
    await typeSay('Правильно понимаю, что вам важно загрузить линию? Для нас главное — чтобы конвейер не встал, срочные допоставки критичны.')
    await wait(6000)
    // рентген
    await lookDesk()
    mark('desk')
    await wait(1500)
    await page.locator('.w3-paper--card').getByRole('button', { name: /Что чувствует/ }).click()
    await wait(900)
    await lookFace()
    mark('xray')
    await wait(5000)
    const close = page.locator('.w3-xray .g-xray-close')
    if (await close.isVisible().catch(() => false)) await close.click()
    await wait(600)
    // блокнот и предложение
    await lookDesk()
    mark('notebook')
    await bestPicks()
    await wait(1500)
    mark('offer')
    await page.locator('.w3-paper--notebook').getByRole('button', { name: /Предложить|Положить на стол/ }).evaluate((el) => (el as HTMLElement).click())
    const sure = page.locator('.w3-paper--notebook').getByRole('button', { name: /Всё равно/ })
    await wait(300)
    if (await sure.count()) await sure.evaluate((el) => (el as HTMLElement).click())
    await waitReply()
    mark('offer-reply')
    await wait(6000)
    if (!(await page.locator('.w3-end').isVisible())) {
      await lookFace()
      mark('say3')
      await typeSay('Если вы берёте на себя срочные допоставки за 48 часов, то мы готовы платить по факту отгрузки.')
      await wait(5000)
    }
    for (let k = 0; k < 6; k++) {
      if (await page.locator('.w3-end').isVisible()) break
      await lookDesk()
      if ((await page.locator('.w3-paper--slip button').count()) > 0) {
        mark('slip')
        await wait(3000)
        await page.locator('.w3-paper--slip').getByRole('button', { name: /Принять|Согласиться/ }).first().evaluate((el) => (el as HTMLElement).click())
        await wait(300)
        const again = page.locator('.w3-paper--slip').getByRole('button', { name: /Всё равно/i })
        if (await again.count()) await again.first().evaluate((el) => (el as HTMLElement).click())
        mark('accept')
        await waitReply()
        break
      }
      await lookFace()
      mark(`say-more-${k}`)
      await typeSay('Давайте посмотрим на цифры: какое предложение вы готовы положить на стол целиком, по всем пунктам?')
      await wait(4000)
    }
    await wait(500)
    mark('stamp')
    await wait(5000)
    // разбор
    await page.getByRole('button', { name: 'Разбор встречи' }).click()
    mark('report')
    await wait(6000)
    await page.screenshot({ path: join(OUT, 'probe-report.png') })
    const smooth = async (dy: number, steps: number) => {
      for (let k = 0; k < steps; k++) {
        await page.mouse.wheel(0, dy)
        await wait(700)
      }
    }
    await smooth(200, 4)
    mark('report-main')
    await wait(3000)
    const more = page.getByRole('button', { name: 'Подробный разбор' }).locator('visible=true').first()
    if (await more.isVisible().catch(() => false)) {
      mark('more')
      await more.click()
      await wait(2500)
    }
    await page.screenshot({ path: join(OUT, 'probe-more.png') })
    const dm = page.locator('.g-dealmap, [class*="dealmap"], [class*="pareto"]').first()
    if (await dm.isVisible().catch(() => false)) {
      await dm.scrollIntoViewIfNeeded()
      mark('pareto')
      await wait(5000)
      await page.screenshot({ path: join(OUT, 'probe-pareto.png') })
    } else {
      await smooth(260, 4)
      mark('pareto?')
      await wait(3000)
    }
    const flip = page.getByRole('button', { name: /Перевернуть/ }).locator('visible=true').first()
    if (await flip.count()) {
      await flip.scrollIntoViewIfNeeded()
      await wait(1500)
      mark('under')
      await flip.click()
      await wait(1000)
      await page.locator('.g-under').scrollIntoViewIfNeeded().catch(() => {})
      await wait(5000)
      await page.screenshot({ path: join(OUT, 'probe-under.png') })
    }
    const replay = page.getByRole('button', { name: 'Переиграть с этого хода' }).first()
    if (await replay.count()) {
      await replay.scrollIntoViewIfNeeded()
      await wait(2500)
      mark('replay')
      await replay.click()
      await wait(5000)
      await page.screenshot({ path: join(OUT, 'probe-replay.png') })
    }
    await wait(3000)
    mark('end')
    await page.screenshot({ path: join(OUT, 'probe-end.png'), fullPage: true })
  }

  if (PART === 'map') {
    await fresh()
    await page.goto(`${URL}/?view=3d`)
    await page.waitForSelector('.tt-btn.is-story')
    await startRec()
    mark('title')
    await wait(1000)
    await page.locator('.tt-btn.is-story').click()
    await page.waitForSelector('.mp-map')
    mark('map')
    await wait(5000)
    const items = page.locator('.mp-list button')
    const cnt = await items.count()
    for (let i = 0; i < Math.min(cnt, 3); i++) {
      await items.nth(i).hover()
      await wait(1200)
    }
    await items.first().click()
    mark('map-card')
    await wait(4000)
    await page.screenshot({ path: join(OUT, 'probe-card.png') })
    mark('end')
  }

  if (PART === 'board') {
    const room = arg('room', '')
    const key = arg('key', '')
    await fresh()
    await page.goto(`${URL}/?view=3d`)
    await page.waitForSelector('.tt-btn.is-jury')
    await startRec()
    mark('title')
    await page.goto(`${URL}/?board=${room}&key=${key}`)
    mark('board')
    await wait(6000)
    await page.mouse.wheel(0, 300)
    await wait(2500)
    const csv = page.getByRole('button', { name: /Выгрузить CSV/ })
    if (await csv.isVisible().catch(() => false)) {
      await csv.scrollIntoViewIfNeeded()
      await wait(700)
      mark('csv')
      const dl = page.waitForEvent('download').catch(() => null)
      await csv.click()
      const d = await dl
      if (d) await d.saveAs(join(OUT, 'board.csv'))
    }
    await wait(3000)
    mark('end')
  }
} catch (e) {
  console.log('ОШИБКА', String(e).split('\n').slice(0, 3).join(' | '))
  mark('error')
  await page.screenshot({ path: join(OUT, 'error.png') }).catch(() => {})
} finally {
  await cdp.send('Page.stopScreencast').catch(() => {})
  await wait(300)
  save()
  await b.close()
  console.log(`кадров ${frames.length}, звуков ${audio.length} → ${OUT}`)
}
