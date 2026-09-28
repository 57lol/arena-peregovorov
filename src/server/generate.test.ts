import { describe, expect, it } from 'vitest'
import { GenerateRequest, orderProblems, scenarioProblems, storyProblems, toScenario } from './generate'

const raw = {
  title: 'Склад под маркетплейс', playerRole: 'директор по логистике', playerBrief: '...', playerBatnaText: 'склад в Зеленодольске',
  opponentName: 'Игорь', opponentRole: 'владелец склада', opponentCompany: 'Логопарк', opponentSpeech: 'коротко', opponentBio: '...',
  opponentBrief: '...', opponentBatnaText: 'другой арендатор', opening: 'Ставка 900 за метр.',
  issues: [
    { id: 'rate', title: 'Ставка', role: 'split' as const, options: ['700 ₽/м²', '750 ₽/м²', '800 ₽/м²', '850 ₽/м²', '900 ₽/м²'] },
    { id: 'exit', title: 'Досрочный выход', role: 'mine' as const, options: ['через 3 месяца', 'через 6 месяцев', 'через год', 'нельзя'] },
    { id: 'deposit', title: 'Депозит', role: 'theirs' as const, options: ['нет', '1 месяц', '2 месяца', '3 месяца'] },
    { id: 'term', title: 'Срок', role: 'theirs' as const, options: ['1 год', '2 года', '3 года'] },
    { id: 'ramp', title: 'Пандусы', role: 'shared' as const, options: ['2 новых', '1 новый', 'как есть'] },
  ],
  interests: [{ issue: 'deposit', text: 'кредит под склад' }, { issue: 'ramp', text: 'сам хочет пандусы' }],
}

describe('генерация сценария', () => {
  it('движок строит таблицы по ролям так, что сценарий проходит обе проверки на любой сложности', () => {
    for (const difficulty of [1, 2, 3] as const) {
      const sc = toScenario(raw, GenerateRequest.parse({ difficulty }))
      expect(scenarioProblems(sc).problems).toEqual([])
    }
  })

  it('портрет по полу, имя без должности, интерес без точки в конце', () => {
    const sc = toScenario({ ...raw, opponentName: 'Алсу Галиева, владелица склада', opponentGender: 'f', interests: [{ issue: 'deposit', text: 'кредит под склад.' }, raw.interests[1]] }, GenerateRequest.parse({}))
    expect(sc.opponent.character.name).toBe('Алсу Галиева')
    expect(sc.opponent.character.portrait).toBe('olga')
    expect(sc.opponent.profile.interests[0].text).toBe('кредит под склад')
  })

  it('интерес от третьего лица — замечание, от первого — нет', () => {
    const third = { ...raw, opponentName: 'Игорь Петров', interests: [{ issue: 'deposit', text: 'Игорь хочет залог' }, { issue: 'ramp', text: 'Для него важны пандусы' }] }
    expect(storyProblems(third)).toHaveLength(2)
    const first = { ...raw, opponentName: 'Игорь Петров', interests: [{ issue: 'deposit', text: 'мне нужен залог: кредит под склад' }, { issue: 'ramp', text: 'пандусы я и сам давно хочу поменять' }] }
    expect(storyProblems(first)).toEqual([])
  })

  it('варианты выравниваются по «лучше игроку»: последний назван лучшим — переворачиваем, средний — переписать', () => {
    const flipped = { ...raw, issues: raw.issues.map((i) => (i.id === 'rate' ? { ...i, options: [...i.options].reverse(), bestForPlayer: '700 ₽/м²' } : i)) }
    expect(toScenario(flipped, GenerateRequest.parse({})).issues[0].options[0]).toBe('700 ₽/м²')
    expect(orderProblems(flipped)).toEqual([])
    const middle = { ...raw, issues: raw.issues.map((i) => (i.id === 'rate' ? { ...i, bestForPlayer: '800 ₽/м²' } : i)) }
    expect(orderProblems(middle)).toHaveLength(1)
  })

  it('компания, которая повторяет должность, не дублируется', () => {
    const dup = toScenario({ ...raw, opponentRole: 'руководитель строительной фирмы', opponentCompany: 'строительная фирма' }, GenerateRequest.parse({}))
    expect(dup.opponent.character.company).toBe('')
    expect(toScenario(raw, GenerateRequest.parse({})).opponent.character.company).toBe('Логопарк')
  })
})
