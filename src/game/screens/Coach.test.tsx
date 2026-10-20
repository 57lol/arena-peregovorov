import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../../content/scenarios'
import { migrate } from '../progress'
import { Coach, LinkField } from './Coach'
import { Setup } from './Setup'

describe('путь руководителя', () => {
  it('начинается с трёх шагов и показывает конструктор перед готовыми делами', () => {
    const html = renderToStaticMarkup(<Coach progress={migrate(null)} server={{ ok: true, provider: 'offline' }} onBack={() => {}} />)
    expect(html).toContain('Кабинет руководителя')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('Проверьте встречу')
    expect(html).toContain('Ссылка команде')
    expect(html.indexOf('Своё дело под задачу команды')).toBeLessThan(html.indexOf(SCENARIOS[0].title))
    expect(html).toContain('Закупка у поставщика')
    expect(html).toContain('Проверить встречу')
    expect(html).not.toContain('Дать команде')
  })

  it('поле истории доступно и в обычной папке, ограничение видно до отправки', () => {
    const html = renderToStaticMarkup(<Setup progress={migrate(null)} server={null} customOpen onBack={() => {}} onOpen={() => {}} />)
    expect(html).toContain('Своя история / контекст')
    expect(html).toContain('maxLength="1500"')
    expect(html).toContain('необязательно')
    expect(html).toContain('0 / 1500')
    expect(html).toContain('Сейчас офлайн-режим')
  })

  it('без сервера предлагает восстановить связь, не выдаёт нерабочую тренировку', () => {
    const html = renderToStaticMarkup(<Coach progress={migrate(null)} server={null} onBack={() => {}} />)
    expect(html).toContain('Кабинету нужен сервер')
    expect(html).not.toContain('Проверить встречу')
  })

  it('секретная ссылка подписана отдельно и копируется себе', () => {
    const html = renderToStaticMarkup(<LinkField label="Доска руководителя" value="https://game.test/?board=room&key=secret" secret />)
    expect(html).toContain('только вам')
    expect(html).toContain('Скопировать себе')
    expect(html).toContain('aria-label="Доска руководителя"')
    expect(html).toContain('role="status"')
  })
})
