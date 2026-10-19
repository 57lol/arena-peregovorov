import { describe, expect, it, vi, afterEach } from 'vitest'
import { newPrepareId, diagnosticId, prepareDiag, prepareCountsLog } from '../shared/prepareDiag'
import { prepareDifference, prepareJournal, ttsDifference, type PrepareParts } from './prepareLog'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const parts: PrepareParts = { who: 'secret-cookie', sc: {}, history: [], text: 'Secret text', accept: false, walkAway: false, opener: false, natural: false, marks: false }
describe('формат диагностики: только известные имена и числа', () => {
  it('различия всех полей, включая режимы озвучки; общий префикс только длиной', () => {
    expect(prepareDifference(parts, { ...parts, who: 'secret-other-cookie', sc: { secret: 'scenario' }, history: ['secret-history'],
      text: 'Secret new text', reaction: 'secret-reaction', offer: { 'secret-key': 1 }, accept: true, walkAway: true,
      opener: true, natural: true, marks: true, lab: 'secret-model', voiceLlm: 'secret-key' })).toBe(
      'text:11/15/prefix:7,session,scenario,history,reaction,offer,accept,walkAway,opener,natural,marks,lab,voiceLlm')
    expect(ttsDifference({ voice: 'secret-voice', 'secret-field\n': 'key' }, { speed: 1, format: 'secret-format' })).toBe('voice,speed,format,other')
  })

  it.each([null, 1, 'secret', [], { id: 'secret\n[ход]', process: 'secret', status: Infinity, counts: { noPartial: -1, shortPause: 'speech', manual: 0.5, limit: Infinity, textChanged: 10000, 'secret-key': 9 } }])('не доверяет служебным полям: %j', (value) => {
    expect(JSON.stringify(prepareDiag(value))).not.toMatch(/secret|speech|Infinity|\[ход\]/)
    expect(prepareCountsLog(value)).toMatch(/^(?:-|textChanged:999)$/)
  })

  it('журнал ограничен 2000 попытками и пятью минутами; явный чужой id не подменяется', () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const journal = prepareJournal()
    for (let i = 0; i <= 2000; i++) journal.add({ id: String(i), who: 'session', at: now, status: 202, reason: 'accepted' })
    expect(journal.find('0', 'session')).toBeUndefined()
    expect(journal.find('1', 'session')).toBeDefined()
    expect(journal.find('missing', 'session')).toBeUndefined()
    expect(journal.find(undefined, 'session')?.id).toBe('2000')
    now += 300_001
    expect(journal.find('2000', 'session')).toBeUndefined()
  })
})

it('Safari без randomUUID: диагностика не мешает отправке заготовки', () => {
  vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
  const id = newPrepareId()
  expect(diagnosticId(id)).toBe(id)
  expect(id[14]).toBe('4')
  expect(newPrepareId()).not.toBe(id)
})
