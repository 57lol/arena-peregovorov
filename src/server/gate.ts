// Ворота прототипа: пока идёт экспертиза, сайт открыт только жюри и команде.
// Вход — по волшебной ссылке ?key=<JURY_KEY> или по логину и паролю на странице входа;
// после входа — подписанная cookie на 30 дней. Открыты только /api/health и ассеты страницы входа.
// Секреты — только в окружении: GATE_SECRET (подпись cookie), JURY_KEY, SITE_LOGIN, SITE_PASSWORD_HASH
// (scrypt:<соль hex>:<хэш hex> из hashPassword).

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { GATE_SCENE_JS } from './gate-scene'

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
  const page = (c: Context, next: string, error = '', status: 200 | 401 | 429 = 200, login = '') => {
    c.header('Cache-Control', 'no-store')
    return c.html(loginPage(next, error, login), status)
  }

  return async (c, next) => {
    const url = new URL(c.req.url)
    const path = url.pathname
    const ip = ipOf(c)

    if (path === '/auth/login' && c.req.method === 'POST') {
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
      const to = safeNext(String(form.next ?? '/'))
      const login = String(form.login ?? '').trim()
      if (blocked(ip)) return page(c, to, 'Слишком много попыток. Подождите 15 минут.', 429, login)
      const ok =
        !!cfg.login &&
        !!cfg.passwordHash &&
        same(login.toLowerCase(), cfg.login.toLowerCase()) &&
        checkPassword(String(form.password ?? ''), cfg.passwordHash)
      if (ok) return letIn(c, to)
      fail(ip, c)
      return page(c, to, 'Не тот пропуск — проверьте логин и пароль.', 401, login)
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

// рамки из игры (public/assets/ui/frame-*.png), встроены: страница входа не открывает /assets/ui
const FRAME_PAPER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAAQ0lEQVR4nGNkYGBgEJXV+M9ABHj9+AYjI0jxtQsHiVHPoGVgz8DEQCJgGtVABACH0p1HjwkqhKlhQRcgBBhBBClJAwBwEBRU1uXO6QAAAABJRU5ErkJggg=='
const FRAME_PLATE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAAVklEQVR4nGNkgAITGfX/DHjAmSc3GUE0C0zxlqWe+NQz+EQz/AdpYoQp/nb3Il4ND26+Yihb+oeBiYFEwDSqgQgAjj1QXHRFg+MQJwDFATjiYALEJg0AeVUg1UhP7HwAAAAASUVORK5CYII='

export function loginPage(next: string, error = '', login = '') {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#1e1d39">
<title>Переговорка — вход</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preload" href="/assets/title/kama.png" as="image">
<style>
@font-face{font-family:'Ark Pixel';src:url('/assets/fonts/ark-pixel-12-prop.woff2') format('woff2');font-display:swap}
@font-face{font-family:'Pixeloid';src:url('/assets/fonts/PixeloidSans.ttf') format('truetype');font-weight:400;font-display:swap}
@font-face{font-family:'Pixeloid';src:url('/assets/fonts/PixeloidSans-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
:root{--ink:#10141f;--ink2:#151d28;--dusk:#1e1d39;--night:#172038;--steel:#577277;--steel2:#394a50;--paper2:#c7cfcc;--paper:#ebede9;
 --wood3:#341c27;--wood:#884b2b;--rust:#be772b;--brass:#de9e41;--brass-hi:#e8c170;--stamp:#a53030;--stamp3:#411d31;
 --leaf:#468232;--leaf2:#25562e;--leaf-hi:#75a743;--denim:#3c5e8b;--u:2px;--sign-x:62vw;--sign-y:34vh}
*{box-sizing:border-box;margin:0}
html,body{min-height:100%;overflow-x:hidden}
body{min-height:100vh;min-height:100dvh;overflow-x:hidden;background:var(--dusk);image-rendering:pixelated;
 font-family:'Pixeloid',ui-monospace,monospace;font-size:18px;line-height:24px;color:var(--ink);
 -webkit-font-smoothing:none;-moz-osx-font-smoothing:unset;text-rendering:optimizeSpeed;font-synthesis:none}
#scene{position:fixed;left:0;top:0;z-index:0;display:block;image-rendering:pixelated;image-rendering:crisp-edges;opacity:0;transition:opacity .4s steps(4)}
.has-scene #scene{opacity:1}
.stage{position:relative;z-index:1;overflow-x:clip;min-height:100vh;min-height:100dvh;display:flex;align-items:center;padding:48px clamp(24px,7vw,120px)}
h1{position:fixed;z-index:1;left:var(--title-x,var(--sign-x));top:calc(var(--sign-y) - 88px);transform:translateX(-50%);white-space:nowrap;
 font-size:54px;line-height:64px;font-weight:700;color:var(--brass-hi);letter-spacing:2px;
 text-shadow:0 var(--u) 0 var(--rust),var(--u) calc(2*var(--u)) 0 var(--ink),calc(2*var(--u)) calc(3*var(--u)) 0 var(--wood3)}

/* пропуск на ленте */
.pass{position:relative;width:min(400px,100%);color:var(--ink);transform-origin:50% -60px;
 border:calc(4*var(--u)) solid transparent;border-image:url('${FRAME_PAPER}') 4 fill stretch;
 filter:drop-shadow(calc(3*var(--u)) calc(4*var(--u)) 0 rgba(16,20,31,.5));animation:hang 1.6s cubic-bezier(.3,.7,.4,1) both}
.pass::before{content:'';position:absolute;left:50%;bottom:100%;width:28px;height:100vh;margin-left:-14px;z-index:-1;
 background:linear-gradient(90deg,var(--ink) 0 2px,var(--stamp) 2px 8px,var(--brass-hi) 8px 10px,var(--stamp) 10px 18px,var(--brass-hi) 18px 20px,var(--stamp) 20px 26px,var(--ink) 26px)}
.clip{position:absolute;left:50%;top:-22px;width:44px;height:26px;margin-left:-22px;background:var(--steel);
 box-shadow:inset 0 0 0 var(--u) var(--ink2),inset 0 calc(2*var(--u)) 0 calc(var(--u)) #819796,inset 0 calc(-2*var(--u)) 0 calc(var(--u)) var(--steel2)}
.clip::after{content:'';position:absolute;left:12px;right:12px;top:14px;height:6px;background:var(--ink2)}
.plate{margin:calc(-1*var(--u)) calc(-1*var(--u)) 0;padding:calc(8*var(--u)) calc(6*var(--u)) calc(5*var(--u));
 border:calc(4*var(--u)) solid transparent;border-image:url('${FRAME_PLATE}') 4 fill stretch;
 font-weight:700;line-height:24px;color:var(--wood3)}
.plate small{display:block;font-family:'Ark Pixel','Pixeloid',monospace;font-weight:400;font-size:24px;line-height:24px;color:var(--wood)}
.body{padding:calc(6*var(--u)) calc(6*var(--u)) calc(7*var(--u))}
.lead{font-family:'Ark Pixel','Pixeloid',monospace;font-size:24px;line-height:26px;color:var(--steel2)}
.field{margin-top:calc(7*var(--u))}
label{display:block;font-weight:700;margin-bottom:calc(2*var(--u))}
.row{position:relative}
input{display:block;width:100%;min-height:48px;font:inherit;font-size:18px;color:var(--ink);caret-color:var(--stamp);background:none;border-radius:0;
 padding:calc(2*var(--u)) calc(4*var(--u));border:calc(4*var(--u)) solid transparent;border-image:url('${FRAME_PAPER}') 4 fill stretch;outline:0}
input:focus-visible{outline:var(--u) solid var(--denim);outline-offset:0;box-shadow:0 0 0 calc(2*var(--u)) var(--brass-hi)}
input[aria-invalid='true']{box-shadow:0 0 0 var(--u) var(--stamp)}
#password{padding-right:112px}
.peek{position:absolute;right:calc(3*var(--u));top:50%;transform:translateY(-50%);min-height:36px;padding:0 calc(4*var(--u));
 font:inherit;font-size:18px;color:var(--steel2);background:var(--paper2);border:0;border-radius:0;cursor:pointer;
 box-shadow:inset 0 calc(-1*var(--u)) 0 #819796}
.peek:hover{color:var(--ink);background:#a8b5b2}
.peek[aria-pressed='true']{background:var(--ink);color:var(--brass-hi);box-shadow:none}
.peek:focus-visible{outline:var(--u) solid var(--denim);outline-offset:var(--u)}
.go{display:block;margin-top:calc(9*var(--u));width:100%;min-height:60px;font:inherit;font-size:27px;line-height:32px;font-weight:700;color:var(--paper);cursor:pointer;
 background:var(--leaf);border:0;border-radius:0;padding:12px 0 calc(12px + var(--u));
 box-shadow:0 0 0 var(--u) var(--ink),inset 0 calc(-2*var(--u)) 0 var(--leaf2),inset 0 var(--u) 0 var(--leaf-hi)}
.go:hover{background:var(--leaf-hi);color:var(--ink)}
.go:active{transform:translateY(var(--u));box-shadow:0 0 0 var(--u) var(--ink),inset 0 var(--u) 0 var(--leaf2)}
.go:focus-visible{outline:var(--u) solid var(--brass-hi);outline-offset:calc(2*var(--u))}
.go[aria-busy='true']{background:var(--leaf2);color:var(--paper2)}
.err{margin-top:calc(6*var(--u));padding:8px 12px 8px 44px;position:relative;background:var(--stamp);color:var(--paper);font-weight:700;box-shadow:0 0 0 var(--u) var(--stamp3)}
.err::before{content:'';position:absolute;left:12px;top:10px;width:20px;height:20px;background:
 linear-gradient(var(--paper),var(--paper)) 8px 2px/4px 10px no-repeat,linear-gradient(var(--paper),var(--paper)) 8px 14px/4px 4px no-repeat;box-shadow:inset 0 0 0 var(--u) var(--paper)}
.hint{margin-top:calc(7*var(--u));padding-top:calc(5*var(--u));border-top:var(--u) dashed var(--paper2);font-family:'Ark Pixel','Pixeloid',monospace;color:var(--steel2);font-size:24px;line-height:26px}
.hint b{color:var(--ink);font-weight:400}
.is-error .pass{animation:hang 1.6s cubic-bezier(.3,.7,.4,1) both,nope .5s .15s steps(10) both}
@keyframes hang{0%{transform:rotate(-5deg)}35%{transform:rotate(3deg)}60%{transform:rotate(-1.5deg)}80%{transform:rotate(.6deg)}100%{transform:none}}
@keyframes nope{0%,100%{translate:0}15%{translate:-12px}30%{translate:10px}45%{translate:-8px}60%{translate:6px}75%{translate:-3px}}
@media (max-width:899px){
 .stage{flex-direction:column;justify-content:flex-end;align-items:center;padding:112px 16px 24px}
 h1{top:28px;left:50%;font-size:36px;line-height:44px;letter-spacing:1px}
 .pass::before{display:none}
 .pass{transform-origin:50% 0}
 .lead{display:none}
 .plate{padding-top:calc(6*var(--u));padding-bottom:calc(4*var(--u))}
 .body{padding-top:calc(2*var(--u))}
 .field{margin-top:calc(5*var(--u))}
 .go{margin-top:calc(7*var(--u))}
 .hint{margin-top:calc(5*var(--u));padding-top:calc(4*var(--u))}
}
@media (max-width:420px){.body{padding:calc(5*var(--u)) calc(5*var(--u)) calc(6*var(--u))}.plate{padding-left:calc(5*var(--u));padding-right:calc(5*var(--u))}.lead,.hint{font-size:24px;line-height:24px}}
@media (max-height:640px) and (max-width:899px){.stage{justify-content:flex-start;padding-top:96px}}
@media (prefers-reduced-motion:reduce){.pass,.is-error .pass{animation:none}#scene{transition:none}}
</style>
<noscript><style>body{background:var(--dusk) url('/assets/title/kama.png') center bottom/cover no-repeat}</style></noscript>
</head>
<body${error ? ' class="is-error"' : ''}>
<canvas id="scene" aria-hidden="true"></canvas>
<h1>Переговорка</h1>
<div class="stage">
<main class="pass">
<span class="clip" aria-hidden="true"></span>
<header class="plate">Пропуск посетителя<small>ОЭЗ «Алабуга»</small></header>
<div class="body">
<p class="lead">Тренажёр переговоров по кейсу Алабуги, ЛЦТ&nbsp;2026.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/auth/login" id="gate">
<input type="hidden" name="next" value="${esc(next)}">
<div class="field">
<label for="login">Логин</label>
<input id="login" name="login" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(login)}"${error && login ? '' : ' autofocus'}>
</div>
<div class="field">
<label for="password">Пароль</label>
<div class="row">
<input id="password" name="password" type="password" autocomplete="current-password" required${error && login ? ' autofocus aria-invalid="true"' : ''}>
<button class="peek" type="button" aria-controls="password" aria-pressed="false" hidden>показать</button>
</div>
</div>
<button class="go" type="submit">Пройти</button>
</form>
<p class="hint"><b>Для экспертов ЛЦТ:</b> логин и пароль — в описании решения на платформе.</p>
</div>
</main>
</div>
<script>
(function(){
var p=document.getElementById('password'),b=document.querySelector('.peek'),f=document.getElementById('gate'),go=document.querySelector('.go');
b.hidden=false;
b.onclick=function(){var on=p.type==='password';p.type=on?'text':'password';b.textContent=on?'скрыть':'показать';b.setAttribute('aria-pressed',on);p.focus()};
p.oninput=function(){p.removeAttribute('aria-invalid')};
f.onsubmit=function(){p.type='password';go.setAttribute('aria-busy','true');go.textContent='Проходим…'};
})();
</script>
<script>${GATE_SCENE_JS}</script>
</body>
</html>`
}
