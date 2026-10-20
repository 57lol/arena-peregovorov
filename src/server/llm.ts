// Модели: Claude Sonnet 5.5 через Anthropic-реле или AITunnel (разметка и реплика собеседника) и YandexGPT (запасная разметка и реплика,
// сборка своего дела; базовая комплектация KIT=base — только Яндекс, см. kit.ts).
// Обе под общим бюджетом LLM_TOTAL_RUB: до вызова — проверка, после — цена в счёт. Возвращают распарсенный JSON;
// любая ошибка — исключение, а вызывающий код откатывается на запасную модель, офлайн-разметчик или заготовку.

import { budget as sharedBudget, type Budget } from './budget'
import { WAIT } from './timeouts'

export interface JsonRequest {
  system: string
  user: string
  temperature: number
  maxTokens?: number
  schema?: { name: string; schema: object } // JSON Schema: строгий формат там, где провайдер умеет
  /** основная модель даже после 80% бюджета: сборку своего дела Lite не тянет (путает порядок вариантов) */
  pro?: boolean
  /** свой таймаут, мс; без него — LLM_TIMEOUT_MS */
  timeoutMs?: number
  /**
   * Claude: JSON по описанию в промпте, без строгой схемы. Со строгой схемой кэш промпта у Claude через AITunnel не
   * срабатывает ни разу (замер 18.10: 0 из 6 запросов, 2,1 ₽ за реплику; без неё — 3013 токенов из кэша, 0,42 ₽),
   * а первые слова приходят не раньше. Для реплики, где порядок полей и так задан промптом.
   */
  loose?: boolean
}

export interface LLM {
  name: 'yandex' | 'aitunnel' | 'anthropic' | 'offline'
  model: string
  json(req: JsonRequest, signal?: AbortSignal): Promise<unknown>
  /** Тот же ответ кусками по мере генерации (склейка кусков — JSON целиком): реплику можно озвучивать, не дожидаясь конца. */
  stream?(req: JsonRequest, signal?: AbortSignal): AsyncGenerator<string>
  /** разбор реплики игрока — своей моделью (ANALYZE_LLM, по умолчанию Claude Sonnet 5.5, если есть ключ AITunnel) */
  analyzer?: LLM
  /** запасная модель: основной провайдер не ответил или ответил не по схеме; backup образует цепочку */
  backup?: LLM
  /** разбор реплики в деле на английском (ANALYZE_LLM_EN); нет — тот же analyzer */
  analyzerEn?: LLM
  /** сборка своего дела — лучшей моделью (GENERATE_LLM, по умолчанию Claude Sonnet, если есть ключ); не вышло — основная */
  writer?: LLM
  /** реплика собеседника — своей моделью (VOICE_LLM, по умолчанию Claude Sonnet 5.5 через AITunnel, если есть ключ) */
  voice?: LLM
  /** заход — первые слова ответа (opener.ts): YandexGPT Pro, пока Claude пишет реплику; OPENER=off — без захода */
  opener?: LLM
}

/** Достаём JSON из ответа модели: бывает в ```json ...```, бывает с текстом вокруг. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('В ответе нет JSON')
  return JSON.parse(body.slice(start, end + 1))
}

interface ChatReply {
  choices?: { message?: { content?: unknown } }[]
  usage?: Usage
}

async function post(url: string, headers: Record<string, string>, body: unknown, ms = WAIT.llm()): Promise<ChatReply> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as ChatReply
}

interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  cost_rub?: number | string
  prompt_tokens_details?: { cached_tokens?: number }
}

/**
 * Ответ потоком (SSE OpenAI-совместимого API): отдаём куски текста, в конце — usage. Оборвали (signal, break) — запрос
 * отменяется, usage нет (onEnd получит undefined и сколько символов успело прийти).
 */
