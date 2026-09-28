/// <reference lib="dom" />
// Снимки разбора с разными финалами: партии собираются движком, разбор открывается из sessionStorage.
// Запуск: npm run dev, потом npx tsx scripts/endings-shots.ts [--url http://localhost:5173]

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { offer } from '../src/content/scenarios/offer'
import { tara } from '../src/content/scenarios/tara'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { endingFacts, pickEnding, type EndingId } from '../src/engine/endings'
import { playAnalyses } from '../src/engine/index'
import { templateLine } from '../src/engine/offline'
import { buildReport } from '../src/engine/report'
import type { MoveAnalysis, Offer, Scenario, TurnRecord } from '../src/engine/types'
import { allDeals, formatOffer } from '../src/engine/utility'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const URL = arg('url', 'http://localhost:5173')
const OUT = join(homedir(), 'Arena-materials', 'shots', 'endings')
mkdirSync(OUT, { recursive: true })

type Move = { text: string; analysis: MoveAnalysis }
const hits = (...ids: string[]) => ids.map((id) => ({ id, quote: id }))
const RUDE: Record<string, string> = {
  attack: 'Вы вообще понимаете, с кем разговариваете?',
  irritator: 'Это щедрое предложение, лучше не будет.',
  ultimatum: 'Это максимум. Или так, или никак.',
}
function move(sc: Scenario, a: Partial<MoveAnalysis>): Move {
  const analysis = { behaviors: [], ...a } as MoveAnalysis
  const text = analysis.walksAway
    ? 'Спасибо, но на этом закончим. Мы пойдём к другим.'
    : analysis.accepts
      ? 'Хорошо, принимаю.'
      : analysis.toneViolation
        ? 'Да вы издеваетесь. Хватит пудрить мне мозги.'
        : analysis.offer && Object.keys(analysis.offer).length
          ? `${analysis.behaviors.map((b) => RUDE[b.id]).filter(Boolean).join(' ')} Предлагаю так: ${formatOffer(sc, analysis.offer)}.`.trim()
          : analysis.behaviors.some((b) => b.id === 'summarize')
            ? 'Давайте сверимся: я правильно понял, что для вас важнее всего сроки?'
            : 'А что для вас в этой сделке главное — и почему?'
  return { text, analysis }
}

function withLines(sc: Scenario, h: TurnRecord[]): TurnRecord[] {
  return h.map((r, n) => {
    const { line, emotion } = templateLine(sc, r.decision, r.stateAfter, n ? h[n - 1].stateAfter.lastOpponentOffer : undefined)
    return { ...r, opponentLine: line, emotion }
  })
}

const endOf = (sc: Scenario, h: TurnRecord[]) => pickEnding(endingFacts(sc, buildReport(sc, h, BEHAVIOR_DICT), h.at(-1)?.stateAfter))

/** Первая партия, приводящая к нужному финалу (тот же перебор, что в тестах). */
function find(sc: Scenario, want: EndingId): TurnRecord[] {
  const best = (p: number[]) => p.indexOf(Math.max(...p))
  const mine: Offer = Object.fromEntries(sc.issues.map((i) => [i.id, best(sc.player.profile.points[i.id])]))
  const tries: Move[][] = []
  const deals = allDeals(sc)
  // тёплый пакет — от лучших для обоих сделок к худшим
  const byJoint = [...deals].sort((a, b) => b.player + b.opponent - (a.player + a.opponent))
  for (const p of byJoint) {
    tries.push([move(sc, { behaviors: hits('ask_interest'), asksAbout: [sc.issues[1].id] }), move(sc, { offer: p.offer, behaviors: hits('check', 'package') }), move(sc, { offer: p.offer, behaviors: hits('summarize') }), move(sc, { offer: p.offer })])
  }
  for (const p of byJoint)
    tries.push([move(sc, { behaviors: hits('ask_interest'), asksAbout: [sc.issues[1].id] }), ...Array.from({ length: sc.turnLimit - 1 }, () => move(sc, { offer: p.offer, behaviors: hits('check', 'package') }))])
  for (const first of [['attack'], ['ultimatum', 'irritator']])
    for (const p of byJoint)
      tries.push([move(sc, { offer: mine, behaviors: hits(...first) }), move(sc, { offer: mine }), move(sc, { offer: p.offer }), move(sc, { offer: p.offer }), move(sc, { offer: p.offer })])
  for (const p of deals) tries.push([move(sc, { offer: p.offer }), move(sc, { offer: p.offer }), move(sc, { walksAway: true })])
  tries.push(Array.from({ length: sc.turnLimit + 1 }, (_, t) => move(sc, { behaviors: hits(t % 2 ? 'summarize' : 'ask_interest') })))
  tries.push([move(sc, { offer: mine, behaviors: hits('attack') }), move(sc, { toneViolation: true }), move(sc, { toneViolation: true }), move(sc, { toneViolation: true })])
  for (const p of deals) tries.push(Array.from({ length: sc.turnLimit }, () => move(sc, { offer: p.offer })))
  for (const t of tries) {
    const h = playAnalyses(sc, t, BEHAVIOR_DICT)
    if (h.at(-1)?.stateAfter.status !== 'open' && endOf(sc, h) === want) return withLines(sc, h)
  }
  throw new Error(`${sc.id}: не нашли партию для финала ${want}`)
}

// что снимаем; opened — какие финалы «уже открыты» в прогрессе до этой партии
const PLAN: { sc: Scenario; ending: EndingId; opened: EndingId[] }[] = [
  { sc: tara, ending: 'legend', opened: ['middling', 'walked'] },
  { sc: tara, ending: 'cold_win', opened: [] },
  { sc: tara, ending: 'lose_lose', opened: ['legend', 'slammed', 'timeout'] },
  { sc: tara, ending: 'slammed', opened: ['middling'] },
  { sc: offer, ending: 'walked', opened: [] },
  { sc: offer, ending: 'timeout', opened: ['lose_lose'] },
  { sc: offer, ending: 'short', opened: ['legend', 'middling', 'cold_win', 'walked'] },
]

const browser = await chromium.launch()
try {
  for (const { sc, ending, opened } of PLAN) {
    const history = find(sc, ending)
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: w < 600 ? 2 : 1 })
      const page = await ctx.newPage()
      await page.goto(URL)
      await page.evaluate(
        ({ sc, history, opened }) => {
          localStorage.clear()
          localStorage.setItem(
            'peregovorka.progress.v1',
            JSON.stringify({ cases: {}, tutorialDone: true, endings: opened.length ? { [sc.id]: opened } : {} }),
          )
          sessionStorage.setItem('peregovorka.session.v1', JSON.stringify({ screen: 'report', current: { scenario: sc, fromLibrary: true }, history }))
        },
        { sc, history, opened },
      )
      await page.reload()
      await page.waitForSelector('.g-finale')
      await page.waitForTimeout(900) // штамп и табличка допечатались
      const title = await page.locator('.g-finale-plaque').innerText()
      await page.locator('.g-finale').screenshot({ path: join(OUT, `${sc.id}-${ending}-${w}.png`) })
      if (w === 1280 || ending === 'legend') await page.screenshot({ path: join(OUT, `${sc.id}-${ending}-${w}-top.png`) })
      console.log(`${sc.id} ${ending} ${w}: «${title}», ходов ${history.length}`)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
