import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { budget, type Budget } from './budget'
import { same } from './pass'
import { PILOT_PREFIX, pilotClose, pilotKey, pilotOpen, pilotState, pilotUntil } from './pilot'

// Страница капитана на время пилота: общая ссылка для друзей, кто перешёл и сколько играл, кнопка «Закрыть всем доступ».
// Вход — /pilot-admin?t=<PILOT_ADMIN>; ворота её пропускают, ключ проверяем здесь.

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
const msk = (t: number | string) => new Date(t).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
const left = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`
}

export function pilotAdmin(quota: Budget = budget(), env = process.env) {
  const allowed = (t: unknown) => !!env.PILOT_ADMIN && typeof t === 'string' && same(t, env.PILOT_ADMIN)
  const deny = (c: Context) => c.text('Нет доступа', 404)

  const render = async (c: Context, t: string) => {
    const key = pilotKey(env)
    const now = Date.now()
    const st = pilotState()
    const open = pilotOpen(now, env)
    const until = pilotUntil(env)
    const link = `https://${c.req.header('host') ?? 'arena-peregovorov.ru'}/?key=${key ?? ''}`
    const rows = Object.values((await quota.total()).judges)
      .filter((j) => j.name.startsWith(PILOT_PREFIX))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    const sum = (k: 'starts' | 'finishes' | 'turns' | 'rub') => rows.reduce((s, r) => s + r[k], 0)
    const live = rows.filter((r) => now - Date.parse(r.lastAt) < 2 * 60_000).length
    const status = !key ? 'Пилот не настроен' :
      open ? `Открыт · закроется сам в ${msk(until)} МСК (через ${left(until - now)})` :
      st.closedAt !== undefined ? `Закрыт кнопкой в ${msk(st.closedAt)} МСК` : `Закрыт по времени в ${msk(until)} МСК`
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Robots-Tag', 'noindex')
    return c.html(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20">
<title>Пилот · админка</title><style>
:root{color-scheme:dark}body{margin:0;background:#1d1830;color:#f3ead7;font:16px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:640px;margin:0 auto;padding:20px 16px 40px}h1{font-size:22px;margin:0 0 4px}
.st{margin:0 0 18px;padding:10px 12px;border-radius:8px;background:${open ? '#24452f' : '#4a2430'}}
label{display:block;font-size:14px;opacity:.8;margin-bottom:6px}
input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #6b5f8a;background:#120f1f;color:inherit;font:inherit}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:18px 0}
.grid div{background:#2a2342;border-radius:8px;padding:10px}.grid b{display:block;font-size:22px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 4px;border-bottom:1px solid #3a3157}
td:nth-child(n+2),th:nth-child(n+2){text-align:right}
button{margin-top:22px;width:100%;padding:14px;border:0;border-radius:8px;background:#c8324a;color:#fff;font:600 17px system-ui,sans-serif}
.note{font-size:13px;opacity:.7;margin-top:14px}
</style></head><body><main>
<h1>Пилот «Переговорки»</h1>
<p class="st">${esc(status)}</p>
<label for="l">Ссылка для участников — одна на всех, у каждого устройства свой счёт</label>
<input id="l" readonly value="${esc(link)}" onclick="this.select()">
<div class="grid">
<div><b>${st.entries}</b>перешли по ссылке</div><div><b>${rows.length}</b>играли</div><div><b>${live}</b>активны сейчас</div>
<div><b>${sum('starts')}</b>встреч начато</div><div><b>${sum('finishes')}</b>доиграно</div><div><b>${sum('turns')}</b>ходов</div>
<div><b>${sum('rub').toFixed(0)} ₽</b>потрачено</div>
</div>
${rows.length ? `<table><tr><th>Устройство</th><th>Встреч</th><th>Доиграно</th><th>Ходов</th><th>₽</th><th>Был</th></tr>
${rows.map((r) => `<tr><td>${esc(r.name.slice(PILOT_PREFIX.length))}</td><td>${r.starts}</td><td>${r.finishes}</td><td>${r.turns}</td><td>${r.rub.toFixed(0)}</td><td>${msk(r.lastAt)}</td></tr>`).join('')}
</table>` : '<p class="note">Пока никто не играл.</p>'}
${open ? `<form method="post" action="/pilot-admin/close" onsubmit="return confirm('Закрыть доступ всем участникам пилота? Открыть обратно будет нельзя.')">
<input type="hidden" name="t" value="${esc(t)}"><button>Закрыть всем доступ</button></form>` : ''}
<p class="note">Страница обновляется сама раз в 20 секунд. После закрытия ссылка и все выданные по ней входы перестают работать.</p>
</main></body></html>`)
  }

  return new Hono()
    .get('/pilot-admin', (c) => (allowed(c.req.query('t')) ? render(c, c.req.query('t')!) : deny(c)))
    .post('/pilot-admin/close', bodyLimit({ maxSize: 2048 }), async (c) => {
      const t = (await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)).t
      if (!allowed(t)) return deny(c)
      pilotClose()
      return c.redirect(`/pilot-admin?t=${encodeURIComponent(String(t))}`, 303)
    })
}
