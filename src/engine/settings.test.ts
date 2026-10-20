import { describe, expect, it } from 'vitest'
import { BEHAVIOR_DICT } from './behaviors'
import { curveOf, revealAt, targetUtility } from './policy'
import { focusOf, meetingTuning, settingsEffect, skillsOf } from './settings'
import { initialState, replay } from './turn'
import type { MoveAnalysis, Scenario } from './types'
import { score } from './utility'
import { generatedScenario } from './__fixtures__/scenarioMatrix'

const base = generatedScenario as Scenario
const tuned = (sc: Scenario, difficulty: 1 | 2 | 3, tone: Scenario['opponent']['character']['tone'], goals = ''): Scenario => {
  const tuning = meetingTuning(difficulty, tone, skillsOf(goals))
  return { ...sc, difficulty, turnLimit: tuning.turnLimit, tuning, opponent: { ...sc.opponent, character: { ...sc.opponent.character, tone } } }
}

// Одна и та же партия: вопрос о причинах, потом игрок стоит на своём и по шагу уступает в делимом пункте
function script(sc: Scenario): MoveAnalysis[] {
  const best = Object.fromEntries(sc.issues.map((i) => [i.id, sc.player.profile.points[i.id].indexOf(Math.max(...sc.player.profile.points[i.id]))]))
  const main = sc.issues.find((i) => i.kind === 'distributive') ?? sc.issues[0]
  const moves: MoveAnalysis[] = [{ behaviors: [{ id: 'ask_interest', quote: 'почему?' }], asksAbout: sc.issues.map((i) => i.id) }]
  for (let k = 0; k < 6; k++) {
    const step = Math.min(main.options.length - 1, Math.floor(k / 2))
    const at = best[main.id] === 0 ? step : main.options.length - 1 - step
    moves.push({ behaviors: k === 2 ? [{ id: 'label', quote: 'кажется, вам важно' }] : [], offer: { ...best, [main.id]: at } })
  }
  return moves
}

