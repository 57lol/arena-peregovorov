import { useState } from 'react'
import type { Scenario } from '../../engine/types'
import { shareLink } from '../share'
import { Button } from '../ui'

/** «Ссылка для команды»: копирует адрес дела; если буфер недоступен — показывает ссылку, чтобы скопировать руками. */
export function ShareButton({ scenario, fromLibrary }: { scenario: Scenario; fromLibrary: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | { manual: string }>('idle')
  const click = async () => {
    const link = await shareLink(scenario, fromLibrary)
    try {
      await navigator.clipboard.writeText(link)
      setState('copied')
      setTimeout(() => setState('idle'), 2400)
    } catch {
      setState({ manual: link })
    }
  }
  return (
    <span className="g-share">
      <Button variant="ghost" onClick={click} title="У всех по ссылке одинаковые условия — результаты можно сравнить">
        {state === 'copied' ? 'Ссылка скопирована' : 'Ссылка для команды'}
      </Button>
      {typeof state === 'object' && (
        <input className="g-share-manual" readOnly value={state.manual} onFocus={(e) => e.target.select()} autoFocus aria-label="Ссылка на дело" />
      )}
    </span>
  )
}
