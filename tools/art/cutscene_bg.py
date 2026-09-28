"""Фоны катсцен кампании «Новенький»: небо на четыре времени суток, трасса вдоль Камы с автобусом,
улица от остановки до общаги, въезд в ОЭЗ «Алабуга» с «Водогреем» и «Инеем».

Кадр катсцены — 180 точек в высоту (src/game/cutscene/). Всё рисуется ДНЁМ: вечер, туман и ночь движок получает
перекраской слоёв в ближайшие цвета Apollo, а горящие окна, фонари и вывески лежат отдельными слоями *_lights.png.
Дальние планы (road_*, street_far, oez_far) бесшовные по горизонтали — движок их повторяет с параллаксом.

Геометрия (y сверху): горизонт 60–118; у трассы вода 112–134, отбойник 134–148, асфальт 148–170 (колёса на 166);
на улице и в ОЭЗ основания зданий на 148, тротуар 148–166, ноги людей на 160, бордюр и дорога 166–180.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/cutscene_bg.py
Пишет public/assets/cutscene/*.png, src/game/cutscene/bg.gen.ts и превью ×3 в tools/art/out/cs_bg_*.png.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from apollo import RGB  # noqa: E402
from font import GLYPHS, text_w  # noqa: E402
from room3d import Tex, darker, lighter  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'cutscene')
PREV = os.path.join(os.path.dirname(__file__), 'out')
GEN = os.path.join(ROOT, 'src', 'game', 'cutscene', 'bg.gen.ts')
T = -1
H = 180
FEET = 160
rng = np.random.default_rng(2909)

# буквы, которых нет в font.py
GL = dict(GLYPHS)
GL.update({
    'Щ': ['#.#.#.', '#.#.#.', '#.#.#.', '######', '.....#'],
    'И': ['#...#', '#..##', '#.#.#', '##..#', '#...#'],
    'Й': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#'],
    'Ё': ['#.#', '###', '#..', '##.', '#..', '###'],
})


def text(t, x, y, s, c, k=1):
    """Надпись шрифтом 3×5 (k — во сколько раз крупнее). Глифы выше 5 рядов растут вверх."""
    for ch in s:
        g = GL[ch]
        up = len(g) - 5
        for dy, row in enumerate(g):
            for dx, v in enumerate(row):
                if v == '#':
                    t.rect(x + dx * k, y + (dy - up) * k, x + dx * k + k - 1, y + (dy - up) * k + k - 1, c)
        x += (len(g[0]) + 1) * k


def tw(s, k=1):
    return sum((len(GL[ch][0]) + 1) * k for ch in s) - k


# ---------------------------------------------------------------------------------------------------
# общие приёмы
# ---------------------------------------------------------------------------------------------------

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 + 1 / 32


def grad(t, stops, band=6):
    """Небо полосами: stops — [(y, цвет)], между полосами — упорядоченный дизеринг на band строк."""
    for i, (y0, c) in enumerate(stops):
        y1 = stops[i + 1][0] if i + 1 < len(stops) else t.h
        t.rect(0, y0, t.w - 1, y1 - 1, c)
    for i in range(1, len(stops)):
        y, c = stops[i]
        prev = stops[i - 1][1]
        for yy in range(y - band, y + band):
            if not 0 <= yy < t.h:
                continue
            f = (yy - (y - band)) / (2 * band)
            for x in range(t.w):
                t.a[yy, x] = c if BAYER[yy % 4, x % 4] < f else prev


def ell_mask(t, cx, cy, rx, ry):
    xs, ys = t.grid()
    return ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 <= 1


def blob(t, cx, cy, rx, ry, dark, mid, light, edge=0.35, hl=True):
    """Крона/облако: заливка, тень снизу-справа, свет сверху-слева, рваный край."""
    m = ell_mask(t, cx, cy, rx, ry)
    t.a[m] = mid
    sh = m & ~ell_mask(t, cx - rx * 0.25, cy - ry * 0.35, rx * 0.95, ry * 0.9)
    t.a[sh] = dark
    if hl and light is not None:
        li = ell_mask(t, cx - rx * 0.3, cy - ry * 0.35, rx * 0.45, ry * 0.4)
        t.a[li & m] = light
    # рваный край: вокруг кромки отдельные точки внутрь и наружу
    ring = ell_mask(t, cx, cy, rx + 1.2, ry + 1.2) & ~ell_mask(t, cx, cy, rx - 0.8, ry - 0.8)
    ys, xs = np.nonzero(ring)
    for y, x in zip(ys, xs):
        r = rng.random()
        if r < edge * 0.5:
            t.a[y, x] = T if not m[y, x] else t.a[y, x]
        elif r < edge and not m[y, x]:
            t.a[y, x] = dark if y > cy else mid


def crown(t, cx, cy, rx, ry, pal, rngl, n=None, mix=None, core=0.8):
    """Крона из мелких листовых пучков: тёмная подложка, поверх пучки — светлые сверху-слева, тёмные снизу-справа.
    pal — (тёмный, средний, светлый); mix — второй набор цветов для части пучков (зелень среди жёлтого)."""
    dark, mid, light = pal
    t.a[ell_mask(t, cx, cy, rx * core, ry * core)] = dark
    n = n or int(rx * ry * 1.1)
    for _ in range(n):
        a = rngl.uniform(0, 2 * np.pi)
        r = np.sqrt(rngl.uniform(0, 1))
        px_ = cx + np.cos(a) * r * rx
        py_ = cy + np.sin(a) * r * ry
        s = (px_ - cx) / rx * 0.45 + (py_ - cy) / ry * 0.85 + rngl.normal(0, 0.22)
        d_, m_, l_ = mix if (mix and rngl.random() < 0.22) else pal
        c = l_ if s < -0.45 else (m_ if s < 0.3 else d_)
        w = int(rngl.integers(2, 4))
        x0 = int(round(px_ - w / 2))
        y0 = int(round(py_))
        t.rect(x0, y0, x0 + w - 1, y0, c)
        t.rect(x0 + 1, y0 - 1, x0 + w - 2 if w > 2 else x0 + 1, y0 - 1, c)
        if c != d_ and rngl.random() < 0.5:
            t.px(x0 + int(rngl.integers(0, w)), y0 + 1, d_)


def wrap_x(w, x, margin):
    """Где рисовать вещь на бесшовном тайле: сама и её копия с другой стороны, если она у края."""
    xs = [x]
    if x < margin:
        xs.append(x + w)
    if x > w - margin:
        xs.append(x - w)
    return xs


def fold(t, w):
    """Холст шире тайла: всё, что вылезло за правый край, переносим к левому."""
    out = Tex(w, t.h)
    out.a[:, :] = t.a[:, :w]
    extra = t.a[:, w:]
    m = extra != T
    sub = out.a[:, :extra.shape[1]]
    sub[m] = extra[m]
    return out


def speckle(t, x0, y0, x1, y1, c, p, on=None):
    sub = t.a[y0:y1 + 1, x0:x1 + 1]
    m = rng.random(sub.shape) < p
    if on is not None:
        m &= np.isin(sub, np.atleast_1d(on))
    sub[m] = c


def halo(t, cx, cy, r0, r1, c_in, c_out, dense=False):
    """Ореол: сплошной круг r0 и дизеринговое кольцо до r1."""
    xs, ys = t.grid()
    d = np.hypot(xs - cx, ys - cy)
    xi, yi = np.floor(xs).astype(int), np.floor(ys).astype(int)
    f = np.clip((r1 - d) / max(1, r1 - r0), 0, 1)
    if dense:
        ring = (d > r0) & (d <= r1) & (BAYER[yi % 4, xi % 4] < 0.5 + 0.5 * f)
    else:
        # редеет к краю: у ядра — шахматка, дальше отдельные точки
        ring = (d > r0) & (d <= r1) & (BAYER[yi % 4, xi % 4] < 0.08 + 0.45 * f)
    t.a[ring] = c_out
    t.a[d <= r0] = c_in


# ---------------------------------------------------------------------------------------------------
# 1. небо
# ---------------------------------------------------------------------------------------------------

def cloud(t, x, y, w, c=45, s=44):
    """Плоское облако: ровное дно, бугристый верх."""
    n = max(2, w // 10)
    for i in range(n):
        cx = x + w * (i + 0.5) / n
        rx = w / n * 0.9 + rng.integers(0, 4)
        ry = 4 + rng.integers(0, 5) * (1 - abs(i - (n - 1) / 2) / n)
        m = ell_mask(t, cx, y, rx, ry)
        t.a[m] = c
    t.rect(x - 2, y, x + w + 2, y + 2, c)
    t.rect(x, y + 2, x + w, y + 2, s)


def sky_day():
    t = Tex(320, H)
    grad(t, [(0, 3), (46, 4), (96, 5)])
    for x, y, w in ((24, 34, 46), (130, 22, 30), (210, 44, 62), (292, 30, 24), (96, 64, 28)):
        cloud(t, x, y, w)
    return t


def sky_dusk():
    t = Tex(320, H)
    grad(t, [(0, 1), (24, 2), (44, 32), (62, 33), (78, 34), (92, 35), (102, 29), (112, 22), (120, 23)], band=5)
    # низкое солнце справа: половина уже за дальним берегом
    halo(t, 250, 104, 11, 24, 23, 29, dense=True)
    halo(t, 250, 104, 9, 11, 45, 23)
    halo(t, 250, 104, 0, 9, 45, 45)
    # тонкие облака, подсвеченные снизу
    for x, y, w in ((12, 58, 70), (90, 70, 44), (170, 50, 90), (270, 76, 40), (40, 84, 36), (200, 88, 30)):
        t.rect(x, y, x + w, y, 34)
        t.rect(x + 4, y + 1, x + w - 3, y + 1, 29 if y > 60 else 35)
        t.rect(x + 10, y - 1, x + w - 16, y - 1, 33)
    return t


def sky_morning():
    t = Tex(320, H)
    grad(t, [(0, 43), (40, 44), (88, 45)], band=8)
    # бледное солнце сквозь туман
    halo(t, 92, 62, 7, 15, 45, 45)
    # полосы тумана
    for y, x0, x1 in ((70, 0, 150), (78, 120, 319), (96, 0, 319), (104, 40, 260)):
        for yy in range(y, y + 3):
            for x in range(x0, x1 + 1):
                edge = min(x - x0, x1 - x) / 24
                if BAYER[yy % 4, x % 4] < min(0.6, edge) * (0.5 if yy != y + 1 else 1):
                    t.px(x, yy, 45)
    return t


def sky_night():
    t = Tex(320, H)
    grad(t, [(0, 36), (30, 30), (72, 0), (104, 1)], band=6)
    ys = rng.integers(2, 100, 70)
    xs = rng.integers(0, 320, 70)
    for x, y in zip(xs, ys):
        if t.a[y, x] in (36, 30, 0):
            t.px(x, y, 44 if rng.random() < 0.6 else 5)
    for x, y in ((40, 14), (182, 28), (270, 10), (120, 48)):
        t.px(x, y, 45)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            t.px(x + dx, y + dy, 43)
    # луна
    halo(t, 60, 36, 7, 12, 44, 0)
    t.a[ell_mask(t, 60, 36, 7, 7)] = 44
    t.a[ell_mask(t, 58, 34, 4, 4) & ell_mask(t, 60, 36, 7, 7)] = 45
    for x, y in ((62, 38), (63, 34), (58, 39)):
        t.px(x, y, 43)
    return t


# ---------------------------------------------------------------------------------------------------
# 2. трасса вдоль Камы: дальний берег, вода, обочина с берёзами
# ---------------------------------------------------------------------------------------------------

RW = 640  # ширина бесшовных тайлов


def periodic(w, x, parts):
    """Гладкий профиль, период которого делит ширину тайла: parts — [(амплитуда, число волн, фаза)]."""
    return sum(a * np.sin(2 * np.pi * (n * x / w) + ph) for a, n, ph in parts)


def chimney(t, x, top, base, stripes=(27, 45), w=4, band=5):
    for i, y in enumerate(range(top, base)):
        c = stripes[((y - top) // band) % 2]
        t.rect(x, y, x + w - 1, y, c)
    t.rect(x + w - 1, top, x + w - 1, base - 1, darker(stripes[0]))
    t.rect(x - 1, top, x + w, top, 41)


def smoke(t, x, y, n=5, c=45, c2=44):
    for i in range(n):
        cx = x + i * 5 + i * i * 0.6
        cy = y - i * 3
        r = 2 + i * 0.8
        m = ell_mask(t, cx, cy, r + 1, r)
        xs, ys = t.grid()
        chk = ((np.floor(xs) + np.floor(ys)) % 2 == 0) if i > 2 else np.ones_like(m)
        t.a[m & chk] = c if i < 3 else c2


def road_far():
    t = Tex(RW + 120, H)
    xs = np.arange(RW + 120)
    # дальние холмы: серо-зелёная дымка
    ridge = 88 + periodic(RW, xs, [(6, 1, 0.4), (3, 3, 1.1), (1.5, 7, 2.0)])
    near = 100 + periodic(RW, xs, [(3, 2, 2.3), (1.5, 5, 0.3), (1, 11, 1.7)])
    for x in xs:
        r = int(round(ridge[x]))
        t.rect(x, r, x, 114, 42)
        t.px(x, r, 43)
    # ОЭЗ на дальнем берегу: корпуса, трубы, кран
    ox = 380
    for x0, x1, top in ((ox, ox + 34, 84), (ox + 30, ox + 70, 78), (ox + 74, ox + 96, 88), (ox + 100, ox + 140, 82)):
        t.rect(x0, top, x1, 104, 42)
        t.rect(x0, top, x1, top, 44)
        t.rect(x1 - 3, top + 1, x1, 104, 41)
        for y in range(top + 4, 102, 5):
            t.rect(x0 + 2, y, x1 - 5, y, 43)
    chimney(t, ox + 44, 52, 80)
    chimney(t, ox + 56, 60, 80)
    smoke(t, ox + 47, 49, 6)
    smoke(t, ox + 59, 57, 5)
    # кран
    cx = ox + 116
    t.rect(cx, 56, cx + 1, 82, 22)
    for y in range(58, 82, 3):
        t.px(cx + (y // 3) % 2, y, 21)
    t.rect(cx - 10, 56, cx + 26, 57, 22)
    t.rect(cx - 12, 58, cx - 7, 61, 41)
    t.line([(cx + 1, 50), (cx + 26, 56)], 41)
    t.line([(cx + 1, 50), (cx - 10, 56)], 41)
    t.rect(cx + 20, 58, cx + 20, 70, 40)
    t.rect(cx + 18, 70, cx + 22, 72, 40)
    # ближняя лесополоса у воды: тёмная зелень с осенними пятнами
    for x in xs:
        n = int(round(near[x]))
        t.rect(x, n, x, 113, 7)
        t.px(x, n, 8)
    for _ in range(420):
        x = int(rng.integers(0, RW + 110))
        y = int(near[x]) + int(rng.integers(0, 10))
        c = [8, 8, 9, 21, 22, 20, 6][int(rng.integers(0, 7))]
        t.rect(x, y, x + int(rng.integers(0, 2)), y + int(rng.integers(0, 2)), c)
    # верхушки деревьев над лесополосой
    for _ in range(90):
        x = int(rng.integers(0, RW + 110))
        y = int(near[x])
        c = [7, 8, 21, 22][int(rng.integers(0, 4))]
        t.rect(x, y - 2, x + 1, y, c)
        t.px(x, y - 3, c)
    # песок у кромки
    t.rect(0, 112, RW + 119, 113, 16)
    speckle(t, 0, 112, RW + 119, 113, 43, 0.15)
    return fold(t, RW)


def road_river():
    t = Tex(RW, H)
    t.rect(0, 114, RW - 1, 133, 3)
    # отражение дальнего берега — тёмная рваная полоса
    xs = np.arange(RW)
    refl = 118 + periodic(RW, xs, [(1.5, 4, 0.2), (1, 9, 1.3)])
    for x in xs:
        t.rect(x, 114, x, int(round(refl[x])), 2)
        if x % 3 == 0:
            t.px(x, int(round(refl[x])) + 1, 2)
    # полосы ряби и блики
    for _ in range(140):
        x = int(rng.integers(0, RW))
        y = int(rng.integers(120, 132))
        L = int(rng.integers(3, 12))
        c = 2 if rng.random() < 0.45 else (4 if rng.random() < 0.75 else 5)
        for xx in wrap_x(RW, x, 12):
            t.rect(xx, y, xx + L, y, c)
    # ближний берег: песок и камни
    t.rect(0, 132, RW - 1, 135, 16)
    t.rect(0, 132, RW - 1, 132, 17)
    speckle(t, 0, 133, RW - 1, 135, 42, 0.18)
    speckle(t, 0, 133, RW - 1, 135, 15, 0.2)
    return t


def birch(t, x, base, top, rngl):
    """Берёза сбоку: белый ствол со штрихами, жёлтая осенняя крона."""
    t.rect(x, top + 6, x + 2, base, 45)
    t.rect(x + 2, top + 6, x + 2, base, 44)
    for y in range(top + 8, base, 4):
        if rngl.random() < 0.8:
            L = int(rngl.integers(1, 3))
            dx = int(rngl.integers(0, 2))
            t.rect(x + dx, y, x + dx + L - 1, y, 37)
    # ветки
    h = base - top
    for y in range(top + 10, top + int(h * 0.6), 6):
        sd = 1 if (y // 6) % 2 else -1
        t.line([(x + 1, y), (x + 1 + sd * 6, y - 5)], 43)
    # крона: вытянутая, жёлтая с прозеленью, несколько ярусов
    cy = top + h * 0.3
    crown(t, x + 1, cy, 11, h * 0.27, (21, 22, 23), rngl, mix=(9, 10, 11), core=0.7)
    crown(t, x - 6, cy + h * 0.12, 6, h * 0.12, (21, 22, 23), rngl, core=0.5)
    crown(t, x + 8, cy + h * 0.08, 6, h * 0.12, (21, 22, 23), rngl, mix=(9, 10, 11), core=0.5)
    crown(t, x + 1 + int(rngl.integers(-3, 4)), top + 6, 6, 5, (21, 22, 23), rngl, core=0.6)
    # свисающие пряди
    for i in range(10):
        px_ = x + 1 + int(rngl.integers(-9, 10))
        py_ = int(cy + rngl.uniform(0, h * 0.3))
        for k in range(int(rngl.integers(2, 7))):
            if k % 2 == 0:
                t.px(px_, py_ + k, 22 if k < 3 else 21)
    # ствол поверх кроны в нижней части — видно, что крона висит на нём
    t.rect(x, int(cy + h * 0.2), x + 1, base, 45)
    t.rect(x + 2, int(cy + h * 0.2), x + 2, base, 44)


def lamp_post(t, x, base, top=66):
    t.rect(x, top + 2, x + 1, base, 42)
    t.rect(x + 1, top + 2, x + 1, base, 41)
    t.rect(x - 1, base - 3, x + 2, base, 41)
    t.line([(x, top + 2), (x + 3, top), (x + 11, top)], 42)
    t.rect(x + 9, top - 1, x + 15, top + 1, 41)
    t.rect(x + 10, top + 2, x + 14, top + 2, 44)


def lamp_light(t, x, top=66):
    t.rect(x + 10, top + 2, x + 14, top + 2, 45)
    halo(t, x + 12, top + 3, 1.5, 8, 45, 23)


def pool(t, cx, cy, rx, ry, c=22, dens=0.45):
    """Пятно света на земле: гуще в середине, к краю редеет."""
    for y in range(int(cy - ry), int(cy + ry) + 1):
        for x in range(int(cx - rx), int(cx + rx) + 1):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d <= 1 and BAYER[y % 4, x % 4] < dens * (1 - d):
                t.px(x, y, c)


def road_near():
    t = Tex(RW, H)
    lights = Tex(RW, H)
    # склон к воде
    t.rect(0, 134, RW - 1, 147, 9)
    t.rect(0, 134, RW - 1, 134, 10)
    speckle(t, 0, 135, RW - 1, 147, 8, 0.22)
    speckle(t, 0, 135, RW - 1, 147, 10, 0.08)
    speckle(t, 0, 136, RW - 1, 147, 22, 0.03)
    speckle(t, 0, 136, RW - 1, 147, 21, 0.03)
    # берёзы на склоне (до отбойника)
    rngl = np.random.default_rng(12)
    for x, top in ((36, 62), (52, 72), (206, 58), (224, 74), (392, 66), (520, 60), (534, 76), (612, 70)):
        for xx in wrap_x(RW, x, 24):
            birch(t, xx, 141, top, np.random.default_rng(x))
    del rngl
    # кусты у воды
    for x in range(0, RW, 23):
        for xx in wrap_x(RW, x, 8):
            c = [(7, 8, 9), (20, 21, 22), (7, 8, 9)][(x // 23) % 3]
            blob(t, xx + (x * 7) % 11, 138, 5, 3, *c, edge=0.3)
    # отбойник
    for x in range(0, RW, 20):
        t.rect(x + 2, 138, x + 3, 147, 41)
        t.px(x + 2, 138, 42)
        t.px(x + 3, 141, 27)
    t.rect(0, 139, RW - 1, 142, 44)
    t.rect(0, 139, RW - 1, 139, 45)
    t.rect(0, 141, RW - 1, 141, 43)
    t.rect(0, 143, RW - 1, 143, 41)
    # асфальт
    t.rect(0, 148, RW - 1, 149, 41)
    t.rect(0, 150, RW - 1, 150, 44)
    t.rect(0, 151, RW - 1, 167, 40)
    speckle(t, 0, 151, RW - 1, 167, 39, 0.12)
    speckle(t, 0, 151, RW - 1, 167, 41, 0.04)
    for x in range(0, RW, 20):
        t.rect(x, 158, x + 11, 159, 45)
    # трещины и заплатки
    for _ in range(10):
        x = int(rng.integers(0, RW - 30))
        y = int(rng.integers(152, 165))
        t.line([(x, y), (x + 4, y + 1), (x + 9, y), (x + 13, y + 2)], 39)
    for x in (140, 460):
        t.rect(x, 162, x + 26, 166, 39)
        t.rect(x + 1, 163, x + 25, 165, 38)
    t.rect(0, 168, RW - 1, 168, 44)
    t.rect(0, 169, RW - 1, 170, 41)
    # передняя обочина
    t.rect(0, 171, RW - 1, 179, 8)
    t.rect(0, 171, RW - 1, 171, 9)
    speckle(t, 0, 172, RW - 1, 179, 7, 0.25)
    speckle(t, 0, 172, RW - 1, 179, 9, 0.15)
    speckle(t, 0, 172, RW - 1, 179, 21, 0.03)
    for x in range(3, RW, 7):
        h = int(rng.integers(1, 4))
        t.rect(x, 171 - h, x, 171, 9 if x % 3 else 10)
    # столбы освещения
    for x in (100, 260, 420, 580):
        lamp_post(t, x, 147)
        lamp_light(lights, x)
        pool(lights, x + 12, 156, 20, 5, 42, 0.5)
    # знак «ЕЛАБУГА 12»
    sx = 300
    t.rect(sx + 5, 118, sx + 5, 147, 41)
    t.rect(sx + 40, 118, sx + 40, 147, 41)
    t.rect(sx, 108, sx + 45, 121, 45)
    t.rect(sx + 1, 109, sx + 44, 120, 2)
    t.rect(sx + 1, 120, sx + 44, 120, 1)
    s = 'ЕЛАБУГА 12'
    text(t, sx + 1 + (44 - tw(s)) // 2 + 1, 112, s, 45)
    return t, lights


# ---------------------------------------------------------------------------------------------------
# 3. автобус
# ---------------------------------------------------------------------------------------------------

BUS_W, BUS_H = 136, 52
WHEELS = [(24, 45), (104, 45)]
WHEEL_R = 7


def bus():
    t = Tex(BUS_W, BUS_H)
    lights = Tex(BUS_W, BUS_H)
    # кузов
    t.rect(2, 4, 131, 44, 45)
    t.rect(4, 2, 128, 3, 44)                       # крыша
    t.rect(4, 2, 128, 2, 45)
    t.rect(34, 0, 70, 2, 43)                       # кондиционер
    t.rect(34, 0, 70, 0, 44)
    t.rect(2, 36, 131, 44, 44)                     # низ в тени
    t.rect(2, 44, 131, 44, 42)
    # нос: скошенное лобовое
    t.poly([(124, 4), (131, 4), (135, 30), (135, 44), (124, 44)], 45)
    t.poly([(125, 6), (131, 6), (134, 28), (125, 28)], 1)
    t.line([(127, 8), (131, 22)], 3)
    t.rect(124, 36, 135, 44, 44)
    t.rect(131, 34, 134, 37, 23)                   # фара
    t.px(134, 36, 45)
    t.rect(132, 40, 135, 42, 41)                   # бампер
    t.rect(133, 7, 135, 8, 40)                     # зеркало
    t.rect(134, 9, 134, 13, 40)
    # табло маршрута над окнами
    t.rect(84, 4, 118, 9, 38)
    text(t, 87, 5, 'ЕЛАБУГА', 22)
    # полосы
    t.rect(2, 30, 131, 31, 2)
    t.rect(2, 32, 131, 33, 29)
    t.poly([(96, 30), (124, 30), (128, 33), (100, 33)], 3)
    # окна салона
    wins = [(6, 22), (25, 41), (44, 60), (63, 79)]
    for x0, x1 in wins:
        t.rect(x0, 11, x1, 26, 1)
        t.rect(x0, 11, x1, 11, 2)
        t.line([(x0 + 3, 25), (x0 + 12, 12)], 2)
    # дверь между окнами и колесом
    t.rect(84, 11, 97, 43, 41)
    t.rect(85, 12, 90, 42, 1)
    t.rect(91, 12, 96, 42, 1)
    t.rect(85, 12, 96, 12, 2)
    t.line([(86, 30), (89, 14)], 2)
    t.rect(98, 11, 121, 26, 1)
    t.rect(98, 11, 121, 11, 2)
    t.line([(101, 25), (109, 12)], 2)
    # пассажиры в окнах: силуэты голов, новенький — во втором окне
    heads = [(12, 38), (31, 19), (50, 38), (70, 38), (104, 38)]
    for i, (hx, c) in enumerate(heads):
        if i == 1:
            # новенький: каштановые волосы, синяя ветровка, профиль вправо
            t.sprite(hx, 17, [
                '.hhhh.',
                'hhhhhh',
                'hhhsss',
                'hhssss',
                '.hsss.',
                '..ss..',
                'jjjjjj',
                'jjjjjjj',
                'jjjjjjjj',
            ], {'h': 19, 's': 15, 'j': 3})
        else:
            t.sprite(hx, 18, [
                '.cccc.',
                'cccccc',
                'cccccc',
                '.cccc.',
                '..cc..',
                'cccccc.',
                'ccccccc',
                'cccccccc',
            ], {'c': c if c != 38 else 2})
    # тень на асфальте
    t.rect(4, 50, 131, 51, 39)
    t.rect(8, 49, 127, 49, 39)
    # задний фонарь
    t.rect(1, 30, 3, 38, 27)
    t.rect(1, 30, 1, 38, 26)
    # колёсные арки
    for wx, wy in WHEELS:
        t.a[ell_mask(t, wx, wy, 9.5, 9.5)] = T
        m = ell_mask(t, wx, wy, 9.5, 9.5) & ~ell_mask(t, wx, wy, 8.2, 8.2)
        m[wy + 2:] = False
        t.a[m] = 40
        t.a[ell_mask(t, wx, wy, 8.2, 8.2)] = 38
        t.a[wy + 2:, :] = np.where(ell_mask(t, wx, wy, 9.5, 9.5)[wy + 2:, :], T, t.a[wy + 2:, :])
    t.a[45:, :] = np.where(t.a[45:, :] == 38, T, t.a[45:, :])
    # слой света: окна салона тёплые, фары
    for x0, x1 in wins + [(98, 121)]:
        lights.rect(x0, 11, x1, 26, 23)
        lights.rect(x0, 11, x1, 12, 22)
    lights.rect(85, 12, 96, 42, 22)
    for i, (hx, c) in enumerate(heads):
        lights.sprite(hx, 17 if i == 1 else 18, [
            '.cccc.',
            'cccccc',
            'cccccc',
            '.cccc.',
            '..cc..',
            'cccccc.',
            'ccccccc',
            'cccccccc',
            'cccccccc',
        ], {'c': 20})
    lights.rect(131, 34, 134, 37, 45)
    halo(lights, 136, 36, 1, 5, 45, 23)
    lights.rect(1, 30, 3, 38, 28)
    return t, lights


def wheel():
    t = Tex(28, 14)
    for f in range(2):
        ox = f * 14
        cx, cy = ox + 7, 7
        t.a[ell_mask(t, cx, cy, 7, 7)] = 37
        t.a[ell_mask(t, cx, cy, 6, 6)] = 38
        t.a[ell_mask(t, cx, cy, 4, 4)] = 42
        t.a[ell_mask(t, cx, cy, 3, 3)] = 43
        t.a[ell_mask(t, cx, cy, 1.2, 1.2)] = 41
        bolts = [(0, -2), (2, 0), (0, 2), (-2, 0)] if f == 0 else [(1, -1), (1, 1), (-2, 1), (-2, -2)]
        for dx, dy in bolts:
            t.px(cx + dx - (1 if f else 0) * 0, cy + dy, 40)
        # протектор: тёмные засечки по кругу
        for k in range(8):
            a = k * np.pi / 4 + (np.pi / 8 if f else 0)
            t.px(round(cx - 0.5 + 6.2 * np.cos(a)), round(cy - 0.5 + 6.2 * np.sin(a)), 39)
    return t


# ---------------------------------------------------------------------------------------------------
# 4. улица Елабуги: дальний план и путь от остановки до общаги
# ---------------------------------------------------------------------------------------------------

def windows_grid(t, lights, x0, x1, top, bottom, ww, wh, sx, sy, glass, frame=None, lit=0.35, rngl=None, warm=(23, 22)):
    rngl = rngl or rng
    y = top
    while y + wh <= bottom:
        x = x0
        while x + ww <= x1:
            t.rect(x, y, x + ww - 1, y + wh - 1, glass)
            if frame is not None:
                t.rect(x, y + wh, x + ww - 1, y + wh, frame)
            if lights is not None and rngl.random() < lit:
                c = warm[0] if rngl.random() < 0.8 else 4
                lights.rect(x, y, x + ww - 1, y + wh - 1, c)
                if ww >= 3 and wh >= 3 and c != 4:
                    lights.rect(x, y, x + ww - 1, y, warm[1])
            x += sx
        y += sy


def street_far():
    W = RW
    t = Tex(W + 140, H)
    L = Tex(W + 140, H)
    # земля за улицей
    t.rect(0, 140, W + 139, 148, 42)
    rngl = np.random.default_rng(31)
    # дальний ряд девятиэтажек (самые бледные)
    x = 0
    while x < W:
        w = int(rngl.integers(50, 80))
        top = int(rngl.integers(58, 76))
        t.rect(x, top, x + w, 140, 44)
        t.rect(x, top, x + w, top + 1, 45)
        t.rect(x + w - 4, top + 2, x + w, 140, 43)
        windows_grid(t, L, x + 3, x + w - 5, top + 4, 138, 2, 2, 5, 6, 43, lit=0.25, rngl=rngl)
        x += w + int(rngl.integers(14, 40))
    # купол церкви
    cx = 300
    t.rect(cx - 12, 92, cx + 12, 140, 45)
    t.rect(cx + 9, 92, cx + 12, 140, 44)
    t.rect(cx - 6, 78, cx + 6, 92, 45)
    t.rect(cx + 4, 78, cx + 6, 92, 44)
    t.a[ell_mask(t, cx, 76, 6, 7) & (t.grid()[1] < 78)] = 22
    t.a[ell_mask(t, cx - 2, 73, 2, 3)] = 23
    t.rect(cx, 62, cx, 69, 22)
    t.rect(cx - 2, 64, cx + 2, 64, 22)
    for wx in (cx - 8, cx - 2, cx + 4):
        t.rect(wx, 100, wx + 2, 108, 42)
        t.px(wx + 1, 99, 42)
    L.rect(cx - 8, 100, cx - 6, 108, 23)
    L.rect(cx + 4, 100, cx + 6, 108, 23)
    # ближний ряд пятиэтажек
    x = 30
    while x < W:
        w = int(rngl.integers(70, 110))
        top = int(rngl.integers(88, 100))
        base = [43, 16, 43, 17][int(rngl.integers(0, 4))]
        t.rect(x, top, x + w, 140, base)
        t.rect(x, top, x + w, top, 44 if base == 43 else 17)
        t.rect(x + w - 5, top + 1, x + w, 140, darker(base))
        t.rect(x - 1, top - 2, x + w + 1, top - 1, 41)
        windows_grid(t, L, x + 3, x + w - 7, top + 4, 136, 3, 4, 7, 8, 42 if base == 43 else 15, lit=0.35, rngl=rngl)
        x += w + int(rngl.integers(40, 90))
    # деревья перед домами
    for _ in range(26):
        tx = int(rngl.integers(0, W))
        pal = [(7, 8, 9), (20, 21, 22), (21, 22, 23), (19, 20, 21), (8, 9, 10)][int(rngl.integers(0, 5))]
        r = int(rngl.integers(6, 11))
        cy = 140 - r - int(rngl.integers(2, 8))
        t.rect(tx, cy, tx + 1, 146, 19)
        crown(t, tx + 0.5, cy, r, r * 0.8, pal, rngl)
    t.rect(0, 146, W + 139, 148, 41)
    return fold(t, W), fold(L, W)


def fence(t, x0, x1, top, base, c=41, hi=42, step=5):
    t.rect(x0, top + 2, x1, top + 3, c)
    t.rect(x0, base - 4, x1, base - 3, c)
    for x in range(x0, x1 + 1, step):
        t.rect(x, top, x + 1, base, c)
        t.px(x, top, hi)


def tree(t, x, base, top, pal, rngl, trunk=19, mix=None):
    """Лиственное дерево: ствол с двумя ветками и круглая крона из пучков."""
    h = base - top
    t.rect(x, top + 8, x + 2, base, trunk)
    t.rect(x + 2, top + 8, x + 2, base, darker(trunk))
    rx = max(9, h * 0.3)
    ry = h * 0.3
    cy = top + ry
    crown(t, x + 1, cy, rx, ry, pal, rngl, mix=mix)
    crown(t, x - rx * 0.45, cy + ry * 0.35, rx * 0.55, ry * 0.5, pal, rngl)
    crown(t, x + 3 + rx * 0.45, cy + ry * 0.3, rx * 0.55, ry * 0.5, pal, rngl)
    # ветки в просвете под кроной
    t.line([(x + 1, int(cy + ry * 0.9)), (x - 4, int(cy + ry * 0.4))], trunk)
    t.line([(x + 1, int(cy + ry * 0.8)), (x + 6, int(cy + ry * 0.3))], trunk)


def bench(t, x, base):
    t.rect(x, base - 10, x + 26, base - 9, 20)
    t.rect(x, base - 14, x + 26, base - 13, 20)
    t.rect(x, base - 10, x + 26, base - 10, 21)
    t.rect(x, base - 14, x + 26, base - 14, 21)
    for lx in (x + 2, x + 22):
        t.rect(lx, base - 8, lx + 1, base, 40)
    t.rect(x + 2, base - 13, x + 3, base - 9, 40)
    t.rect(x + 22, base - 13, x + 23, base - 9, 40)


def ground_street(t, w):
    # газон за тротуаром
    t.rect(0, 140, w - 1, 147, 9)
    t.rect(0, 140, w - 1, 140, 10)
    speckle(t, 0, 141, w - 1, 147, 8, 0.25)
    speckle(t, 0, 141, w - 1, 147, 21, 0.04)
    speckle(t, 0, 141, w - 1, 147, 22, 0.03)
    # тротуар: плитка
    t.rect(0, 148, w - 1, 165, 43)
    t.rect(0, 148, w - 1, 148, 44)
    for y in (153, 159):
        t.rect(0, y, w - 1, y, 42)
    for y0, y1, off in ((149, 152, 0), (154, 158, 6), (160, 165, 3)):
        for x in range(off, w, 12):
            t.rect(x, y0, x, y1, 42)
    speckle(t, 0, 149, w - 1, 165, 44, 0.03)
    # бордюр и край дороги
    t.rect(0, 166, w - 1, 168, 44)
    t.rect(0, 166, w - 1, 166, 45)
    t.rect(0, 168, w - 1, 168, 42)
    for x in range(0, w, 16):
        t.rect(x, 166, x, 168, 42)
    t.rect(0, 169, w - 1, 179, 40)
    speckle(t, 0, 169, w - 1, 179, 39, 0.14)
    t.rect(0, 169, w - 1, 169, 39)
    # опавшие листья на тротуаре
    for _ in range(w // 9):
        x = int(rng.integers(0, w))
        y = int(rng.integers(149, 166))
        t.px(x, y, [21, 22, 28, 23][int(rng.integers(0, 4))])


def street_near():
    w = 960
    t = Tex(w, H)
    L = Tex(w, H)
    rngl = np.random.default_rng(77)
    ground_street(t, w)

    # --- остановка x 10–120 ---
    x0, x1 = 14, 114
    t.rect(x0, 92, x1, 98, 41)                               # козырёк
    t.rect(x0, 92, x1, 92, 43)
    t.rect(x0 + 1, 93, x1 - 1, 97, 45)                       # табло-фриз
    s = 'ОСТАНОВКА'
    text(t, x0 + (x1 - x0 - tw(s)) // 2 + 1, 93, s, 2)
    t.rect(x0, 98, x1, 98, 40)
    for px_ in (x0 + 3, x1 - 4):
        t.rect(px_, 99, px_ + 1, 150, 41)
        t.px(px_, 99, 42)
    t.rect(x0 + 6, 101, x1 - 7, 136, 5)                      # стекло задней стенки
    t.rect(x0 + 6, 101, x1 - 7, 101, 41)
    t.rect(x0 + 6, 136, x1 - 7, 136, 41)
    for gx in range(x0 + 6, x1 - 6, 24):
        t.rect(gx, 101, gx, 136, 41)
    for gx in range(x0 + 12, x1 - 12, 24):
        t.line([(gx, 132), (gx + 10, 104)], 45)
        t.line([(gx + 3, 132), (gx + 13, 104)], 44)
    t.rect(x0 + 30, 106, x0 + 54, 126, 44)                   # расписание / объявление
    t.rect(x0 + 31, 107, x0 + 53, 110, 3)
    for yy in range(113, 125, 3):
        t.rect(x0 + 33, yy, x0 + 50, yy, 42)
    bench(t, x0 + 34, 148)
    t.rect(x1 + 2, 136, x1 + 8, 148, 41)                     # урна
    t.rect(x1 + 2, 136, x1 + 8, 136, 43)
    t.rect(x1 + 3, 138, x1 + 7, 147, 40)
    # знак «А» на столбе
    sx = 124
    t.rect(sx, 96, sx + 1, 150, 41)
    t.rect(sx - 5, 84, sx + 6, 95, 45)
    t.rect(sx - 5, 84, sx + 6, 84, 2)
    t.rect(sx - 5, 95, sx + 6, 95, 2)
    t.rect(sx - 5, 84, sx - 5, 95, 2)
    t.rect(sx + 6, 84, sx + 6, 95, 2)
    text(t, sx - 1, 87, 'А', 2)
    t.rect(sx - 4, 96, sx + 5, 99, 22)
    t.rect(sx - 3, 97, sx + 4, 97, 20)
    L.rect(x0 + 6, 99, x1 - 7, 99, 45)                       # лампа под козырьком
    halo(L, (x0 + x1) // 2, 101, 1.5, 12, 45, 23)
    pool(L, (x0 + x1) // 2, 154, 40, 7, 22, 0.4)
    L.rect(x0 + 1, 93, x1 - 1, 97, 45)
    text(L, x0 + (x1 - x0 - tw(s)) // 2 + 1, 93, s, 2)

    # --- x 130–300: берёзы, фонарь, забор, газон ---
    fence(t, 150, 290, 134, 147)
    birch(t, 160, 146, 50, np.random.default_rng(5))
    birch(t, 262, 146, 58, np.random.default_rng(9))
    lamp_post(t, 212, 148, 70)
    lamp_light(L, 212, 70)
    pool(L, 224, 156, 18, 6)
    tree(t, 236, 146, 74, (20, 21, 22), rngl)

    # --- x 300–450: «Семёрочка» ---
    s0, s1 = 304, 446
    t.rect(s0, 86, s1, 147, 17)
    t.rect(s1 - 6, 88, s1, 147, 16)
    speckle(t, s0, 104, s1 - 7, 146, 16, 0.06)
    t.rect(s0 - 2, 82, s1 + 2, 86, 41)                       # парапет
    t.rect(s0 - 2, 82, s1 + 2, 82, 43)
    t.rect(s0, 88, s1, 104, 8)                               # вывеска
    t.rect(s0, 88, s1, 88, 9)
    t.rect(s0, 104, s1, 104, 7)
    s = 'СЕМЁРОЧКА'
    sw = tw(s, 2)
    tx = s0 + 6
    text(t, tx, 93, s, 45, 2)
    t.rect(tx + sw + 6, 90, tx + sw + 17, 101, 22)            # «7» в жёлтом квадрате
    t.rect(tx + sw + 6, 90, tx + sw + 17, 90, 23)
    text(t, tx + sw + 9, 92, '7', 8, 2)
    # витрина
    t.rect(s0 + 8, 110, s0 + 80, 142, 41)
    t.rect(s0 + 9, 111, s0 + 79, 141, 4)
    for sy in (120, 130):                                     # полки за стеклом
        t.rect(s0 + 10, sy, s0 + 78, sy, 3)
        for bx in range(s0 + 11, s0 + 77, 4):
            t.rect(bx, sy - 4, bx + 2, sy - 1, [27, 22, 9, 3, 34, 45][(bx // 4) % 6])
    t.line([(s0 + 14, 140), (s0 + 34, 112)], 5)
    t.line([(s0 + 18, 140), (s0 + 38, 112)], 5)
    t.line([(s0 + 50, 140), (s0 + 66, 112)], 5)
    t.rect(s0 + 8, 142, s0 + 80, 143, 43)
    # дверь с козырьком
    d0, d1 = s0 + 94, s0 + 118
    t.rect(d0 - 6, 104, d1 + 6, 108, 8)
    t.rect(d0 - 6, 108, d1 + 6, 108, 7)
    t.rect(d0, 110, d1, 147, 41)
    t.rect(d0 + 2, 112, d0 + 11, 146, 4)
    t.rect(d0 + 13, 112, d1 - 2, 146, 4)
    t.line([(d0 + 3, 140), (d0 + 9, 116)], 5)
    t.rect(d0 + 10, 126, d0 + 11, 130, 43)
    t.rect(d0 + 13, 126, d0 + 14, 130, 43)
    t.rect(d0 + 4, 118, d1 - 4, 122, 22)                      # табличка «открыто»
    t.rect(d0 - 2, 146, d1 + 2, 147, 42)
    t.rect(s1 - 16, 116, s1 - 8, 128, 45)                     # объявление
    t.rect(s1 - 15, 118, s1 - 9, 118, 27)
    # свет магазина
    L.rect(s0, 88, s1, 104, 9)
    L.rect(s0, 88, s1, 88, 10)
    text(L, tx, 93, s, 45, 2)
    L.rect(tx + sw + 6, 90, tx + sw + 17, 101, 23)
    text(L, tx + sw + 9, 92, '7', 8, 2)
    L.rect(s0 + 9, 111, s0 + 79, 141, 23)
    for sy in (120, 130):
        L.rect(s0 + 10, sy, s0 + 78, sy, 21)
        for bx in range(s0 + 11, s0 + 77, 4):
            L.rect(bx, sy - 4, bx + 2, sy - 1, [27, 29, 9, 3, 34, 45][(bx // 4) % 6])
    L.rect(d0 + 2, 112, d0 + 11, 146, 23)
    L.rect(d0 + 13, 112, d1 - 2, 146, 23)
    L.rect(d0 + 4, 118, d1 - 4, 122, 22)
    pool(L, s0 + 44, 152, 44, 6, 22, 0.5)                    # свет из витрины на плитку
    pool(L, (d0 + d1) // 2, 152, 18, 6, 22, 0.5)
    shop_door = (d0 + d1) // 2

    # --- x 450–580: деревья, скамейка, фонарь, клумба-шина ---
    tree(t, 470, 146, 64, (21, 22, 23), rngl)
    tree(t, 568, 146, 70, (7, 8, 9), rngl, mix=(21, 22, 23))
    bench(t, 486, 146)
    lamp_post(t, 526, 148, 70)
    lamp_light(L, 526, 70)
    pool(L, 538, 156, 18, 6)
    # крашеная покрышка с цветами
    tx0 = 540
    t.rect(tx0, 140, tx0 + 18, 147, 22)
    t.rect(tx0, 140, tx0 + 18, 140, 23)
    t.rect(tx0 + 2, 142, tx0 + 16, 144, 13)
    for i in range(0, 18, 4):
        t.rect(tx0 + i, 145, tx0 + i + 1, 147, 21)
    for fx, c in ((tx0 + 4, 28), (tx0 + 8, 35), (tx0 + 12, 23), (tx0 + 15, 28)):
        t.rect(fx, 136, fx, 141, 8)
        t.rect(fx - 1, 135, fx + 1, 136, c)
        t.px(fx, 134, c)

    # --- x 580–920: общежитие, пять этажей ---
    b0, b1 = 590, 910
    top = 9
    door = 740
    t.rect(b0, top, b1, 147, 16)
    t.rect(b0, top, b1, top + 1, 17)
    # кирпичная кладка: редкие швы
    for y in range(top + 3, 147, 3):
        off = 0 if (y // 3) % 2 else 4
        for x in range(b0 + off, b1, 8):
            t.px(x, y, 15)
    t.rect(b1 - 8, top + 2, b1, 147, 15)                     # тень торца
    t.rect(b0 - 2, top - 5, b1 + 2, top - 1, 41)             # парапет
    t.rect(b0 - 2, top - 5, b1 + 2, top - 5, 43)
    belts = [96, 75, 54, 33]                                  # межэтажные пояса
    for fy in belts:
        t.rect(b0, fy - 1, b1 - 9, fy, 15)
    t.rect(b0, 145, b1, 147, 42)                             # цоколь
    t.rect(b0, 145, b1, 145, 43)
    rngw = np.random.default_rng(214)
    cols = [x for x in range(b0 + 10, b1 - 22, 26) if abs(x + 6 - door) > 24]
    plate_w = tw('ОБЩЕЖИТИЕ') + 6
    p0 = door + 25
    ground = [x for x in cols if not (door - 30 < x + 14 and x - 2 < p0 + plate_w + 2)]
    # окна четырёх верхних этажей 12×13
    for fy in belts:
        for cx_ in cols:
            wx, wy = cx_, fy - 17
            t.rect(wx - 1, wy - 1, wx + 12, wy + 13, 45)
            t.rect(wx, wy, wx + 11, wy + 12, 3)
            t.rect(wx + 5, wy, wx + 6, wy + 12, 45)
            t.rect(wx, wy + 4, wx + 11, wy + 4, 45)
            t.line([(wx + 1, wy + 11), (wx + 4, wy + 6)], 4)
            t.line([(wx + 8, wy + 11), (wx + 10, wy + 8)], 4)
            t.rect(wx - 2, wy + 14, wx + 13, wy + 14, 43)    # отлив
            r = rngw.random()
            if r < 0.25:                                      # занавески
                c = [34, 22, 9, 28][int(rngw.integers(0, 4))]
                t.rect(wx, wy + 5, wx + 1, wy + 12, c)
                t.rect(wx + 10, wy + 5, wx + 11, wy + 12, c)
            elif r < 0.4:                                     # цветок на подоконнике
                t.rect(wx + 2, wy + 10, wx + 4, wy + 12, 28)
                t.rect(wx + 2, wy + 7, wx + 4, wy + 9, 9)
            if rngw.random() < 0.5:
                c = 23 if rngw.random() < 0.85 else 4
                L.rect(wx, wy, wx + 11, wy + 12, c)
                L.rect(wx + 5, wy, wx + 6, wy + 12, 22 if c == 23 else 3)
                L.rect(wx, wy + 4, wx + 11, wy + 4, 22 if c == 23 else 3)
                if r < 0.25:
                    L.rect(wx, wy + 5, wx + 1, wy + 12, 21)
                    L.rect(wx + 10, wy + 5, wx + 11, wy + 12, 21)
    # окна лестницы над входом — между этажами
    for sy in (80, 59, 38, 17):
        t.rect(door - 6, sy - 1, door + 6, sy + 9, 45)
        t.rect(door - 5, sy, door + 5, sy + 8, 3)
        t.rect(door, sy, door, sy + 8, 45)
        t.line([(door - 4, sy + 7), (door - 2, sy + 2)], 4)
        L.rect(door - 5, sy, door + 5, sy + 8, 22)
        L.rect(door, sy, door, sy + 8, 21)
    for cx_ in ground:                                        # первый этаж
        wx, wy = cx_ - 1, 104
        t.rect(wx - 1, wy - 1, wx + 14, wy + 19, 45)
        t.rect(wx, wy, wx + 13, wy + 18, 3)
        t.rect(wx + 6, wy, wx + 7, wy + 18, 45)
        t.line([(wx + 1, wy + 17), (wx + 5, wy + 8)], 4)
        t.rect(wx - 2, wy + 20, wx + 15, wy + 20, 43)
        for gy in range(wy + 2, wy + 18, 4):                  # решётки первого этажа
            t.rect(wx, gy, wx + 13, gy, 40)
        if rngw.random() < 0.5:
            L.rect(wx, wy, wx + 13, wy + 18, 23)
            for gy in range(wy + 2, wy + 18, 4):
                L.rect(wx, gy, wx + 13, gy, 20)
            L.rect(wx + 6, wy, wx + 7, wy + 18, 21)
    # балкон с бельём на третьем этаже
    bx0 = cols[1] - 4
    wy = 54 - 17
    t.rect(bx0, wy + 7, bx0 + 20, wy + 14, 42)
    t.rect(bx0, wy + 7, bx0 + 20, wy + 7, 44)
    for x in range(bx0 + 1, bx0 + 20, 3):
        t.rect(x, wy + 8, x, wy + 14, 41)
    t.line([(bx0 + 1, wy - 1), (bx0 + 19, wy - 1)], 41)
    for x, c in ((bx0 + 3, 45), (bx0 + 8, 34), (bx0 + 13, 4)):
        t.rect(x, wy, x + 3, wy + 5, c)
    # крыльцо
    t.rect(door - 22, 92, door + 22, 96, 43)                  # козырёк
    t.rect(door - 22, 92, door + 22, 92, 44)
    t.rect(door - 22, 96, door + 22, 96, 41)
    for px_ in (door - 20, door + 19):
        t.rect(px_, 97, px_ + 1, 145, 42)
    t.rect(door - 10, 100, door + 10, 145, 20)                # дверь
    t.rect(door - 10, 100, door + 10, 100, 19)
    t.rect(door - 8, 103, door + 8, 120, 19)
    t.rect(door - 8, 124, door + 8, 142, 19)
    t.rect(door - 7, 104, door + 7, 119, 20)
    t.rect(door - 7, 125, door + 7, 141, 20)
    t.rect(door + 5, 121, door + 7, 123, 43)                  # ручка
    t.rect(door + 12, 116, door + 16, 124, 41)                # домофон
    t.rect(door + 13, 118, door + 15, 120, 39)
    t.rect(door - 2, 97, door + 2, 99, 41)                    # лампа над дверью
    t.rect(door - 1, 99, door + 1, 99, 44)
    t.rect(door - 24, 144, door + 24, 147, 43)                # ступени
    t.rect(door - 24, 144, door + 24, 144, 44)
    t.rect(door - 20, 141, door + 20, 143, 44)
    t.rect(door - 20, 141, door + 20, 141, 45)
    # табличка «ОБЩЕЖИТИЕ №3»
    t.rect(p0, 101, p0 + plate_w, 117, 2)
    t.rect(p0, 101, p0 + plate_w, 101, 3)
    t.rect(p0, 117, p0 + plate_w, 117, 1)
    text(t, p0 + (plate_w + 1 - tw('ОБЩЕЖИТИЕ')) // 2, 104, 'ОБЩЕЖИТИЕ', 45)
    text(t, p0 + (plate_w + 1 - tw('№3')) // 2, 110, '№3', 45)
    # велосипед у стены
    vx = 676
    for wcx in (vx, vx + 18):
        m = ell_mask(t, wcx, 140, 6, 6) & ~ell_mask(t, wcx, 140, 4.8, 4.8)
        t.a[m] = 38
        t.px(wcx, 140, 41)
    t.line([(vx, 140), (vx + 7, 131), (vx + 16, 131), (vx + 18, 140)], 27)
    t.line([(vx + 7, 131), (vx + 9, 140), (vx + 16, 131)], 27)
    t.line([(vx + 9, 140), (vx, 140)], 27)
    t.rect(vx + 5, 128, vx + 9, 129, 38)                      # седло
    t.line([(vx + 16, 131), (vx + 15, 126), (vx + 18, 125)], 41)
    # свет крыльца
    L.rect(door - 1, 99, door + 1, 99, 45)
    halo(L, door, 100, 1.5, 11, 45, 23)
    pool(L, door, 152, 24, 7, 22, 0.55)
    L.rect(p0 + 1, 102, p0 + plate_w - 1, 116, 3)
    text(L, p0 + (plate_w + 1 - tw('ОБЩЕЖИТИЕ')) // 2, 104, 'ОБЩЕЖИТИЕ', 45)
    text(L, p0 + (plate_w + 1 - tw('№3')) // 2, 110, '№3', 45)

    # --- x 920–960: деревья ---
    tree(t, 930, 146, 60, (20, 21, 22), rngl)
    tree(t, 954, 146, 72, (21, 22, 23), rngl)
    # фонари для свечения на участке общаги
    lamp_post(t, 612, 148, 72)
    lamp_light(L, 612, 72)
    pool(L, 624, 156, 18, 6)
    return t, L, {'stopX': 64, 'stopSignX': sx, 'shopDoorX': shop_door, 'dormDoorX': door}


# ---------------------------------------------------------------------------------------------------
# 5. ОЭЗ «Алабуга»: дальняя промзона и въезд с корпусами
# ---------------------------------------------------------------------------------------------------

def pylon(t, x, base, top):
    t.line([(x - 6, base), (x - 1, top)], 41)
    t.line([(x + 6, base), (x + 1, top)], 41)
    for y in range(top + 6, base, 7):
        k = (y - top) / (base - top)
        dx = int(1 + 5 * k)
        t.line([(x - dx, y), (x + dx, y + 6)], 41)
        t.line([(x + dx, y), (x - dx, y + 6)], 41)
    t.rect(x - 9, top + 4, x + 9, top + 4, 41)
    t.rect(x - 6, top + 10, x + 6, top + 10, 41)
    return (x - 9, top + 5), (x + 9, top + 5)


def oez_far():
    W = RW
    t = Tex(W + 160, H)
    L = Tex(W + 160, H)
    rngl = np.random.default_rng(88)
    t.rect(0, 136, W + 159, 148, 42)
    # огромные корпуса с шедовыми крышами
    x = 0
    while x < W:
        w = int(rngl.integers(90, 150))
        top = int(rngl.integers(92, 108))
        t.rect(x, top, x + w, 140, 43)
        t.rect(x + w - 5, top, x + w, 140, 42)
        for sx_ in range(x, x + w - 6, 10):                   # шеды
            t.poly([(sx_, top), (sx_ + 7, top - 6), (sx_ + 7, top), (sx_ + 10, top)], 42)
            t.rect(sx_ + 7, top - 6, sx_ + 7, top - 1, 44)
            L.rect(sx_ + 6, top - 4, sx_ + 6, top - 1, 4)
        for y in range(top + 6, 136, 6):
            t.rect(x + 2, y, x + w - 7, y, 42)
        windows_grid(t, L, x + 6, x + w - 8, top + 10, 128, 6, 2, 10, 12, 41, lit=0.3, rngl=rngl, warm=(4, 5))
        x += w + int(rngl.integers(10, 50))
    # цистерны
    for cx in (140, 158, 470):
        t.rect(cx - 7, 116, cx + 7, 138, 44)
        t.rect(cx + 4, 116, cx + 7, 138, 43)
        t.a[ell_mask(t, cx, 116, 7, 3)] = 45
        t.rect(cx - 7, 124, cx + 7, 124, 43)
    # трубы с огнями
    for cx, top_ in ((70, 46), (82, 58), (330, 40), (560, 52)):
        chimney(t, cx, top_, 110, (28, 44), 5, 6)
        L.rect(cx + 1, top_ + 1, cx + 3, top_ + 1, 27)
        L.px(cx + 2, top_ - 1, 28)
        L.px(cx + 2, top_ + 20, 27)
        smoke(t, cx + 3, top_ - 3, 6, 45, 44)
    # краны
    for cx in (230, 410):
        t.rect(cx, 50, cx + 1, 104, 41)
        for y in range(52, 104, 3):
            t.px(cx + (y // 3) % 2, y, 40)
        t.rect(cx - 14, 50, cx + 34, 51, 41)
        t.rect(cx - 16, 52, cx - 10, 56, 40)
        t.rect(cx + 26, 52, cx + 26, 70, 40)
        L.px(cx, 48, 27)
        L.px(cx + 34, 49, 27)
    # опоры ЛЭП с проводами (провода — в пределах тайла)
    tops = []
    for px_ in (20, 180, 340, 500):
        tops.append(pylon(t, px_, 136, 60))
        L.px(px_, 59, 27)
    for i in range(len(tops)):
        a = tops[i]
        b = tops[(i + 1) % len(tops)]
        for side in (0, 1):
            x0_, y0_ = a[side]
            x1_, y1_ = b[side]
            if x1_ < x0_:
                x1_ += W
            for xx in range(x0_, x1_ + 1):
                f = (xx - x0_) / max(1, x1_ - x0_)
                yy = y0_ + (y1_ - y0_) * f + 8 * np.sin(np.pi * f)
                t.px(xx, int(round(yy)), 41)
    t.rect(0, 144, W + 159, 148, 41)
    for x in range(0, W + 160, 4):                            # забор промзоны
        t.rect(x, 138, x, 144, 41)
    t.rect(0, 138, W + 159, 138, 41)
    return fold(t, W), fold(L, W)


def car(t, x, base, body, dark, light, kind='sedan'):
    """Легковушка сбоку, 52×20, носом вправо."""
    y = base - 20
    if kind == 'sedan':
        t.poly([(x + 2, y + 10), (x + 12, y + 9), (x + 18, y + 2), (x + 34, y + 2), (x + 41, y + 9), (x + 51, y + 11),
                (x + 51, y + 16), (x + 1, y + 16)], body)
        t.poly([(x + 19, y + 4), (x + 25, y + 4), (x + 25, y + 9), (x + 14, y + 9)], 1)
        t.poly([(x + 27, y + 4), (x + 33, y + 4), (x + 38, y + 9), (x + 27, y + 9)], 1)
    else:
        t.poly([(x + 2, y + 6), (x + 10, y + 1), (x + 36, y + 1), (x + 44, y + 8), (x + 51, y + 9), (x + 51, y + 16),
                (x + 1, y + 16)], body)
        t.poly([(x + 11, y + 3), (x + 22, y + 3), (x + 22, y + 8), (x + 6, y + 8)], 1)
        t.poly([(x + 24, y + 3), (x + 35, y + 3), (x + 41, y + 8), (x + 24, y + 8)], 1)
    t.rect(x + 1, y + 12, x + 51, y + 16, dark)
    t.rect(x + 2, y + 10, x + 50, y + 10, light)
    t.rect(x + 48, y + 11, x + 51, y + 12, 23)
    t.rect(x + 1, y + 11, x + 2, y + 13, 27)
    for wx in (x + 11, x + 41):
        t.a[ell_mask(t, wx, base - 4, 4.2, 4.2)] = 37
        t.a[ell_mask(t, wx, base - 4, 2.2, 2.2)] = 42
        t.px(wx, base - 4, 41)
    t.rect(x + 4, base - 1, x + 48, base - 1, 39)


def oez_near():
    w = 960
    t = Tex(w, H)
    L = Tex(w, H)
    rngl = np.random.default_rng(101)
    ground_street(t, w)
    # вместо газона — асфальт площадки вдоль всего въезда
    t.rect(0, 140, w - 1, 147, 41)
    t.rect(0, 140, w - 1, 140, 42)
    speckle(t, 0, 141, w - 1, 147, 40, 0.1)

    # --- КПП x 0–190 ---
    fence(t, 0, 18, 116, 147, 41, 42, 3)
    t.rect(22, 102, 70, 147, 44)                              # будка
    t.rect(66, 104, 70, 147, 43)
    t.rect(20, 98, 72, 102, 41)
    t.rect(20, 98, 72, 98, 43)
    t.rect(28, 110, 60, 126, 45)
    t.rect(29, 111, 59, 125, 3)
    t.line([(31, 124), (38, 112)], 4)
    t.line([(46, 124), (52, 112)], 4)
    t.rect(24, 104, 64, 107, 2)
    text(t, 24 + (41 - tw('ОХРАНА')) // 2, 104, 'ОХРАНА', 45)
    t.rect(30, 130, 58, 146, 42)                              # дверь будки
    t.rect(31, 131, 57, 145, 43)
    # арка «ОЭЗ «АЛАБУГА»»
    a0, a1 = 76, 186
    for px_ in (a0, a1 - 8):
        t.rect(px_, 58, px_ + 8, 147, 42)
        t.rect(px_, 58, px_ + 1, 147, 43)
        t.rect(px_ + 7, 58, px_ + 8, 147, 41)
    t.rect(a0 - 2, 54, a1 + 2, 74, 1)
    t.rect(a0 - 2, 54, a1 + 2, 55, 2)
    t.rect(a0 - 2, 73, a1 + 2, 74, 0)
    s1, s2 = 'ОЭЗ', 'АЛАБУГА'
    text(t, a0 + (a1 - a0 - tw(s1)) // 2 + 1, 57, s1, 4)
    text(t, a0 + (a1 - a0 - tw(s2, 2)) // 2 + 1, 63, s2, 45, 2)
    t.rect(a0 + 6, 60, a0 + 38, 60, 3)
    t.rect(a1 - 38, 60, a1 - 6, 60, 3)
    # шлагбаум
    bx = 92
    t.rect(bx - 3, 130, bx + 5, 147, 42)
    t.rect(bx - 3, 130, bx + 5, 131, 44)
    t.rect(bx - 3, 138, bx + 5, 139, 22)
    t.rect(bx, 126, bx + 3, 129, 41)
    for i, x in enumerate(range(bx + 4, a1 - 10, 6)):
        t.rect(x, 127, x + 5, 129, 27 if i % 2 == 0 else 45)
    t.rect(a1 - 12, 132, a1 - 11, 147, 41)                   # упор
    t.rect(a1 - 13, 130, a1 - 10, 131, 41)
    # турникет у будки
    t.rect(64, 134, 72, 147, 42)
    t.rect(64, 134, 72, 134, 44)
    L.rect(29, 111, 59, 125, 23)
    L.rect(24, 104, 64, 107, 3)
    text(L, 24 + (41 - tw('ОХРАНА')) // 2, 104, 'ОХРАНА', 45)
    L.rect(a0 - 1, 56, a1 + 1, 72, 1)
    text(L, a0 + (a1 - a0 - tw(s1)) // 2 + 1, 57, s1, 5)
    text(L, a0 + (a1 - a0 - tw(s2, 2)) // 2 + 1, 63, s2, 45, 2)
    L.rect(a0 + 6, 60, a0 + 38, 60, 4)
    L.rect(a1 - 38, 60, a1 - 6, 60, 4)
    L.rect(68, 136, 69, 137, 9)

    # --- парковка x 190–380 ---
    for x in range(200, 372, 30):
        t.rect(x, 141, x, 147, 44)
    car(t, 206, 147, 27, 26, 28, 'sedan')
    car(t, 290, 147, 44, 42, 45, 'suv')
    lamp_post(t, 360, 148, 64)
    lamp_light(L, 360, 64)
    pool(L, 372, 156, 18, 6)
    tree(t, 196, 139, 80, (7, 8, 9), rngl, mix=(20, 21, 22))

    # --- «Водогрей» x 380–650 ---
    v0, v1 = 390, 648
    t.rect(v0, 40, v1, 147, 3)
    for y in range(44, 146, 6):
        t.rect(v0, y, v1, y, 2)
    t.rect(v0, 40, v1, 41, 4)
    t.rect(v1 - 6, 42, v1, 147, 2)
    t.rect(v0 - 2, 36, v1 + 2, 40, 41)
    t.rect(v0 - 2, 36, v1 + 2, 36, 43)
    # вывеска
    sg = 'ВОДОГРЕЙ'
    sw = tw(sg, 2)
    sx0 = v0 + 20
    t.rect(sx0 - 6, 47, sx0 + sw + 22, 63, 45)
    t.rect(sx0 - 6, 63, sx0 + sw + 22, 63, 43)
    text(t, sx0, 51, sg, 2, 2)
    # логотип-капля
    lx = sx0 + sw + 12
    t.a[ell_mask(t, lx, 57, 4, 4)] = 3
    t.poly([(lx - 3, 55), (lx, 49), (lx + 3, 55)], 3)
    t.px(lx - 1, 56, 5)
    t.px(lx - 1, 55, 5)
    # ленточные окна
    t.rect(v0 + 10, 70, v0 + 168, 82, 45)
    t.rect(v0 + 11, 71, v0 + 167, 81, 1)
    for x in range(v0 + 11, v0 + 168, 12):
        t.rect(x, 71, x, 81, 45)
        t.line([(x + 2, 80), (x + 6, 72)], 2)
    # вход
    door_v = 520
    t.rect(door_v - 20, 94, door_v + 20, 98, 45)
    t.rect(door_v - 20, 98, door_v + 20, 98, 43)
    t.rect(door_v - 12, 100, door_v + 12, 145, 45)
    t.rect(door_v - 11, 101, door_v - 1, 145, 2)
    t.rect(door_v + 1, 101, door_v + 11, 145, 2)
    t.line([(door_v - 9, 140), (door_v - 3, 106)], 4)
    t.line([(door_v + 3, 140), (door_v + 8, 112)], 4)
    t.rect(door_v - 2, 118, door_v - 2, 128, 43)
    t.rect(door_v + 2, 118, door_v + 2, 128, 43)
    t.rect(door_v - 18, 144, door_v + 18, 147, 43)
    t.rect(door_v - 18, 144, door_v + 18, 144, 44)
    t.rect(door_v + 16, 108, door_v + 26, 116, 45)            # табличка
    t.rect(door_v + 17, 110, door_v + 25, 110, 2)
    t.rect(door_v + 17, 113, door_v + 23, 113, 42)
    # ворота нового цеха
    g0, g1 = 568, 638
    t.rect(g0 - 4, 84, g1 + 4, 147, 22)
    for i, y in enumerate(range(84, 148, 4)):
        t.rect(g0 - 4, y, g0 - 1, y + 1, 37)
        t.rect(g1 + 1, y + 2, g1 + 4, y + 3, 37)
    for i, x in enumerate(range(g0 - 4, g1 + 5, 4)):
        t.rect(x, 84, x + 1, 86, 37)
    t.rect(g0, 88, g1, 147, 43)
    for y in range(92, 147, 5):
        t.rect(g0, y, g1, y, 42)
    t.rect(g0 + 30, 116, g0 + 40, 124, 42)
    t.rect(g0 + 4, 74, g1 - 4, 82, 8)
    ng = 'НОВЫЙ ЦЕХ'
    text(t, g0 + (g1 - g0 - tw(ng)) // 2 + 1, 76, ng, 45)
    # свет «Водогрея»
    L.rect(sx0 - 5, 48, sx0 + sw + 21, 62, 45)
    text(L, sx0, 51, sg, 2, 2)
    L.a[ell_mask(L, lx, 57, 4, 4)] = 3
    L.poly([(lx - 3, 55), (lx, 49), (lx + 3, 55)], 3)
    for x in range(v0 + 11, v0 + 168, 12):
        if rngl.random() < 0.7:
            L.rect(x + 1, 71, x + 11, 81, 23 if rngl.random() < 0.5 else 4)
    L.rect(door_v - 11, 101, door_v - 1, 145, 23)
    L.rect(door_v + 1, 101, door_v + 11, 145, 23)
    L.rect(door_v - 20, 98, door_v + 20, 98, 45)
    halo(L, door_v, 100, 1, 12, 45, 23)
    L.rect(g0 + 4, 74, g1 - 4, 82, 9)
    text(L, g0 + (g1 - g0 - tw(ng)) // 2 + 1, 76, ng, 45)
    L.rect(g0 - 2, 84, g1 + 2, 85, 22)

    # --- «Иней» x 650–960 ---
    i0, i1 = 662, 948
    t.rect(i0, 50, i1, 147, 44)
    for x in range(i0 + 20, i1, 22):
        t.rect(x, 52, x, 146, 43)
    t.rect(i0, 50, i1, 51, 45)
    t.rect(i1 - 6, 52, i1, 147, 43)
    t.rect(i0 - 2, 46, i1 + 2, 50, 41)
    t.rect(i0 - 2, 46, i1 + 2, 46, 43)
    t.rect(i0, 136, i1, 138, 4)                                # синяя полоса
    # вывеска-снежинка и «ИНЕЙ»
    ix = i0 + 40
    snow = ['...#...', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '...#...']
    t.sprite(ix - 6, 58, [r.replace('#', '##').replace('.', '..') for r in snow for _ in (0, 1)][:14], {'#': 3})
    t.px(ix + 0, 64, 5)
    t.px(ix + 1, 64, 5)
    text(t, ix + 14, 60, 'ИНЕЙ', 3, 2)
    # окна лентой
    t.rect(i0 + 10, 80, i1 - 12, 96, 45)
    t.rect(i0 + 11, 81, i1 - 13, 95, 3)
    for x in range(i0 + 11, i1 - 12, 16):
        t.rect(x, 81, x, 95, 45)
        t.line([(x + 2, 94), (x + 8, 82)], 4)
    t.rect(i0 + 10, 104, i1 - 12, 118, 45)
    t.rect(i0 + 11, 105, i1 - 13, 117, 3)
    for x in range(i0 + 11, i1 - 12, 16):
        t.rect(x, 105, x, 117, 45)
    door_i = 800
    t.rect(door_i - 22, 98, door_i + 22, 101, 3)
    t.rect(door_i - 22, 98, door_i + 22, 98, 4)
    t.rect(door_i - 13, 102, door_i + 13, 145, 45)
    t.rect(door_i - 12, 103, door_i - 1, 145, 2)
    t.rect(door_i + 1, 103, door_i + 12, 145, 2)
    t.line([(door_i - 10, 140), (door_i - 4, 108)], 4)
    t.line([(door_i + 3, 140), (door_i + 9, 110)], 4)
    t.rect(door_i - 18, 144, door_i + 18, 147, 43)
    t.rect(door_i - 18, 144, door_i + 18, 144, 44)
    # закрыть ленту окон над дверью под козырьком
    t.rect(door_i - 13, 104, door_i + 13, 118, 44)
    t.rect(door_i - 12, 103, door_i - 1, 145, 2)
    t.rect(door_i + 1, 103, door_i + 12, 145, 2)
    t.line([(door_i - 10, 140), (door_i - 4, 108)], 4)
    t.line([(door_i + 3, 140), (door_i + 9, 110)], 4)
    # туи у входа
    for tx0 in (door_i - 30, door_i + 26):
        t.poly([(tx0, 147), (tx0 + 3, 118), (tx0 + 6, 147)], 7)
        t.poly([(tx0 + 1, 146), (tx0 + 3, 122), (tx0 + 3, 146)], 8)
        t.rect(tx0 - 1, 144, tx0 + 7, 147, 41)
    # флагшток с триколором
    fx = 920
    t.rect(fx, 30, fx + 1, 147, 43)
    t.rect(fx - 2, 144, fx + 3, 147, 42)
    t.rect(fx + 2, 32, fx + 15, 34, 45)
    t.rect(fx + 2, 35, fx + 15, 37, 3)
    t.rect(fx + 2, 38, fx + 15, 40, 27)
    t.px(fx + 15, 32, T)
    t.px(fx + 15, 40, T)
    # свет «Инея»
    for x in range(ix - 5, ix + 6):
        pass
    L.sprite(ix - 6, 58, [r.replace('#', '##').replace('.', '..') for r in snow for _ in (0, 1)][:14], {'#': 4})
    text(L, ix + 14, 60, 'ИНЕЙ', 4, 2)
    for x in range(i0 + 11, i1 - 12, 16):
        if rngl.random() < 0.55:
            L.rect(x + 1, 81, x + 15, 95, 23 if rngl.random() < 0.6 else 4)
    for x in range(i0 + 11, i1 - 12, 16):
        if abs(x + 8 - door_i) > 18 and rngl.random() < 0.5:
            L.rect(x + 1, 105, x + 15, 117, 23)
    L.rect(door_i - 12, 103, door_i - 1, 145, 23)
    L.rect(door_i + 1, 103, door_i + 12, 145, 23)
    halo(L, door_i, 102, 1, 12, 45, 23)
    for x in (i0 + 150, 700):
        pass
    return t, L, {'barrierX': bx, 'gateX': (a0 + a1) // 2, 'vodogreyDoorX': door_v, 'workshopGateX': (g0 + g1) // 2, 'ineiDoorX': door_i}


# ---------------------------------------------------------------------------------------------------
# сохранение, превью, метаданные
# ---------------------------------------------------------------------------------------------------

PAL = np.array(RGB + [(0, 0, 0)], np.uint8)


def save(t, name):
    """Палитровый PNG: индексы Apollo, 46 — прозрачный."""
    a = np.where(t.a == T, 46, t.a).astype(np.uint8)
    im = Image.fromarray(a, 'P')
    flat = [v for rgb in RGB for v in rgb] + [0, 0, 0]
    im.putpalette(flat + [0, 0, 0] * (256 - len(flat) // 3))
    if (t.a == T).any():
        im.info['transparency'] = 46
        im.save(os.path.join(OUT, name + '.png'), optimize=True, transparency=46)
    else:
        im.save(os.path.join(OUT, name + '.png'), optimize=True)
    return t.image()


def over(dst, src, x=0, y=0, dark=1.0):
    im = src
    if dark != 1.0:
        a = np.array(im).astype(float)
        a[..., :3] *= dark
        im = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    dst.alpha_composite(im, (int(x), int(y)))


def tile_crop(im, off, w=320):
    """Кусок бесшовного тайла шириной w со сдвигом off (с переходом через край)."""
    W = im.width
    out = Image.new('RGBA', (w, im.height), (0, 0, 0, 0))
    x = -(off % W)
    while x < w:
        out.alpha_composite(im, (x, 0)) if x >= 0 else out.alpha_composite(im.crop((-x, 0, W, im.height)), (0, 0))
        x += W
    return out


def x3(im):
    return im.resize((im.width * 3, im.height * 3), Image.NEAREST)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    os.makedirs(os.path.dirname(GEN), exist_ok=True)
    ims = {}
    for name, fn in (('sky_day', sky_day), ('sky_dusk', sky_dusk), ('sky_morning', sky_morning), ('sky_night', sky_night)):
        ims[name] = save(fn(), name)
    ims['road_far'] = save(road_far(), 'road_far')
    ims['road_river'] = save(road_river(), 'road_river')
    rn, rl = road_near()
    ims['road_near'] = save(rn, 'road_near')
    ims['road_lights'] = save(rl, 'road_lights')
    b, bl = bus()
    ims['bus'] = save(b, 'bus')
    ims['bus_lights'] = save(bl, 'bus_lights')
    ims['wheel'] = save(wheel(), 'wheel')
    sf, sfl = street_far()
    ims['street_far'] = save(sf, 'street_far')
    ims['street_far_lights'] = save(sfl, 'street_far_lights')
    sn, snl, street_meta = street_near()
    ims['street_near'] = save(sn, 'street_near')
    ims['street_lights'] = save(snl, 'street_lights')
    of, ofl = oez_far()
    ims['oez_far'] = save(of, 'oez_far')
    ims['oez_far_lights'] = save(ofl, 'oez_far_lights')
    on, onl, oez_meta = oez_near()
    ims['oez_near'] = save(on, 'oez_near')
    ims['oez_lights'] = save(onl, 'oez_lights')

    # --- превью ---
    def road_frame(sky, off, dark=1.0, lit=False):
        f = Image.new('RGBA', (320, H), (0, 0, 0, 255))
        over(f, ims[sky], dark=dark)
        over(f, tile_crop(ims['road_far'], int(off * 0.15)), dark=dark)
        over(f, tile_crop(ims['road_river'], int(off * 0.35)), dark=dark)
        over(f, tile_crop(ims['road_near'], off), dark=dark)
        if lit:
            over(f, tile_crop(ims['road_lights'], off))
        bx, by = 92, 166 - (BUS_H - 1)
        over(f, ims['bus'], bx, by, dark=dark)
        wf = ims['wheel']
        for i, (wx, wy) in enumerate(WHEELS):
            over(f, wf.crop((14 * (i % 2), 0, 14 * (i % 2) + 14, 14)), bx + wx - 7, by + wy - 7, dark=dark)
        if lit:
            over(f, ims['bus_lights'], bx, by)
        return f

    x3(road_frame('sky_dusk', 0)).save(os.path.join(PREV, 'cs_bg_road.png'))
    x3(road_frame('sky_day', 2400)).save(os.path.join(PREV, 'cs_bg_road_b.png'))
    x3(road_frame('sky_morning', 1200)).save(os.path.join(PREV, 'cs_bg_road_c.png'))

    def walk_frames(prefix, sky, offs, dark=1.0, lit=False):
        rows = []
        for off in offs:
            f = Image.new('RGBA', (320, H), (0, 0, 0, 255))
            over(f, ims[sky], dark=dark)
            over(f, tile_crop(ims[prefix + '_far'], int(off * 0.5)), dark=dark)
            if lit:
                over(f, tile_crop(ims[prefix + '_far_lights'], int(off * 0.5)))
            near = ims[prefix + '_near'].crop((off, 0, off + 320, H))
            over(f, near, dark=dark)
            if lit:
                over(f, ims[prefix + '_lights'].crop((off, 0, off + 320, H)))
            rows.append(f)
        sheet = Image.new('RGBA', (320, H * len(rows) + 4 * (len(rows) - 1)), (20, 20, 20, 255))
        for i, r in enumerate(rows):
            sheet.alpha_composite(r, (0, i * (H + 4)))
        return sheet

    x3(walk_frames('street', 'sky_day', (0, 300, 640))).save(os.path.join(PREV, 'cs_bg_street.png'))
    x3(walk_frames('oez', 'sky_day', (0, 300, 640))).save(os.path.join(PREV, 'cs_bg_oez.png'))
    # вечер/ночь: затемнённые слои + свет
    lit = Image.new('RGBA', (320, H * 3 + 8), (20, 20, 20, 255))
    lit.alpha_composite(road_frame('sky_night', 200, dark=0.45, lit=True), (0, 0))
    lit.alpha_composite(walk_frames('street', 'sky_night', (640,), dark=0.45, lit=True), (0, H + 4))
    lit.alpha_composite(walk_frames('oez', 'sky_night', (420,), dark=0.45, lit=True), (0, 2 * (H + 4)))
    x3(lit).save(os.path.join(PREV, 'cs_bg_lights.png'))
    lit2 = walk_frames('street', 'sky_night', (0, 300), dark=0.45, lit=True)
    x3(lit2).save(os.path.join(PREV, 'cs_bg_lights_b.png'))
    # стыки бесшовных тайлов: кусок 320 вокруг стыка
    seams = Image.new('RGBA', (320, H * 5 + 16), (20, 20, 20, 255))
    for i, n in enumerate(('road_far', 'road_river', 'road_near', 'street_far', 'oez_far')):
        f = Image.new('RGBA', (320, H), (0, 0, 0, 255))
        over(f, ims['sky_day'])
        over(f, tile_crop(ims[n], ims[n].width - 160))
        seams.alpha_composite(f, (0, i * (H + 4)))
    x3(seams).save(os.path.join(PREV, 'cs_bg_seams.png'))
    # все небеса
    skies = Image.new('RGBA', (640, 360))
    for i, n in enumerate(('sky_day', 'sky_dusk', 'sky_morning', 'sky_night')):
        skies.alpha_composite(ims[n], ((i % 2) * 320, (i // 2) * 180))
    skies.resize((1280, 720), Image.NEAREST).save(os.path.join(PREV, 'cs_bg_skies.png'))

    # --- метаданные ---
    size = {k: [v.width, v.height] for k, v in ims.items()}
    meta = {
        'frameH': H,
        'feetY': FEET,
        'size': size,
        'road': {'waterY': [112, 134], 'railY': [134, 148], 'asphaltY': [148, 170], 'wheelGroundY': 166},
        'bus': {'w': BUS_W, 'h': BUS_H, 'wheels': [list(w) for w in WHEELS], 'wheelR': WHEEL_R,
                'wheelFrame': 14, 'wheelFrames': 2, 'bottomY': BUS_H - 1},
        'street': street_meta,
        'oez': oez_meta,
    }
    head = ('// Сгенерировано tools/art/cutscene_bg.py — не править руками.\n'
            '// Фоны катсцен: размеры файлов public/assets/cutscene/*.png, где ноги людей (feetY), где колёса автобуса\n'
            '// (центры относительно левого верхнего угла bus.png) и x ключевых мест на улице и в ОЭЗ (двери, остановка, шлагбаум).\n\n')
    with open(GEN, 'w', encoding='utf-8') as f:
        f.write(head + 'export const BG = ' + json.dumps(meta, ensure_ascii=False) + ' as const\n')
    print('ok', ', '.join(f'{k} {v[0]}×{v[1]}' for k, v in size.items()))


if __name__ == '__main__':
    main()