async function* sse(url: string, headers: Record<string, string>, body: object, ms: number, signal: AbortSignal | undefined, onEnd: (u: Usage | undefined, chars: number) => Promise<void>): AsyncGenerator<string> {
  const ac = new AbortController()
  const stop = () => ac.abort(signal?.reason)
  signal?.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(() => ac.abort(new DOMException('Модель не ответила вовремя', 'TimeoutError')), ms)
  let usage: Usage | undefined
  let chars = 0
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
      signal: ac.signal,
    })
    if (!res.ok) throw new Error(`${url} → ${res.status}: ${(await res.text()).slice(0, 300)}`)
    let buf = ''
    for await (const piece of res.body!.pipeThrough(new TextDecoderStream())) {
      buf += piece
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        const o = JSON.parse(data) as { usage?: Usage; error?: { message?: string }; choices?: { delta?: { content?: unknown } }[] }
        if (o.error) throw new Error(`${url}: ${o.error.message ?? 'ошибка'}`)
        if (o.usage) usage = o.usage
        const d = o.choices?.[0]?.delta?.content
        if (typeof d === 'string' && d) {
          chars += d.length
          yield d
          if (ac.signal.aborted) return
        }
      }
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
    // ушли из цикла раньше конца (спекуляция не угадала, проверка завернула) — запрос не нужен
    if (!usage) ac.abort()
    await onEnd(usage, chars)
  }
}

/** OpenAI-совместимый chat/completions Яндекса. */
function openaiCompatible(
  name: 'yandex',
  url: string,
  headers: Record<string, string>,
  model: string,
  onUsage?: (tokensIn: number, tokensOut: number) => Promise<void>,
): LLM {
  const request = ({ system, user, temperature, maxTokens, schema }: JsonRequest) => ({
    model,
    temperature,
    max_tokens: maxTokens ?? 1024,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: schema
      ? { type: 'json_schema', json_schema: { name: schema.name, schema: schema.schema, strict: true } }
      : { type: 'json_object' },
  })
  return {
    name,
    model,
    stream(req, signal) {
      const ms = req.timeoutMs ? Math.min(req.timeoutMs, WAIT.llm()) : WAIT.llm()
      return sse(url, headers, request(req), ms, signal, async (u, chars) => {
        if (!onUsage) return
        await onUsage(Number(u?.prompt_tokens ?? Math.ceil((req.system.length + req.user.length) / 3)), Number(u?.completion_tokens ?? Math.ceil(chars / 3)))
      })
    },
    async json({ system, user, temperature, maxTokens, schema, timeoutMs }) {
      const r = await post(url, headers, {
        model,
        temperature,
        max_tokens: maxTokens ?? 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: schema
          ? { type: 'json_schema', json_schema: { name: schema.name, schema: schema.schema, strict: true } }
          : { type: 'json_object' },
      }, timeoutMs ? Math.min(timeoutMs, WAIT.llm()) : undefined)
      const text = r.choices?.[0]?.message?.content
      // usage есть в каждом ответе Яндекса; нет — считаем грубо, ~3 символа на токен
      if (onUsage) {
        const u = r.usage ?? {}
        await onUsage(
          Number(u.prompt_tokens ?? Math.ceil((system.length + user.length) / 3)),
          Number(u.completion_tokens ?? Math.ceil(String(text ?? '').length / 3)),
        )
      }
      if (typeof text !== 'string') throw new Error('Пустой ответ')
      return extractJson(text)
    },
  }
}

/**
 * YandexGPT под общим бюджетом LLM_TOTAL_RUB (budget.ts): YANDEX_MODEL (Pro 5.1 — реплика собеседника и сборка дела),
 * с 80% лимита — YANDEX_FALLBACK_MODEL (Lite),
 * со 100% — исключение, и вызывающий код доигрывает ход офлайн. `model` меняется вместе с режимом,
 * поэтому ответы Lite и Pro лежат в кэше под разными ключами.
 */
