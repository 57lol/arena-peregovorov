/// <reference lib="dom" />
// Первая встреча глазами новичка, который ничего не читает: жмёт большую кнопку, потом то, что мигает,
// и «Подсказать фразу», когда наставник её предлагает. Снимок на каждом шаге, 1440×900 и 390×844.
// Снимки — в ~/Arena-materials/shots/onboarding/. Обучение в прогоне включает ?tutorial=1.
// Запуск: npm run dev:offline, потом npx tsx scripts/onboarding-e2e.ts [--url http://localhost:5173] [--only wide,phone] [--live]

import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
const ONLY = arg('only', 'wide,phone').split(',')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'onboarding')
mkdirSync(OUT, { recursive: true })

const problems: string[] = []
const fail = (m: string) => {
  problems.push(m)
  console.log('  ПРОБЛЕМА:', m)
}

let n = 0
async function shot(page: Page, tag: string, name: string) {
  n++
  await page.screenshot({ path: join(OUT, `${tag}-${String(n).padStart(2, '0')}-${name}.png`) })
  const box = page.locator('.g-mentor-text').first()
  const mentor = (await box.count()) ? await box.innerText().catch(() => '') : ''
  console.log(`  ${String(n).padStart(2, '0')} ${name}${mentor ? ` — наставник: ${mentor}` : ''}`)
}

async function waitReply(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.w3-say textarea')?.hasAttribute('disabled') || document.querySelector('.w3-end'), undefined, {
    timeout: 60_000,
  })
  await page.waitForTimeout(400)
  const box = page.locator('.w3-them .px-dialog-box')
  if (await box.isVisible()) await box.click()
  await page.waitForTimeout(900)
}

/** Точка на экране, где лежит лист (через мир), — так новичок тыкает в бумагу пальцем. */
async function paperPoint(page: Page, id: string) {
  return page.evaluate((id) => {
    const w = (window as unknown as { __world: { pick: (x: number, y: number) => string | null } }).__world
    for (let y = 40; y < innerHeight - 160; y += 10) for (let x = 16; x < innerWidth - 16; x += 10) if (w.pick(x, y) === id) return { x, y }
    return null
  }, id)
}

const visible = (page: Page, sel: string) => page.locator(sel).first().isVisible().catch(() => false)

