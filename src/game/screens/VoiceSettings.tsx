import { useEffect, useState } from 'react'
import { saveInputMode, savePause, useVoiceSettings, type PauseLevel } from '../voiceSettings'
import { loadMicId, saveMicId } from '../recording'
import { PixelIcon } from '../ui'

/**
 * Какой микрофон слушать и совет, если распознаёт через раз. «В наушниках 50/50» (брат, AirPods на iPhone):
 * Bluetooth-гарнитура пишет звук хуже встроенного микрофона. Список появляется, только если микрофонов больше одного;
 * в 3D меню ставит микрофон на паузу, и после «Вернуться за стол» он открывается уже выбранный.
 */
function MicPicker({ className = 'w3-menu-item w3-volume' }: { className?: string }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [id, setId] = useState(() => loadMicId() ?? '')
  useEffect(() => {
    let alive = true
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((d) => alive && setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId && x.deviceId !== 'default' && x.label)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className={`${className} g-mic-pick`}>
      {mics.length > 1 && (
        <label>
          <PixelIcon name="mic" px={2} /> Микрофон:{' '}
          <select
            value={mics.some((m) => m.deviceId === id) ? id : ''}
            onChange={(e) => {
              setId(e.target.value)
              saveMicId(e.target.value)
            }}
          >
            <option value="">как в системе</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <small className="g-mic-tip">
        Плохо слышит? Говорите ближе к микрофону. В Bluetooth-наушниках (AirPods) распознаёт хуже — попробуйте без них
        {mics.length > 1 ? ' или выберите встроенный микрофон' : ''}.
      </small>
    </div>
  )
}

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
      {mode === 'voice' && (
        <li>
          <MicPicker />
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
      {mode === 'voice' && <MicPicker className="g-voice-pause" />}
    </section>
  )
}
