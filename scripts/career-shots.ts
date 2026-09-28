/// <reference lib="dom" />
// Снимки карьеры: карточка на титуле, папка с советом и «Сыграть жёстче», «Личное дело», «Что прокачали» в разборе,
// бриф жёсткой версии. Прогресс подкладываем в localStorage, партию для разбора играем офлайн движком.
// Запуск: npm run dev:offline, потом npx tsx scripts/career-shots.ts [--url http://localhost:5173] [--live]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { getScenario } from '../src/content/scenarios'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { analyzeOffline, templateLine, withContext } from '../src/engine/offline'
import { initialState, step } from '../src/engine/turn'
import type { TurnRecord } from '../src/engine/types'
import { explorer } from './players'
import { requireOffline } from './offline-guard'

const i = process.argv.indexOf('--url')
const URL = i > 0 ? process.argv[i + 1] : 'http://localhost:5173'
await requireOffline(URL)
const OUT = join(homedir(), 'Arena-materials', 'shots', 'career')
mkdirSync(OUT, { recursive: true })

const S = (deal: boolean, value: boolean, trust: boolean) => ({ deal, value, trust })
const rec = (title: string, plays: number, bestPoints: number | null, stars: ReturnType<typeof S>) => ({
  title,
  plays,
  bestPoints,
  bestStars: Number(stars.deal) + Number(stars.value) + Number(stars.trust),
  stars,
  lastStatus: bestPoints === null ? 'walked_away' : 'deal',
})
const run = (caseId: string, status: string, stars: ReturnType<typeof S>, beh: Record<string, number>, fair = false, early = false) => ({
  caseId,
  status,
  stars,
  fair,
  early,
  turns: 9,
  beh,
})

// игрок, который сыграл пять партий: оффер взят, жёсткий оффер — на двух звёздах, «Тара» пока без сделки
const PROGRESS = {
  tutorialDone: true,
  cases: {
    offer: rec('Оффер для робототехника', 3, 85, S(true, true, true)),
    'offer-hard': rec('Оффер для робототехника: жёстче', 1, 71, S(true, false, true)),
    tara: rec('Тара к запуску', 1, null, S(false, false, false)),
  },
  endings: { offer: ['walked', 'middling', 'legend'], tara: ['slammed'] },
  runs: [
    run('offer', 'walked_away', S(false, false, false), { anchor: 1, instant_counter: 2, ultimatum: 1 }),
    run('offer', 'deal', S(true, false, false), { ask_interest: 1, anchor: 1, split: 1, instant_counter: 1 }, true),
    run('offer', 'deal', S(true, true, true), { ask_interest: 3, check: 2, package: 1, label: 1, anchor: 1 }, true, true),
    run('offer-hard', 'deal', S(true, false, true), { ask_interest: 2, check: 1, package: 1, summarize: 1, anchor: 1 }, true),
    run('tara', 'walked_away', S(false, false, false), { anchor: 1, attack: 1, irritator: 2, instant_counter: 1 }),
  ],
}

/** Партия «Тары» исследователем — для разбора: сделка, три звезды. */
function taraGame(): TurnRecord[] {
  const sc = getScenario('tara')!
  const h: TurnRecord[] = []
  let st = initialState(sc)
  while (st.status === 'open' && h.length < sc.turnLimit + 1) {
    const text = explorer(sc, h)
    const a = withContext(analyzeOffline(sc, text, BEHAVIOR_DICT), st, h, BEHAVIOR_DICT)
    const r = step(sc, st, a, BEHAVIOR_DICT, h.map((x) => x.analysis))
    const { line, emotion } = templateLine(sc, r.decision, r.state, st.lastOpponentOffer)
    h.push({ turn: r.state.turn, playerText: text, analysis: a, deltas: r.deltas, decision: r.decision, opponentLine: line, emotion, stateAfter: r.state })
    st = r.state
  }
  return h
}

async function seed(page: Page) {
  await page.goto(URL)
  await page.evaluate((p) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('peregovorka.progress.v2', JSON.stringify(p))
  }, PROGRESS)
  await page.goto(URL)
  await page.waitForSelector('.g-career-card')
  await page.waitForTimeout(400)
}

const browser = await chromium.launch()
try {
  for (const [name, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: name === '390' ? 2 : 1 })).newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await seed(page)
    await page.locator('.g-career-card').scrollIntoViewIfNeeded()
    await page.locator('.g-career-card').screenshot({ path: join(OUT, `${name}-title-card.png`) })

    // папка: совет и «Сыграть жёстче»
    await page.getByRole('button', { name: 'Начать' }).click()
    await page.waitForSelector('.g-folders')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, `${name}-folder.png`), fullPage: true })
    const offer = page.locator('.g-folder', { hasText: 'Оффер для робототехника' })
    await offer.scrollIntoViewIfNeeded()
    await offer.screenshot({ path: join(OUT, `${name}-folder-harder.png`) })
    await page.locator('.g-folder.is-advised').screenshot({ path: join(OUT, `${name}-folder-advice.png`) })

    // личное дело
    await page.locator('.g-setup-career').getByRole('button', { name: 'Открыть' }).click()
    await page.waitForSelector('.g-career-grid')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, `${name}-career.png`), fullPage: true })
    await page.screenshot({ path: join(OUT, `${name}-career-top.png`) })

    // «Сыграть жёстче» из личного дела → бриф жёсткой версии
    await page.locator('.g-case', { hasText: 'Оффер' }).getByRole('button', { name: 'Сыграть жёстче' }).click()
    await page.waitForSelector('.g-dossier')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, `${name}-brief-harder.png`) })
    await page.locator('.g-dossier-them').screenshot({ path: join(OUT, `${name}-brief-harder-them.png`) })

    // разбор свежей партии: «Что прокачали» и «Сыграть жёстче»
    await page.evaluate(
      ([sc, history]) => sessionStorage.setItem('peregovorka.session.v1', JSON.stringify({ screen: 'report', current: { scenario: sc, fromLibrary: true }, history })),
      [getScenario('tara'), taraGame()] as const,
    )
    await page.reload()
    await page.waitForSelector('.g-gain')
    await page.waitForTimeout(500)
    await page.locator('.g-gain').scrollIntoViewIfNeeded()
    await page.locator('.g-gain').screenshot({ path: join(OUT, `${name}-debrief-gain.png`) })
    await page.screenshot({ path: join(OUT, `${name}-debrief.png`), fullPage: true })
    await page.locator('.g-report-actions').screenshot({ path: join(OUT, `${name}-debrief-actions.png`) })

    // после партии личное дело выросло: «Тара» с тремя звёздами, совет сменился
    await page.getByRole('button', { name: 'Другое дело' }).click()
    await page.waitForSelector('.g-folders')
    await page.locator('.g-setup-career').getByRole('button', { name: 'Открыть' }).click()
    await page.waitForSelector('.g-career-grid')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, `${name}-career-after.png`), fullPage: true })

    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    console.log('ok', name, wide ? 'ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ' : 'без горизонтального скролла', errors.length ? errors : '')
  }
} finally {
  await browser.close()
}
