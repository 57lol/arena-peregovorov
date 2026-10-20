// Как настройки руководителя повлияли на дело: короткая сводка после сборки «Своего дела»
// и проверка в разборе — применил ли игрок те приёмы, ради которых дело собирали.

import type { ReactNode } from 'react'
import { behaviorById } from '../../engine/behaviors'
import { TECHNIQUES } from '../../engine/books'
import { settingsEffect } from '../../engine/settings'
import type { Scenario, TurnRecord } from '../../engine/types'
import './SettingsEffect.css'

/** Сводка «как настройки повлияли на дело»: строки с сервера, а если их нет — по самому делу. */
export function SettingsEffect({ scenario, lines, children }: { scenario: Scenario; lines?: string[]; children?: ReactNode }) {
  const shown = lines?.length ? lines : settingsEffect(scenario)
  return (
    <div className="g-effect" role="status">
      <h4>Дело «{scenario.title}» собрано под ваши настройки</h4>
      <ul>
        {shown.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {children}
    </div>
  )
}

/** Разбор: приёмы, которые руководитель просил потренировать, — сколько раз игрок их применил. */
export function FocusCheck({ sc, history }: { sc: Scenario; history: TurnRecord[] }) {
  if (!sc.focus?.length) return null
  const used = new Map<string, number>()
  for (const h of history) for (const b of h.analysis.behaviors) used.set(b.id, (used.get(b.id) ?? 0) + 1)
  return (
    <div className="g-effect">
      <h4>Под цели этого дела</h4>
      <ul>
        {sc.focus.map((id) => {
          const n = used.get(id) ?? 0
          const name = behaviorById(id)?.title ?? TECHNIQUES[id as keyof typeof TECHNIQUES]?.refs[0]?.name ?? id
          return (
            <li key={id} className={n ? 'g-effect-used' : undefined}>
              {name}: {n ? `применили ${n} раз${n % 10 >= 2 && n % 10 <= 4 && (n < 12 || n > 14) ? 'а' : ''}` : `не было — ${TECHNIQUES[id as keyof typeof TECHNIQUES]?.say ?? ''}`}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
