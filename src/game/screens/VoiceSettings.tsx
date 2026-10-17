import { saveInputMode, savePause, useVoiceSettings, type PauseLevel } from '../voiceSettings'
import { PixelIcon } from '../ui'

const LEVELS: PauseLevel[] = ['short', 'medium', 'long']
const LEVEL_RU: Record<PauseLevel, string> = { short: 'коротко', medium: 'средне', long: 'долго' }

/** Ползунок «Сколько ждать, пока я договорю»: коротко / средне / долго. */
export function PauseSlider({ className = 'w3-menu-item w3-volume' }: { className?: string }) {
  const { pause } = useVoiceSettings()
  return (
    <label className={className}>
      <PixelIcon name="mic" px={2} />
      <span>
        Ждать, пока я договорю: <b>{LEVEL_RU[pause]}</b>
      </span>
      <input
        type="range"
        min={0}
        max={2}
        step={1}
        value={LEVELS.indexOf(pause)}
        aria-label="Сколько ждать, пока я договорю"
        aria-valuetext={LEVEL_RU[pause]}
        onChange={(e) => savePause(LEVELS[Number(e.target.value)] ?? 'medium')}
      />
    </label>
  )
}

/** Пункт меню встречи: «Отвечаю голосом / текстом» одной кнопкой и пауза, если голосом. */
export function VoiceMenuItems() {
  const { mode } = useVoiceSettings()
  return (
    <>
      <li>
        <button type="button" className="w3-menu-item" aria-pressed={mode === 'voice'} onClick={() => saveInputMode(mode === 'voice' ? 'text' : 'voice')}>
          <PixelIcon name={mode === 'voice' ? 'mic' : 'pen'} px={2} /> {mode === 'voice' ? 'Отвечаю голосом — писать текстом' : 'Отвечаю текстом — говорить голосом'}
        </button>
      </li>
      {mode === 'voice' && (
        <li>
          <PauseSlider />
        </li>
      )}
    </>
  )
}

/** Запасной 2D-вид: те же настройки в правой колонке. */
export function VoiceSettings2D() {
  const { mode } = useVoiceSettings()
  return (
    <section className="g-voice-set" aria-label="Как отвечать">
      <div className="g-voice-seg" role="group" aria-label="Как отвечать">
        <button type="button" className="g-voice-seg-btn" aria-pressed={mode === 'voice'} onClick={() => saveInputMode('voice')}>
          Говорить голосом
        </button>
        <button type="button" className="g-voice-seg-btn" aria-pressed={mode === 'text'} onClick={() => saveInputMode('text')}>
          Писать текстом
        </button>
      </div>
      {mode === 'voice' && <PauseSlider className="g-voice-pause" />}
    </section>
  )
}
