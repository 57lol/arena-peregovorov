import { expect, it } from 'vitest'
import { endingCatalog } from '../content/endings'
import { china } from '../content/scenarios/china'
import { harder } from '../content/scenarios/harder'
import { istanbul } from '../content/scenarios/istanbul'
import { lagos } from '../content/scenarios/lagos'
import { firstName } from './cast'

for (const [sc, name] of [[istanbul, 'Эмре'], [lagos, 'Адебайо'], [china, 'Ли Вэй']] as const) {
  it(`${sc.id}: русское короткое имя, включая жёсткую версию и свои финалы`, () => {
    expect(firstName(sc)).toBe(name)
    expect(firstName(harder(sc))).toBe(name)
    expect(harder(sc).blurb).toContain(`${name} уступает`)
    expect(endingCatalog({ ...sc, id: 'custom' })[0].epilogue).toContain(name)
  })
}
