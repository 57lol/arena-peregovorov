// Адаптеры LLM. Все возвращают уже распарсенный JSON; любая ошибка — исключение,
// а вызывающий код откатывается на офлайн-разметчик или шаблон.

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { budget as sharedBudget, type Budget } from './budget'
import { sberFetch, sberToken } from './sber'

export interface JsonRequest {
  system: string
  user: string
  temperature: number
  maxTokens?: number
  schema?: { name: string; schema: object } // JSON Schema: строгий формат там, где провайдер умеет
}

export interface LLM {
  name: 'anthropic' | 'openai' | 'yandex' | 'gigachat' | 'claude-cli' | 'offline'
  model: string
  json(req: JsonRequest): Promise<unknown>
}

const timeout = () => Number(process.env.LLM_TIMEOUT_MS ?? 25000)

/** Достаём JSON из ответа модели: бывает в ```json ...```, бывает с текстом вокруг. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('В ответе нет JSON')
  return JSON.parse(body.slice(start, end + 1))
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout()),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

function anthropic(): LLM {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('Нет ANTHROPIC_API_KEY')
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5'
  return {
    name: 'anthropic',
    model,
    async json({ system, user, temperature, maxTokens, schema }) {
      const r = await post(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: maxTokens ?? 1024,
          temperature,
          system: system + '\n\nОтвечай только JSON-объектом, без пояснений.',
          messages: [{ role: 'user', content: schema ? `${user}\n\nФормат ответа — JSON по схеме:\n${JSON.stringify(schema.schema)}` : user }],
        },
      )
      const text = (r.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
      return extractJson(text)
    },
  }
}

/** OpenAI и всё OpenAI-совместимое (в т.ч. новый эндпоинт Яндекса). */
function openaiCompatible(
  name: 'openai' | 'yandex',
  url: string,
  headers: Record<string, string>,
  model: string,
  onUsage?: (tokensIn: number, tokensOut: number) => Promise<void>,
): LLM {
  return {
    name,
    model,
    async json({ system, user, temperature, maxTokens, schema }) {
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
      })
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

function openai(): LLM {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Нет OPENAI_API_KEY')
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  return openaiCompatible('openai', `${base}/chat/completions`, { authorization: `Bearer ${key}` }, process.env.OPENAI_MODEL ?? 'gpt-4.1-mini')
}

/**
 * YandexGPT под суточным бюджетом (budget.ts): Pro, с 80% лимита — YANDEX_FALLBACK_MODEL (Lite),
 * со 100% — исключение, и вызывающий код доигрывает ход офлайн. `model` меняется вместе с режимом,
 * поэтому ответы Lite и Pro лежат в кэше под разными ключами.
 */
export function yandex(b: Budget = sharedBudget(), transport?: (model: string) => LLM, only?: string): LLM {
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
  const primaryName = only ?? process.env.YANDEX_MODEL ?? 'yandexgpt-5.1'
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
      if ((await b.mode()) === 'offline') throw new Error('Суточный лимит на нейросеть исчерпан — ход разобран правилами')
      return pick().json(req)
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

/** Локальный Claude Code по подписке — для ночной разработки без ключей. */
function claudeCli(): LLM {
  const model = process.env.CLAUDE_CLI_MODEL ?? 'haiku'
  return {
    name: 'claude-cli',
    model,
    json({ system, user, schema }) {
      const prompt = schema ? `${user}\n\nФормат ответа — JSON по схеме:\n${JSON.stringify(schema.schema)}` : user
      return new Promise((resolve, reject) => {
        const p = spawn(
          process.env.CLAUDE_CLI_BIN ?? 'claude',
          [
            '-p', '--model', model, '--output-format', 'json',
            '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', '',
            '--append-system-prompt', system + '\n\nТы не ассистент в этом режиме. Ответь одним JSON-объектом и ничем больше.',
          ],
          { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] },
        )
        let out = ''
        let err = ''
        const timer = setTimeout(() => {
          p.kill('SIGKILL')
          reject(new Error('claude -p: таймаут'))
        }, Math.max(timeout(), 60000))
        p.stdout.on('data', (d) => (out += d))
        p.stderr.on('data', (d) => (err += d))
        p.on('error', reject)
        p.on('close', (code) => {
          clearTimeout(timer)
          try {
            const r = JSON.parse(out)
            if (r.is_error || code !== 0) throw new Error(`claude -p: ${r.result ?? err}`)
            resolve(extractJson(r.result))
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e) + err))
          }
        })
        p.stdin.end(prompt)
      })
    },
  }
}

