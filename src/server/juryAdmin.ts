import { Hono } from 'hono'
import { budget, type Budget } from './budget'
import { same } from './pass'

/** Ключ капитана передаём только заголовком, в адрес и журнал он не попадает. */
export function juryAdmin(quota: Budget = budget(), env = process.env) {
  return new Hono().get('/api/admin/jury', async (c) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    if (!env.ADMIN_KEY) return c.json({ error: 'Статистика выключена' }, 404)
    const auth = c.req.header('authorization') ?? ''
    if (!same(auth, `Bearer ${env.ADMIN_KEY}`)) return c.json({ error: 'Нужен ключ капитана' }, 401)
    const [total, today] = await Promise.all([quota.total(), quota.today()])
    return c.json({ since: total.since, rub: total.rub, date: today.date,
      judges: Object.values(total.judges), today: Object.values(today.judges) })
  })
}
