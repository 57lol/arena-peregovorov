/// <reference lib="dom" />
// Голос после отмены хода: ход → «Переиграть с этого хода» → восстановленная реплика звучит снова → следующий ход тоже.
// Оба вида (классика и 3D). Запуск: dev на 5173, потом npx tsx scripts/undo-voice-e2e.ts [--url http://localhost:5173]
import { chromium, type Page } from 'playwright'

const i = process.argv.indexOf('--url')
const URL = i > 0 ? process.argv[i + 1] : 'http://localhost:5173'

type W = { plays: string[] }
const plays = (p: Page) => p.evaluate(() => (window as unknown as W).plays.slice())
const waitSpeech = (p: Page, n: number, ms = 60_000) =>
  p.waitForFunction((n) => (window as unknown as W).plays.filter((x) => x.startsWith('speech:ok')).length >= n, n, { timeout: ms })

async function run(view: 'classic' | '3d') {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  // строкой: tsx добавляет в функции __name, которого в браузере нет
  await page.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    window.plays = []
    const orig = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      const src = this.src.startsWith('data:') ? 'silent' : this.src.includes('voice-fillers') ? 'filler' : 'speech'
      return orig.call(this).then(() => void window.plays.push(src + ':ok'), (e) => { window.plays.push(src + ':' + e.name); throw e })
    }
  `)
  const tts: string[] = []
  page.on('request', (r) => r.url().endsWith('/api/tts') && tts.push(JSON.parse(r.postData() ?? '{}').text?.slice(0, 30)))
  await page.goto(`${URL}/?view=${view}`)
  await page.evaluate(() => {
    localStorage.setItem('peregovorka.voice.v2', '1')
    localStorage.setItem('peregovorka.progress.v2', JSON.stringify({ tutorialDone: true }))
  })
  await page.reload()
  await page.getByRole('button', { name: 'Все дела' }).click()
  await page.getByText('Тара к запуску').first().click()
  await page.getByRole('button', { name: 'Войти в переговорку' }).click()
  await page.waitForSelector('textarea', { timeout: 60_000 })
  await waitSpeech(page, 1) // приветствие
  const say = async (text: string) => {
    await page.locator('textarea').fill(text)
    await page.getByRole('button', { name: 'Сказать', exact: true }).click()
    await page.waitForFunction(() => !(document.querySelector('textarea') as HTMLTextAreaElement)?.disabled, undefined, { timeout: 120_000 })
  }
  await say('Добрый день! Какую цену за тару вы готовы предложить?')
  await waitSpeech(page, 2)
  const before = (await plays(page)).length
  // перемотка из записи разговора
  if (view === '3d') await page.locator('.w3-menu-btn').click()
  const proto = page.locator('details').filter({ hasText: 'Запись разговора' }).first()
  await proto.locator('summary').click()
  await proto.getByRole('button', { name: 'Переиграть с этого хода' }).first().click()
  let ok = true
  try {
    await waitSpeech(page, 3, 15_000)
  } catch {
    ok = false
  }
  console.log(view, 'после перемотки реплика озвучена:', ok, (await plays(page)).slice(before))
  await say('Хорошо, давайте начнём с цены. Сколько вы хотите?')
  let ok2 = true
  try {
    await waitSpeech(page, ok ? 4 : 3)
  } catch {
    ok2 = false
  }
  console.log(view, 'следующий ход озвучен:', ok2, 'plays', await plays(page), 'tts', tts)
  await browser.close()
  return ok && ok2
}

const only = process.argv.includes('--3d') ? ['3d'] : process.argv.includes('--classic') ? ['classic'] : ['classic', '3d']
const res: boolean[] = []
for (const v of only) res.push(await run(v as 'classic' | '3d'))
console.log(res.every(Boolean) ? 'OK' : 'FAIL')
process.exit(res.every(Boolean) ? 0 : 1)
