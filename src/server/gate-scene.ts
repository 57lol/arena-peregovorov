// Живая сцена для страницы входа: облегчённый TitleScene без React и без основного бандла.
// Панорама kama.png в целом масштабе, поверх — вывеска, окна, огни, пар, автобус, машины, вода, теплоход.
// Скрипт встраивается в HTML как есть; данные панорамы — из того же title.gen, что и у игры.

import { TITLE } from '../game/title.gen'

const APOLLO = `172038 253a5e 3c5e8b 4f8fba 73bed3 a4dddb 19332d 25562e 468232 75a743 a8ca58 d0da91
4d2b32 7a4841 ad7757 c09473 d7b594 e7d5b3 341c27 602c2c 884b2b be772b de9e41 e8c170
241527 411d31 752438 a53030 cf573c da863e 1e1d39 402751 7a367b a23e8c c65197 df84a5
090a14 10141f 151d28 202e37 394a50 577277 819796 a8b5b2 c7cfcc ebede9`.split(/\s+/)

const { w, h, road, water, sun, stopSign, lamps, chimneys, beacons, sign, windows } = TITLE
const DATA = JSON.stringify({ w, h, road, water, sun, stopSign, lamps, chimneys, beacons, sign, windows, ap: APOLLO })

const SCRIPT = String.raw`
(function () {
  var T = __DATA__;
  var ap = function (i) { return '#' + T.ap[i]; };
  var cv = document.getElementById('scene');
  var g = cv && cv.getContext('2d');
  if (!g) return;
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var R = function (a, b) { return a + Math.random() * (b - a); };
  var P = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var bake = function (w, h, fn) { var c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')); return c; };
  var sprite = function (rows, legend) {
    return bake(rows[0].length, rows.length, function (x) {
      rows.forEach(function (row, y) { for (var i = 0; i < row.length; i++) { var k = legend[row[i]]; if (k === undefined) continue; x.fillStyle = ap(k); x.fillRect(i, y, 1, 1); } });
    });
  };
  function bus(wheel, open) {
    return bake(40, 15, function (x) {
      var f = function (c, a, b, w, h) { x.fillStyle = ap(c); x.fillRect(a, b, w, h); };
      f(23, 2, 0, 35, 1); f(22, 1, 1, 37, 10); f(21, 1, 10, 37, 1); f(20, 1, 11, 37, 1);
      for (var i = 3; i < 27; i += 5) { f(17, i, 3, 4, 4); f(16, i, 6, 4, 1); }
      [5, 14, 19].forEach(function (i) { f(41, i, 4, 1, 2); });
      f(open ? 17 : 1, 28, 3, 4, 8); if (!open) f(2, 30, 3, 1, 8);
      f(1, 34, 2, 3, 6); f(4, 35, 2, 1, 2); f(27, 1, 8, 37, 1); f(45, 38, 8, 1, 2); f(28, 0, 7, 1, 2);
      [5, 28].forEach(function (c) { f(37, c, 10, 5, 5); f(37, c - 1, 11, 7, 3); f(41, c + 1 + (wheel % 2), 11 + ((wheel >> 1) % 2), 2, 2); f(42, c + 2, 12, 1, 1); });
    });
  }
  var CAR = ['...kkkkk.....', '..kwwkwwk....', 'LbbbbbbbbbbbR', 'bbbbbbbbbbbbb', '.tt.....tt...', '.tt.....tt...'];
  var BOAT = ['.....mm.......', '...wwwwwww....', '..wlwlwlwlw...', 'bbbbbbbbbbbbbb', '.bbbbbbbbbbbb.'];

  var bg = new Image();
  var sp = null, W = null, box = null;
  var FAR = T.road[0] + 6, NEAR = T.road[1] - 1, STOP = T.stopSign - 32;

  function sprites() {
    var s = T.sign, src = bake(s[2], s[3], function (x) { x.drawImage(bg, -s[0], -s[1]); });
    var d = src.getContext('2d').getImageData(0, 0, s[2], s[3]).data;
    var on = function (x, y) { var i = (y * s[2] + x) * 4; return d[i + 3] > 0 && d[i] < 20 && d[i + 2] < 30; };
    var cols = [], letters = [];
    for (var x = 0; x < s[2]; x++) { var any = 0; for (var y = 0; y < s[3]; y++) if (on(x, y)) any = 1; cols.push(any); }
    cols.forEach(function (c, x) { if (c && !cols[x - 1]) letters.push([x, x]); if (c) letters[letters.length - 1][1] = x; });
    var glow = function (c, only) {
      return bake(s[2], s[3], function (g2) { g2.fillStyle = c; for (var y = 0; y < s[3]; y++) for (var x = 0; x < s[2]; x++) if (on(x, y) && (!only || (x >= only[0] && x <= only[1]))) g2.fillRect(x, y, 1, 1); });
    };
    return {
      sign: glow(ap(23)), letters: letters, off: letters.map(function (l) { return glow(ap(21), l); }),
      bus: [0, 1, 2, 3].map(function (k) { return bus(k, false); }), busOpen: bus(0, true),
      cars: [27, 2, 42, 7, 21, 44].map(function (c) { return sprite(CAR, { k: c, b: c, w: 1, L: 23, R: 27, t: 37 }); }),
      boat: sprite(BOAT, { m: 27, w: 44, l: 23, b: 38 })
    };
  }

  // Раскладка: на широком экране пропуск слева, вывеска справа от него; на узком панорама сверху, вода уходит под пропуск.
  function fit() {
    var vw = innerWidth, vh = innerHeight, card = document.querySelector('.pass');
    var wide = vw >= 900;
    var s = wide ? Math.max(2, Math.min(6, Math.floor(vh / T.h))) : (vw >= 560 ? 3 : 2);
    while (s > 2 && vw / s < 110) s--;
    var bw = Math.ceil(vw / s), bh = Math.ceil(vh / s);
    var r = card ? { right: card.offsetLeft + card.offsetWidth, top: card.offsetTop } : { right: 0, top: vh };
    var ox, bottom;
    if (wide) {
      ox = Math.round((r.right + 48) / s) - T.sign[0];
      bottom = bh;
    } else {
      ox = Math.round(bw / 2 - (T.sign[0] + T.sign[2] / 2 + 20));
      bottom = Math.min(bh, Math.round(r.top / s) + 44);
    }
    ox = Math.max(bw - T.w, Math.min(0, ox));
    var oy = Math.max(bottom, T.h) - T.h;
    cv.width = bw; cv.height = bh; cv.style.width = bw * s + 'px'; cv.style.height = bh * s + 'px';
    var st = document.documentElement.style;
    st.setProperty('--sign-x', ((ox + T.sign[0] + T.sign[2] / 2) * s) + 'px');
    st.setProperty('--sign-y', ((oy + T.sign[1]) * s) + 'px');
    var h1 = document.querySelector('h1'), hw = h1 ? h1.offsetWidth / 2 : 0, tx = (ox + T.sign[0] + T.sign[2] / 2) * s;
    if (wide) tx = Math.min(Math.max(tx, r.right + 32 + hw), vw - hw - 24);
    st.setProperty('--title-x', tx + 'px');
    var stars = [];
    for (var i = 0, n = Math.round(bw * Math.max(0, oy + 40) / 260); i < n; i++) stars.push([Math.floor(Math.random() * bw), Math.floor(Math.random() * Math.max(1, oy + 34)), Math.random() * 6]);
    var prev = box;
    box = { w: bw, h: bh, s: s, ox: ox, oy: oy, left: -ox, right: bw - ox, stars: stars };
    if (!W || !prev || prev.left !== box.left) W = world();
    document.documentElement.classList.add('has-scene');
  }

  function world() {
    var sh = [];
    for (var i = 0; i < 90; i++) {
      var y = T.water + 2 + Math.floor(Math.random() * (T.h - T.water - 3)), near = Math.random() < 0.3;
      sh.push({ x: near ? T.sun[0] + Math.round(R(-14, 14) * (1 + (y - T.water) / 30)) : Math.floor(Math.random() * T.w), y: y, len: 1 + Math.floor(Math.random() * 4), ph: Math.random() * 7, c: near ? ap(P([17, 45, 23])) : ap(P([35, 34, 29, 3])) });
    }
    return {
      cars: [], nextCar: 1, puffs: [], nextPuff: T.chimneys.map(function () { return Math.random(); }),
      lit: T.windows.map(function () { return Math.random() < 0.55; }), flicker: null, shimmer: sh,
      bus: still ? { x: STOP, phase: 'stop', since: 0, wheel: 0 } : { x: Math.max(box.left - 44, STOP - 110), phase: 'in', since: 0, wheel: 0 },
      boat: null, nextBoat: 3
    };
  }

  function step(t, dt) {
    var w = W, b = w.bus, V = 46, BR = 1.6;
    b.since += dt;
    if (b.phase === 'in') {
      var from = STOP - V * BR / 2;
      if (b.x < from) b.x = Math.min(from, b.x + V * dt);
      else b.x = Math.min(STOP, b.x + Math.max(3, Math.sqrt(Math.max(0, 2 * (STOP - b.x) * V / BR))) * dt);
      b.wheel += dt * 10;
      if (b.x >= STOP) { b.phase = 'stop'; b.since = 0; }
    } else if (b.phase === 'stop') {
      if (b.since > 3.4) { b.phase = 'out'; b.since = 0; }
    } else if (b.phase === 'out') {
      b.x += Math.min(V * 1.3, V * b.since / BR) * dt; b.wheel += dt * 10;
      if (b.x > box.right + 4) { b.phase = 'gone'; b.since = 0; }
    } else if (b.since > 7) { b.phase = 'in'; b.since = 0; b.x = box.left - 44; }

    w.nextCar -= dt;
    if (w.nextCar <= 0) { w.cars.push({ x: box.right + 4, v: R(38, 50), img: P(sp.cars) }); w.nextCar = R(2.2, 6.5); }
    w.cars.sort(function (a, c) { return a.x - c.x; });
    w.cars.forEach(function (c, i) { var a = w.cars[i - 1], nx = c.x - c.v * dt; if (a && nx < a.x + a.img.width + 3) nx = Math.max(nx, a.x + a.img.width + 3); c.x = nx; });
    w.cars = w.cars.filter(function (c) { return c.x > box.left - 24; });

    T.chimneys.forEach(function (c, i) {
      w.nextPuff[i] -= dt;
      if (w.nextPuff[i] <= 0) { w.puffs.push({ x: c[0] - 1, y: c[1], age: 0, life: R(4, 7) }); w.nextPuff[i] = R(0.5, 0.9); }
    });
    w.puffs.forEach(function (p) { p.age += dt; p.y -= dt * (3.2 - p.age * 0.25); p.x += dt * (1.2 + p.age * 0.9); });
    w.puffs = w.puffs.filter(function (p) { return p.age < p.life; });

    if (Math.random() < dt * 3) { var k = Math.floor(Math.random() * w.lit.length); w.lit[k] = !w.lit[k]; }
    if (!w.flicker && Math.random() < dt / 9) w.flicker = { l: Math.floor(Math.random() * sp.letters.length), until: t + R(0.4, 1.2) };
    if (w.flicker && t > w.flicker.until) w.flicker = null;

    w.nextBoat -= dt;
    if (!w.boat && w.nextBoat <= 0) w.boat = { x: box.left - 16 };
    if (w.boat) { w.boat.x += 4 * dt; if (w.boat.x > box.right + 2) { w.boat = null; w.nextBoat = R(15, 30); } }
  }

  function px(c, x, y, ww, hh) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), ww || 1, hh || 1); }

  function draw(t) {
    var w = W, i;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = ap(30); g.fillRect(0, 0, box.w, box.h);
    box.stars.forEach(function (s) { var b = Math.sin(t * 1.3 + s[2]); if (b < -0.6) return; px(b > 0.7 ? ap(45) : ap(42), s[0], s[1]); });
    g.translate(box.ox, box.oy);
    g.fillStyle = ap(0); g.fillRect(-box.ox, T.h, box.w, box.h);
    g.drawImage(bg, 0, 0);
    g.drawImage(sp.sign, T.sign[0], T.sign[1]);
    if (w.flicker && Math.floor(t * 12) % 3 !== 0) g.drawImage(sp.off[w.flicker.l], T.sign[0], T.sign[1]);
    T.windows.forEach(function (o, i) { if (w.lit[i]) px(i % 7 === 0 ? ap(4) : i % 5 === 0 ? ap(17) : ap(23), o[0], o[1], o[2], 1); });
    var blink = still || Math.floor(t * 1.2) % 2 === 0;
    T.beacons.forEach(function (o) { px(blink ? ap(28) : ap(26), o[0], o[1]); });
    w.puffs.forEach(function (p) {
      var k = p.age / p.life, r = k < 0.15 ? 1 : k < 0.5 ? 2 : 3, x = Math.round(p.x), y = Math.round(p.y);
      g.fillStyle = k < 0.25 ? ap(44) : k < 0.55 ? ap(42) : ap(31);
      if (k > 0.8) { for (var dy = -r + 1; dy < r; dy++) for (var dx = -r + 1; dx < r; dx++) if ((x + dx + y + dy) % 2 === 0) g.fillRect(x + dx, y + dy, 1, 1); return; }
      g.fillRect(x - r + 1, y - r, 2 * r - 1, 2 * r + 1); g.fillRect(x - r, y - r + 1, 2 * r + 1, 2 * r - 1);
    });
    T.lamps.forEach(function (l, i) {
      if (i === 4 && !still && Math.sin(t * 9) + Math.sin(t * 2.3) > 1.2) return;
      px(ap(45), l[0] - 1, l[1] - 1, 3, 1); px(ap(23), l[0] - 2, l[1], 5, 1);
      [[-3, 1], [3, 1], [-1, 2], [1, 2], [0, 3], [-2, 3], [2, 3]].forEach(function (d) { px(ap(22), l[0] + d[0], l[1] + d[1]); });
    });
    var b = w.bus;
    if (b.phase !== 'gone') {
      var open = b.phase === 'stop' && b.since > 0.5 && b.since < 2.8, img = open ? sp.busOpen : sp.bus[Math.floor(b.wheel) % 4], bx = Math.round(b.x);
      if (b.phase !== 'stop') for (i = 0; i < 14; i += 2) px(ap(21), bx + 40 + i, FAR - 2 + ((i >> 1) % 2));
      px(ap(38), bx + 1, FAR + 1, 37, 1); g.drawImage(img, bx, FAR - img.height + 1);
    }
    w.cars.forEach(function (c) {
      var cx = Math.round(c.x);
      for (var i = 1; i < 12; i += 2) px(ap(21), cx - i - 1, NEAR - 2 + ((i >> 1) % 2));
      px(ap(38), cx, NEAR + 1, c.img.width, 1); g.drawImage(c.img, cx, NEAR - c.img.height + 1);
    });
    w.shimmer.forEach(function (s) { if (Math.sin(t * 1.6 + s.ph) <= -0.2 && !still) return; px(s.c, s.x + Math.round(Math.sin(t * 0.9 + s.ph * 3) * 2), s.y, s.len, 1); });
    T.lamps.forEach(function (l, i) {
      for (var y = T.water + 2; y < T.water + 22; y += 2) {
        var k = (y - T.water) / 22, ww = 1 + Math.round((1 + Math.sin(t * 3 + y * 0.7 + i)) * (1 + k));
        if (Math.sin(t * 2.2 + y + i * 3) < -0.5) continue;
        px(k < 0.5 ? ap(23) : ap(22), l[0] - (ww >> 1), y, ww, 1);
      }
    });
    if (w.boat) {
      var x = Math.round(w.boat.x), y = T.water + 16;
      g.drawImage(sp.boat, x, y);
      for (i = 2; i < 24; i += 3) px(ap(4), x - i, y + 5 + ((i >> 1) % 2), 2, 1);
      px(ap(1), x, y + 5, 14, 1);
    }
  }

  bg.onload = function () {
    sp = sprites(); fit();
    addEventListener('resize', fit);
    if (document.fonts) document.fonts.ready.then(fit);
    if (still) { draw(0); return; }
    var last = 0, t = 0;
    (function loop(now) {
      requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; }
      if (now - last < 64) return;
      var dt = last ? Math.min((now - last) / 1000, 0.25) : 1 / 15;
      last = now; t += dt; step(t, dt); draw(t);
    })(0);
  };
  bg.src = '/assets/title/kama.png';
})();
`

export const GATE_SCENE_JS = SCRIPT.replace('__DATA__', DATA)
