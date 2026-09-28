/// <reference lib="dom" />
// Снимки своих дел с лицами из пула: титул по ссылке, досье, переговорка.
// Запуск: npm run dev, потом npx tsx scripts/faces-shots.ts gen-xxxx [gen-yyyy ...] [--say]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const URL = 'http://localhost:5173'
const OUT = join(homedir(), 'Arena-materials', 'shots', 'faces')
mkdirSync(OUT, { recursive: true })
const ids = process.argv.slice(2).filter((a) => a.startsWith('gen-'))
const talk = process.argv.includes('--say')

const browser = await chromium.launch()
try {
  for (const id of ids) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    await page.goto(URL)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${URL}/?case=${id}`)
    await page.waitForSelector('.px-portrait')
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(OUT, `${id}-title.png`) })
    await page.locator('.g-big').click()
    await page.waitForSelector('.g-dossier')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, `${id}-brief.png`) })
    await page.getByRole('button', { name: 'Войти в переговорку' }).click()
    await page.waitForSelector('.px-dialog')
    const off = page.getByRole('button', { name: 'Без подсказок' }).first()
    if (await off.isVisible().catch(() => false)) await off.click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(OUT, `${id}-play.png`) })
    if (talk) {
      await page.locator('textarea').fill('Ваши условия нам не подходят совсем. Либо скидка вдвое, либо мы уходим к другим.')
      await page.getByRole('button', { name: 'Сказать', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('textarea')?.disabled, undefined, { timeout: 120_000 })
      await page.waitForTimeout(2500)
      await page.screenshot({ path: join(OUT, `${id}-play2.png`) })
    }
    console.log('ok', id)
  }
} finally {
  await browser.close()
}
