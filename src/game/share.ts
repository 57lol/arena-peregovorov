// Ссылка для команды: у всех, кто её откроет, одинаковые условия — результаты можно сравнивать.
// Сценарий из библиотеки — по id (?case=tara), свой — целиком в адресе, сжатый (#case=...).

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
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(sc)), new CompressionStream('deflate-raw'))
  return `${base}#case=${b64url(packed)}`
}

export type LinkCase = { id: string } | { scenario: Scenario } | { error: string }

/** Что зашито в адресе страницы, если там есть дело. */
export async function readLink(): Promise<LinkCase | null> {
  const q = new URLSearchParams(location.search).get('case')
  if (q) return { id: q }
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

export function clearLink() {
  history.replaceState(null, '', location.pathname)
}