export function yandex(b: Budget = sharedBudget(), transport?: (model: string) => LLM, only?: string, main?: string): LLM {
  const key = process.env.YANDEX_API_KEY
  const folder = process.env.YANDEX_FOLDER_ID
  if (!transport && (!key || !folder)) throw new Error('Нет YANDEX_API_KEY или YANDEX_FOLDER_ID')
  const uri = (m: string) => (m.startsWith('gpt://') ? m : `gpt://${folder}/${m}`)
  const make = transport ?? ((model: string) =>
    openaiCompatible(
      'yandex',
      process.env.YANDEX_URL ?? 'https://ai.api.cloud.yandex.net/v1/chat/completions',
      { authorization: `Api-Key ${key}`, 'x-folder-id': folder!, 'x-data-logging-enabled': 'false' },
      uri(model),
      (i, o) => b.addLlm(model.split('/').pop()!, i, o),
    ))
  // only — одна модель без переключения (лаборатория сравнивает Pro и Lite)
  const primaryName = only ?? main ?? process.env.YANDEX_MODEL ?? 'yandexgpt-5.1'
  const fallbackName = only ?? process.env.YANDEX_FALLBACK_MODEL ?? 'yandexgpt-lite'
  const primary = make(primaryName)
  const fallback = fallbackName === primaryName ? primary : make(fallbackName)
  const pick = () => (b.modeNow() === 'pro' ? primary : fallback)
  void b.mode() // подтянуть сегодняшний счёт с диска до первого хода
  return {
    name: 'yandex',
    get model() {
      return pick().model
    },
    async json(req) {
      if ((await b.mode()) === 'offline') throw new Error('Общий лимит на нейросеть исчерпан — ход разобран правилами')
      return (req.pro ? primary : pick()).json(req)
    },
    async *stream(req, signal) {
      if ((await b.mode()) === 'offline') throw new Error('Общий лимит на нейросеть исчерпан — ход разобран правилами')
      const m = req.pro ? primary : pick()
      if (!m.stream) {
        yield JSON.stringify(await m.json(req))
        return
      }
      yield* m.stream(req, signal)
    },
  }
}

/** Режим для /api/health: pro, lite или offline. Сумм наружу не отдаём. */
export async function llmMode(llm: LLM, b: Budget = sharedBudget()): Promise<'pro' | 'lite' | 'offline'> {
  if (llm.name === 'offline') return 'offline'
  if (llm.name !== 'yandex') return 'pro'
  const m = await b.mode()
  return m === 'pro' && /lite/i.test(llm.model) ? 'lite' : m
}

/**
 * Как выключить рассуждение у модели AITunnel. У Sonnet 5.5, GPT-6.1 Sol, Gemini 3.x и Grok «none» запрещён (400),
 * минимум «minimal»; у Luna, GPT-5.4, Haiku, DeepSeek, Qwen — «none». Рассуждение тормозит реплику на секунды
 * и однажды съело весь лимит токенов (пустой ответ). AITUNNEL_REASONING — свой вариант для всех моделей.
 */
export function aitunnelFlags(model: string, env = process.env): Record<string, unknown> {
  if (env.AITUNNEL_REASONING) return env.AITUNNEL_REASONING === 'off' ? {} : { reasoning_effort: env.AITUNNEL_REASONING }
  if (/^kimi/.test(model)) return { reasoning: { enabled: false } }
  if (/^(claude-(sonnet|opus|fable)|gpt-6(\.\d)?-sol|gpt-6-astra|gemini|grok)/.test(model)) return { reasoning_effort: 'minimal' }
  if (/^(gpt-6-luna|gpt-5|claude-haiku|deepseek|qwen)/.test(model)) return { reasoning_effort: 'none' }
  return {}
}

/**
 * У кого AITunnel (через OpenRouter) берёт Claude: замер 17.10 на настоящем промпте хода — через Google Vertex реплика
 * начинается за ~1,0–1,25 с против ~1,05–1,8 с по умолчанию, и кэш промпта живёт у одного поставщика. Не ответил —
 * OpenRouter сам идёт к другому. AITUNNEL_PROVIDER — свой список через запятую, off — как решит OpenRouter.
 */
export function aitunnelRoute(model: string, env = process.env): Record<string, unknown> {
  const order = env.AITUNNEL_PROVIDER ?? (/^claude/.test(model) ? 'google-vertex' : 'off')
  return order === 'off' ? {} : { provider: { order: order.split(',').map((x) => x.trim()), allow_fallbacks: true } }
}