/**
 * GigaChat (Сбер): OAuth по GIGACHAT_AUTH_KEY, дальше OpenAI-подобный chat/completions. Строгого JSON по схеме
 * у него нет — схему кладём в текст и достаём JSON из ответа, как у Anthropic.
 */
function gigachat(): LLM {
  const key = process.env.GIGACHAT_AUTH_KEY
  if (!key) throw new Error('Нет GIGACHAT_AUTH_KEY')
  const model = process.env.GIGACHAT_MODEL ?? 'GigaChat-2'
  const scope = process.env.GIGACHAT_SCOPE ?? 'GIGACHAT_API_PERS'
  return {
    name: 'gigachat',
    model,
    async json({ system, user, temperature, maxTokens, schema }) {
      const token = await sberToken(key, scope)
      const r = await sberFetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model,
          // ноль GigaChat не любит — берём почти ноль, это та же жадная выборка
          temperature: Math.max(temperature, 0.01),
          max_tokens: maxTokens ?? 1024,
          messages: [
            { role: 'system', content: system + '\n\nОтвечай только JSON-объектом, без пояснений.' },
            { role: 'user', content: schema ? `${user}\n\nФормат ответа — JSON по схеме:\n${JSON.stringify(schema.schema)}` : user },
          ],
        }),
        ms: timeout(),
      })
      const text = r.body.toString('utf8')
      if (r.status !== 200) throw new Error(`GigaChat → ${r.status}: ${text.slice(0, 300)}`)
      const content = JSON.parse(text).choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('Пустой ответ')
      return extractJson(content)
    },
  }
}

/** Какие LLM можно включить и какой ключ нужен — для лаборатории. Ключей наружу не отдаём. */
export function llmStatus(env = process.env) {
  const yc = !!env.YANDEX_API_KEY && !!env.YANDEX_FOLDER_ID
  return {
    yandex: { ready: yc, need: 'YANDEX_API_KEY, YANDEX_FOLDER_ID', model: env.YANDEX_MODEL ?? 'yandexgpt-5.1' },
    'yandex-lite': { ready: yc, need: 'YANDEX_API_KEY, YANDEX_FOLDER_ID', model: env.YANDEX_FALLBACK_MODEL ?? 'yandexgpt-lite' },
    openai: { ready: !!env.OPENAI_API_KEY, need: 'OPENAI_API_KEY', model: env.OPENAI_MODEL ?? 'gpt-4.1-mini' },
    anthropic: { ready: !!env.ANTHROPIC_API_KEY, need: 'ANTHROPIC_API_KEY', model: env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5' },
    gigachat: { ready: !!env.GIGACHAT_AUTH_KEY, need: 'GIGACHAT_AUTH_KEY', model: env.GIGACHAT_MODEL ?? 'GigaChat-2' },
    offline: { ready: true, need: '', model: 'правила и шаблоны' },
  }
}
export type LabLlm = keyof ReturnType<typeof llmStatus>

const offline: LLM = {
  name: 'offline',
  model: 'rules',
  json: () => Promise.reject(new Error('Офлайн-режим')),
}

export function makeLLM(kind = process.env.LLM_PROVIDER ?? 'offline'): { llm: LLM; error?: string } {
  try {
    switch (kind) {
      case 'anthropic': return { llm: anthropic() }
      case 'openai': return { llm: openai() }
      case 'yandex': return { llm: yandex() }
      case 'yandex-lite': return { llm: yandex(undefined, undefined, process.env.YANDEX_FALLBACK_MODEL ?? 'yandexgpt-lite') }
      case 'gigachat': return { llm: gigachat() }
      case 'claude-cli': return { llm: claudeCli() }
      default: return { llm: offline }
    }
  } catch (e) {
    return { llm: offline, error: (e as Error).message }
  }
}
