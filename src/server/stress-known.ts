// Заранее известные тексты для голоса: вступления, свои реплики персонажей и общие шаблоны движка (с подставленными
// условиями), интересы, пункты листка, фразы-паузы, субтитры катсцен (на будущее — рассказчик). Их ударения
// разобраны офлайн: __fixtures__/stress-known.json, проверка — stress-known.test.ts, пересборка — scripts/stress-known.ts.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_SCENARIOS } from '../content/scenarios'
import { FILLERS } from '../content/fillers'
import { openingAnchor } from '../engine/policy'
import { formatOffer } from '../engine/utility'

export interface KnownText {
  src: string
  text: string
}

/** Строки из исходника, где есть кириллица (общие шаблоны движка не экспортируются — берём из файла). */
function literals(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  return [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]).filter((s) => /[а-яё]/i.test(s) && /\s/.test(s))
}

const fill = (line: string, offer: string, interest: string, main: string) =>
  line.replace('{offer}', offer).replace('{interest}', interest).replace('{main}', main)

export function knownTexts(cutscenes: KnownText[] = []): KnownText[] {
  const out: KnownText[] = []
  for (const sc of ALL_SCENARIOS) {
    const offer = formatOffer(sc, openingAnchor(sc))
    const interests = sc.opponent.profile.interests.map((i) => i.text)
    const main = offer.split(', ')[0] ?? ''
    out.push({ src: `${sc.id}:opening`, text: sc.opening })
    for (const [kind, lines] of Object.entries(sc.opponent.character.lines ?? {}))
      for (const l of lines ?? []) out.push({ src: `${sc.id}:lines.${kind}`, text: fill(l, offer, interests[0] ?? '', main) })
    for (const t of interests) out.push({ src: `${sc.id}:interest`, text: t })
    for (const i of sc.issues) for (const o of i.options) out.push({ src: `${sc.id}:issue`, text: `${i.title.toLowerCase()} — ${o}` })
  }
  const sample = ALL_SCENARIOS[0]
  const sampleOffer = formatOffer(sample, openingAnchor(sample))
  for (const l of literals('src/engine/offline/lines.ts'))
    out.push({ src: 'engine:lines', text: fill(l, sampleOffer, sample.opponent.profile.interests[0]?.text ?? '', sampleOffer.split(', ')[0]) })
  for (const g of Object.values(FILLERS)) for (const t of Object.values(g)) out.push({ src: 'fillers', text: t })
  out.push(...cutscenes)
  const seen = new Set<string>()
  return out.filter((k) => k.text.trim() && !seen.has(k.text) && seen.add(k.text))
}

/** Все строки катсцен с кириллицей (субтитры, памятки, сообщения) — рассказчик пока не встроен, ударения готовим заранее. */
export function cutsceneTexts(all: unknown[]): KnownText[] {
  const out: KnownText[] = []
  const walk = (o: unknown, path: string) => {
    if (typeof o === 'string') {
      if (/[а-яё]/i.test(o) && /\s/.test(o)) out.push({ src: path, text: o })
    } else if (Array.isArray(o)) o.forEach((x) => walk(x, path))
    else if (o && typeof o === 'object')
      for (const [k, v] of Object.entries(o)) if (!['id', 'set', 'mood', 'face', 'who', 'kind', 'at'].includes(k)) walk(v, path)
  }
  for (const c of all) walk(c, `cutscene:${(c as { id?: string }).id ?? ''}`)
  return out
}
