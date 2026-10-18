import { lowerFirst } from '../../engine/text'
import { useEffect } from 'react'
import type { Case } from '../../App'
import type { Scenario } from '../../engine/types'
import { baseCaseId } from '../../content/scenarios/harder'
import '../onboarding.css'
import { HARDER_REVEAL } from '../../engine/policy'
import { maxScore } from '../../engine/utility'
import { chapterOf } from '../../content/story'
import { difficultyRu, TONE_RU, g, plural, portraitFor } from '../cast'
import { Button, Portrait, worstFirst } from '../ui'
import { ShareButton } from './ShareButton'
import { canRecord, informal, loadVoiceOn, voiceFor, warmFillers, warmLine, type SpeechCaps } from '../speech'
import { useVoiceSettings } from '../voiceSettings'

interface Props {
  game: Case
  onStart: () => void
  onBack: () => void
  backLabel?: string
  speech?: SpeechCaps
}

/** Бриф: папка дела открыта. Здесь игрок узнаёт всё, что знает его персонаж, — и только это. */
export function Brief({ game, onStart, onBack, backLabel = 'К делам', speech }: Props) {
  const answer = useVoiceSettings()
  const byVoice = answer.mode === 'voice' && canRecord() && (speech ? speech.stt || !!speech.scribe : true)
  const sc = game.scenario
  useEffect(() => {
    if (speech?.tts && loadVoiceOn()) {
      void warmLine(sc.opening, voiceFor(sc))
      warmFillers(voiceFor(sc), informal(sc))
    }
  }, [sc, speech?.tts, speech?.eleven])
  const P = sc.player.profile
  const c = sc.opponent.character
  const max = maxScore(P, sc.issues)
  return (
    <div className="px-root g-page" data-desk="factory">
      <main className="px-desk g-desk g-brief">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            {backLabel}
          </Button>
          <Button variant="brass" icon="send" className="g-bar-go" onClick={onStart}>
            {chapterOf(sc.id)?.kind === 'life' ? 'Начать разговор' : 'Войти в переговорку'}
          </Button>
        </header>

        <article className="g-dossier">
          <span className="g-folder-tab">{sc.sphere}</span>
          <header className="g-dossier-head">
            <h1 className="g-dossier-title">{sc.title}</h1>
            {sc.blurb && <p className="g-brief-blurb">{sc.blurb}</p>}
          </header>

          {/* главное — пять строк: кто вы, кто напротив, чего хотите, что будет без сделки, одна подсказка */}
          <div className="g-brief-main">
            <div className="g-photo" aria-hidden="true">
              <Portrait id={portraitFor(sc)} emotion="neutral" scale={1} />
              <span className="g-photo-clip" />
            </div>
            <dl className="g-brief-lines">
              <div>
                <dt>Вы</dt>
                <dd>{sc.player.role}</dd>
              </div>
              <div>
                <dt>Напротив</dt>
                <dd>
                  {c.name}, {c.role}. Характер: {TONE_RU[c.tone]}, {difficultyRu(sc)}.
                  {sc.harder ? (
                    <>
                      {' '}
                      <span className="g-tag">жёстче</span> Уступает медленнее, чем в прошлый раз, а о своём рассказывает, только
                      когда доверия на {HARDER_REVEAL} больше.
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Чего вы хотите</dt>
                <dd>Главное для вас — {mainIssues(sc)}. Остальным можно поступиться.</dd>
              </div>
              <div>
                <dt>Если не договоритесь</dt>
                <dd>
                  {P.batnaText} Это выгода <b className="g-brief-batna">{P.batna}</b> из {max}: сделка, которая даёт меньше, хуже,
                  чем не договориться вовсе.
                </dd>
              </div>
              <div className="g-brief-hint">
                <dt>Подсказка</dt>
                <dd>{hintFor(sc).replace(/([^.!?…])$/u, '$1.')}</dd>
              </div>
            </dl>
          </div>

          <footer className="g-dossier-foot">
            <Button variant="brass" icon="send" className="g-big" onClick={onStart}>
              {chapterOf(sc.id)?.kind === 'life' ? 'Начать разговор' : 'Войти в переговорку'}
            </Button>
            <ShareButton scenario={sc} fromLibrary={game.fromLibrary} />
            <p className="g-muted">
              На встречу — {sc.turnLimit} {plural(sc.turnLimit, 'реплика', 'реплики', 'реплик')}. Цели и выгода будут у вас в
              блокноте на столе.
            </p>
            {byVoice && (
              <p className="g-muted g-brief-voice">
                Отвечаете голосом: когда собеседник замолчит, микрофон слушает сам, пауза отправляет реплику. Писать текстом
                можно в меню встречи.
              </p>
            )}
          </footer>

          {/* подробности — для тех, кому интересно */}
          <div className="g-brief-more">
            <details className="g-fold">
              <summary>Вся история</summary>
              <div className="g-dossier-story">
                {/* кто напротив — уже в строке «Напротив» выше, здесь только история */}
                {sc.player.brief.split(/\n\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </details>

            <details className="g-fold">
              <summary>Сколько вам даёт каждый вариант</summary>
              <div className="g-table">
                <p className="g-muted">
                  Число у варианта — сколько он даёт вам, в сумме до {max}. У {g(sc, 'него', 'неё')} свой счёт, и его вы не видите.
                </p>
                <p className="g-table-legend">
                  <span className="g-table-legend-item">слева хуже для вас, справа лучше</span>
                  <span className="g-table-legend-item">
                    <i className="g-table-swatch" aria-hidden="true" /> в рамке — самый выгодный для вас вариант
                  </span>
                </p>
                {sc.issues.map((i) => {
                  const pts = P.points[i.id]
                  const best = Math.max(...pts)
                  return (
                    <div key={i.id} className="g-table-row">
                      <h3 className="g-table-title">{i.title}</h3>
                      <ol className="g-table-opts">
                        {worstFirst(pts).map((k) => (
                          <li key={k} className={pts[k] === best ? 'is-best' : undefined}>
                            <span>{i.options[k]}</span>
                            <b>{pts[k]}</b>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )
                })}
              </div>
            </details>

            {sc.goals?.length ? (
              <details className="g-fold">
                <summary>Что потренируете</summary>
                <ul className="g-brief-goals">
                  {sc.goals.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </article>
      </main>
    </div>
  )
}

/** Два-три пункта, где у вас самый большой разброс выгоды, — то, за что стоит держаться. */
function mainIssues(sc: Scenario): string {
  const P = sc.player.profile
  const w = sc.issues.map((i) => ({ t: lowerFirst(i.title), w: Math.max(...P.points[i.id]) - Math.min(...P.points[i.id]) }))
  const top = [...w].sort((a, b) => b.w - a.w)
  // третий — если он почти так же важен, как второй
  const n = top[2] && top[2].w >= top[1].w * 0.8 ? 3 : 2
  const names = top.slice(0, n).map((x) => x.t)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : names[0]
}

// Одна подсказка на встречу: что сделать первым. Для дел без своей — первая цель из брифа.
const HINTS: Record<string, string> = {
  offer: 'Сначала спросите Дарину, что для неё главное. Деньги — не единственное, что вы можете ей дать.',
  tara: 'Марат первым назовёт свою цену. Не спорьте сразу о рублях: спросите, что ему важно, и предложите обмен.',
  client: 'Роза будет давить до последнего. Не спешите уступать: узнайте, чего она опасается, и ищите, что можно обменять.',
  istanbul:
    'Говорите по-английски. Эмре встретит вас по-турецки («Hoş geldiniz» — «добро пожаловать») и первым назовёт цену в евро. Спросите, что ему важно («Why is … so important for you?»), предложите обмен («If you…, we can…») и называйте условия целиком: «€450,000», «30% upfront», «8 weeks».',
}
const hintFor = (sc: Scenario) => HINTS[baseCaseId(sc.id)] ?? sc.goals?.[0] ?? 'Сначала спросите, что для собеседника главное и почему.'
