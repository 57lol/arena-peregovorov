// /?voices — одна реплика разными голосами: SpeechKit v1 и v3, OpenAI, ElevenLabs, SaluteSpeech.
// Звук синтезируется только по нажатию и ложится в кэш сервера: второй раз та же кнопка бесплатна.

import { useEffect, useState } from 'react'
import '../ui/tokens.css'
import '../ui/ui.css'
import './lab.css'
import { ALL_SCENARIOS } from '../../content/scenarios'
import { portraitFor } from '../cast'
import { voiceOf } from '../speech'
import { PORTRAITS, Portrait, PixelIcon } from '../ui'
import type { LabTts } from './config'
import { catalog, say, stop, type Catalog, type SynthReq } from './synth'

const PHRASES = [
  { id: 'deal', label: 'Торг', emotion: 'neutral', text: 'Двести двенадцать за короб — это честная цена. Но если подпишем договор на год, давайте говорить.' },
  { id: 'angry', label: 'Раздражение', emotion: 'annoyed', text: 'Мы третий раз ходим по кругу. Или вы называете цифру, или я пошёл.' },
  { id: 'warm', label: 'Согласие', emotion: 'pleased', text: 'Вот это разговор. Срочные за пять дней сделаю, если деньги придут за пятнадцать.' },
  { id: 'life', label: 'Общага', emotion: 'neutral', text: 'Слушай, вай-фай пополам — это понятно. А с уборкой давай по графику, без обид?' },
] as const

const EMOTION_RU: Record<string, string> = { neutral: 'спокойно', annoyed: 'раздражённо', pleased: 'довольно' }

const PROVIDER_RU: Record<LabTts, string> = {
  yandex: 'Yandex SpeechKit',
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  salute: 'Sber SaluteSpeech',
}

/** Китайский поставщик: русский с акцентом умеет только gpt-4o-mini-tts через instructions. */
const FOREIGNER = {
  name: 'Ли Вэй',
  role: 'поставщик из Нинбо',
  text: 'Друг мой, сто восемьдесят рублей — очень хорошая цена. Двадцать тысяч штук, отгрузка через сорок дней. Меньше не могу, честно.',
  voice: 'ash',
  instructions:
    'Ты Ли Вэй, китайский поставщик. Говоришь по-русски уверенно, но с заметным китайским акцентом: мягче согласные, ровная мелодика, ' +
    'чуть неверные ударения, короткие паузы между словами. Тон вежливый, деловой, с улыбкой.',
}
/** Без ключа OpenAI акцент есть у SpeechKit v3: четыре голоса читают по-русски с казахским и узбекским акцентом. */
const ACCENT = {
  name: 'Айгерим',
  role: 'поставщица из Алматы',
  text: 'Смотрите, сто восемьдесят рублей — хорошая цена. Двадцать тысяч штук, отгрузка через сорок дней. Меньше не могу, честно.',
}

type ChipState = { busy?: boolean; playing?: boolean; ok?: boolean; note?: string }

/** Кнопка «послушать»: сама ходит на сервер и пишет под собой длительность, кэш или ошибку. */
function Play({ req, label, sub, disabled }: { req: SynthReq; label: string; sub?: string; disabled?: boolean }) {
  // состояние помнит, к какой реплике относится: сменили фразу — кнопка снова чистая
  const key = JSON.stringify(req)
  const [st, setS] = useState<ChipState & { key?: string }>({})
  const s: ChipState = st.key === key ? st : {}
  const go = async () => {
    setS({ key, busy: true })
    const r = await say(req, () => setS((x) => ({ ...x, playing: false })))
    setS({ key, ok: r.ok, note: r.note, playing: r.ok })
  }
  return (
    <div className={`vx-chip${s.playing ? ' is-playing' : ''}${s.ok === false ? ' is-error' : ''}`}>
      <button type="button" className="vx-chip-btn" onClick={go} disabled={disabled || s.busy} aria-label={`Послушать: ${label}`}>
        <PixelIcon name={s.playing ? 'sound' : 'right'} px={2} />
        <span className="vx-chip-label">{label}</span>
        {sub && <span className="vx-chip-sub">{sub}</span>}
      </button>
      <span className="vx-chip-note" aria-live="polite">
        {s.busy ? 'синтез…' : s.note ?? ''}
      </span>
    </div>
  )
}

