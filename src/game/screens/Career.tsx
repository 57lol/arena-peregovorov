import type { Case } from '../../App'
import { SCENARIOS, harder } from '../../content/scenarios'
import { ENDING_IDS } from '../../engine/endings'
import type { Scenario } from '../../engine/types'
import { firstName } from '../cast'
import { RANKS, SKILLS, SKILL_RU, axisName, nextCase, plural, profileOf, rankOf, runGain, skillsOf, type Skill } from '../career'
import type { Progress, RunLog } from '../progress'
import { Button, PixelIcon } from '../ui'
import { Stars } from './Stars'

const pointsWord = (n: number) => plural(n, 'очко', 'очка', 'очков')

/** Полоска прогресса: сколько набрано внутри ступени. */
function XpBar({ into, span, label }: { into: number; span: number; label: string }) {
  const pct = span ? Math.min(100, (into / span) * 100) : 100
  return (
    <span className="g-xp" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={span || into} aria-valuenow={into}>
      <span className="g-xp-fill" style={{ width: `${pct}%` }} />
    </span>
  )
}

/** Звание одной строкой и шкала до следующего — для титула и папки дел. */
export function CareerCard({ progress, onOpen }: { progress: Progress; onOpen: () => void }) {
  const rank = rankOf(progress)
  const from = rank.at
  return (
    <section className="g-career-card" aria-label="Личное дело">
      <div className="g-career-card-text">
        <p className="g-career-kicker">Личное дело</p>
        <p className="g-career-rank">{rank.title}</p>
        {rank.next ? (
          <>
            <XpBar into={rank.score.total - from} span={rank.next.at - from} label={`До звания «${rank.next.title}»`} />
            <p className="g-career-next">
              До звания «{rank.next.title}» ещё {rank.next.need} {pointsWord(rank.next.need)}
            </p>
          </>
        ) : (
          <p className="g-career-next">Выше в этой конторе только директор.</p>
        )}
      </div>
      <Button icon="notebook" onClick={onOpen}>
        Открыть
      </Button>
    </section>
  )
}

interface Props {
  progress: Progress
  onOpen: (c: Case) => void
  onBack: () => void
}

