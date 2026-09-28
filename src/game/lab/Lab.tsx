// /?lab — лаборатория: те же дела, но собеседника ведёт другая модель и озвучивает другой голос.
// Выбор живёт в этой вкладке (sessionStorage): игра по кнопке «Играть» подхватывает его, закрыл вкладку — всё как было.

import { useEffect, useState } from 'react'
import '../ui/tokens.css'
import '../ui/ui.css'
import './lab.css'
import { ALL_SCENARIOS } from '../../content/scenarios'
import { CHAPTERS } from '../../content/story'
import type { TurnRecord } from '../../engine/types'
import { portraitFor } from '../cast'
import { FEMALE_VOICES, voiceOf } from '../speech'
import { Button, PixelIcon, PORTRAITS } from '../ui'
import { LAB_VOICE, loadLab, saveLab, type LabConfig, type LabLlm, type LabTts } from './config'
import { say, stop, type ProviderStatus } from './synth'

interface LabInfo {
  enabled: boolean
  main: { provider: string; model: string; mode: string }
  llm: Record<LabLlm, ProviderStatus>
  tts: Record<LabTts, ProviderStatus>
}

const LLM_RU: Record<LabLlm, string> = {
  yandex: 'YandexGPT, основная',
  'yandex-lite': 'YandexGPT Lite',
  openai: 'OpenAI GPT',
  anthropic: 'Claude',
  gigachat: 'GigaChat',
  offline: 'Без нейросети',
}
const TTS_RU: Record<LabTts, string> = { yandex: 'SpeechKit', openai: 'OpenAI', elevenlabs: 'ElevenLabs', salute: 'SaluteSpeech' }
type TtsChoice = 'yandex-v3' | 'yandex-v1' | Exclude<LabTts, 'yandex'>
const TTS_CHOICES: { id: TtsChoice; provider: LabTts; label: string; api?: 'v1' | 'v3' }[] = [
  { id: 'yandex-v3', provider: 'yandex', label: 'SpeechKit v3', api: 'v3' },
  { id: 'yandex-v1', provider: 'yandex', label: 'SpeechKit v1', api: 'v1' },
  { id: 'openai', provider: 'openai', label: 'OpenAI' },
  { id: 'elevenlabs', provider: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'salute', provider: 'salute', label: 'SaluteSpeech' },
]
const choiceOf = (c: LabConfig): TtsChoice => (!c.tts || c.tts === 'yandex' ? (c.ttsApi === 'v1' ? 'yandex-v1' : 'yandex-v3') : c.tts)

const SOURCE_RU: Record<string, string> = { llm: 'нейросеть', cache: 'кэш', offline: 'правила', template: 'шаблон', button: 'кнопка' }

interface Probe {
  line: string
  emotion: string
  took: number
  sources: { analysis: string; voice: string; lab?: string; errors?: string[] }
  behaviors: string[]
  voice?: string
}

