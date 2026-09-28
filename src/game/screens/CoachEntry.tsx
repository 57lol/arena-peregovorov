import { Button } from '../ui'

/** Вход в кабинет руководителя: записка на краю стола, не мешает игроку. */
export function CoachEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <aside className="g-coach-note" aria-labelledby="coach-note-h">
      <p className="g-coach-note-tab">Для руководителя</p>
      <h2 id="coach-note-h" className="g-coach-note-title">
        Проведите тренировку для команды
      </h2>
      <p className="g-coach-note-text">
        Дайте всем одно дело по ссылке. Каждый сыграет со своего телефона, а вы на одной доске увидите, кто как договорился
        и что чаще мешало команде.
      </p>
      <Button icon="right" onClick={onOpen}>
        Открыть кабинет
      </Button>
    </aside>
  )
}
