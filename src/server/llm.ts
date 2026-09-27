// Адаптеры LLM. Все возвращают уже распарсенный JSON; любая ошибка — исключение,
// а вызывающий код откатывается на офлайн-разметчик или шаблон.

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

export interface JsonRequest {
  system: string
  user: string
  temperature: number
  maxTokens?: number
  schema?: { name: string; schema: object } // JSON Schema: строгий формат там, где провайдер умеет
}

export interface LLM {
  name: 'anthropic' | 'openai' | 'yandex' | 'claude-cli' | 'offline'
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
    async json({ system, user, temperature, maxTokens }) {
      const r = await post(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: maxTokens ?? 1024,
          temperature,
          system: system + '\n\nОтвечай только JSON-объектом, без пояснений.',
          messages: [{ role: 'user', content: user }],
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

function yandex(): LLM {
  const key = process.env.YANDEX_API_KEY
  const folder = process.env.YANDEX_FOLDER_ID
  if (!key || !folder) throw new Error('Нет YANDEX_API_KEY или YANDEX_FOLDER_ID')
  const model = process.env.YANDEX_MODEL ?? 'yandexgpt-5.1'
  return openaiCompatible(
    'yandex',
    process.env.YANDEX_URL ?? 'https://ai.api.cloud.yandex.net/v1/chat/completions',
    { authorization: `Api-Key ${key}`, 'x-folder-id': folder, 'x-data-logging-enabled': 'false' },
    model.startsWith('gpt://') ? model : `gpt://${folder}/${model}`,
  )
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
      case 'claude-cli': return { llm: claudeCli() }
      default: return { llm: offline }
    }
  } catch (e) {
    return { llm: offline, error: (e as Error).message }
  }
}