describe('настройки руководителя → параметры встречи', () => {
  it('тон меняет характер: напористый уступает медленнее, злится быстрее и раньше уходит, чем дружелюбный', () => {
    const f = meetingTuning(2, 'friendly'), a = meetingTuning(2, 'aggressive')
    expect(a.concession).toBeLessThan(f.concession)
    expect(a.reserve).toBeGreaterThan(f.reserve)
    expect(a.tension).toBeGreaterThan(f.tension)
    expect(a.trust).toBeLessThan(f.trust)
    expect(a.tensionGain).toBeGreaterThan(f.tensionGain)
    expect(a.walkAt).toBeLessThan(f.walkAt)
    expect(meetingTuning(2, 'evasive').revealShift).toBeGreaterThan(f.revealShift)
  })

  it('сложность меняет рынок: зона торга уже, уступки медленнее, встреча длиннее', () => {
    const [e, m, h] = ([1, 2, 3] as const).map((d) => meetingTuning(d, 'neutral'))
    expect(e.oppBatna).toBeLessThan(m.oppBatna)
    expect(m.oppBatna).toBeLessThan(h.oppBatna)
    expect(e.concession).toBeGreaterThan(m.concession)
    expect(m.concession).toBeGreaterThan(h.concession)
    expect(h.turnLimit).toBeGreaterThan(e.turnLimit)
    // без тона и навыков — те же цифры, что были у сгенерированных дел до таблицы
    expect(m).toMatchObject({ oppBatna: 0.32, playerBatna: 0.28, concession: 1, reserve: 0.12, trust: 45, tension: 20, turnLimit: 12 })
  })

  it('навыки задают ситуацию: запасной вариант сильнее, встреча короче, давление на входе, интересы открываются вопросом', () => {
    expect(skillsOf('Выяснять скрытые интересы; меняться пунктами')).toEqual(['interests', 'package'])
    expect(skillsOf('')).toEqual([])
    const plain = meetingTuning(2, 'neutral')
    expect(meetingTuning(2, 'neutral', ['batna']).playerBatna).toBeGreaterThan(plain.playerBatna)
    expect(meetingTuning(2, 'neutral', ['deadline']).turnLimit).toBeLessThan(plain.turnLimit)
    expect(meetingTuning(2, 'neutral', ['pressure']).tension).toBeGreaterThan(plain.tension)
    expect(meetingTuning(2, 'neutral', ['interests']).revealShift).toBeLessThan(plain.revealShift)
    expect(meetingTuning(2, 'neutral', ['anchor']).oppBatna).toBeLessThan(plain.oppBatna)
    expect(focusOf(['interests'])).toContain('ask_interest')
  })

  it('движок читает настройки: старт, кривая уступок, порог раскрытия', () => {
    const f = tuned(base, 2, 'friendly'), a = tuned(base, 2, 'aggressive')
    expect(initialState(f).trust).toBeGreaterThan(initialState(a).trust)
    expect(curveOf(a).e).toBeLessThan(curveOf(f).e)
    const st = initialState(base)
    expect(targetUtility(a, st, 5)).toBeGreaterThan(targetUtility(f, st, 5))
    const it = base.opponent.profile.interests[0]
    expect(revealAt(tuned(base, 2, 'evasive'), it)).toBeGreaterThan(revealAt(f, it))
    // «сыграть жёстче» поверх настроек — ещё упрямее
    expect(curveOf({ ...a, harder: 1 }).e).toBeLessThan(curveOf(a).e)
    // дело без настроек — как раньше, по ступени сложности
    expect(curveOf(base)).toEqual({ e: 1.0, reserve: 0.12 })
  })

  it('та же офлайн-партия с другим тоном или сложностью идёт по-другому', () => {
    const run = (sc: Scenario) => replay(sc, script(sc), BEHAVIOR_DICT)
    const trace = (sc: Scenario) => run(sc).map((r) => [r.decision.kind, r.state.trust, r.state.tension, score(sc.opponent.profile, r.state.tableOffer as Record<string, number>)])
    const friendly = tuned(base, 2, 'friendly'), aggressive = tuned(base, 2, 'aggressive')
    const fr = run(friendly), ag = run(aggressive)
    expect(trace(friendly)).not.toEqual(trace(aggressive))
    // дружелюбный к концу доверяет больше и спокойнее
    expect(fr[fr.length - 1].state.trust).toBeGreaterThan(ag[ag.length - 1].state.trust)
    expect(fr[fr.length - 1].state.tension).toBeLessThan(ag[ag.length - 1].state.tension)
    // на четвёртом ходу напористый просит себе больше
    const own = (sc: Scenario, r: typeof fr) => score(sc.opponent.profile, r[3].state.tableOffer as Record<string, number>)
    expect(own(aggressive, ag)).toBeGreaterThanOrEqual(own(friendly, fr))
    expect(trace(tuned(base, 1, 'neutral'))).not.toEqual(trace(tuned(base, 3, 'neutral')))
  })

  it('сводка для руководителя говорит цифрами дела и называет приёмы под цели', () => {
    const sc = { ...tuned(base, 3, 'aggressive', 'Выяснять интересы'), focus: focusOf(['interests']) }
    const lines = settingsEffect(sc)
    expect(lines[0]).toMatch(/^Зона торга: .*\d+%/)
    expect(lines.join(' ')).toMatch(/напористый: уступает медленно|напористый: почти не двигается/)
    expect(lines.join(' ')).toMatch(/взрывается быстро/)
    expect(lines.some((l) => l.startsWith('Окупается приём «Спросите: «Почему?»»'))).toBe(true)
    expect(settingsEffect(tuned(base, 1, 'friendly')).join(' ')).toMatch(/уступает рано/)
    // дело без настроек (из папки) — тоже описывается, без выдумок про характер
    expect(settingsEffect(base).length).toBeGreaterThanOrEqual(3)
  })
})
