import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-opener-'))
const { checkOpener, openerPrompt, spareOpener, writeOpener } = await import('./opener')
const { findScenario } = await import('./library')
const { initialState } = await import('../engine/turn')
type LLM = import('./llm').LLM

const tara = findScenario('tara')!

describe('заход — первые слова ответа без обязательств', () => {
  it('отклик проходит, обязательства и чужие цифры — нет', () => {
    expect(checkOpener('Главное…')).toBe('Главное…')
    expect(checkOpener('Дешевле, говорите')).toBe('Дешевле, говорите…')
    expect(checkOpener('Загнул, да?')).toBe('Загнул, да?')
    expect(checkOpener('«Exclusivity…»')).toBe('Exclusivity…')
    for (const bad of ['Ладно, двести.', 'Нет.', 'Да.', 'Сегодня — не получится.', 'Okay, deal.', 'Конечно!', 'Отличный вопрос.', 'We can’t do that.', 'Раз два три четыре пять шесть семь восемь девять.'])
      expect(checkOpener(bad), bad).toBeUndefined()
    // цифра — только своя у игрока: переспрос можно, новая цена — нет
    expect(checkOpener('Двести?', 'Давайте за двести')).toBe('Двести?')
    expect(checkOpener('Двести пятьдесят?', 'Давайте за двести')).toBeUndefined()
  })

  it('промпт: характер, его слова, прошлые начала — чтобы не повторяться', () => {
    const history = [{ playerText: 'Привет', opponentLine: 'Давайте по-взрослому, без спешки.', analysis: { behaviors: [] } }] as never
    const p = openerPrompt(tara, history, 'Двести двенадцать — дорого.', initialState(tara))
    expect(p.system).toContain(tara.opponent.character.name)
    expect(p.user).toContain('Двести двенадцать — дорого.')
    expect(p.user).toContain('«Давайте по-взрослому, без…»')
  })

  it('не прошёл проверку — вторая попытка; удачный — в кэше, повтор хода модель не зовёт', async () => {
    const answers = [{ say: 'Ладно, двести.' }, { say: 'Двести, значит…' }]
    const m: LLM = { name: 'yandex', model: 'pro', json: vi.fn(async () => answers.shift()) }
    const text = `Давайте за двести ${Date.now()}`
    expect(await writeOpener(m, tara, [], text, initialState(tara), false, 800)).toBe('Двести, значит…')
    expect(await writeOpener(m, tara, [], text, initialState(tara), false, 800)).toBe('Двести, значит…')
    expect(m.json).toHaveBeenCalledTimes(2)
  })

  it('модель молчит дольше срока — без захода, и это не кэшируется', async () => {
    const m: LLM = { name: 'yandex', model: 'pro', json: vi.fn(() => new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 50))) }
    expect(await writeOpener(m, tara, [], `Тишина ${Date.now()}`, initialState(tara), false, 120)).toBeUndefined()
  })
})

describe('запасной заход', () => {
  it('на языке дела, проходит проверку захода и не повторяет начало прошлой реплики', () => {
    const lagos = findScenario('lagos')!
    expect(spareOpener(tara, [])).toBe('Так…')
    expect(spareOpener(lagos, [])).toBe('Well…')
    for (const sc of [tara, lagos]) for (let n = 0; n < 6; n++) {
      const history = Array.from({ length: n }, () => ({ opponentLine: 'Так… ну что ж.' })) as never
      const s = spareOpener(sc, history)
      expect(checkOpener(s)).toBe(s)
      expect(s.startsWith('Так…') && n > 0).toBe(false)
    }
  })
})
