// Массовые прогоны по умолчанию гоняются без живой модели: каждый ход на Pro стоит денег, а прогон — это
// десятки ходов. Сервер для них поднимают так: npm run dev:offline. Нужна модель — флаг --live.

export async function requireOffline(base: string) {
  if (process.argv.includes('--live')) return
  let h: { mode?: string; provider?: string; model?: string }
  try {
    h = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) })).json()
  } catch {
    return // сервера нет — значит, и модели нет
  }
  if (h.mode === 'offline' || h.provider === 'offline') return
  console.error(
    `Сервер ${base} работает на живой модели (${h.provider} ${h.model}). Прогоны идут офлайн:\n` +
      '  npm run dev:offline   — поднять сервер без модели\n' +
      '  --live                — если модель правда нужна (платно)',
  )
  process.exit(1)
}
