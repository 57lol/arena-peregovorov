// Галерея катсцен: все ролики «Сюжета» с превью, по клику — проигрываются, потом обратно сюда.
// Экран открывают с титула («Катсцены» в углу) и из хаба жюри; там же — та же лента карточек (Films).

import { useEffect, useRef } from 'react'
import { Button, PixelIcon } from '../ui'
import { H } from './art'
import { Painter, imagesOf } from './render'
import { CUTSCENES } from './scripts'
import { total } from './timeline'
import type { Cutscene } from './types'
import { nameOf, posterOf } from './cards'
import './gallery.css'

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
