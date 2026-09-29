// Ворота прототипа: пока идёт экспертиза, сайт открыт только жюри и команде.
// Вход — по волшебной ссылке ?key=<JURY_KEY> или по логину и паролю на странице входа;
// после входа — подписанная cookie на 30 дней. Открыты только /api/health и ассеты страницы входа.
// Секреты — только в окружении: GATE_SECRET (подпись cookie), JURY_KEY, SITE_LOGIN, SITE_PASSWORD_HASH
// (scrypt:<соль hex>:<хэш hex> из hashPassword).

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

const COOKIE = 'arena_pass'
const TTL = 30 * 24 * 3600
const OPEN = [/^\/api\/health$/, /^\/assets\/fonts\//, /^\/assets\/title\//, /^\/favicon\.svg$/]
const MAX_FAILS = 8
const FAIL_WINDOW = 15 * 60 * 1000

export type GateConfig = { secret: string; juryKey?: string; login?: string; passwordHash?: string }

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`
}

function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function checkPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split(':')
  return kind === 'scrypt' && !!salt && !!hash && same(hashPassword(password, salt), stored)
}

const sign = (secret: string, exp: number) => createHmac('sha256', secret).update(`v1.${exp}`).digest('base64url')

export function makePass(secret: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL
  return `${exp}.${sign(secret, exp)}`
}

export function passValid(secret: string, value: string | undefined, now = Date.now()) {
  const [exp, sig] = (value ?? '').split('.')
  return !!sig && Number(exp) > now / 1000 && same(sig, sign(secret, Number(exp)))
}

export function gate(cfg: GateConfig): MiddlewareHandler {
  const fails = new Map<string, { n: number; until: number }>()
  // nginx хостинга дописывает адрес клиента в конец X-Forwarded-For; начало и X-Real-IP клиент может подделать
  const ipOf = (c: Context) => (c.req.header('x-forwarded-for') ?? '').split(',').pop()?.trim() || 'local'
  const blocked = (ip: string) => {
    const f = fails.get(ip)
    return !!f && f.until > Date.now() && f.n >= MAX_FAILS
  }
  const fail = (ip: string, c: Context) => {
    console.warn(`вход: неудача ip=${ip} xff=${c.req.header('x-forwarded-for') ?? '-'}`)
    const f = fails.get(ip)
    if (!f || f.until < Date.now()) fails.set(ip, { n: 1, until: Date.now() + FAIL_WINDOW })
    else f.n++
    if (fails.size > 10000) fails.clear()
  }
  const letIn = (c: Context, to: string) => {
    setCookie(c, COOKIE, makePass(cfg.secret), { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: TTL })
    c.header('Cache-Control', 'no-store')
    return c.redirect(to, 303)
  }
  const page = (c: Context, next: string, error = '', status: 200 | 401 | 429 = 200) => {
    c.header('Cache-Control', 'no-store')
    return c.html(loginPage(next, error), status)
  }

  return async (c, next) => {
    const url = new URL(c.req.url)
    const path = url.pathname
    const ip = ipOf(c)

    if (path === '/auth/login' && c.req.method === 'POST') {
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
      const to = safeNext(String(form.next ?? '/'))
      if (blocked(ip)) return page(c, to, 'Слишком много попыток. Подождите 15 минут.', 429)
      const ok =
        !!cfg.login &&
        !!cfg.passwordHash &&
        same(String(form.login ?? '').trim().toLowerCase(), cfg.login.toLowerCase()) &&
        checkPassword(String(form.password ?? ''), cfg.passwordHash)
      if (ok) return letIn(c, to)
      fail(ip, c)
      return page(c, to, 'Неверный логин или пароль. Проверьте раскладку и попробуйте ещё раз.', 401)
    }

    // волшебная ссылка: ставим cookie и убираем key из адреса, остальные параметры не трогаем
    if (c.req.method === 'GET' && url.searchParams.has('key')) {
      const rest = url.search.slice(1).split('&').filter((p) => p && p !== 'key' && !p.startsWith('key='))
      const clean = path + (rest.length ? `?${rest.join('&')}` : '')
      const key = url.searchParams.get('key') ?? ''
      if (blocked(ip)) return page(c, clean, 'Слишком много попыток. Подождите 15 минут.', 429)
      if (cfg.juryKey && same(key, cfg.juryKey)) return letIn(c, clean)
      fail(ip, c)
      return page(c, clean, 'Ключ в ссылке не подошёл. Войдите по логину и паролю.', 401)
    }

    if (passValid(cfg.secret, getCookie(c, COOKIE)) || OPEN.some((r) => r.test(path))) return next()

    if (path.startsWith('/api/')) return c.json({ error: 'Нужен вход: откройте сайт и войдите' }, 401)
    const isPage = c.req.method === 'GET' && !/\.[a-z0-9]{1,5}$/i.test(path)
    return isPage ? page(c, path + url.search) : c.text('Нужен вход', 401)
  }
}

function safeNext(s: string) {
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : '/'
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export function loginPage(next: string, error = '') {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Переговорка — вход</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
@font-face{font-family:'Ark Pixel';src:url('/assets/fonts/ark-pixel-12-prop.woff2') format('woff2');font-display:swap}
@font-face{font-family:'Pixeloid';src:url('/assets/fonts/PixeloidSans.ttf') format('truetype');font-weight:400;font-display:swap}
@font-face{font-family:'Pixeloid';src:url('/assets/fonts/PixeloidSans-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
:root{--ink:#10141f;--night:#172038;--night2:#253a5e;--steel3:#202e37;--steel2:#394a50;--mist:#a8b5b2;--paper2:#c7cfcc;--paper:#ebede9;--wood3:#341c27;--wood:#884b2b;--brass:#de9e41;--brass-hi:#e8c170;--stamp:#a53030;--stamp3:#411d31;--leaf:#468232;--leaf2:#25562e;--leaf-hi:#75a743;--u:2px}
*{box-sizing:border-box;margin:0}
html,body{min-height:100%}
body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(8*var(--u));padding:24px 16px;
 background:var(--night) url('/assets/title/kama.png') center bottom/cover no-repeat;image-rendering:pixelated;
 font-family:'Pixeloid',ui-monospace,monospace;font-size:18px;line-height:24px;color:var(--paper);
 -webkit-font-smoothing:none;-moz-osx-font-smoothing:unset;text-rendering:optimizeSpeed;font-synthesis:none}
h1{font-size:36px;line-height:40px;font-weight:700;color:var(--brass-hi);text-align:center;letter-spacing:1px;
 text-shadow:var(--u) var(--u) 0 var(--ink),calc(2*var(--u)) calc(2*var(--u)) 0 var(--wood3)}
.card{width:100%;max-width:420px;background:var(--paper);color:var(--ink);padding:calc(10*var(--u)) calc(10*var(--u)) calc(8*var(--u));
 box-shadow:0 0 0 var(--u) var(--ink),0 0 0 calc(3*var(--u)) var(--wood),0 0 0 calc(4*var(--u)) var(--ink),calc(4*var(--u)) calc(6*var(--u)) 0 calc(4*var(--u)) rgba(16,20,31,.55)}
.lead{font-family:'Ark Pixel','Pixeloid',monospace;font-size:24px;line-height:28px;margin-bottom:calc(8*var(--u))}
label{display:block;font-weight:700;margin:calc(6*var(--u)) 0 calc(2*var(--u))}
input{width:100%;font:inherit;font-size:18px;color:var(--ink);background:#fff;border:0;border-radius:0;padding:10px 12px;
 box-shadow:inset 0 0 0 var(--u) var(--steel2),inset var(--u) var(--u) 0 calc(2*var(--u)) var(--paper2);outline:0}
input:focus{box-shadow:inset 0 0 0 var(--u) var(--ink),0 0 0 var(--u) var(--brass)}
button{margin-top:calc(10*var(--u));width:100%;font:inherit;font-size:27px;line-height:32px;font-weight:700;color:var(--paper);cursor:pointer;
 background:var(--leaf);border:0;border-radius:0;padding:12px 0 calc(12px + var(--u));
 box-shadow:0 0 0 var(--u) var(--ink),inset 0 calc(-2*var(--u)) 0 var(--leaf2),inset 0 var(--u) 0 var(--leaf-hi)}
button:hover{background:var(--leaf-hi);color:var(--ink)}
button:active{transform:translateY(var(--u));box-shadow:0 0 0 var(--u) var(--ink),inset 0 var(--u) 0 var(--leaf2)}
button:focus-visible{outline:var(--u) solid var(--brass-hi);outline-offset:calc(2*var(--u))}
.err{margin-bottom:calc(6*var(--u));padding:8px 12px;background:var(--stamp);color:var(--paper);font-weight:700;box-shadow:0 0 0 var(--u) var(--stamp3)}
.hint{margin-top:calc(8*var(--u));font-family:'Ark Pixel','Pixeloid',monospace;color:var(--steel2);font-size:24px;line-height:28px}
.hint b{color:var(--ink)}
@media (max-width:420px){h1{font-size:27px;line-height:32px}.card{padding:16px 14px 14px}.lead,.hint{font-size:20px;line-height:24px}}
</style>
</head>
<body>
<h1>Переговорка</h1>
<main class="card">
<p class="lead">Пиксельный тренажёр переговоров — кейс ОЭЗ «Алабуга», ЛЦТ&nbsp;2026.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/auth/login">
<input type="hidden" name="next" value="${esc(next)}">
<label for="login">Логин</label>
<input id="login" name="login" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required${error ? '' : ' autofocus'}>
<label for="password">Пароль</label>
<input id="password" name="password" type="password" autocomplete="current-password" required${error ? ' autofocus' : ''}>
<button type="submit">Войти</button>
</form>
<p class="hint"><b>Для экспертов ЛЦТ:</b> логин и пароль — в описании решения на платформе.</p>
</main>
</body>
</html>`
}