/** «Личное дело»: звание, навыки, сильное и слабое, лучшее по каждому делу и что сыграть дальше. */
export function Career({ progress, onOpen, onBack }: Props) {
  const rank = rankOf(progress)
  const skills = skillsOf(progress.runs)
  const prof = profileOf(progress.runs)
  const advice = nextCase(progress)
  const open = (sc: Scenario) => onOpen({ scenario: sc, fromLibrary: true })
  const played = Object.keys(progress.cases).length > 0

  return (
    <div className="px-root g-page" data-desk="office">
      <main className="px-desk g-desk g-career">
        <header className="g-bar">
          <Button variant="ghost" icon="left" onClick={onBack}>
            Назад
          </Button>
        </header>
        <h1 className="g-h1">Личное дело</h1>
        <p className="g-sub">
          <span>
            {played
              ? 'Собрано по вашим партиям в этом браузере. Ничего не закрыто: любое дело можно открыть хоть сейчас.'
              : 'Пока пусто: отдел кадров ждёт вашу первую встречу. Любое дело открыто, начать можно с любого.'}
          </span>
        </p>

        {advice && (
          <section className="g-next" aria-label="Что сыграть дальше">
            <p>
              <b>Советуем дальше:</b> «{advice.scenario.title}». {advice.why}
            </p>
            <Button variant="brass" icon="notebook" onClick={() => open(advice.scenario)}>
              Открыть дело
            </Button>
          </section>
        )}

        <div className="g-career-grid">
          <section className="g-sheet g-career-rankbox" aria-labelledby="rank-h">
            <h2 id="rank-h" className="g-sheet-title">
              {rank.title}
            </h2>
            <p className="g-muted">{rank.note}</p>
            <p className="g-career-score">
              Звёзд {rank.score.stars}, финалов {rank.score.endings}: всего {rank.score.total} {pointsWord(rank.score.total)}.
              {rank.next ? ` До звания «${rank.next.title}» ещё ${rank.next.need}.` : ''}
            </p>
            <ol className="g-ladder">
              {RANKS.map((r, i) => (
                <li key={r.title} className={i < rank.index ? 'is-done' : i === rank.index ? 'is-now' : undefined}>
                  <span className="g-ladder-mark" aria-hidden="true">
                    {i < rank.index ? <PixelIcon name="check" px={2} color="var(--c-leaf)" /> : null}
                  </span>
                  <span className="g-ladder-title">{r.title}</span>
                  <span className="g-ladder-at">{r.at ? `от ${r.at}` : 'с порога'}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="g-sheet g-skills" aria-labelledby="skills-h">
            <h2 id="skills-h" className="g-sheet-title">
              Навыки
            </h2>
            <p className="g-muted">Растут от приёмов в ваших репликах и от того, чем кончилась встреча. Хамство и ультиматумы съедают прирост.</p>
            {!progress.runs.length && played && (
              <p className="g-career-note">Прошлые партии сыграны до того, как отдел кадров завёл картотеку. Шкалы оживут со следующей встречи.</p>
            )}
            <ul className="g-skill-list">
              {SKILLS.map((a) => (
                <SkillRow key={a} s={skills[a]} />
              ))}
            </ul>
          </section>

          <section className="g-sheet g-traits" aria-labelledby="traits-h">
            <h2 id="traits-h" className="g-sheet-title">
              Характеристика
            </h2>
            {prof.runs ? (
              <dl className="g-traits-list">
                <Trait label="Партий в картотеке" value={String(prof.runs)} />
                {prof.strongest && <Trait label="Сильная сторона" value={axisName(prof.strongest)} good />}
                {prof.weakest && <Trait label="Проседает" value={axisName(prof.weakest)} bad />}
                {prof.best && <Trait label="Любимый приём" value={`${prof.best.title}: ${prof.best.count} ${plural(prof.best.count, 'раз', 'раза', 'раз')}`} good />}
                {prof.worst && <Trait label="Чаще всего мешало" value={`${prof.worst.title}: ${prof.worst.count} ${plural(prof.worst.count, 'раз', 'раза', 'раз')}`} bad />}
                {prof.tryNext && <Trait label="Попробуйте" value={prof.tryNext.title} />}
              </dl>
            ) : (
              <p className="g-muted">Характеристику пишут после первой встречи. Обычно честно.</p>
            )}
          </section>

          <section className="g-sheet g-cases" aria-labelledby="cases-h">
            <h2 id="cases-h" className="g-sheet-title">
              Дела
            </h2>
            <ul className="g-case-list">
              {SCENARIOS.map((sc) => (
                <CaseRow key={sc.id} sc={sc} progress={progress} onOpen={open} />
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}

function SkillRow({ s }: { s: Skill }) {
  const r = SKILL_RU[s.axis]
  const left = s.span - s.into
  return (
    <li className="g-skill">
      <p className="g-skill-head">
        <b>{r.name}</b>
        <span className="g-skill-lvl">ур. {s.level}</span>
      </p>
      <XpBar into={s.into} span={s.span} label={`${r.name}: уровень ${s.level}`} />
      <p className="g-skill-hint">
        {s.span ? `До ${s.level + 1}-го ещё ${left} ${pointsWord(left)}. ` : 'Потолок. Дальше только преподавать. '}
        Растёт: {r.grows}.
      </p>
    </li>
  )
}

function Trait({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className={good ? 'is-good' : bad ? 'is-bad' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function CaseRow({ sc, progress, onOpen }: { sc: Scenario; progress: Progress; onOpen: (sc: Scenario) => void }) {
  const hard = harder(sc)
  const rec = progress.cases[sc.id]
  const hrec = progress.cases[hard.id]
  const endings = new Set(progress.endings[sc.id] ?? []).size
  const best = (r: typeof rec) =>
    !r ? 'не играли' : r.bestPoints === null ? `${r.plays} ${plural(r.plays, 'встреча', 'встречи', 'встреч')}, сделки пока нет` : `лучший итог ${r.bestPoints}, ${r.plays} ${plural(r.plays, 'встреча', 'встречи', 'встреч')}`
  return (
    <li className="g-case">
      <p className="g-case-title">
        <b>{sc.title}</b>
        <span className="g-case-endings">
          финалов {endings} из {ENDING_IDS.length}
        </span>
      </p>
      <p className="g-case-line">
        {rec && <Stars stars={rec.stars} />} {best(rec)}
      </p>
      <p className="g-case-line g-case-line--hard">
        <span className="g-tag">жёстче</span> {hrec && <Stars stars={hrec.stars} />}{' '}
        {hrec ? best(hrec) : rec?.bestPoints != null ? `${firstName(sc)} ждёт реванша` : 'после первой сделки'}
      </p>
      <div className="g-case-actions">
        <Button variant="ghost" onClick={() => onOpen(sc)}>
          Открыть
        </Button>
        {(rec?.bestPoints != null || hrec) && (
          <Button variant="stamp" onClick={() => onOpen(hard)}>
            Сыграть жёстче
          </Button>
        )}
      </div>
    </li>
  )
}

/** Строки для разбора: «+2 к Процессу: вы резюмировали 3 раза». before/after — прогресс до и после этой партии. */
export function SkillGain({ run, before, after, children }: { run: RunLog; before?: Progress; after?: Progress; children?: React.ReactNode }) {
  const g = runGain(run)
  const lv = before && after ? { b: skillsOf(before.runs), a: skillsOf(after.runs) } : null
  const rank = before && after ? { b: rankOf(before), a: rankOf(after) } : null
  const rows = SKILLS.filter((a) => g[a].xp > 0)
  return (
    <section className="g-sheet g-gain" aria-labelledby="gain-h">
      <h2 id="gain-h" className="g-sheet-title">
        Что прокачали
      </h2>
      {rows.length ? (
        <ul className="g-gain-list">
          {rows.map((a) => (
            <li key={a}>
              <b className="g-gain-plus">
                +{g[a].xp} {SKILL_RU[a].to}
              </b>
              : вы {g[a].why.slice(0, 2).join(', ')}.
              {lv && lv.a[a].level > lv.b[a].level && (
                <>
                  {' '}
                  <span className="g-gain-lvl">Уровень {lv.a[a].level}.</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="g-muted">В этот раз без прироста: сильных приёмов не было или их съели резкости. Бывает и у старших менеджеров.</p>
      )}
      {rank && rank.a.index > rank.b.index && (
        <p className="g-ledger-new">
          Новое звание: {rank.a.title}. {rank.a.note}
        </p>
      )}
      {children}
    </section>
  )
}
