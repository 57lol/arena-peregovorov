/** Трасса голосового режима для живых прогонов (scripts/voiceonly-live.ts): пишется, только если страница завела window.__voiceTrace. */
export function voiceTrace(kind: string, detail?: unknown) {
  const w = globalThis as unknown as { __voiceTrace?: unknown[] }
  w.__voiceTrace?.push([Math.round(performance.now()), kind, detail])
}
