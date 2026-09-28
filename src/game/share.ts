// Ссылка для команды: у всех, кто её откроет, одинаковые условия — результаты можно сравнивать.
// Сценарий из библиотеки — по id (?case=tara). Своё дело кладём на сервер и даём короткий id (?case=gen-…),
// чтобы таблицу собеседника нельзя было вытащить из адреса. Нет сервера — дело целиком в адресе, сжатое (#case=...).

import { checkScenario } from '../engine/validate'
import type { Scenario } from '../engine/types'

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const unb64url = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function shareLink(sc: Scenario, fromLibrary: boolean): Promise<string> {
  const base = `${location.origin}${location.pathname}`
  if (fromLibrary) return `${base}?case=${encodeURIComponent(sc.id)}`
  try {
    const r = await fetch('/api/scenarios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: sc }),
      signal: AbortSignal.timeout(5000),
    })
    const { id } = r.ok ? ((await r.json()) as { id?: string }) : {}
    if (id) return `${base}?case=${encodeURIComponent(id)}`
  } catch {
    // сервера нет — запасной вариант ниже
  }
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(sc)), new CompressionStream('deflate-raw'))
  return `${base}#case=${b64url(packed)}`
}

export type LinkCase = { id: string; scenario?: Scenario } | { scenario: Scenario } | { error: string }

/** Что зашито в адресе страницы, если там есть дело. */
export async function readLink(): Promise<LinkCase | null> {
  const q = new URLSearchParams(location.search).get('case')
  if (q) return { id: q, scenario: await fetchSaved(q) }
  const h = new URLSearchParams(location.hash.slice(1)).get('case')
  if (!h) return null
  try {
    const json = new TextDecoder().decode(await pipe(unb64url(h), new DecompressionStream('deflate-raw')))
    const scenario = JSON.parse(json) as Scenario
    const { problems } = checkScenario(scenario)
    if (problems.some((p) => p.includes('вариант'))) throw new Error(problems.join('; '))
    return { scenario }
  } catch {
    return { error: 'Ссылка на дело повреждена — возможно, она обрезалась при копировании.' }
  }
}

/** Своё дело, сохранённое на сервере по ссылке. Библиотечные дела берём из сборки и сюда не ходим. */
async function fetchSaved(id: string): Promise<Scenario | undefined> {
  if (!id.startsWith('gen-')) return undefined
  try {
    const r = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) })
    return r.ok ? ((await r.json()) as Scenario) : undefined
  } catch {
    return undefined
  }
}

export function clearLink() {
  history.replaceState(null, '', location.pathname)
}
