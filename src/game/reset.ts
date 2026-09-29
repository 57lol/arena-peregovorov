// ?reset — стереть весь прогресс игры в этом браузере и начать как в первый раз.
// Модуль импортируется в main.tsx первым: App.tsx при загрузке сразу читает сохранённую партию из sessionStorage,
// и если стереть позже, старая партия вернётся в хранилище. Пока идёт сброс, игра не рисуется вовсе.

/** Всё, что игра хранит в браузере, начинается с этого префикса (прогресс, катсцены, голос, вид, имя игрока…). */
export const PREFIX = 'peregovorka.'

/** Стирает ключи игры из localStorage и всю sessionStorage вкладки. Возвращает, что стёрли. */
export function wipeGame(local: Storage, session: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < local.length; i++) {
    const k = local.key(i)
    if (k?.startsWith(PREFIX)) keys.push(k)
  }
  for (const k of keys) local.removeItem(k)
  session.clear()
  return keys
}

/** Тот же адрес без reset: остальные параметры (?cutscenes=1, ?jury) остаются. */
export function withoutReset(href: string): string {
  const u = new URL(href)
  u.searchParams.delete('reset')
  return u.pathname + u.search + u.hash
}

export const resetting = typeof location !== 'undefined' && new URLSearchParams(location.search).has('reset')

if (resetting) {
  try {
    wipeGame(localStorage, sessionStorage)
  } catch {
    // хранилище недоступно — нечего стирать
  }
  location.replace(withoutReset(location.href))
}
