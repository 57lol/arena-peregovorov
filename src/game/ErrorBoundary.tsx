// Последняя страховка: любая ошибка отрисовки вместо белого экрана показывает записку с выходом.
// Битый чанк после деплоя лечится перезагрузкой; если перезагружали только что — тоже записка.

import { Component, type ReactNode } from 'react'
import { isChunkError, reloadForChunk } from './chunkRecovery'
import { Button } from './ui'

/** Сохранённая партия вкладки: если ошибка в ней, «Обновить» поднимет ту же ошибку. */
const SESSION = 'peregovorka.session.v1'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    if (isChunkError(error)) reloadForChunk()
  }

  render() {
    if (!this.state.failed) return this.props.children
    const restart = () => {
      try {
        sessionStorage.removeItem(SESSION)
      } catch {
        // без хранилища партия и не сохранялась
      }
      location.reload()
    }
    return (
      <main className="px-root px-desk" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <div className="px-slip" role="alert" style={{ maxWidth: '28em' }}>
          <p className="px-slip-from">Переговорка</p>
          <p>Игра споткнулась. Обновите страницу — вернётесь туда, где были.</p>
          <p>Не помогает — начните заново с титула: пройденные дела сохранятся.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            <Button variant="brass" onClick={() => location.reload()}>
              Обновить
            </Button>
            <Button onClick={restart}>Начать заново</Button>
          </div>
        </div>
      </main>
    )
  }
}
