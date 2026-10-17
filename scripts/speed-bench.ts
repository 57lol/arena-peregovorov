// Время хода по этапам против живого сервера (модели и голос настоящие — это деньги, по умолчанию 3 дела × 4 хода).
//   npx tsx scripts/speed-bench.ts http://localhost:8971 [--cases dorm,stop,tara] [--turns 4] [--json] > ходы.jsonl
// По умолчанию ход идёт потоком (как новый клиент): строка со ссылкой на звук → звук по ссылке → ход целиком.
// --json — как старый клиент: ход целиком → /api/tts той же реплики, играть можно только когда звук скачан.
// Сервер должен быть свежим (пустой CACHE_DIR), иначе разметка и реплики придут из кэша.
import { PERSONAS } from '../src/content/voices'
import { getScenario } from '../src/content/scenarios'

const SCRIPTS: Record<string, string[]> = {
  dorm: [
    'Привет, я Никита. Слушай, 600 за вай-фай — это ты прям с порога зашёл. А что для тебя вообще главное в комнате?',
    'Ахах, понял. А приставка какая у тебя, плойка? Я в FIFA немного гоняю, могу как-нибудь вынести тебя.',
    'Понял, суббота святое. Слушай, у меня тема такая: автобус в 7:52, вставать в 6:30, так что в будни после одиннадцати мне прям тишина нужна. А с чаем, сахаром, бумагой у вас тут как — каждый своё?',
    'О, так это ж идеально сходится. Давай так: в будни тихо с 23:00, а в выходные пусть пацаны сидят допоздна, мне по выходным не вставать. Уборка — график на двери. Вай-фай 300, касса общая.',
    'Ладно, а если я ещё чай, сахар и бумагу на себя возьму первый месяц? Тогда по рукам?',
  ],
  stop: [
    'Слушай, извини, правда случайно, сумка дурная. Но две тысячи — ты загнул, братан. Тебя как звать-то?',
    'Да спокойно, я не наезжаю. Серый, а тебе телефон-то зачем так срочно, позвонить кому надо?',
    'Ха, так ты тоже первый день? Я вот тоже, сегодня первый день на заводе, а уже с кроссовками разбираюсь. Комедия. Ты сам-то на служебный едешь?',
    'Короче, смотри. Телефон в руки не дам, там пропуск и банк. Давай я сам наберу твоего бригадира и дам поговорить на громкой. За энергетик закину 150, и извинюсь нормально, при пацанах. Идёт?',
    'Ладно, без обид, правда. Слушай, мы оба опоздаем, если тут до обеда стоять будем. Давай так: на громкой звонишь, 150 за энергетик, извиняюсь при пацанах и вместе успеваем на 7:52. По рукам?',
  ],
  tara: [
    'Добрый день, Марат. Образцы у вас отличные, технологи довольны. Прежде чем про цифры — расскажите, что для вас в этом контракте главное?',
    'Понял. Но 212 за короб — это дорого, Марат. Казань нам возит дешевле, и вы это знаете.',
    'А почему вам так принципиальна оплата по факту отгрузки? У вас с оборотными деньгами что-то, или это политика такая?',
    'Хорошо, по цифрам. Для нас главное, чтобы конвейер не встал: если срочную допоставку делаете за 48 часов, мы платим по факту отгрузки. Цена 196, договор на год, отгрузки раз в неделю.',
    'Справедливо. Тогда давайте 200 ровно, по факту отгрузки, 48 часов, год, раз в неделю. Встречаемся посередине — и я сегодня же несу договор финдиректору.',
  ],
}

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:8971'
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const cases = opt('cases', 'dorm,stop,tara').split(',')
const turns = Number(opt('turns', '4'))
const json = args.includes('--json')
const ms = (t0: number) => Math.round(performance.now() - t0)

/** Звук: первый байт и целиком, мс от t0. */
async function audio(r: Response, t0: number) {
  const reader = r.body!.getReader()
  let first: number | undefined
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value?.length && first === undefined) first = ms(t0)
    bytes += value?.length ?? 0
  }
  return { first, all: ms(t0), bytes, cache: r.headers.get('x-cache'), api: r.headers.get('x-tts-api'), took: r.headers.get('x-tts-ms'), fallback: r.headers.get('x-tts-fallback') }
}

for (const id of cases) {
  const sc = getScenario(id)
  if (!sc) throw new Error(`нет дела ${id}`)
  const who = sc.opponent.character.portrait
  const persona = PERSONAS[who]
  const tts = { voice: persona.voice, who, ...(persona.role ? { role: persona.role } : {}) }
  const history: unknown[] = []
  for (const playerText of SCRIPTS[id].slice(0, turns)) {
    const body = { scenarioId: id, history, playerText, tts, ...(json ? {} : { stream: true }) }
    const t0 = performance.now()
    const r = await fetch(`${base}/api/turn`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'bench=1' }, body: JSON.stringify(body) })
    const row: Record<string, unknown> = { case: id, turn: history.length + 1, playerText }
    let turn: any
    if (json || !r.headers.get('content-type')?.includes('ndjson')) {
      turn = await r.json()
      row.done = ms(t0)
      if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(turn)}`)
      const t1 = performance.now()
      const a = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...tts, text: turn.opponentLine, emotion: turn.emotion }) })
      const got = await audio(a, t1)
      row.tts = got
      // старый клиент играет звук, только когда скачал его целиком
      row.firstSound = (row.done as number) + got.all
    } else {
      // поток: строки JSON — line (первый кусок и ссылка на звук), done (ход целиком)
      const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      let sound: Promise<Awaited<ReturnType<typeof audio>>> | undefined
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += value
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const ev = JSON.parse(buf.slice(0, i))
          buf = buf.slice(i + 1)
          if (ev.t === 'line' && !sound) {
            row.line = ms(t0)
            row.firstText = ev.text
            if (ev.audio) sound = fetch(`${base}${ev.audio}`).then((a) => audio(a, t0))
          } else if (ev.t === 'done') {
            turn = ev
            row.done = ms(t0)
          } else if (ev.t === 'error') throw new Error(ev.error)
        }
      }
      const got = sound ? await sound : undefined
      row.tts = got
      row.firstSound = got?.first
    }
    row.ms = turn.sources?.ms
    row.sources = turn.sources
    row.decision = turn.decision?.kind
    row.line = row.line ?? undefined
    row.opponentLine = turn.opponentLine
    row.record = turn.record
    console.log(JSON.stringify(row))
    console.error(`${id} ${row.turn}: ${row.decision} звук ${row.firstSound} мс, ход ${row.done} мс ${JSON.stringify(row.ms)} — ${turn.opponentLine}`)
    history.push({ playerText, opponentLine: turn.opponentLine, emotion: turn.emotion, analysis: turn.analysis })
    if (turn.state?.status !== 'open') break
  }
}
