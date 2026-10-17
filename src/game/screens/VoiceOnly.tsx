import type { Meeting } from '../useMeeting'
import { canRecord } from '../speech'
import { MicButton } from './Mic'

/** Одинаковый разговорный режим для обеих переговорок. */
export function VoiceOnly({ m }: { m: Meeting }) {
  return (
    <div className="g-voiceonly">
      <span className="g-voiceonly-beta">Бета: только голос</span>
      <div className="g-voiceonly-controls">
        {m.canMic && canRecord() ? (
          <MicButton
            voiceOnly
            disabled={!m.micReady}
            autoKey={m.autoMic && !m.error ? `${m.lineKey}:${m.line}` : undefined}
            onStart={m.hush}
            onText={(text) => {
              m.setDraft(text)
              void m.send(text)
            }}
            onError={m.setError}
            onOff={() => m.setMicOff(true)}
          />
        ) : <p role="status">Микрофон недоступен. Проверьте разрешение браузера и подключение к серверу распознавания.</p>}
        <label className="g-auto-mic">
          <input type="checkbox" checked={m.autoMic} onChange={(e) => m.setAutoMic(e.target.checked)} />
          Авто-микрофон
        </label>
      </div>
      <p className="g-voiceonly-hint" role="status">
        {m.pending ? `${m.name} думает…` : !m.micReady ? 'Слушаем собеседника…' : 'Говорите. Пауза завершит реплику; до 30 секунд.'}
      </p>
    </div>
  )
}
