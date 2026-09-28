/// <reference lib="dom" />
// Снимки третьего дела: папка с тремя делами (ноутбук и телефон), досье «Удержать клиента», переговорка с Розой.
// Запуск: npm run dev, потом npx tsx scripts/case3-shots.ts [--url http://localhost:5173] [--say]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const i = process.argv.indexOf('--url')
const URL = i > 0 ? process.argv[i + 1] : 'http://localhost:5173'
const OUT = join(homedir(), 'Arena-materials', 'shots', 'case3')
const talk = process.argv.includes('--say')
mkdirSync(OUT, { recursive: true })

async function toFolder(page: Page) {
  await page.goto(URL)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(URL)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.waitForSelector('.g-folders')
  await page.waitForTimeout(400)
}

const browser = await chromium.launch()
try {
  for (const [name, viewport] of [['laptop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: name === 'phone' ? 2 : 1 })).newPage()
    await toFolder(page)
    await page.screenshot({ path: join(OUT, `${name}-folder.png`), fullPage: true })
    const card = page.locator('.g-folder', { hasText: 'Удержать клиента' })
    await card.scrollIntoViewIfNeeded()
    await card.screenshot({ path: join(OUT, `${name}-folder-card.png`) })
    await card.getByRole('button', { name: 'Открыть дело' }).click()
    await page.waitForSelector('.g-dossier')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, `${name}-brief.png`), fullPage: true })
    await page.getByRole('button', { name: 'Войти в переговорку' }).click()
    await page.waitForSelector('.px-dialog')
    const off = page.getByRole('button', { name: 'Без подсказок' }).first()
    if (await off.isVisible().catch(() => false)) await off.click()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(6000)
    await page.screenshot({ path: join(OUT, `${name}-play.png`) })
    if (talk && name === 'laptop') {
      await page.locator('textarea').fill('Роза Ильдаровна, прежде чем говорить о процентах: что для вас в новом договоре главное и почему?')
      await page.getByRole('button', { name: 'Сказать', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('textarea')?.disabled, undefined, { timeout: 120_000 })
      await page.waitForTimeout(9000)
      await page.screenshot({ path: join(OUT, `${name}-play-reveal.png`) })
    }
    console.log('ok', name)
  }
} finally {
  await browser.close()
}
