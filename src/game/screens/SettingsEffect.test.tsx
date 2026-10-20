import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { generatedScenario } from '../../engine/__fixtures__/scenarioMatrix'
import { focusOf, meetingTuning } from '../../engine/settings'
import type { Scenario, TurnRecord } from '../../engine/types'
import { FocusCheck, SettingsEffect } from './SettingsEffect'

const sc: Scenario = { ...generatedScenario, tuning: meetingTuning(3, 'aggressive', ['interests']), focus: focusOf(['interests']) }

describe('сводка настроек для руководителя', () => {
  it('показывает строки с сервера, а без них считает сама по делу', () => {
    const html = renderToStaticMarkup(<SettingsEffect scenario={sc} lines={['Зона торга: узкая.', 'Окупается приём «Ярлык».']} />)
    expect(html).toContain('собрано под ваши настройки')
    expect(html).toContain('Окупается приём «Ярлык».')
    const own = renderToStaticMarkup(<SettingsEffect scenario={sc} />)
    expect(own).toMatch(/Зона торга \S+: собеседник может уступить до \d+%/)
    expect(own).toContain('Окупается приём')
  })

  it('в разборе отмечает приёмы под цели: применённые и пропущенные', () => {
    const turn = { analysis: { behaviors: [{ id: 'ask_interest', quote: 'почему?' }, { id: 'ask_interest', quote: 'а зачем?' }] } } as unknown as TurnRecord
    const html = renderToStaticMarkup(<FocusCheck sc={sc} history={[turn]} />)
    expect(html).toContain('Под цели этого дела')
    expect(html).toMatch(/применили 2 раза/)
    expect(html).toMatch(/не было — /)
    expect(renderToStaticMarkup(<FocusCheck sc={generatedScenario} history={[turn]} />)).toBe('')
  })
})