function NeedKey({ provider, st }: { provider: LabTts; st?: { ready: boolean; need: string; model: string } }) {
  return (
    <div className="vx-need">
      <b>{PROVIDER_RU[provider]}</b> · {st?.model ?? ''}
      <p>
        Нужен ключ <code>{st?.need ?? '…'}</code> в <code>.env</code> сервера. Без него тут пусто, остальное работает.
        {provider === 'openai' && ' С российского сервера OpenAI отвечает 403 — ключ и OPENAI_BASE_URL берутся у прокси (ProxyAPI).'}
        {provider === 'elevenlabs' && ' ElevenLabs закрыт для России и не принимает российские карты.'}
        {provider === 'salute' && ' Сбер с июля не продаёт SaluteSpeech физлицам — только если проект в Studio уже есть.'}
      </p>
    </div>
  )
}

export default function Voices() {
  const [cat, setCat] = useState<Catalog | null | undefined>(undefined)
  const [phrase, setPhrase] = useState<(typeof PHRASES)[number]['id']>('deal')
  const [own, setOwn] = useState('')
  useEffect(() => {
    catalog().then(setCat)
    return stop
  }, [])
  // портрет 96 пикселей спрайта: на телефоне вдвое меньше, иначе лицо займёт пол-экрана
  const faceScale = typeof window !== 'undefined' && window.innerWidth < 600 ? 1 : 2
  const p = PHRASES.find((x) => x.id === phrase)!
  const text = own.trim() || p.text
  const emotion = p.emotion
  const y = cat?.yandex
  const general = y?.voices.filter((v) => !v.model) ?? []
  const male = general.filter((v) => !v.female)
  const female = general.filter((v) => v.female && !v.id.endsWith('_ru'))
  const live = y?.voices.filter((v) => v.model === 'livetts') ?? []
  const accented = y?.voices.filter((v) => v.id.endsWith('_ru')) ?? []

  return (
    <main className="vx">
      <header className="vx-head">
        <a className="vx-back" href="/">
          <PixelIcon name="left" px={2} /> В игру
        </a>
        <h1>Голоса</h1>
        <p>Одна и та же реплика разными голосами. Слушайте по кнопке: каждый звук синтезируется один раз, дальше берётся из кэша.</p>
        {cat === null && <p className="vx-warn">Сервер не отвечает — без него голосов нет.</p>}
        {y && !y.ready && <p className="vx-warn">SpeechKit на сервере выключен: нет YANDEX_API_KEY или SPEECH=off.</p>}
      </header>

      <section className="vx-phrase" aria-label="Реплика">
        <div className="vx-tabs" role="tablist">
          {PHRASES.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === phrase && !own.trim()} className="vx-tab" onClick={() => (setPhrase(x.id), setOwn(''))}>
              {x.label}
            </button>
          ))}
        </div>
        <blockquote className="vx-quote">
          «{text}» <span className="vx-mood">— {EMOTION_RU[emotion]}</span>
        </blockquote>
        <label className="vx-own">
          <span>Своя фраза</span>
          <input value={own} maxLength={200} placeholder="до 200 знаков" onChange={(e) => setOwn(e.target.value)} />
        </label>
      </section>

      <section className="vx-block">
        <h2>Кто кем говорит в игре</h2>
        <p className="vx-lead">Собеседники семи дел. Голоса не повторяются, у новых лиц — голос своего пола.</p>
        <div className="vx-cast">
          {ALL_SCENARIOS.map((sc) => {
            const face = portraitFor(sc)
            const v = voiceOf(face, PORTRAITS[face].female)
            const info = y?.voices.find((x) => x.id === v)
            return (
              <div key={sc.id} className="vx-person">
                <Portrait id={face} emotion="neutral" scale={faceScale} className="vx-face" />
                <div>
                  <b>{sc.opponent.character.name}</b>
                  <span className="vx-small">{sc.title}</span>
                  <Play req={{ text, voice: v, emotion }} label={info?.name ?? v} sub={info?.v3only ? 'v3, новый' : 'v3'} disabled={!y?.ready} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="vx-block">
        <h2>SpeechKit: API v1 против v3</h2>
        <p className="vx-lead">
          Игра говорит через v3: там семь новых голосов и выравнивание громкости. Старые голоса можно сравнить в обоих API. Роль под эмоцию сервер подбирает сам.
        </p>
        {[
          ['Мужские', male],
          ['Женские', female],
          ['Модель livetts: самая живая, но без ролей и темпа, дороже на треть', live],
        ].map(([title, list]) => (
          <div key={title as string} className="vx-group">
            <h3>{title as string}</h3>
            <div className="vx-grid">
              {(list as Catalog['yandex']['voices']).map((v) => (
                <div key={v.id} className={`vx-voice${v.v3only ? ' is-new' : ''}`}>
                  <div className="vx-voice-name">
                    <b>{v.name}</b> <code>{v.id}</code>
                    {v.v3only && <span className="vx-tag">новый</span>}
                  </div>
                  <span className="vx-small">
                    {v.note}
                    {v.roles?.length ? ` · роли: ${v.roles.join(', ')}` : ''}
                  </span>
                  <div className="vx-row">
                    <Play req={{ text, voice: v.id, emotion, api: 'v3' }} label="v3" disabled={!y?.ready} />
                    {!v.v3only && <Play req={{ text, voice: v.id, emotion, api: 'v1' }} label="v1" disabled={!y?.ready} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="vx-block">
        <h2>Другие провайдеры</h2>
        <p className="vx-lead">Для сравнения. Работают, когда на сервере есть ключ; цены и выводы — в VOICE_LLM_RESEARCH.md.</p>
        {(['openai', 'elevenlabs', 'salute'] as const).map((pv) => {
          const st = cat?.[pv]
          if (!st?.ready) return <NeedKey key={pv} provider={pv} st={st} />
          return (
            <div key={pv} className="vx-group">
              <h3>
                {PROVIDER_RU[pv]} <span className="vx-small">· {st.model}</span>
              </h3>
              <div className="vx-row vx-wrap">
                {st.voices.map((v) => (
                  <Play key={v.id} req={{ text, voice: v.id, emotion, provider: pv }} label={v.name} sub={v.female ? 'ж' : 'м'} />
                ))}
              </div>
            </div>
          )
        })}
      </section>

      <section className="vx-block">
        <h2>Собеседник-иностранец</h2>
        <p className="vx-lead">Поставщик из Китая говорит по-русски с акцентом. Так звучала бы встреча с зарубежным партнёром.</p>
        <div className="vx-foreign">
          <div className="vx-person">
            <div className="vx-avatar" aria-hidden>
              李
            </div>
            <div>
              <b>
                {FOREIGNER.name}, {FOREIGNER.role}
              </b>
              <blockquote className="vx-quote vx-quote--small">«{FOREIGNER.text}»</blockquote>
              {cat?.openai?.ready ? (
                <Play req={{ text: FOREIGNER.text, voice: FOREIGNER.voice, provider: 'openai', instructions: FOREIGNER.instructions }} label="OpenAI, с акцентом" sub={cat.openai.model} />
              ) : (
                <NeedKey provider="openai" st={cat?.openai} />
              )}
            </div>
          </div>
          <div className="vx-person">
            <div className="vx-avatar" aria-hidden>
              А
            </div>
            <div>
              <b>
                {ACCENT.name}, {ACCENT.role}
              </b>
              <blockquote className="vx-quote vx-quote--small">«{ACCENT.text}»</blockquote>
              <span className="vx-small">Уже сейчас, без новых ключей: голоса SpeechKit v3 с акцентом.</span>
              <div className="vx-row vx-wrap">
                {accented.map((v) => (
                  <Play key={v.id} req={{ text: ACCENT.text, voice: v.id, emotion: 'neutral' }} label={v.name} sub={v.note?.replace('русский с ', '')} disabled={!y?.ready} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
