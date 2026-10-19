import { useState, useSyncExternalStore } from 'react'
import { Button, PixelIcon } from '../ui'
import { audible, getVolume, setSoundOn, setVolume, soundOn, subscribe, type Channel } from './engine'
import './sound.css'

const LABEL: Record<Channel, string> = { music: 'Музыка', sfx: 'Звуки', voice: 'Голос' }

/** Ползунок громкости канала: меняет звук сразу и запоминается. Голос — тот же, что озвучка собеседника. */
export function ChannelSlider({ ch, className = 'snd-row' }: { ch: Channel; className?: string }) {
  const [v, setV] = useState(() => getVolume(ch))
  return (
    <label className={className}>
      <PixelIcon name={v > 0 ? 'sound' : 'mute'} px={2} />
      <span>{LABEL[ch]}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        aria-valuetext={`${Math.round(v * 100)} %`}
        onChange={(e) => {
          const x = Number(e.target.value)
          setV(x)
          setVolume(ch, x)
        }}
      />
    </label>
  )
}

/** Главный экран: «звук вкл/выкл» одной кнопкой и громкость по каналам рядом. */
export function SoundToggle() {
  const on = useSyncExternalStore(subscribe, soundOn, () => false)
  const [open, setOpen] = useState(false)
  return (
    <div className="snd-corner">
      <Button variant="ghost" icon={on ? 'sound' : 'mute'} aria-label={on ? 'Выключить звук' : 'Включить звук'} title={on ? 'Выключить музыку и звуки' : 'Включить музыку и звуки'} onClick={() => setSoundOn(!on)}>
        {on ? 'Звук' : 'Без звука'}
      </Button>
      <Button variant="ghost" icon={open ? 'cross' : 'more'} aria-expanded={open} aria-label="Громкость" title="Громкость" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="snd-panel" role="group" aria-label="Громкость">
          {(['music', 'sfx', 'voice'] as const).map((ch) => (
            <ChannelSlider key={ch} ch={ch} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Плашка у главных кнопок титула: пока музыка не звучит (браузер ждёт первого клика или звук выключили), её видно
 * сразу, и включить можно одним нажатием. Любой клик или клавиша по странице тоже включают звук — плашка пропадает.
 * В прогонах Playwright звук выключен нарочно — там плашки нет.
 */
export function MusicHint() {
  const on = useSyncExternalStore(subscribe, audible, () => true)
  if (on || (typeof navigator !== 'undefined' && navigator.webdriver)) return null
  return (
    <div className="snd-hint-row">
      <button type="button" className="snd-hint" onClick={() => setSoundOn(true)}>
        <PixelIcon name="mute" px={2} className="snd-hint-icon" />
        <span>
          Музыка выключена — <b>включить</b>
        </span>
      </button>
    </div>
  )
}