/** Модель реплики по умолчанию: живее всех держит рамку, ~2 с на ответ (~/Arena-materials/final/models/PROVIDERS_REPORT.md). */
export const DEFAULT_VOICE_MODEL = 'claude-sonnet-5.5'
/**
 * Разметчик по умолчанию — тоже Sonnet 5.5: замер 18.10 на корпусе с эталоном — 92% реплик без ошибок против 67% у
 * YandexGPT Pro и 25% у Haiku 5.5 на одних и тех же трудных репликах (~/Arena-materials/final/ANALYZE_CLAUDE.md).
 */
export const DEFAULT_ANALYZE_MODEL = DEFAULT_VOICE_MODEL

/**
 * AITunnel: один ключ — сотни моделей (Claude, GPT, Gemini), OpenAI-совместимый API, оплата рублями.
 * Цену хода AITunnel сам пишет в usage.cost_rub — её и кладём в общий бюджет (нет её — считаем по тарифу Pro).
 * У Claude кэш системного промпта включается меткой cache_control (ход дешевле вдвое), у остальных он автоматический.
 */
export function aitunnel(model?: string, b: Budget = sharedBudget(), env = process.env): LLM {
  const key = env.AITUNNEL_API_KEY
  if (!key) throw new Error('Нет AITUNNEL_API_KEY')
  const m = model ?? env.AITUNNEL_MODEL ?? DEFAULT_VOICE_MODEL
  const url = `${(env.AITUNNEL_BASE_URL ?? 'https://api.aitunnel.ru/v1').replace(/\/$/, '')}/chat/completions`
  const claude = /^claude/.test(m)
  void b.mode()
  const request = ({ system, user, temperature, maxTokens, schema, loose }: JsonRequest) => ({
    model: m,
    temperature,
    // с рассуждением «minimal» его почти нет, но запас нужен: иначе ответ может прийти пустым
    max_tokens: Math.max(maxTokens ?? 1024, 800),
    messages: [
      { role: 'system', content: claude ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system },
      { role: 'user', content: user },
    ],
    response_format: schema && !(claude && loose)
      ? { type: 'json_schema', json_schema: { name: schema.name, schema: schema.schema, strict: true } }
      : { type: 'json_object' },
    ...aitunnelFlags(m, env),
    ...aitunnelRoute(m, env),
  })
  // цена оборванного потока неизвестна (AITunnel пишет её только в конце): считаем по прошлым ходам — ₽ за символ промпта
  let rubPerChar = 0.00025
  const pay = async (req: JsonRequest, u: Usage | undefined, chars: number) => {
    const size = req.system.length + req.user.length
    const rub = u?.cost_rub != null && Number.isFinite(Number(u.cost_rub)) ? Number(u.cost_rub) : undefined
    if (u && rub !== undefined && size) rubPerChar = rub / size
    if (u?.prompt_tokens_details && env.LLM_LOG_CACHE) console.log(`[llm] ${m}: промпт ${u.prompt_tokens}, из кэша ${u.prompt_tokens_details.cached_tokens ?? 0}, ${rub ?? '?'} ₽`)
    await b.addLlm(`aitunnel/${m}`, Number(u?.prompt_tokens ?? Math.ceil(size / 3)), Number(u?.completion_tokens ?? Math.ceil(chars / 3)), rub ?? (u ? undefined : size * rubPerChar))
  }
  return {
    name: 'aitunnel',
    model: m,
    async *stream(req, signal) {
      if ((await b.mode()) === 'offline') throw new Error('Общий лимит на нейросеть исчерпан')
      const ms = req.timeoutMs ? Math.min(req.timeoutMs, WAIT.llm()) : WAIT.llm()
      yield* sse(url, { authorization: `Bearer ${key}` }, request(req), ms, signal, (u, chars) => pay(req, u, chars))
    },
    async json(req) {
      if ((await b.mode()) === 'offline') throw new Error('Общий лимит на нейросеть исчерпан')
      const r = await post(url, { authorization: `Bearer ${key}` }, request(req), req.timeoutMs ? Math.min(req.timeoutMs, WAIT.llm()) : undefined)
      const text = r.choices?.[0]?.message?.content
      await pay(req, r.usage ?? {}, String(text ?? '').length)
      if (typeof text !== 'string' || !text.trim()) throw new Error('Пустой ответ')
      return extractJson(text)
    },
  }
}

