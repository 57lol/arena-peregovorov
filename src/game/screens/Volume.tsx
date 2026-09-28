import { useState } from 'react'
import { loadVolume, setVolume } from '../speech'
import { PixelIcon } from '../ui'

/** Ползунок громкости голоса собеседника: меняет звук сразу, даже посреди реплики, и запоминается. */
export function VolumeSlider({ className = 'w3-menu-item w3-volume' }: { className?: string }) {
  const [v, setV] = useState(loadVolume)
  return (
    <label className={className}>
      <PixelIcon name={v > 0 ? 'sound' : 'mute'} px={2} />
      <span>Громкость</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        aria-valuetext={`${Math.round(v * 100)}%`}
        onChange={(e) => {
          const x = Number(e.target.value)
          setV(x)
          setVolume(x)
        }}
      />
    </label>
  )
}