async function run(phone: boolean) {
  const tag = phone ? '390' : '1440'
  n = 0
  for (const f of readdirSync(OUT)) if (f.startsWith(`${tag}-`)) rmSync(join(OUT, f))
  console.log(`\n${tag}`)
  // настоящая видеокарта (Metal): на программном рендере кадров мало, и встреча честно уходит в классический вид
  const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] })
  const ctx = await b.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
  })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  try {
    await page.goto(`${URL}/?view=3d&tutorial=1`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${URL}/?view=3d&tutorial=1`)
    await page.waitForTimeout(900)
    await shot(page, tag, 'титул')

    // самая большая кнопка
    await page.locator('.tt-btn.is-story').click()
    await page.waitForTimeout(700)
    // карта кампании: у первой главы большая кнопка «Войти»
    if (await visible(page, '.mp-card-actions')) {
      await page.screenshot({ path: join(OUT, `${tag}-02-карта-целиком.png`), fullPage: true })
      await shot(page, tag, 'карта')
      await page.locator('.mp-card-actions .px-btn--brass').first().click()
      await page.waitForTimeout(700)
    }
    await page.screenshot({ path: join(OUT, `${tag}-02-бриф-целиком.png`), fullPage: true })
    await shot(page, tag, 'бриф')
    await page.locator('.g-dossier-foot .px-btn--brass, .g-brief-go').first().click()
    await page.waitForSelector('.w3-canvas', { timeout: 30_000 })
    await page.waitForTimeout(2600)
    await shot(page, tag, 'встреча-начало')

    const seen = new Set<string>()
    for (let k = 0; k < 30; k++) {
      if (await visible(page, '.w3-end')) {
        await shot(page, tag, 'конец-встречи')
        await page.getByRole('button', { name: 'Разбор встречи' }).click()
        await page.waitForTimeout(1500)
        await shot(page, tag, 'разбор')
        await page.screenshot({ path: join(OUT, `${tag}-${String(++n).padStart(2, '0')}-разбор-целиком.png`), fullPage: true })
        break
      }
      const mentor = await visible(page, '.w3-mentor')
      const text = mentor ? await page.locator('.g-mentor-text').innerText() : ''
      // наставник предлагает фразу — берём её и говорим
      const example = page.locator('.w3-mentor').getByRole('button', { name: 'Подсказать фразу' })
      if (await example.isVisible().catch(() => false)) {
        await example.click()
        await shot(page, tag, 'фраза-в-поле')
        await page.getByRole('button', { name: 'Сказать', exact: true }).click()
        await waitReply(page)
        await shot(page, tag, 'ответ')
        continue
      }
      const lit = page.locator('.is-tutor').first()
      const litCls = (await lit.getAttribute('class').catch(() => null)) ?? ''
      const key = `${text}|${litCls}`
      if (seen.has(key) && !litCls.includes('w3-note')) {
        // тот же шаг второй раз — значит, клик ничего не дал; жмём «Понятно», если есть
        const ok = page.locator('.w3-mentor').getByRole('button', { name: 'Понятно' })
        if (await ok.isVisible().catch(() => false)) {
          await ok.click()
          await page.waitForTimeout(700)
          continue
        }
      }
      seen.add(key)

      if (!mentor) {
        // обучение кончилось: говорим что-нибудь, а если на листке есть что подписать — соглашаемся
        const accept = page.locator('.w3-paper--slip').getByRole('button', { name: /Согласиться/ })
        if ((await page.locator('.w3-paper--slip button').count()) > 0) {
          await page.locator('.w3-look').click().catch(() => {})
          await page.waitForTimeout(1300)
          if (phone) {
            const p = await paperPoint(page, 'slip')
            if (p) await page.mouse.click(p.x, p.y)
            await page.waitForTimeout(1100)
          }
          await shot(page, tag, 'листок-перед-согласием')
          await accept.click()
          const again = page.locator('.w3-paper--slip').getByRole('button', { name: /Всё равно/ })
          await page.waitForTimeout(250)
          if (await again.isVisible().catch(() => false)) await again.click()
          await waitReply(page)
          continue
        }
        await page.locator('.w3-say textarea').fill('Если вы согласны на квартиру на полгода, давайте выйдем через месяц и оклад 180 тысяч.')
        await page.getByRole('button', { name: 'Сказать', exact: true }).click()
        await waitReply(page)
        await shot(page, tag, 'ответ')
        continue
      }

      // мигает то, о чём говорит наставник — туда и жмём
      if (litCls.includes('w3-look')) {
        await lit.click()
        await page.waitForTimeout(1500)
        await shot(page, tag, 'стол')
      } else if (litCls.includes('w3-note')) {
        // крутим стрелки: первую доступную «вперёд»
        const step = page.locator('.w3-paper--notebook .px-step:not([disabled])').first()
        await step.click()
        await page.waitForTimeout(400)
        await shot(page, tag, 'крутим-стрелки')
      } else if (litCls.includes('px-btn') && (await lit.innerText()).includes('Предложить')) {
        await shot(page, tag, 'перед-предложением')
        await lit.click()
        const sure = page.locator('.w3-paper--notebook').getByRole('button', { name: /Всё равно/ })
        await page.waitForTimeout(250)
        if (await sure.isVisible().catch(() => false)) await sure.click()
        await waitReply(page)
        await shot(page, tag, 'ответ-на-предложение')
      } else if (litCls.includes('w3-card-btn')) {
        await lit.click()
        await page.waitForTimeout(900)
        await shot(page, tag, 'карточка-нажали')
        if (await visible(page, '.w3-xray')) {
          // посмотрели и закрыли
          await page.locator('.w3-xray .g-xray-close').click().catch(() => {})
        }
      } else if (/Нажми на/.test(text) && phone) {
        const id = /блокнот/.test(text) ? 'notebook' : /листок/.test(text) ? 'slip' : 'card'
        const p = await paperPoint(page, id)
        if (!p) fail(`${tag}: не нашли лист ${id}`)
        else await page.mouse.click(p.x, p.y)
        await page.waitForTimeout(1200)
        await shot(page, tag, `в-руках-${id}`)
      } else {
        const ok = page.locator('.w3-mentor').getByRole('button', { name: 'Понятно' })
        if (await ok.isVisible().catch(() => false)) {
          await shot(page, tag, 'шаг')
          await ok.click()
          await page.waitForTimeout(900)
        } else {
          fail(`${tag}: непонятно, что делать: «${text}»`)
          break
        }
      }
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (sw > 0) fail(`${tag}: горизонтальная прокрутка ${sw}px`)
  } catch (e) {
    fail(`${tag}: ${String(e).split('\n')[0]}`)
    await shot(page, tag, 'ошибка').catch(() => {})
  } finally {
    if (errors.length) fail(`${tag}: ошибки в консоли: ${errors.slice(0, 3).join(' | ')}`)
    await b.close()
  }
}

await requireOffline(URL)
for (const r of ONLY) await run(r === 'phone')
console.log(problems.length ? `\nПроблем: ${problems.length}` : '\nВсё прошло')
process.exit(problems.length ? 1 : 0)