/** Нативный ID Anthropic отличается от ID посредника. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'
/** USD за миллион токенов Sonnet 5.5: уточнить тариф до включения; запись кэша на 5 минут. */
export const ANTHROPIC_PRICE = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } as const

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

const anthropicEnabled = (env: NodeJS.ProcessEnv) => env.ANTHROPIC_VIA_RELAY === 'on' || !!env.ANTHROPIC_BASE_URL

/**
 * Messages через наш воркер: ключ Anthropic есть только у воркера. JSON задаём инструкцией и assistant-префиллом,
 * поэтому stream остаётся потоком текста (включая начальную скобку), пригодным для ранней проверки/озвучки.
 * Схему проверяет вызывающий код; это не API structured outputs. Усечённый ответ считается отказом провайдера.
 */
export function anthropic(model?: string, b: Budget = sharedBudget(), env = process.env): LLM {
  const base = env.ANTHROPIC_BASE_URL || (env.ELEVEN_RELAY_URL ? `${env.ELEVEN_RELAY_URL.replace(/\/+$/, '')}/anthropic/v1` : undefined)
  if (!base || !env.ELEVEN_RELAY_SECRET) throw new Error('Anthropic требует ANTHROPIC_BASE_URL или ELEVEN_RELAY_URL, и ELEVEN_RELAY_SECRET')
  const url = `${base.replace(/\/+$/, '')}/messages`
  const m = model ?? DEFAULT_ANTHROPIC_MODEL
  const headers = { 'content-type': 'application/json', 'x-relay-secret': env.ELEVEN_RELAY_SECRET, 'anthropic-version': '2023-06-01' }
  const usdRub = Number(env.USD_RUB ?? 100)
  if (!Number.isFinite(usdRub) || usdRub <= 0) throw new Error('USD_RUB должен быть положительным числом')
  const request = (req: JsonRequest) => ({
    model: m,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature,
    system: [{ type: 'text', text: `${req.system}\n\nReturn exactly one JSON object, without Markdown or commentary. Continue the opening brace already supplied.${req.schema ? `\nJSON schema: ${JSON.stringify(req.schema.schema)}` : ''}`, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.user }, { role: 'assistant', content: '{' }],
  })
  const pay = async (body: ReturnType<typeof request>, u: AnthropicUsage | undefined, chars: number, finalUsage: boolean) => {
    // input_tokens не включает запись/чтение кэша. При обрыве без usage — оценка, как у других провайдеров.
    const input = u?.input_tokens ?? Math.ceil((body.system[0].text.length + body.messages[0].content.length + 1) / 3)
    const output = finalUsage && u?.output_tokens !== undefined ? u.output_tokens : Math.max(u?.output_tokens ?? 0, Math.ceil(chars / 3))
    const write = u?.cache_creation_input_tokens ?? 0
    const read = u?.cache_read_input_tokens ?? 0
    const p = ANTHROPIC_PRICE
    await b.addLlm(`anthropic/${m}`, input + write + read, output,
      (input * p.input + output * p.output + write * p.cacheWrite + read * p.cacheRead) * usdRub / 1_000_000)
  }
  const context = (req: JsonRequest, signal?: AbortSignal) => {
    const ac = new AbortController()
    const stop = () => ac.abort(signal?.reason)
    if (signal?.aborted) stop()
    else signal?.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(() => ac.abort(new DOMException('Модель не ответила вовремя', 'TimeoutError')), Math.min(req.timeoutMs ?? WAIT.llm(), WAIT.llm()))
    return { signal: ac.signal, close() { clearTimeout(timer); signal?.removeEventListener('abort', stop); ac.abort() } }
  }
  const send = async (body: object, signal: AbortSignal) => {
    signal.throwIfAborted()
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    // Не включаем тело ответа/URL в ошибку: воркер может вернуть диагностические секреты.
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Anthropic HTTP ${res.status}`) }
    return res
  }
  const checkStop = (reason: unknown) => {
    if (reason !== 'end_turn' && reason !== 'stop_sequence') throw new Error(`Anthropic: незавершённый ответ (${String(reason)})`)
  }
  return {
    name: 'anthropic', model: m,
    async json(req, signal) {
      signal?.throwIfAborted()
      if ((await b.mode()) === 'offline') throw new Error('Общий лимит на нейросеть исчерпан')
      const ctx = context(req, signal)
      const body = request(req)
      let accepted = false
      let usage: AnthropicUsage | undefined
      let text = ''
      try {
        const res = await send(body, ctx.signal)
        accepted = true
        const r = await res.json() as { content?: { type: string; text?: string }[]; usage?: AnthropicUsage; stop_reason?: string; error?: unknown }
        ctx.signal.throwIfAborted()
        usage = r.usage
        text = r.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? ''
        if (r.error) throw new Error('Anthropic: ошибка провайдера')
        checkStop(r.stop_reason)
        return JSON.parse(`{${text}`)
      } finally {
        ctx.close()
        if (accepted) await pay(body, usage, text.length, true)
      }
    },
    async *stream(req, signal) {
      signal?.throwIfAborted()
      if ((await b.mode()) === 'offline') throw new Error('Общий лимит на нейросеть исчерпан')
      const ctx = context(req, signal)
      const body = request(req)
      let accepted = false
      let usage: AnthropicUsage | undefined
      let finalUsage = false
      let text = ''
      let stopped = false
      let reason: string | undefined
      try {
        const res = await send({ ...body, stream: true }, ctx.signal)
        accepted = true
        if (!res.body) throw new Error('Anthropic: пустой поток')
        let buffer = ''
        // TextDecoderStream сохраняет разрезанные UTF-8 символы; события SSE собираются до пустой строки.
        for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
          ctx.signal.throwIfAborted()
          buffer += chunk
          let match: RegExpExecArray | null
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            ctx.signal.throwIfAborted()
            const event = buffer.slice(0, match.index)
            buffer = buffer.slice(match.index + match[0].length)
            const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
            if (!data) continue
            const e = JSON.parse(data) as {
              type: string; message?: { usage?: AnthropicUsage }; usage?: AnthropicUsage
              delta?: { type?: string; text?: string; stop_reason?: string }; error?: { type?: string }
            }
            if (e.type === 'error') throw new Error(`Anthropic: ${e.error?.type ?? 'ошибка потока'}`)
            if (e.type === 'message_start') usage = e.message?.usage
            if (e.type === 'message_delta') {
              usage = { ...usage, ...e.usage }
              finalUsage = e.usage?.output_tokens !== undefined
              reason = e.delta?.stop_reason ?? reason
            }
            if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
              const prefix = text ? '' : '{'
              text += e.delta.text
              yield prefix + e.delta.text
              ctx.signal.throwIfAborted()
            }
            if (e.type === 'message_stop') { stopped = true; break }
          }
          if (stopped) break
        }
        ctx.signal.throwIfAborted()
        if (!stopped) throw new Error('Anthropic: поток оборвался до message_stop')
        checkStop(reason)
        JSON.parse(`{${text}`)
      } finally {
        ctx.close() // break у потребителя тоже отменяет запрос и освобождает соединение
        if (accepted) await pay(body, usage, text.length, finalUsage)
      }
    },
  }
}

/**
 * Модель по строке «провайдер:модель»: «aitunnel:claude-sonnet-5.5», «yandex:yandexgpt-5.1», «yandex-lite», «offline».
 * Для LLM_PROVIDER, VOICE_LLM, ANALYZE_LLM, лаборатории и выбора модели реплики на запрос.
 */
export function llmFromSpec(spec: string, env = process.env): LLM {
  const [kind, ...rest] = spec.trim().split(':')
  const model = rest.join(':') || undefined
  switch (kind) {
    case 'aitunnel': return patient(aitunnel(model, undefined, env))
    case 'anthropic': return patient(anthropic(model, undefined, env))
    case 'yandex': return patient(yandex(undefined, undefined, model))
    case 'yandex-lite': return patient(yandex(undefined, undefined, env.YANDEX_FALLBACK_MODEL ?? 'yandexgpt-lite'))
    case 'offline': return offline
    default: throw new Error(`Не знаю модель «${spec}»`)
  }
}

/**
 * Модель зависла три раза подряд (таймаут) — две минуты её не ждём: ход сразу идёт запасным путём (другая модель,
 * правила, заготовка), а не висит по 30 с на каждой реплике.
 */
export function patient(m: LLM, pauseMs = 120_000): LLM {
  let fails = 0
  let until = 0
  return {
    name: m.name,
    get model() {
      return m.model
    },
    async json(req, signal) {
      if (Date.now() < until) throw new Error(`${m.model} не отвечает, пробуем позже`)
      try {
        const r = await m.json(req, signal)
        fails = 0
        return r
      } catch (e) {
        failed(e)
        throw e
      }
    },
    ...(m.stream
      ? {
          async *stream(req: JsonRequest, signal?: AbortSignal) {
            if (Date.now() < until) throw new Error(`${m.model} не отвечает, пробуем позже`)
            try {
              yield* m.stream!(req, signal)
              fails = 0
            } catch (e) {
              failed(e)
              throw e
            }
          },
        }
      : {}),
  }
  function failed(e: unknown) {
    if ((e as Error).name === 'TimeoutError' && ++fails >= 3) {
      until = Date.now() + pauseMs
      fails = 0
      console.warn(`[llm] ${m.model}: три таймаута подряд, ${pauseMs / 1000} с идём запасным путём`)
    }
  }
}

/** Модели реплики, которые можно выбрать на запрос (страница сравнения): VOICE_LLM_ALLOWED или этот список. */
const VOICE_CHOICES = [`aitunnel:${DEFAULT_VOICE_MODEL}`, 'aitunnel:gpt-6.1-sol', 'yandex:yandexgpt-5.1']
export const voiceChoices = (env = process.env) => (env.VOICE_LLM_ALLOWED ? env.VOICE_LLM_ALLOWED.split(',').map((x) => x.trim()).filter(Boolean) : VOICE_CHOICES)

/** Какие модели можно включить в лаборатории и какой ключ нужен. Ключей наружу не отдаём. */
export function llmStatus(env = process.env) {
  const yc = !!env.YANDEX_API_KEY && !!env.YANDEX_FOLDER_ID
  return {
    yandex: { ready: yc, need: 'YANDEX_API_KEY, YANDEX_FOLDER_ID', model: env.YANDEX_MODEL ?? 'yandexgpt-5.1', ...(env.YANDEX_ANALYZE_MODEL ? { analyze: env.YANDEX_ANALYZE_MODEL } : {}) },
    'yandex-lite': { ready: yc, need: 'YANDEX_API_KEY, YANDEX_FOLDER_ID', model: env.YANDEX_FALLBACK_MODEL ?? 'yandexgpt-lite' },
    aitunnel: { ready: !!env.AITUNNEL_API_KEY, need: 'AITUNNEL_API_KEY', model: env.AITUNNEL_MODEL ?? DEFAULT_VOICE_MODEL },
    offline: { ready: true, need: '', model: 'правила и шаблоны' },
  }
}
export type LabLlm = keyof ReturnType<typeof llmStatus>

const offline: LLM = {
  name: 'offline',
  model: 'rules',
  json: () => Promise.reject(new Error('Офлайн-режим')),
}

/**
 * Основная модель (LLM_PROVIDER) и отдельные модели разметки и реплики (ANALYZE_LLM, ANALYZE_LLM_EN, VOICE_LLM —
 * «провайдер:модель»). Есть ключ AITunnel — размечает и пишет реплику Claude Sonnet 5.5, Яндекс — запасной: разметку
 * подхватывает YandexGPT (YANDEX_ANALYZE_MODEL или основная), потом правила; реплику — основная модель, потом заготовка.
 * main — всё основной моделью; ANALYZE_LLM=main размечает Яндексом и английские дела (если ANALYZE_LLM_EN не задан).
 */
export function makeLLM(kind = process.env.LLM_PROVIDER ?? 'offline', env = process.env): { llm: LLM; error?: string } {
  let llm: LLM
  const errors: string[] = []
  try {
    llm = llmFromSpec(kind, env)
    // у Яндекса разметка — своей моделью (YANDEX_ANALYZE_MODEL), бюджет общий
    const am = env.YANDEX_ANALYZE_MODEL
    if (kind === 'yandex' && am && am !== (env.YANDEX_MODEL ?? 'yandexgpt-5.1')) llm.analyzer = patient(yandex(undefined, undefined, undefined, am))
  } catch (e) {
    return { llm: offline, error: (e as Error).message }
  }
  if (llm.name === 'offline') return { llm }
  const native = anthropicEnabled(env) || llm.name === 'anthropic'
  const claude = native ? `anthropic:${DEFAULT_ANTHROPIC_MODEL}` : env.AITUNNEL_API_KEY ? `aitunnel:${DEFAULT_ANALYZE_MODEL}` : undefined
  const base = llm.analyzer ?? llm // разметчик основной модели — он же запасной у Claude
  const anthropicBackup = (last: LLM, model: string): LLM | undefined => {
    const y = last.name === 'yandex' ? last : env.YANDEX_API_KEY && env.YANDEX_FOLDER_ID ? llmFromSpec('yandex', env) : undefined
    if (!env.AITUNNEL_API_KEY) return y
    const spare = llmFromSpec(`aitunnel:${model}`, env)
    spare.backup = y
    return spare
  }
  if (llm.name === 'anthropic') {
    try { llm.backup = anthropicBackup(llm, DEFAULT_ANALYZE_MODEL) }
    catch (e) { errors.push(`backup: ${(e as Error).message}`) }
  }
  const attach = (field: 'analyzer' | 'analyzerEn' | 'voice', spec: string | undefined) => {
    if (!spec || spec === 'main') return
    try {
      const m = llmFromSpec(spec, env)
      if (m.name === 'anthropic') {
        m.backup = anthropicBackup(field === 'voice' ? llm : base, field === 'voice' ? DEFAULT_VOICE_MODEL : DEFAULT_ANALYZE_MODEL)
      } else if (field !== 'voice' && m.model !== base.model) m.backup = base
      llm[field] = m
    } catch (e) {
      errors.push(`${field}: ${(e as Error).message}`)
    }
  }
  attach('analyzer', env.ANALYZE_LLM ?? claude)
  // английские дела — тот же разметчик, если не задан свой (замер 18.10: Sonnet 97–100%, Pro 94% и 2 сломанных JSON)
  attach('analyzerEn', env.ANALYZE_LLM_EN ?? env.ANALYZE_LLM ?? claude)
  attach('voice', env.VOICE_LLM ?? (native ? `anthropic:${DEFAULT_ANTHROPIC_MODEL}` : env.AITUNNEL_API_KEY ? `aitunnel:${DEFAULT_VOICE_MODEL}` : undefined))
  // своё дело пишет лучшая модель: GENERATE_LLM («main» — основная) или та же Claude, что и реплику
  if (env.GENERATE_LLM !== 'main') {
    try {
      const w = env.GENERATE_LLM ? llmFromSpec(env.GENERATE_LLM, env) : llm.voice?.name === 'aitunnel' || llm.voice?.name === 'anthropic' ? llm.voice : undefined
      if (w && w !== llm) llm.writer = w
    } catch (e) {
      errors.push(`writer: ${(e as Error).message}`)
    }
  }
  // заход нужен, только когда реплику пишет Claude: у YandexGPT первые слова и так через ~0,3 с
  if (env.OPENER !== 'off' && (llm.voice?.name === 'aitunnel' || llm.voice?.name === 'anthropic')) {
    try {
      const y = llm.name === 'yandex' ? llm : llm.name === 'anthropic' ? [llm.backup, llm.backup?.backup].find((m) => m?.name === 'yandex') : undefined
      llm.opener = env.OPENER_LLM ? llmFromSpec(env.OPENER_LLM, env) : y
    } catch (e) {
      errors.push(`opener: ${(e as Error).message}`)
    }
  }
  return { llm, ...(errors.length ? { error: errors.join('; ') } : {}) }
}
