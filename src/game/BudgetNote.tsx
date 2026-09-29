// Плашка про демо-бюджет нейросети (общий лимит LLM_TOTAL_RUB на сервере): на встрече и в хабе «Для жюри».
// Режим берём из /api/health при каждом показе. Крестик прячет плашку до конца сессии (для этого режима).

import { useEffect, useState } from 'react'
import { health } from './api'

const TEXT = {
  lite: 'Демо-бюджет нейросети почти израсходован — собеседник отвечает упрощённой моделью. Разбор и оценка считаются так же.',
  offline:
    'Демо-бюджет нейросети (6000 ₽) израсходован — собеседник говорит заготовками, голос выключен. Движок, разбор и оценка работают как обычно: они не зависят от нейросети.',
}
const KEY = 'arena.budget-note.closed'

export function BudgetNote() {
  const [mode, setMode] = useState<'lite' | 'offline' | null>(null)
  useEffect(() => {
    let alive = true
    health().then((h) => {
      // провайдер offline с самого начала — это не бюджет, плашка не нужна
      if (!alive || !h || h.provider === 'offline') return
      const m = h.mode === 'lite' || h.mode === 'offline' ? h.mode : null
      let closed = ''
      try {
        closed = sessionStorage.getItem(KEY) ?? ''
      } catch {
        // нет хранилища — просто покажем
      }
      setMode(m && closed !== m ? m : null)
    })
    return () => {
      alive = false
    }
  }, [])
  if (!mode) return null
  const close = () => {
    try {
      sessionStorage.setItem(KEY, mode)
    } catch {
      // ничего
    }
    setMode(null)
  }
  return (
    <div className="g-budget-note" role="status" data-mode={mode}>
      <p>{TEXT[mode]}</p>
      <button type="button" aria-label="Закрыть" onClick={close}>
        ×
      </button>
    </div>
  )
}
