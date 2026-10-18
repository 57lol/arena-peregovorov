import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Jury } from './Jury'
import { loadProgress } from '../progress'

it('жюри видит финальную командировку в Лагос и предупреждение о языке', () => {
  const noop = () => {}
  const html = renderToStaticMarkup(<Jury progress={loadProgress()} server={null} onProgress={noop} onOpen={noop} onDemo={noop} onSetup={noop} onCoach={noop} onCareer={noop} onMap={noop} onCutscene={noop} onFilms={noop} onStory={noop} onBack={noop} />)
  expect(html).toContain('🇳🇬 Lagos: экспорт и партнёрство')
  expect(html).toContain('вторая командировка · финальный уровень')
  expect(html).toContain('/assets/portraits/lagos.png')
  expect(html).toContain('с носителем')
})
