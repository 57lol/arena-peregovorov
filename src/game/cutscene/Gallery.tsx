// Галерея катсцен: все ролики «Сюжета» с превью, по клику — проигрываются, потом обратно сюда.
// Экран открывают с титула («Катсцены» в углу) и из хаба жюри; там же — та же лента карточек (Films).

import { useEffect, useRef } from 'react'
import { Button, PixelIcon } from '../ui'
import { H } from './art'
import { Painter, imagesOf } from './render'
import { BRIDGES, CUTSCENES } from './scripts'
import { total } from './timeline'
import type { Cutscene, Shot } from './types'
import { CHAPTERS } from '../../content/story'
import './gallery.css'

/** Кадр для превью: первый «живой» план (не титр, не карта и не телефон крупно), чуть дальше середины — там уже кто-то в кадре. */
export function posterOf(cs: Cutscene): { shot: Shot; t: number } {
  const shot = cs.shots.find((s) => s.set !== 'black' && s.set !== 'map' && s.set !== 'phone') ?? cs.shots[0]
  return { shot, t: Math.min(shot.dur * 0.6, shot.dur - 0.05) }
}

/** Где катсцена в неделе: «Пролог», «После главы 2», «Финал». */
export function placeOf(cs: Cutscene): string {
  if (cs.id === 'prologue') return 'Пролог'
  const after = Object.keys(BRIDGES).find((k) => BRIDGES[k].id === cs.id)
  const i = CHAPTERS.findIndex((c) => c.id === after)
  if (i < 0) return ''
  return CHAPTERS[i].kind === 'finale' ? 'Финал недели' : `После главы ${i + 1}`
}

/** Подпись карточки: «После главы 1 · Понедельник» и «На остановку» из «Понедельник: на остановку». */
export function nameOf(cs: Cutscene): { place: string; title: string } {
  const [head, ...rest] = cs.title.split(':')
  const tail = rest.join(':').trim()
  const place = placeOf(cs)
  if (!tail) return { place, title: cs.title }
  return {
    place: place.toLowerCase().includes(head.trim().toLowerCase()) ? place : `${place} · ${head.trim()}`,
    title: tail.charAt(0).toUpperCase() + tail.slice(1),
  }
}

/** Превью: один кадр движком катсцен на маленьком холсте, целыми пикселями. */
function Poster({ cs }: { cs: Cutscene }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const p = new Painter(ref.current!)
    p.setWidth(320)
    const { shot, t } = posterOf(cs)
    let live = true
    p.load(imagesOf(shot)).then(() => live && p.draw(shot, t))
    return () => {
      live = false
    }
  }, [cs])
  return <canvas ref={ref} className="gl-poster" width={320} height={H} aria-hidden="true" />
}

/** Лента карточек катсцен: превью, где в неделе, название, длина. */
export function Films({ onPlay }: { onPlay: (id: string) => void }) {
  return (
    <ul className="gl-films">
      {CUTSCENES.map((cs) => {
        const to = cs.shots.at(-1)?.card
        return (
          <li key={cs.id}>
            <button type="button" className="gl-film" onClick={() => onPlay(cs.id)}>
              <span className="gl-frame">
                <Poster cs={cs} />
                <span className="gl-play" aria-hidden="true">
                  <PixelIcon name="right" px={3} />
                </span>
                <span className="gl-len">{Math.round(total(cs))} с</span>
              </span>
              <span className="gl-place">{nameOf(cs).place}</span>
              <span className="gl-title">{nameOf(cs).title}</span>
              {to && cs.id !== 'finale' && <span className="gl-to">дальше: {to.title}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function Gallery({ onPlay, onBack, back }: { onPlay: (id: string) => void; onBack: () => void; back: string }) {
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk gl-page">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            {back}
          </Button>
        </header>
        <h1 className="g-h1">Катсцены</h1>
        <p className="gl-lead">Все ролики «Сюжета» без прохождения. Клик — следующий план, Esc — обратно сюда.</p>
        <Films onPlay={onPlay} />
      </main>
    </div>
  )
}
