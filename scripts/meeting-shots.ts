/// <reference lib="dom" />
// Встреча глазами игрока на телефоне: 3D, голосовой режим по умолчанию, как у живого человека (navigator.webdriver = false).
// Снимки «до/после» правок раскладки: вход, реплика собеседника, свой ход, ответ, «Написать» с клавиатурой, стол.
// Запуск (сначала офлайн-сервер, например PORT=8797 LLM_PROVIDER=offline npx tsx src/server/index.ts и vite --port 5197):
//   npx tsx scripts/meeting-shots.ts --url http://localhost:5197 --tag after [--vp 390,664,375,430,844,1440] [--cases dorm,tara] [--tutorial]
// Снимки — ~/Arena-materials/final/mobile/<tag>/<дело>-<вьюпорт>-<шаг>.png

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, devices, type Page } from 'playwright'
import { requireOffline } from './offline-guard'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
await requireOffline(URL)
const OUT = join(homedir(), 'Arena-materials', 'final', 'mobile', arg('tag', 'after'))
mkdirSync(OUT, { recursive: true })

const phone = devices['iPhone 14']
const VPS = {
  '390': { width: 390, height: 844 },
  // iPhone 14 в Safari: панели браузера съедают 180 точек
  '664': { width: 390, height: 664 },
  '375': { width: 375, height: 667 },
  '430': { width: 430, height: 932 },
  '844': { width: 844, height: 390 },
  // iPhone SE лёжа
  '667': { width: 667, height: 375 },
  '1440': { width: 1440, height: 900 },
} as const
type VpId = keyof typeof VPS
const vps = arg('vp', '390,664,375,430,844,1440').split(',') as VpId[]
const cases = arg('cases', 'dorm,tara').split(',')
// --tutorial: первая встреча с наставником, как у нового игрока
const TUT = process.argv.includes('--tutorial')
const LINE = 'Слушай, давай спокойно: что для тебя тут самое важное и почему? Мне правда интересно, а не просто так спрашиваю.'

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log('  снимок', name)
}

/** Ждём, пока собеседник допечатает реплику (или 12 с). */
async function settle(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('.px-dialog-more') || !!document.querySelector('.w3-end'), undefined, { timeout: 12_000 }).catch(() => {})
  await page.waitForTimeout(400)
}

/** Открыть ввод текстом: новая кнопка «Написать» или старая ссылка «Писать текстом». */
async function openWrite(page: Page) {
  const btn = page.getByRole('button', { name: /^(Написать|Писать текстом)$/ }).first()
  if (await btn.isVisible().catch(() => false)) await btn.click()
  await page.waitForSelector('#px-speech', { timeout: 5000 })
}

async function run(id: VpId, caseId: string) {
  const vp = VPS[id]
  const isPhone = vp.width < 1000
  const tag = `${caseId}-${id}${TUT ? '-обучение' : ''}`
  console.log(tag)
  const b = await chromium.launch({ args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  try {
    const { defaultBrowserType: _, ...dev } = phone
    const ctx = await b.newContext(isPhone ? { ...dev, viewport: vp, screen: vp } : { viewport: vp })
    await ctx.grantPermissions(['microphone'], { origin: new globalThis.URL(URL).origin })
    // как у живого игрока: 3D, голос по умолчанию; fps программного рендера не повод уходить в 2D
    await ctx.addInitScript({ content: "Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); window.__name = (f) => f" })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  ОШИБКА СТРАНИЦЫ', String(e).slice(0, 200)))
    // распознавание «есть», но фейковый микрофон гудит — «не расслышал»
    await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, mode: 'offline', provider: 'offline', model: 'rules', scenarios: 9, speech: { tts: false, stt: true } } }))
    await page.route('**/api/stt', (r) => r.fulfill({ json: { text: '' } }))
    await page.goto(`${URL}/`)
    // обучение уже пройдено — встреча как у вернувшегося игрока
    await page.evaluate((TUT) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ cases: {}, tutorialDone: true, endings: {}, runs: [] }))
      if (TUT) localStorage.removeItem('peregovorka.progress.v2')
    }, TUT)
    await page.goto(`${URL}/?case=${caseId}&view=3d`)
    const toCase = page.getByRole('button', { name: 'К делу' })
    if (await toCase.isVisible({ timeout: 3000 }).catch(() => false)) await toCase.click()
    await page.waitForSelector('.g-dossier', { timeout: 15_000 })
    await page.getByRole('button', { name: /^(Войти|Начать разговор)/ }).filter({ visible: true }).last().click()
    await page.waitForFunction(() => (window as unknown as { __world?: unknown }).__world, undefined, { timeout: 40_000 })
    // программный рендер медленный — fps ничего не говорит о живом телефоне: сторож «не тянет 3D» не должен уводить в 2D
    await page.evaluate(() => Object.defineProperty((window as unknown as { __world: object }).__world, 'fps', { get: () => 60, set: () => {} }))
    await page.waitForTimeout(1800)
    await shot(page, `${tag}-1-вход`)
    await settle(page)
    await shot(page, `${tag}-2-реплика`)
    // «Написать»: клавиатуры в эмуляции нет — подставляем её высоту, как это делает visualViewport
    await openWrite(page)
    await page.locator('#px-speech').fill(LINE)
    if (isPhone) {
      const kb = Math.round(vp.height * (vp.width > vp.height ? 0.55 : 0.42))
      await page.evaluate((kb) => {
        const play = document.querySelector('.w3-play') as HTMLElement | null
        play?.style.setProperty('--kb', `${kb}px`)
        play?.setAttribute('data-kb', '')
      }, kb)
      await page.waitForTimeout(300)
      const r = await page.evaluate(() => document.querySelector('#px-speech')?.getBoundingClientRect().bottom ?? 0)
      if (r > vp.height - kb + 1) console.log(`  ПРОБЛЕМА: поле ввода под клавиатурой (${Math.round(r)} > ${vp.height - kb})`)
      await shot(page, `${tag}-3-написать-клавиатура`)
      await page.evaluate(() => {
        const play = document.querySelector('.w3-play') as HTMLElement | null
        play?.style.setProperty('--kb', '0px')
        play?.removeAttribute('data-kb')
      })
    } else await shot(page, `${tag}-3-написать`)
    await page.locator('#px-speech').press('Enter')
    // ответ печатается: снимок посреди реплики и в конце
    await page.waitForFunction(() => !!document.querySelector('.px-dialog-shown')?.textContent && !document.querySelector('.px-dialog-more'), undefined, { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    await shot(page, `${tag}-4-ответ-печатается`)
    await settle(page)
    await shot(page, `${tag}-5-ответ`)
    // стол: блокнот (на телефоне — в руках)
    const desk = page.locator('.w3-look, .w3-notebook-btn').first()
    if (await desk.isVisible().catch(() => false)) await desk.click()
    await page.waitForTimeout(1500)
    await shot(page, `${tag}-6-стол`)
  } catch (e) {
    console.log('  СБОЙ', String(e).split('\n')[0])
  } finally {
    await b.close()
  }
}

for (const c of cases) for (const id of vps) await run(id, c)
