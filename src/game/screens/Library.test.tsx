import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { behaviorById, type BehaviorId } from '../../engine/behaviors'
import { BOOKS, BOOK_ORDER, TECHNIQUES, techniquesOf } from '../../engine/books'
import { Method } from './Method'
import { Library } from './Library'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

it('библиотека: пять книг и все приёмы из них с примерами, у каждого приёма есть название в игре', () => {
  const html = renderToStaticMarkup(<Library onBack={() => {}} />)
  for (const id of BOOK_ORDER) {
    const b = BOOKS[id]
    for (const s of [b.authors, b.title, b.original, b.edition, b.idea, b.inGame]) expect(html, id).toContain(esc(s))
    const own = techniquesOf(id)
    expect(own.length, id).toBeGreaterThan(0)
    for (const t of own) expect(html, `${id}/${t.id}`).toContain(esc(t.ref.name))
  }
  for (const [id, t] of Object.entries(TECHNIQUES) as [BehaviorId, (typeof TECHNIQUES)[BehaviorId]][]) {
    const b = behaviorById(id)
    expect(b?.title, id).toBeTruthy()
    if (!t.refs.length) continue
    expect(html, id).toContain(esc(t.say))
    expect(html, id).toContain(esc(`в игре: ${b!.title}`))
  }
  // ловушки — отдельным списком, а приём без книги честно подписан
  expect(html).toContain('Чего избегать')
  expect(html).toContain(esc(TECHNIQUES.dilution.note!))
  // открыта одна книга, остальные спрятаны
  expect(html.match(/<section[^>]* hidden/g)).toHaveLength(BOOK_ORDER.length - 1)
})

it('«Как мы считаем» знает про все приёмы и пять книг', () => {
  const html = renderToStaticMarkup(<Method onBooks={() => {}} />)
  expect(html).toContain('30 приёмов')
  for (const id of BOOK_ORDER) expect(html).toContain(esc(BOOKS[id].authors))
  expect(html).toContain('Библиотека приёмов')
  expect(html).toContain('Getting Past No')
  expect(html).toContain('Difficult Conversations')
})
