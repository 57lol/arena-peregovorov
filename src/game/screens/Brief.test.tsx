import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { getScenario } from '../../content/scenarios'
import { Brief } from './Brief'

it('в целях брифа Ли Вэя MOQ сохраняет регистр, обычные заголовки начинаются со строчной', () => {
  const html = renderToStaticMarkup(<Brief game={{ scenario: getScenario('china')!, fromLibrary: true }} onStart={() => {}} onBack={() => {}} />)
  expect(html).toMatch(/Главное для вас — [^.]*MOQ — минимальная партия/)
  expect(html).toContain('цена датчика за штуку')
  expect(html).not.toContain('mOQ')
})