export default function Lab() {
  const [info, setInfo] = useState<LabInfo | null | undefined>(undefined)
  const [cfg, setCfg] = useState<LabConfig>(loadLab)
  const [caseId, setCaseId] = useState('tara')
  const [text, setText] = useState('Добрый день! Прежде чем говорить о цене, расскажите, что для вас сейчас важнее всего?')
  const [probe, setProbe] = useState<Probe | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/lab', { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null))
    return stop
  }, [])

  const update = (c: LabConfig) => {
    setCfg(c)
    saveLab(c)
  }
  const llm: LabLlm = cfg.llm ?? 'yandex'
  const tts = TTS_CHOICES.find((t) => t.id === choiceOf(cfg))!

  async function run() {
    setBusy(true)
    setErr('')
    setProbe(null)
    stop()
    const t0 = performance.now()
    try {
      const r = await fetch('/api/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lab-llm': llm },
        body: JSON.stringify({ scenarioId: caseId, history: [], playerText: text }),
        signal: AbortSignal.timeout(90_000),
      })
      const j = (await r.json()) as { record?: TurnRecord; sources?: Probe['sources']; error?: string }
      if (!r.ok || !j.record) throw new Error(j.error ?? `сервер ответил ${r.status}`)
      const p: Probe = {
        line: j.record.opponentLine,
        emotion: j.record.emotion,
        took: Math.round(performance.now() - t0),
        sources: j.sources!,
        behaviors: j.record.analysis.behaviors.map((b) => b.id),
      }
      setProbe(p)
      const sc = ALL_SCENARIOS.find((s) => s.id === caseId)!
      const face = portraitFor(sc)
      const yv = voiceOf(face, PORTRAITS[face].female)
      const voice = tts.provider === 'yandex' ? yv : LAB_VOICE[tts.provider][FEMALE_VOICES.includes(yv) ? 'female' : 'male']
      const s = await say({ text: p.line, voice, provider: tts.provider, api: tts.api, emotion: p.emotion })
      setProbe({ ...p, voice: `${TTS_RU[tts.provider]}${tts.api ? ' ' + tts.api : ''}, ${voice}: ${s.note}` })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const chapter = (id: string) => CHAPTERS.find((c) => c.id === id)
  // по дням кампании, как на карте
  const order = (id: string) => (i => (i < 0 ? 99 : i))(CHAPTERS.findIndex((c) => c.id === id))
  const cases = [...ALL_SCENARIOS].sort((a, b) => order(a.id) - order(b.id))

  return (
    <main className="vx">
      <header className="vx-head">
        <a className="vx-back" href="/">
          <PixelIcon name="left" px={2} /> В игру
        </a>
        <h1>Лаборатория</h1>
        <p>Те же дела, но собеседника ведёт другая модель и озвучивает другой голос. Выбор действует только в этой вкладке.</p>
        {info === null && <p className="vx-warn">Сервер не отвечает — лаборатории без него нет.</p>}
        {info && !info.enabled && <p className="vx-warn">Лаборатория выключена на сервере (LAB=off).</p>}
        {info && (
          <p className="vx-small">
            Основная модель сервера: {info.main.provider} · {info.main.model} · режим {info.main.mode}
          </p>
        )}
      </header>

      <section className="vx-block">
        <h2>Кто думает за собеседника</h2>
        <div className="lab-cards" role="radiogroup" aria-label="Модель">
          {(Object.keys(LLM_RU) as LabLlm[]).map((id) => {
            const st = info?.llm[id]
            const ready = !!st?.ready
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={llm === id}
                disabled={!ready}
                className={`lab-card${llm === id ? ' is-on' : ''}${ready ? '' : ' is-off'}`}
                onClick={() => update({ ...cfg, llm: id === 'yandex' ? undefined : id })}
              >
                <b>{LLM_RU[id]}</b>
                <span className="vx-small">{st?.model ?? '…'}</span>
                <span className={`lab-state${ready ? ' is-ready' : ''}`}>{ready ? 'готово' : `нужен ключ ${st?.need ?? ''}`}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="vx-block">
        <h2>Кто говорит</h2>
        <div className="lab-cards" role="radiogroup" aria-label="Голос">
          {TTS_CHOICES.map((t) => {
            const st = info?.tts[t.provider]
            const ready = !!st?.ready
            const on = tts.id === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!ready}
                className={`lab-card${on ? ' is-on' : ''}${ready ? '' : ' is-off'}`}
                onClick={() => update({ ...cfg, tts: t.provider === 'yandex' ? undefined : t.provider, ttsApi: t.api === 'v1' ? 'v1' : undefined })}
              >
                <b>{t.label}</b>
                <span className="vx-small">{t.provider === 'yandex' ? (t.api === 'v3' ? 'новые голоса, LUFS' : 'как было до 29.09') : st?.model}</span>
                <span className={`lab-state${ready ? ' is-ready' : ''}`}>{ready ? 'готово' : `нужен ключ ${st?.need ?? ''}`}</span>
              </button>
            )
          })}
        </div>
        <p className="vx-small">
          Сравнить все голоса одной репликой — на странице <a href="/?voices">«Голоса»</a>.
        </p>
      </section>

      <section className="vx-block">
        <h2>Проверка одним ходом</h2>
        <div className="lab-probe">
          <label className="vx-own">
            <span>Дело</span>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              {cases.map((s) => (
                <option key={s.id} value={s.id}>
                  {chapter(s.id)?.day ? `${chapter(s.id)!.day}: ` : ''}
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="vx-own">
            <span>Ваша реплика</span>
            <textarea rows={2} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          </label>
          <Button variant="brass" icon="send" onClick={run} disabled={busy || !text.trim() || !info}>
            {busy ? 'Думает…' : 'Сыграть ход'}
          </Button>
          {err && <p className="vx-warn">{err}</p>}
          {probe && (
            <div className="lab-answer" aria-live="polite">
              <blockquote className="vx-quote">«{probe.line}»</blockquote>
              <dl>
                <dt>Модель</dt>
                <dd>{probe.sources.lab ?? `${info?.main.provider} · ${info?.main.model}`}</dd>
                <dt>Разбор реплики</dt>
                <dd>
                  {SOURCE_RU[probe.sources.analysis] ?? probe.sources.analysis}
                  {probe.behaviors.length ? ` · ${probe.behaviors.join(', ')}` : ' · приёмов не нашёл'}
                </dd>
                <dt>Ответ собеседника</dt>
                <dd>
                  {SOURCE_RU[probe.sources.voice] ?? probe.sources.voice} · {probe.took} мс
                </dd>
                {probe.sources.errors?.length ? (
                  <>
                    <dt>Откатились</dt>
                    <dd>{probe.sources.errors.join('; ')}</dd>
                  </>
                ) : null}
                <dt>Голос</dt>
                <dd>{probe.voice ?? '…'}</dd>
              </dl>
            </div>
          )}
        </div>
      </section>

      <section className="vx-block">
        <h2>Тестовые уровни</h2>
        <p className="vx-lead">
          Полная встреча с выбранными моделью и голосом: {LLM_RU[llm]}, {tts.label}. Оценку всё так же считает движок, поэтому результаты сравнимы между моделями.
        </p>
        <div className="lab-levels">
          {cases.map((s) => (
            <a key={s.id} className="lab-level" href={`/?case=${s.id}`}>
              <span className="vx-small">{chapter(s.id) ? `${chapter(s.id)!.day}, ${chapter(s.id)!.place}` : 'дело из папки'}</span>
              <b>{s.title}</b>
              <span className="vx-small">{s.opponent.character.name}</span>
            </a>
          ))}
        </div>
        {(cfg.llm || cfg.tts || cfg.ttsApi) && (
          <Button variant="ghost" icon="cross" onClick={() => update({})}>
            Вернуть основные YandexGPT и SpeechKit
          </Button>
        )}
      </section>
    </main>
  )
}
