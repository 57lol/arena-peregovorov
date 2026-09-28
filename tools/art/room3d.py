"""Текстуры 3D-переговорной (src/game/world3d/room.ts) в палитре Apollo.

Большие поверхности — уникальные текстуры с запечёнными тенями (стены, пол, потолок, столешница),
мелочь — атлас в трёх вариантах освещённости: 0 — грань к свету, 1 — боковая, 2 — снизу.
Вариант получается сдвигом каждого цвета на ступень темнее по его рампе, поэтому в кадре остаются
чистые цвета палитры, а не дизеринг от освещения.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/room3d.py
Пишет public/assets/world/*.png, src/game/world3d/room3d.gen.ts (раскладка атласа и места вещей)
и превью ×4 в tools/art/out/room3d_*.png.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from apollo import RGB  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'world')
PREV = os.path.join(os.path.dirname(__file__), 'out')
GEN = os.path.join(ROOT, 'src', 'game', 'world3d', 'room3d.gen.ts')
T = -1
rng = np.random.default_rng(57)


def read_layout():
    """ROOM и TABLE берём прямо из layout.ts, чтобы запечённые тени совпали с геометрией."""
    src = open(os.path.join(ROOT, 'src', 'game', 'world3d', 'layout.ts'), encoding='utf-8').read()
    out = {}
    for name in ('ROOM', 'TABLE'):
        body = re.search(r'export const %s = \{(.*?)\n\}' % name, src, re.S).group(1)
        out[name] = {k: float(v) for k, v in re.findall(r'(\w+):\s*(-?[\d.]+)', body)}
    return out['ROOM'], out['TABLE']


ROOM, TABLE = read_layout()
HW, BACK, FRONT, HGT = ROOM['halfW'], ROOM['back'], ROOM['front'], ROOM['height']
S = 0.025  # м на тексель у стен, пола и потолка

# --- ступени света: цвет -> на ступень темнее по своей рампе ------------------------------------------
DARK = {}
for ramp, tail in (([0, 1, 2, 3, 4, 5], 37), ([6, 7, 8, 9, 10, 11], 38), ([12, 13, 14, 15, 16, 17], 18),
                   ([18, 19, 20, 21, 22, 23], 24), ([24, 25, 26, 27, 28, 29], 36), ([30, 31, 32, 33, 34, 35], 36),
                   ([36, 37, 38, 39, 40, 41, 42, 43, 44, 45], 36)):
    DARK[ramp[0]] = tail
    for a, b in zip(ramp[1:], ramp):
        DARK[a] = b
LIGHT = {}
for ramp in ([0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [12, 13, 14, 15, 16, 17], [18, 19, 20, 21, 22, 23],
             [24, 25, 26, 27, 28, 29], [30, 31, 32, 33, 34, 35], [36, 37, 38, 39, 40, 41, 42, 43, 44, 45]):
    for a, b in zip(ramp, ramp[1:] + ramp[-1:]):
        LIGHT[a] = b
LUT_D = np.array([DARK[i] for i in range(46)] + [T])
LUT_L = np.array([LIGHT[i] for i in range(46)] + [T])


def darker(a, k=1):
    for _ in range(k):
        a = LUT_D[a]  # индекс -1 берёт последний элемент, то есть прозрачность остаётся прозрачной
    return a


def lighter(a, k=1):
    for _ in range(k):
        a = LUT_L[a]
    return a


# --- мелкий шрифт 3×5 (и пошире для Д, М, Ц) ---------------------------------------------------------
FONT = {
    'А': ['.#.', '#.#', '###', '#.#', '#.#'], 'Б': ['###', '#..', '##.', '#.#', '##.'],
    'Д': ['.##.', '.##.', '.##.', '####', '#..#'], 'Е': ['###', '#..', '##.', '#..', '###'],
    'Ё': ['#.#', '###', '##.', '#..', '###'], 'З': ['##.', '..#', '.#.', '..#', '##.'],
    'К': ['#.#', '#.#', '##.', '#.#', '#.#'], 'Л': ['.###', '.#.#', '.#.#', '.#.#', '##.#'],
    'М': ['#...#', '##.##', '#.#.#', '#...#', '#...#'], 'Н': ['#.#', '#.#', '###', '#.#', '#.#'],
    'О': ['###', '#.#', '#.#', '#.#', '###'], 'П': ['###', '#.#', '#.#', '#.#', '#.#'],
    'Р': ['##.', '#.#', '##.', '#..', '#..'], 'С': ['.##', '#..', '#..', '#..', '.##'],
    'Т': ['###', '.#.', '.#.', '.#.', '.#.'], 'Ц': ['#.#.', '#.#.', '#.#.', '####', '...#'],
    'Ч': ['#.#', '#.#', '.##', '..#', '..#'], 'Э': ['###.', '...#', '.###', '...#', '###.'],
    'Я': ['.##', '#.#', '.##', '#.#', '#.#'], 'В': ['##.', '#.#', '##.', '#.#', '##.'],
    '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
    '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
    '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
    '6': ['.##', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'],
    '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '##.'],
    ' ': ['..', '..', '..', '..', '..'], '.': ['.', '.', '.', '.', '#'], '-': ['..', '..', '##', '..', '..'],
    '№': ['#..#', '##.#', '#.##', '#..#', '#..#'], '→': ['..#.', '...#', '####', '...#', '..#.'],
}


def text_w(s, k=1):
    return sum((len(FONT[ch][0]) + 1) * k for ch in s) - k


class Tex:
    """Палитровый холст: в клетках индексы Apollo, -1 — прозрачно. y растёт вниз."""

    def __init__(self, w, h, fill=T):
        self.a = np.full((h, w), fill, int)

    @property
    def w(self):
        return self.a.shape[1]

    @property
    def h(self):
        return self.a.shape[0]

    def rect(self, x0, y0, x1, y1, c):
        x0, x1 = max(0, int(x0)), min(self.w - 1, int(x1))
        y0, y1 = max(0, int(y0)), min(self.h - 1, int(y1))
        if x0 <= x1 and y0 <= y1:
            self.a[y0:y1 + 1, x0:x1 + 1] = c

    def frame(self, x0, y0, x1, y1, c):
        self.rect(x0, y0, x1, y0, c)
        self.rect(x0, y1, x1, y1, c)
        self.rect(x0, y0, x0, y1, c)
        self.rect(x1, y0, x1, y1, c)

    def px(self, x, y, c):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = c

    def line(self, pts, c):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0), 1))
            for i in range(n + 1):
                self.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), c)

    def sprite(self, x0, y0, rows, legend):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch in legend:
                    self.px(x0 + dx, y0 + dy, legend[ch])

    def checker(self, x0, y0, x1, y1, c, phase=0):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                if (x + y + phase) % 2 == 0:
                    self.px(x, y, c)

    def mask(self, m, c):
        self.a[m] = c

    def grid(self):
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        return xs + 0.5, ys + 0.5

    def ellipse(self, cx, cy, rx, ry, c):
        xs, ys = self.grid()
        self.a[((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 <= 1] = c

    def poly(self, pts, c):
        im = Image.new('L', (self.w, self.h), 0)
        ImageDraw.Draw(im).polygon([(x, y) for x, y in pts], fill=1)
        self.a[np.array(im).astype(bool)] = c

    def noise(self, x0, y0, x1, y1, c, p, on=None):
        sub = self.a[int(y0):int(y1) + 1, int(x0):int(x1) + 1]
        m = rng.random(sub.shape) < p
        if on is not None:
            m &= np.isin(sub, np.atleast_1d(on))
        sub[m] = c

    def blotch(self, x0, y0, x1, y1, c, cell, p, on=None):
        """Крупные пятна: шум в низком разрешении, растянутый ступеньками."""
        sub = self.a[int(y0):int(y1) + 1, int(x0):int(x1) + 1]
        h, w = sub.shape
        small = rng.random((h // cell + 2, w // cell + 2)) < p
        m = np.kron(small, np.ones((cell, cell), bool))
        oy, ox = rng.integers(0, cell, 2)
        m = m[oy:oy + h, ox:ox + w]
        if on is not None:
            m &= np.isin(sub, np.atleast_1d(on))
        sub[m] = c

    def shade(self, x0, y0, x1, y1, k=1, m=None):
        """Затемнить прямоугольник (или маску) на k ступеней рампы — запечённая тень."""
        sub = self.a[int(y0):int(y1) + 1, int(x0):int(x1) + 1]
        if m is None:
            sub[...] = darker(sub, k) if k > 0 else lighter(sub, -k)
        else:
            mm = m[int(y0):int(y1) + 1, int(x0):int(x1) + 1]
            sub[mm] = (darker(sub, k) if k > 0 else lighter(sub, -k))[mm]

    def shade_ellipse(self, cx, cy, rx, ry, k=1):
        xs, ys = self.grid()
        m = ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 <= 1
        self.shade(0, 0, self.w - 1, self.h - 1, k, m)

    def shade_poly(self, pts, k=1):
        im = Image.new('L', (self.w, self.h), 0)
        ImageDraw.Draw(im).polygon([(x, y) for x, y in pts], fill=1)
        self.shade(0, 0, self.w - 1, self.h - 1, k, np.array(im).astype(bool))

    def text(self, x, y, s, c, k=1):
        for ch in s:
            g = FONT[ch]
            for dy, row in enumerate(g):
                for dx, v in enumerate(row):
                    if v == '#':
                        self.rect(x + dx * k, y + dy * k, x + dx * k + k - 1, y + dy * k + k - 1, c)
            x += (len(g[0]) + 1) * k

    def blit(self, o, x, y):
        for yy in range(o.h):
            for xx in range(o.w):
                if o.a[yy, xx] != T:
                    self.px(x + xx, y + yy, o.a[yy, xx])

    def image(self):
        pal = np.array(RGB + [(0, 0, 0)], np.uint8)
        rgb = pal[self.a]
        alpha = np.where(self.a == T, 0, 255).astype(np.uint8)
        return Image.fromarray(np.dstack([rgb, alpha]), 'RGBA')


def wood(t, x0, y0, x1, y1, base, dark, light, streak=0.5, vertical=False, knots=0):
    """Древесные волокна: длинные тёмные и светлые штрихи вдоль доски."""
    t.rect(x0, y0, x1, y1, base)
    if vertical:
        tt = Tex(y1 - y0 + 1, x1 - x0 + 1)
        wood(tt, 0, 0, tt.w - 1, tt.h - 1, base, dark, light, streak, False, knots)
        t.a[y0:y1 + 1, x0:x1 + 1] = tt.a.T
        return
    for y in range(y0, y1 + 1):
        x = x0 + int(rng.integers(-20, 0))
        while x <= x1:
            n = int(rng.integers(4, 22))
            r = rng.random()
            if r < streak * 0.6:
                t.rect(x, y, x + n, y, dark)
            elif r < streak:
                t.rect(x, y, x + n // 2, y, light)
            x += n + int(rng.integers(2, 12))
    for _ in range(knots):
        cx, cy = rng.integers(x0 + 4, max(x0 + 5, x1 - 4)), rng.integers(y0, y1 + 1)
        t.rect(cx - 3, cy, cx + 3, cy, dark)
        t.rect(cx - 1, cy, cx + 1, cy, light)


# ======================================================================================================
# Атлас мелочи
# ======================================================================================================

class Atlas:
    def __init__(self, w=256, h=256):
        self.size = w
        self.h = h
        self.items = []

    def add(self, name, t):
        self.items.append((name, t))
        return t

    def pack(self):
        """«Горизонт»: каждую картинку кладём туда, где она ляжет ниже всего.
        Вокруг — 1 тексель повтора края против швов."""
        order = sorted(self.items, key=lambda it: (-it[1].h, -it[1].w))
        sky_ = np.zeros(self.size, int)
        rects = {}
        sheet = Tex(self.size, self.h)
        for name, t in order:
            w, h = t.w + 2, t.h + 2
            best = None
            for x in range(0, self.size - w + 1):
                y = sky_[x:x + w].max()
                if best is None or y < best[1]:
                    best = (x, y)
            x, y = best
            if y + h > self.h:
                raise SystemExit(f'атлас переполнен на {name}')
            sheet.a[y:y + h, x:x + w] = np.pad(t.a, 1, mode='edge')
            sky_[x:x + w] = y + h
            rects[name] = [int(x) + 1, int(y) + 1, t.w, t.h]
        self.rects = rects
        self.sheet = sheet
        return rects


def solid(c, n=4):
    return Tex(n, n, c)


def common_items(at):
    for c in (36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 19, 20, 21, 22, 27, 12, 13, 18, 16):
        at.add(f'c{c}', solid(c))
    # «хром»: полосы блика
    t = Tex(8, 8, 43)
    t.rect(0, 0, 7, 1, 45)
    t.rect(0, 6, 7, 7, 41)
    at.add('chrome', t)
    # пар и стакан воды — общие
    t = Tex(12, 16, T)  # стакан с водой, бок
    t.rect(0, 0, 11, 15, 5)
    t.rect(0, 5, 11, 15, 4)
    t.rect(0, 5, 11, 5, 45)
    t.rect(2, 0, 2, 15, 45)
    t.rect(9, 0, 9, 15, 43)
    t.rect(0, 15, 11, 15, 43)
    at.add('water_side', t)
    t = Tex(8, 8, 4)
    t.rect(1, 1, 3, 2, 5)
    at.add('water_top', t)


def clock_face(office=False):
    t = Tex(40, 40, T)
    cx = cy = 20
    t.ellipse(cx, cy, 20, 20, 37 if office else 20)
    t.ellipse(cx, cy, 18, 18, 45 if office else 21)
    t.ellipse(cx, cy, 17, 17, 45)
    xs, ys = t.grid()
    # лёгкая тень от ободка сверху
    m = (((xs - cx) / 17) ** 2 + ((ys - cy) / 17) ** 2 <= 1) & (((xs - cx) / 17) ** 2 + ((ys - cy + 1.5) / 16) ** 2 > 1)
    t.mask(m & (ys < cy), 44)
    for i in range(60):
        a = i / 60 * 2 * np.pi
        big = i % 5 == 0
        for rr in (np.arange(12.5, 16) if big else [15.2]):
            t.px(cx - 0.5 + rr * np.sin(a) + 0.5, cy - 0.5 - rr * np.cos(a) + 0.5, 37 if big or office else 42)
    if not office:
        t.text(cx - 3, cy + 5, 'СС', 42) if False else None
        t.rect(cx - 3, cy - 8, cx + 2, cy - 8, 42)  # надпись «ЯНТАРЬ» — просто штрих
        t.rect(cx - 1, cy + 7, cx, cy + 8, 27)  # красная марка
    return t


# ------------------------------------------------------------------------------------------------------
# Завод
# ------------------------------------------------------------------------------------------------------

def factory_atlas():
    at = Atlas(256, 320)
    common_items(at)
    at.add('clock', clock_face(False))
    at.add('clock_rim', Tex(8, 4, 20))

    # грамота 36×48
    t = Tex(36, 48, 20)
    t.frame(0, 0, 35, 47, 19)
    t.rect(1, 1, 34, 1, 21)
    t.rect(1, 1, 1, 46, 21)
    t.rect(3, 3, 32, 44, 17)
    t.frame(4, 4, 31, 43, 22)
    t.checker(5, 5, 30, 5, 23)
    t.ellipse(18, 11, 4, 4, 27)  # шестерёнка-эмблема
    t.ellipse(18, 11, 2, 2, 22)
    for a in range(8):
        t.px(18 + 5 * np.cos(a * np.pi / 4), 11 + 5 * np.sin(a * np.pi / 4), 27)
    t.rect(8, 17, 27, 18, 27)  # «ПОЧЁТНАЯ ГРАМОТА»
    t.checker(8, 17, 27, 18, 26)
    for yy, x1 in ((22, 28), (25, 28), (28, 26), (31, 24)):
        t.rect(8, yy, x1, yy, 15)
    t.ellipse(25, 37, 3.5, 3.5, 3)  # синяя печать
    t.ellipse(25, 37, 2, 2, 17)
    t.line([(8, 38), (11, 36), (13, 38), (16, 37)], 1)  # подпись
    t.rect(3, 45, 32, 45, 19)
    at.add('gramota', t)

    # календарь 32×56
    t = Tex(32, 56, 45)
    t.frame(0, 0, 31, 55, 43)
    t.rect(0, 0, 31, 2, 40)  # пружина
    for x in range(2, 31, 3):
        t.px(x, 1, 43)
    # картинка: берёзы у реки
    t.rect(1, 3, 30, 22, 5)
    t.rect(1, 10, 30, 22, 4)
    t.rect(1, 14, 30, 16, 9)
    t.rect(1, 17, 30, 22, 3)
    t.checker(1, 17, 30, 17, 4)
    for x in (6, 11, 23):
        t.rect(x, 5, x, 16, 45)
        t.px(x, 8, 37)
        t.px(x, 12, 37)
        t.ellipse(x + 0.5, 6, 3, 3, 10)
        t.ellipse(x + 1.5, 5, 1.5, 1.5, 11)
    t.rect(1, 23, 30, 28, 27)
    t.text(9, 23, '2026', 45)
    for r in range(5):
        for c in range(7):
            col = 27 if c >= 5 else 40
            t.rect(3 + c * 4, 31 + r * 5, 4 + c * 4, 32 + r * 5, col)
    t.frame(18, 49, 22, 53, 27)  # обведённое 29-е
    at.add('calendar', t)

    # вымпел 26×40, остриём вниз, с бахромой
    t = Tex(26, 40, T)
    t.rect(0, 0, 25, 1, 19)  # палочка
    t.px(12, 0, 22)
    t.poly([(1, 2), (25, 2), (13, 34)], 27)
    t.line([(1, 2), (13, 34)], 26)
    t.line([(25, 2), (13, 34)], 26)
    t.rect(4, 5, 21, 6, 22)
    t.rect(6, 9, 19, 9, 22)
    t.rect(7, 11, 18, 11, 22)
    t.sprite(10, 14, ['..#..', '.###.', '#####', '.###.', '.#.#.'], {'#': 22})
    t.rect(10, 22, 15, 22, 23)
    for i in range(0, 32, 2):  # бахрома по косым краям
        f = i / 32
        t.px(0 + 12.5 * f, 2 + 32 * f + 1, 22)
        t.px(25 - 12.5 * f, 2 + 32 * f + 1, 22)
    t.rect(12, 34, 13, 38, 22)  # кисточка
    t.rect(11, 38, 14, 39, 23)
    at.add('pennant', t)

    # радиатор 48×26: чугунные секции
    t = Tex(48, 26, 43)
    for x in range(0, 48, 4):
        t.rect(x, 1, x, 24, 44)
        t.rect(x + 2, 2, x + 2, 23, 42)
        t.rect(x + 3, 0, x + 3, 25, 41)
    t.rect(0, 0, 47, 0, 44)
    t.rect(0, 25, 47, 25, 40)
    t.rect(0, 5, 47, 5, 42)
    t.rect(0, 20, 47, 20, 42)
    at.add('radiator', t)

    # жалюзи, поднятые пачкой
    t = Tex(64, 8, 44)
    for y in range(0, 8, 2):
        t.rect(0, y, 63, y, 45)
    t.rect(0, 7, 63, 7, 42)
    at.add('blinds', t)
    t = Tex(4, 16, 43)
    t.rect(1, 0, 1, 15, 42)
    at.add('cord', t)

    # краска рам и подоконника
    t = Tex(8, 8, 45)
    t.noise(0, 0, 7, 7, 44, 0.15)
    at.add('paint', t)
    t = Tex(8, 8, 44)
    t.noise(0, 0, 7, 7, 43, 0.12)
    at.add('plaster', t)

    # алоэ в горшке
    t = Tex(24, 28, T)
    for (x0, y0, x1, y1) in ((12, 27, 3, 4), (12, 27, 8, 1), (12, 27, 15, 2), (12, 27, 21, 6), (12, 27, 18, 12),
                             (12, 27, 5, 13), (12, 27, 11, 8)):
        t.line([(x0, y0), (x1, y1)], 8)
        t.line([(x0 + 1, y0), (x1 + 1, y1)], 9)
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        t.px(mx + 2, my, 10)
        t.px(mx - 1, my + 3, 11)
    t.noise(0, 0, 23, 27, 7, 0.25, on=8)
    at.add('aloe', t)
    t = Tex(16, 10, 21)
    t.rect(0, 0, 15, 2, 22)
    t.rect(0, 2, 15, 2, 20)
    t.rect(10, 3, 12, 9, 20)
    at.add('pot', t)

    # шкаф: фасад 64×104 (стекло сверху, дверцы снизу)
    t = Tex(64, 104, 20)
    wood(t, 0, 0, 63, 103, 20, 19, 21, 0.35, vertical=True)
    t.rect(0, 0, 63, 2, 21)
    t.rect(0, 3, 63, 3, 18)
    t.rect(3, 5, 60, 70, 18)  # внутренность за стеклом
    t.rect(3, 5, 60, 6, 24)
    shelves = (5, 27, 49, 71)
    spines = [27, 2, 22, 27, 8, 2, 2, 42, 26, 22, 8, 2, 27, 40, 22]
    for si in range(3):
        top, bot = shelves[si] + 3, shelves[si + 1] - 1
        x = 4
        i = si * 5
        while x < 58:
            col = spines[i % len(spines)]
            w = 3 + (i % 3 == 0)
            hh = int(rng.integers(0, 4))
            if si == 1 and 36 < x < 48:  # кубок и глобус вместо папок
                t.rect(40, bot - 3, 44, bot, 21)
                t.rect(41, bot - 11, 43, bot - 4, 22)
                t.rect(39, bot - 13, 45, bot - 11, 22)
                t.px(40, bot - 12, 23)
                x = 49
                continue
            t.rect(x, top + hh, x + w - 1, bot, col)
            t.rect(x, top + hh + 3, x + w - 1, top + hh + 6, 45)
            t.px(x + 1, bot - 4, 37)
            t.rect(x + w - 1, top + hh, x + w - 1, bot, darker(col))
            x += w + (1 if i % 4 == 3 else 0)
            i += 1
        t.rect(3, shelves[si + 1], 60, shelves[si + 1] + 1, 21)
        t.rect(3, shelves[si + 1] + 2, 60, shelves[si + 1] + 2, 19)
    t.rect(31, 5, 32, 70, 20)  # притвор между дверцами
    t.frame(3, 5, 60, 70, 19)
    for k in range(3):  # блики на стекле
        x0 = 8 + k * 22
        t.line([(x0, 66), (x0 + 12, 8)], 42)
        t.line([(x0 + 2, 66), (x0 + 14, 8)], 42) if k == 1 else None
    t.px(29, 38, 22)
    t.px(34, 38, 22)
    t.rect(0, 72, 63, 73, 19)
    for x0 in (3, 33):  # филёнки нижних дверок
        t.frame(x0, 76, x0 + 27, 98, 19)
        t.rect(x0 + 1, 76, x0 + 27, 76, 21)
        t.rect(x0 + 2, 78, x0 + 25, 96, 20)
        t.frame(x0 + 3, 79, x0 + 24, 95, 21)
        t.rect(x0 + 4, 80, x0 + 24, 95, 20)
    t.rect(29, 84, 29, 88, 22)
    t.rect(34, 84, 34, 88, 22)
    t.rect(0, 100, 63, 103, 18)
    at.add('cabinet', t)
    t = Tex(24, 48, 20)
    wood(t, 0, 0, 23, 47, 20, 19, 21, 0.4, vertical=True)
    at.add('cab_side', t)
    t = Tex(32, 16, 20)
    wood(t, 0, 0, 31, 15, 20, 19, 21, 0.4)
    at.add('wood', t)
    t = Tex(32, 16, 19)
    wood(t, 0, 0, 31, 15, 19, 18, 20, 0.5)
    t.rect(0, 0, 31, 0, 21)
    at.add('wood_dark', t)

    # каска
    t = Tex(16, 12, 22)
    t.rect(0, 0, 15, 3, 23)
    t.rect(0, 9, 15, 11, 21)
    t.rect(7, 0, 8, 11, 21)  # ребро
    at.add('hardhat', t)

    # гофрокороб: верх со скотчем, бок с маркировкой, торец с волнами
    t = Tex(24, 24, 15)
    t.noise(0, 0, 23, 23, 14, 0.08)
    t.rect(0, 10, 23, 13, 16)
    t.rect(0, 10, 23, 10, 17)
    t.rect(0, 11, 23, 11, 23) if False else None
    at.add('box_top', t)
    t = Tex(24, 16, 15)
    t.noise(0, 0, 23, 15, 14, 0.08)
    t.rect(0, 0, 23, 0, 16)
    t.sprite(3, 4, ['.#...#.', '###.###', '.#...#.', '.#...#.'], {'#': 37})  # «верх»
    t.frame(13, 4, 20, 10, 27)
    t.rect(15, 6, 18, 8, 27)
    at.add('box_side', t)
    t = Tex(24, 8, 15)
    t.rect(0, 0, 23, 0, 16)
    t.rect(0, 7, 23, 7, 16)
    for x in range(24):
        t.px(x, 2 + (x % 4 in (1, 2)) * 2 + (x % 4 == 2), 14)
        t.px(x, 4 + (x % 4 in (0, 3)), 13 if x % 2 else 14)
    at.add('box_edge', t)

    # фикус в кадке
    t = Tex(56, 72, T)
    t.line([(28, 71), (27, 50), (24, 34), (22, 20)], 13)
    t.line([(28, 55), (35, 40), (38, 26)], 13)
    t.line([(27, 45), (18, 38), (14, 26)], 13)
    leaves = []
    for _ in range(58):
        cx = float(rng.normal(28, 11))
        cy = float(rng.uniform(4, 60 - abs(cx - 28) * 0.5))
        leaves.append((cx, cy))
    leaves.sort(key=lambda p: p[1])
    for cx, cy in leaves:
        a = rng.uniform(-0.9, 0.9)
        rx, ry = 5.5, 2.4
        xs, ys = t.grid()
        dx, dy = xs - cx, ys - cy
        u = dx * np.cos(a) + dy * np.sin(a)
        v = -dx * np.sin(a) + dy * np.cos(a)
        m = (u / rx) ** 2 + (v / ry) ** 2 <= 1
        t.mask(m, 7 if cy > 40 else 8)
        t.mask(m & (v < -0.6), 8 if cy > 40 else 9)
        t.mask(m & (np.abs(v) < 0.5) & (np.abs(u) < 4), 7)
        t.mask(m & (v < -1.4) & (u > 0), 10)
    t.noise(0, 0, 55, 71, 6, 0.08, on=7)
    at.add('ficus', t)
    t = Tex(32, 16, 20)
    for x in range(0, 32, 4):
        t.rect(x, 0, x, 15, 19)
        t.rect(x + 1, 0, x + 1, 15, 21)
    t.rect(0, 2, 31, 3, 40)
    t.rect(0, 2, 31, 2, 42)
    t.rect(0, 12, 31, 13, 40)
    t.rect(0, 12, 31, 12, 42)
    at.add('kadka', t)
    t = Tex(16, 16, 12)
    t.noise(0, 0, 15, 15, 13, 0.3)
    at.add('soil', t)

    # карта ОЭЗ 64×44
    t = Tex(64, 44, 20)
    t.frame(0, 0, 63, 43, 19)
    t.rect(2, 2, 61, 41, 11)
    t.noise(2, 2, 61, 41, 10, 0.25)
    t.poly([(2, 30), (20, 26), (40, 33), (61, 28), (61, 41), (2, 41)], 4)  # Кама
    t.line([(2, 30), (20, 26), (40, 33), (61, 28)], 3)
    for x in range(8, 58, 11):  # кварталы и дороги
        t.rect(x, 5, x, 26, 44)
    t.rect(4, 12, 58, 12, 44)
    t.rect(4, 20, 50, 20, 44)
    for (x0, y0, x1, y1, c) in ((10, 6, 17, 10, 42), (20, 6, 27, 10, 43), (30, 14, 38, 18, 42), (41, 6, 48, 10, 27),
                                (10, 14, 17, 18, 43), (21, 22, 28, 24, 42), (51, 14, 57, 18, 2), (41, 14, 47, 18, 43)):
        t.rect(x0, y0, x1, y1, c)
        t.rect(x0, y1, x1, y1, darker(c))
    t.rect(44, 7, 45, 8, 45)  # «вы здесь»
    t.rect(4, 33, 20, 40, 45)  # легенда
    for i, c in enumerate((27, 42, 2)):
        t.rect(6, 34 + i * 2, 7, 34 + i * 2, c)
        t.rect(9, 34 + i * 2, 18 - i * 2, 34 + i * 2, 41)
    at.add('map', t)

    # вешалка и пиджак
    t = Tex(28, 44, T)
    t.line([(4, 4), (14, 0), (24, 4)], 40)
    t.rect(13, 0, 14, 1, 42)
    t.poly([(3, 5), (25, 5), (26, 40), (1, 40)], 1)
    t.poly([(10, 5), (18, 5), (14, 22)], 0)
    t.poly([(11, 5), (14, 14), (17, 5)], 44)
    t.line([(14, 6), (14, 14)], 27)
    t.rect(1, 36, 26, 40, 0)
    t.line([(7, 6), (5, 38)], 2)
    t.line([(21, 6), (23, 38)], 0)
    t.px(12, 26, 42)
    t.px(12, 31, 42)
    t.rect(19, 14, 22, 14, 2)  # карман
    # кепка сверху на крючке
    t.rect(3, 41, 25, 43, T)
    at.add('jacket', t)

    # дверь, обитая дерматином, 48×104
    t = Tex(48, 104, 13)
    for y in range(-48, 104, 12):
        t.line([(0, y), (48, y + 48)], 12)
        t.line([(0, y + 48), (48, y)], 12)
    for yy in range(0, 104, 12):
        for xx in range(0, 49, 12):
            for (x, y) in ((xx, yy), (xx + 6, yy + 6)):
                t.px(x, y, 23)
                t.px(x + 1, y + 1, 21)
    t.noise(0, 0, 47, 103, 14, 0.03, on=13)
    t.frame(0, 0, 47, 103, 12)
    for y in range(0, 104, 3):  # гвоздики по краю
        t.px(1, y, 22)
        t.px(46, y, 22)
    for x in range(0, 48, 3):
        t.px(x, 1, 22)
        t.px(x, 102, 22)
    t.rect(38, 44, 41, 58, 21)  # ручка и замок
    t.rect(39, 45, 40, 57, 23)
    t.rect(39, 61, 40, 63, 37)
    t.rect(17, 30, 30, 34, 22)  # табличка
    t.rect(18, 31, 29, 33, 23)
    t.rect(19, 32, 28, 32, 20)
    at.add('door', t)

    # сейф 32×56 (фасад), бока
    t = Tex(32, 56, 7)
    t.rect(0, 0, 31, 1, 8)
    t.frame(0, 0, 31, 55, 6)
    t.frame(3, 4, 28, 50, 6)
    t.rect(4, 5, 27, 5, 8)
    t.ellipse(15.5, 22, 6, 6, 40)
    t.ellipse(15.5, 22, 4.5, 4.5, 42)
    t.ellipse(15.5, 22, 1.5, 1.5, 40)
    for a in range(4):
        t.line([(15.5, 22), (15.5 + 7 * np.cos(a * np.pi / 2 + 0.4), 22 + 7 * np.sin(a * np.pi / 2 + 0.4))], 43)
    t.rect(22, 32, 25, 38, 22)
    t.px(23, 35, 37)
    t.rect(6, 42, 14, 45, 45)  # инвентарная бирка
    t.rect(7, 43, 13, 43, 41)
    t.rect(0, 52, 31, 55, 38)
    at.add('safe', t)
    t = Tex(16, 16, 7)
    t.rect(0, 0, 15, 0, 8)
    t.rect(0, 13, 15, 15, 38)
    at.add('safe_side', t)

    # графин и стакан
    t = Tex(16, 30, T)
    t.rect(6, 0, 9, 3, 43)  # пробка
    t.rect(7, 0, 8, 0, 45)
    t.rect(6, 4, 9, 9, 44)
    t.ellipse(7.5, 20, 7.5, 9, 44)
    t.ellipse(7.5, 21.5, 6.5, 7.5, 5)
    t.rect(1, 17, 14, 17, 45)
    t.rect(3, 15, 4, 25, 45)
    t.rect(11, 18, 12, 26, 4)
    t.rect(2, 28, 13, 29, 43)
    at.add('decanter', t)
    t = Tex(8, 12, 44)
    t.rect(1, 4, 6, 10, 5)
    for x in (0, 2, 4, 6):
        t.rect(x, 0, x, 11, 45 if x % 4 == 0 else 43)
    t.rect(0, 11, 7, 11, 42)
    at.add('glass_f', t)

    # плакат по ТБ 40×56
    t = Tex(40, 56, 45)
    t.frame(0, 0, 39, 55, 43)
    t.rect(1, 1, 38, 10, 27)
    t.text(15, 3, 'ТБ', 45)
    for x in range(1, 39, 4):  # сигнальная лента
        t.line([(x, 52), (x + 3, 49)], 22)
    t.rect(1, 48, 38, 48, 37)
    t.rect(1, 53, 38, 53, 37)
    t.checker(1, 49, 38, 52, 37)
    t.checker(1, 49, 38, 52, 22, 1)
    # рабочий в каске показывает на знак
    t.ellipse(13, 18, 5, 3, 22)
    t.rect(8, 19, 18, 20, 21)
    t.ellipse(13, 24, 4, 4.5, 15)
    t.rect(11, 23, 11, 23, 37)
    t.rect(15, 23, 15, 23, 37)
    t.poly([(5, 44), (7, 30), (19, 30), (21, 44)], 29)
    t.rect(12, 30, 14, 44, 22)
    t.line([(19, 32), (26, 26)], 29)
    t.line([(19, 33), (26, 27)], 29)
    t.rect(26, 25, 27, 26, 15)
    t.poly([(31, 14), (37, 25), (25, 25)], 22)  # треугольный знак
    t.line([(31, 14), (37, 25), (25, 25), (31, 14)], 37)
    t.rect(31, 18, 31, 21, 37)
    t.px(31, 23, 37)
    for yy in (34, 37, 40):
        t.rect(25, yy, 36, yy, 42)
    at.add('poster_tb', t)

    # доска почёта 112×68
    t = Tex(112, 68, 19)
    wood(t, 0, 0, 111, 67, 19, 18, 20, 0.3)
    t.rect(4, 4, 107, 63, 26)
    t.checker(4, 4, 107, 63, 25)
    t.rect(4, 4, 107, 13, 27)
    t.text(56 - text_w('ДОСКА ПОЧЁТА') // 2, 6, 'ДОСКА ПОЧЁТА', 22)
    faces = [(42, 40), (43, 41), (44, 42), (42, 41), (43, 40), (44, 41), (42, 40), (43, 42), (44, 40), (43, 41)]
    for i, (skin, hair) in enumerate(faces):
        c, r = i % 5, i // 5
        x0, y0 = 10 + c * 19, 17 + r * 23
        t.rect(x0 - 1, y0 - 1, x0 + 13, y0 + 16, 22)
        t.rect(x0, y0, x0 + 12, y0 + 15, 43)
        t.ellipse(x0 + 6.5, y0 + 6, 3.5, 4.5, 44 if skin != 42 else 43)
        t.rect(x0 + 3, y0 + 1, x0 + 10, y0 + 3, 40 if i % 3 else 42)
        t.poly([(x0 + 1, y0 + 15), (x0 + 3, y0 + 11), (x0 + 10, y0 + 11), (x0 + 12, y0 + 15)], 39)
        t.px(x0 + 5, y0 + 6, 39)
        t.px(x0 + 8, y0 + 6, 39)
        t.rect(x0 + 1, y0 + 18, x0 + 11, y0 + 18, 23)
    at.add('honor', t)

    # чай в подстаканнике
    t = Tex(16, 16, 21)
    t.rect(0, 0, 15, 1, 45)
    t.rect(0, 2, 15, 3, 22)
    t.rect(0, 10, 15, 15, 20)
    t.rect(3, 0, 3, 15, 45)
    t.rect(4, 2, 4, 15, 23)
    t.rect(12, 2, 12, 15, 19)
    at.add('tea_side', t)
    t = Tex(8, 8, 20)
    t.rect(1, 1, 6, 6, 21)
    t.rect(2, 2, 3, 3, 22)
    at.add('tea_top', t)
    t = Tex(24, 10, 42)
    t.rect(0, 0, 23, 0, 44)
    t.rect(0, 9, 23, 9, 40)
    for x in range(0, 24, 4):  # «ажур»
        t.sprite(x, 2, ['.#..', '#.#.', '.#..', '#.#.', '.#..', '....'], {'#': 44})
        t.px(x + 2, 4, 40)
    t.rect(7, 0, 7, 9, 45)
    at.add('podstak', t)

    # дисковый телефон
    t = Tex(20, 20, 27)
    t.rect(0, 0, 19, 1, 28)
    t.rect(0, 18, 19, 19, 26)
    at.add('phone', t)
    t = Tex(16, 16, T)
    t.ellipse(8, 8, 8, 8, 44)
    for a in range(10):
        ang = -np.pi / 2 + (a + 1.5) / 12 * 2 * np.pi
        t.rect(8 + 5.2 * np.cos(ang) - 1, 8 + 5.2 * np.sin(ang) - 1, 8 + 5.2 * np.cos(ang), 8 + 5.2 * np.sin(ang), 37)
    t.ellipse(8, 8, 2.5, 2.5, 45)
    t.px(8, 8, 27)
    at.add('dial', t)

    # папка «Дело» и стопка
    t = Tex(24, 32, 16)
    t.noise(0, 0, 23, 31, 15, 0.1)
    t.frame(0, 0, 23, 31, 15)
    t.rect(4, 5, 19, 5, 14)
    t.text(6, 8, 'ДЕЛО', 13)
    t.text(8, 15, '№', 13)
    t.rect(13, 19, 19, 19, 14)
    for yy in (23, 26):
        t.rect(4, yy, 19, yy, 14)
    t.rect(22, 14, 23, 17, 45)  # завязки
    t.rect(20, 15, 21, 16, 44)
    at.add('delo', t)
    t = Tex(22, 30, 45)
    for yy in range(4, 28, 3):
        t.rect(3, yy, 18 - (yy % 7), yy, 43)
    t.rect(16, 0, 17, 5, 27)
    at.add('papers', t)
    t = Tex(22, 6, 45)
    for yy in range(0, 6, 2):
        t.rect(0, yy, 21, yy, 43)
    at.add('papers_side', t)

    # министерская лампа: зелёный абажур и латунь
    t = Tex(24, 12, 7)
    t.rect(0, 0, 23, 2, 8)
    t.rect(0, 3, 23, 3, 9)
    t.rect(0, 10, 23, 11, 23)
    t.rect(4, 4, 6, 9, 8)
    at.add('shade_green', t)
    t = Tex(8, 8, 22)
    t.rect(0, 0, 7, 1, 23)
    t.rect(0, 6, 7, 7, 21)
    at.add('brass', t)

    # кресло директора: стёжка ромбами, пуговки в узлах, каждая подушка светлее сверху
    t = Tex(40, 60, 13)
    xs, ys = t.grid()
    cu = (xs + ys) / 10.0  # диагональные координаты ромбов
    cv = (xs - ys) / 10.0
    fu, fv = cu - np.floor(cu), cv - np.floor(cv)
    top = (fu < 0.5) & (fv > 0.5)  # верхняя четверть ромба
    t.mask(top, 14)
    t.mask(((fu < 0.3) & (fv > 0.7)), 15)
    t.mask((fu > 0.5) & (fv < 0.5), 12)
    t.mask((np.abs(fu - 0.5) > 0.44) | (np.abs(fv - 0.5) > 0.44), 12)
    for yy in range(0, 61, 10):
        for xx in range(0, 41, 10):
            for (x, y) in ((xx, yy), (xx + 5, yy + 5)):
                t.rect(x - 1, y - 1, x, y, 18)
                t.px(x - 1, y - 1, 14)
    t.frame(0, 0, 39, 59, 12)
    t.rect(1, 1, 38, 2, 14)
    t.rect(1, 1, 38, 1, 15)
    at.add('chair_boss', t)
    t = Tex(16, 16, 13)
    t.rect(0, 0, 15, 1, 14)
    t.rect(0, 14, 15, 15, 12)
    at.add('leather', t)
    # стул массовки: ткань-рогожка
    t = Tex(24, 24, 26)
    t.checker(0, 0, 23, 23, 25)
    t.noise(0, 0, 23, 23, 27, 0.05)
    t.frame(0, 0, 23, 23, 25)
    t.rect(1, 1, 22, 1, 27)
    at.add('fabric', t)

    # розетка и выключатель
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.px(2, 4, 40)
    t.px(5, 4, 40)
    at.add('socket', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.rect(3, 2, 4, 5, 43)
    at.add('switch', t)
    return at


# ------------------------------------------------------------------------------------------------------
# Бизнес-центр
# ------------------------------------------------------------------------------------------------------

def office_atlas():
    at = Atlas(256)
    common_items(at)
    at.add('clock', clock_face(True))
    at.add('clock_rim', Tex(8, 4, 37))

    # маркерная доска 96×62
    t = Tex(96, 62, 45)
    t.frame(0, 0, 95, 61, 42)
    t.rect(1, 1, 94, 1, 44)
    t.rect(0, 61, 95, 61, 41)
    t.text(6, 6, 'ЦЕНА', 2)
    t.text(26, 6, '→', 2)
    t.text(34, 6, 'СРОК', 2)
    t.frame(54, 4, 70, 12, 27)
    t.text(56, 6, '-7', 27)
    t.text(65, 6, '', 27)
    for yy, x1 in ((16, 30), (19, 26), (22, 34)):
        t.rect(6, yy, x1, yy, 2)
    t.line([(38, 16), (46, 20), (38, 24)], 2)
    t.line([(6, 30), (40, 30)], 40)
    t.line([(6, 32), (40, 27)], 27)
    t.line([(6, 52), (6, 36)], 40)
    t.line([(6, 52), (60, 52)], 40)
    t.line([(8, 48), (16, 42), (24, 46), (34, 38), (44, 41), (56, 33)], 8)
    t.line([(8, 49), (16, 43), (24, 47), (34, 39), (44, 42), (56, 34)], 8)
    t.rect(70, 30, 81, 41, 23)  # стикеры
    t.rect(70, 30, 81, 31, 22)
    t.rect(72, 34, 79, 34, 21)
    t.rect(72, 37, 77, 37, 21)
    t.rect(80, 44, 90, 54, 35)
    t.rect(80, 44, 90, 45, 34)
    t.rect(82, 48, 88, 48, 33)
    at.add('whiteboard', t)
    t = Tex(24, 4, 43)
    t.rect(0, 0, 23, 0, 44)
    t.rect(3, 1, 7, 2, 27)
    t.rect(10, 1, 14, 2, 2)
    t.rect(17, 1, 20, 2, 37)
    at.add('tray', t)

    # сансевиерия
    t = Tex(40, 60, T)
    blades = [(6, 22, 3, 9), (11, 8, 4, 8), (16, 16, 4, 9), (21, 2, 5, 8), (26, 12, 4, 9), (31, 20, 4, 8),
              (35, 30, 3, 9), (14, 28, 3, 7), (24, 24, 4, 7)]
    for x, top, w, col in blades:
        for y in range(top, 60):
            k = (y - top) / 4
            ww = min(w, 1 + int(k))
            t.rect(x, y, x + ww - 1, y, col)
            t.px(x, y, 10 if y > top + 2 else col)
            t.px(x + ww - 1, y, 11 if (y > top + 3 and col == 8) else darker(col))
            if (y * 3 + x) % 5 == 0 and ww > 2:
                t.rect(x + 1, y, x + ww - 2, y, 7)
    at.add('sansev', t)
    t = Tex(24, 16, 38)
    t.rect(0, 0, 23, 1, 40)
    t.rect(2, 2, 3, 15, 39)
    at.add('planter', t)

    # кулер
    t = Tex(24, 72, 45)
    t.rect(0, 0, 23, 2, 44)
    t.rect(3, 8, 20, 22, 40)
    t.rect(4, 9, 19, 21, 39)
    t.rect(6, 12, 8, 16, 27)
    t.rect(15, 12, 17, 16, 2)
    t.rect(5, 26, 18, 27, 43)
    t.rect(0, 36, 23, 36, 43)
    t.frame(3, 40, 20, 66, 43)
    t.rect(10, 52, 13, 53, 42)
    t.rect(0, 69, 23, 71, 42)
    at.add('cooler', t)
    t = Tex(16, 16, 44)
    t.rect(0, 14, 15, 15, 42)
    at.add('cooler_side', t)
    t = Tex(24, 20, 4)
    t.rect(0, 0, 23, 19, 4)
    t.rect(0, 0, 23, 5, 5)
    t.rect(4, 0, 5, 19, 45)
    t.rect(17, 0, 17, 19, 3)
    t.rect(0, 12, 23, 12, 5)
    at.add('bottle', t)

    # телевизор, выключенный
    t = Tex(72, 42, 38)
    t.frame(0, 0, 71, 41, 37)
    t.rect(2, 2, 69, 39, 39)
    t.poly([(30, 2), (46, 2), (22, 39), (6, 39)], 40)
    t.poly([(50, 2), (54, 2), (30, 39), (26, 39)], 40)
    t.px(66, 39, 27)
    at.add('tv', t)

    # дверь: светлое дерево с матовой вставкой
    t = Tex(48, 104, 16)
    wood(t, 0, 0, 47, 103, 16, 15, 17, 0.3, vertical=True)
    t.rect(8, 10, 13, 90, 44)
    t.rect(9, 11, 12, 89, 43)
    t.checker(9, 11, 12, 89, 44)
    t.rect(38, 50, 44, 51, 43)
    t.rect(38, 50, 38, 55, 42)
    t.rect(37, 56, 39, 58, 42)
    t.frame(0, 0, 47, 103, 15)
    t.rect(22, 20, 34, 26, 40)  # табличка «301»
    t.text(24, 21, '301', 45)
    at.add('door', t)

    # картина: абстракция-«генплан»
    t = Tex(60, 44, 38)
    t.rect(2, 2, 57, 41, 45)
    t.rect(6, 6, 53, 37, 44)
    t.ellipse(22, 20, 10, 10, 3)
    t.ellipse(22, 20, 6, 6, 4)
    t.rect(30, 12, 50, 18, 28)
    t.rect(34, 22, 50, 32, 2)
    t.rect(10, 30, 28, 34, 22)
    t.line([(6, 37), (53, 6)], 40)
    at.add('print', t)

    # сплит-кондиционер, тумба, кофемашина
    t = Tex(40, 14, 45)
    t.rect(0, 0, 39, 0, 44)
    t.rect(2, 9, 37, 9, 43)
    for y in (10, 12):
        t.rect(3, y, 36, y, 42)
    t.rect(30, 4, 33, 5, 43)
    t.px(34, 5, 9)
    t.rect(0, 13, 39, 13, 43)
    at.add('ac', t)
    t = Tex(56, 36, 44)
    t.rect(0, 0, 55, 1, 45)
    t.frame(1, 3, 27, 34, 43)
    t.frame(28, 3, 54, 34, 43)
    t.rect(24, 16, 25, 21, 41)
    t.rect(30, 16, 31, 21, 41)
    t.rect(0, 35, 55, 35, 40)
    at.add('credenza', t)
    t = Tex(16, 20, 38)
    t.rect(0, 0, 15, 1, 40)
    t.rect(2, 3, 13, 5, 39)
    t.px(3, 4, 9)
    t.px(5, 4, 45)
    t.rect(5, 9, 10, 10, 42)
    t.rect(6, 11, 9, 11, 43)
    t.rect(4, 14, 11, 16, 39)
    t.rect(6, 12, 9, 15, 45)
    t.rect(0, 18, 15, 19, 37)
    at.add('coffee', t)

    # тренч на крючке
    t = Tex(26, 50, T)
    t.poly([(8, 2), (18, 2), (24, 49), (2, 49)], 15)
    t.poly([(10, 2), (16, 2), (13, 14)], 16)
    t.line([(13, 14), (13, 49)], 14)
    t.rect(4, 22, 22, 24, 14)
    t.rect(12, 21, 14, 25, 21)
    t.line([(7, 6), (4, 46)], 16)
    t.line([(19, 6), (22, 46)], 14)
    t.rect(11, 0, 15, 1, 40)
    at.add('trench', t)

    # ноутбук закрытый
    t = Tex(32, 22, 43)
    t.frame(0, 0, 31, 21, 42)
    t.rect(1, 1, 30, 1, 44)
    t.rect(14, 9, 17, 12, 44)
    t.rect(22, 15, 26, 18, 27)  # наклейка
    t.rect(23, 16, 25, 16, 28)
    at.add('laptop', t)

    # стикеры
    t = Tex(8, 8, 23)
    t.rect(0, 0, 7, 0, 22)
    at.add('sticky', t)
    t = Tex(8, 4, 23)
    for y in range(0, 4, 2):
        t.rect(0, y, 7, y, 22)
    at.add('sticky_side', t)
    t = Tex(12, 4, 2)
    t.rect(0, 0, 11, 0, 3)
    t.rect(10, 0, 11, 3, 43)
    at.add('pen', t)

    # стул-сетка
    t = Tex(40, 48, 38)
    for y in range(0, 48, 2):
        for x in range(0, 40, 2):
            t.px(x + (y // 2) % 2, y, 39)
    t.frame(0, 0, 39, 47, 37)
    t.rect(1, 1, 38, 2, 40)
    t.rect(4, 20, 35, 21, 37)  # поясничный упор
    at.add('mesh', t)
    t = Tex(24, 24, 40)
    t.noise(0, 0, 23, 23, 39, 0.3)
    t.noise(0, 0, 23, 23, 41, 0.08)
    t.frame(0, 0, 23, 23, 39)
    at.add('fabric', t)

    t = Tex(8, 8, 45)
    t.noise(0, 0, 7, 7, 44, 0.1)
    at.add('paint', t)
    t = Tex(8, 8, 43)
    t.noise(0, 0, 7, 7, 42, 0.1)
    at.add('plaster', t)
    t = Tex(8, 8, 39)
    t.rect(0, 0, 7, 0, 41)
    t.rect(0, 1, 7, 1, 40)
    at.add('alu', t)
    t = Tex(32, 16, 21)
    wood(t, 0, 0, 31, 15, 21, 20, 22, 0.35)
    at.add('wood', t)
    # кромка стола
    t = Tex(32, 8, 44)
    t.rect(0, 0, 31, 0, 45)
    t.rect(0, 7, 31, 7, 43)
    at.add('edge', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.px(2, 4, 40)
    t.px(5, 4, 40)
    at.add('socket', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.rect(3, 2, 4, 5, 43)
    at.add('switch', t)
    return at


# ======================================================================================================
# Большие поверхности
# ======================================================================================================

def m2t(x, y, x0, y0, s=S, flip_y=True, hgt=HGT):
    """Метры на стене -> тексели (строка 0 — верх стены)."""
    return (x - x0) / s, ((hgt - y) if flip_y else (y - y0)) / s


def wall_factory(width_m, side=0):
    w, h = round(width_m / S), round(HGT / S)
    t = Tex(w, h, 44)
    t.blotch(0, 0, w - 1, h - 1, 45, 2, 0.012)
    t.noise(0, 0, w - 1, h - 1, 43, 0.004)
    t.rect(0, 0, w - 1, 1, 43)  # у потолка
    panel = h - round(1.0 / S)  # верх панели на метре
    t.rect(0, panel, w - 1, h - 1, 41)
    for _ in range(w // 6):  # мазки кисти
        x = int(rng.integers(0, w))
        y = int(rng.integers(panel + 2, h - 6))
        t.rect(x, y, x, y + int(rng.integers(2, 7)), 42 if rng.random() < 0.6 else 40)
    t.noise(0, panel, w - 1, h - 1, 40, 0.006)
    t.rect(0, panel - 2, w - 1, panel - 1, 40)  # бордюр
    t.rect(0, panel, w - 1, panel, 42)
    t.rect(0, h - 4, w - 1, h - 1, 20)  # плинтус
    t.rect(0, h - 4, w - 1, h - 4, 21)
    t.rect(0, h - 1, w - 1, h - 1, 19)
    return t, panel


def corners(t, k=1, both=True):
    t.shade(0, 0, 1, t.h - 1, k)
    if both:
        t.shade(t.w - 2, 0, t.w - 1, t.h - 1, k)


def factory_walls(P):
    walls = {}
    # задняя: x от -HW до HW
    t, panel = wall_factory(2 * HW)
    X = lambda x: (x + HW) / S  # noqa: E731
    Y = lambda y: (HGT - y) / S  # noqa: E731
    wx0, wx1, wy0, wy1 = P['window']
    # сажа над батареей и тень под подоконником
    rx0, rx1, ry0, ry1 = P['radiator']
    t.shade(X(rx0) + 2, Y(wy0) + 2, X(rx1) - 2, Y(wy0) + 3, 1)
    t.blotch(X(rx0), Y(ry1) - 4, X(rx1), Y(ry1) - 1, 40, 2, 0.4, on=41)
    # трещинка на побелке над окном и след от старого портрета
    t.line([(X(-0.7), Y(2.95)), (X(-0.62), Y(2.8)), (X(-0.66), Y(2.66)), (X(-0.58), Y(2.5))], 43)
    t.rect(X(0.28), Y(2.8), X(0.62), Y(2.34), 45)
    t.px(X(0.45), Y(2.83), 40)
    t.blit(Tex(8, 8, 45), X(1.02), Y(0.95))  # розетка у шкафа
    t.frame(X(1.02), Y(0.95), X(1.02) + 7, Y(0.95) + 7, 43)
    t.px(X(1.02) + 2, Y(0.95) + 4, 40)
    t.px(X(1.02) + 5, Y(0.95) + 4, 40)
    cx0, cx1 = P['cabinet'][:2]
    t.shade(X(cx0) - 2, Y(P['cabinet'][2]) - 2, X(cx1) + 1, t.h - 1, 1)  # тень вокруг шкафа
    corners(t)
    walls['back'] = t
    # левая (смотрим на -X): столбец 0 — перед комнаты
    t, _ = wall_factory(FRONT - BACK)
    Z = lambda z: (FRONT - z) / S  # noqa: E731
    dz0, dz1 = P['door'][:2]
    t.shade(Z(dz1) - 3, Y(2.18), Z(dz0) + 2, t.h - 1, 1)
    t.rect(Z(dz1) - 3, Y(2.14), Z(dz0) + 2, t.h - 1, 43)  # затёртый косяк
    t.shade(Z(-2.3) - 8, Y(0.1), Z(-2.3) + 8, t.h - 1, 1)  # фикус
    corners(t)
    walls['left'] = t
    # правая (смотрим на +X): столбец 0 — зад комнаты
    t, _ = wall_factory(FRONT - BACK)
    Zr = lambda z: (z - BACK) / S  # noqa: E731
    sz0, sz1, sh = P['safe'][:3]
    t.shade(Zr(sz0) - 2, Y(sh) - 2, Zr(sz1) + 2, t.h - 1, 1)
    corners(t)
    walls['right'] = t
    # передняя (за спиной): столбец 0 — x = +HW
    t, _ = wall_factory(2 * HW)
    corners(t)
    walls['front'] = t
    return walls


def wall_office(width_m):
    w, h = round(width_m / S), round(HGT / S)
    t = Tex(w, h, 43)
    t.noise(0, 0, w - 1, h - 1, 42, 0.003)
    t.rect(0, 0, w - 1, 0, 42)
    t.rect(0, h - 3, w - 1, h - 1, 40)  # плинтус
    t.rect(0, h - 3, w - 1, h - 3, 41)
    return t


def office_walls(P):
    walls = {}
    t = wall_office(2 * HW)
    X = lambda x: (x + HW) / S  # noqa: E731
    Y = lambda y: (HGT - y) / S  # noqa: E731
    # деревянные рейки справа: 10 см рейка, 5 см щель (частый шаг даёт муар)
    sx = int(X(P['slats']))
    t.rect(sx, 0, t.w - 1, t.h - 1, 18)
    for x in range(sx + 1, t.w, 6):
        t.rect(x, 0, x + 3, t.h - 1, 20)
        t.rect(x, 0, x, t.h - 1, 21)
        t.rect(x + 3, 0, x + 3, t.h - 1, 19)
        t.rect(x + 4, 0, x + 4, t.h - 1, 24)
    t.noise(sx, 0, t.w - 1, t.h - 1, 21, 0.03, on=20)
    t.rect(sx, 0, sx, t.h - 1, 19)
    t.shade(sx, 0, t.w - 1, 1, 1)
    t.shade(sx, t.h - 3, t.w - 1, t.h - 1, 1)
    px0, pz0 = P['sansev'][:2]
    t.shade(X(px0) - 7, Y(0.9), X(px0) + 7, t.h - 1, 1)
    # тень под доской
    bx0, bx1, by0, _ = P['board']
    t.shade(X(bx0) + 1, Y(by0) - 1, X(bx1) + 1, Y(by0) + 1, 1)
    corners(t)
    walls['back'] = t
    Z = lambda z: (FRONT - z) / S  # noqa: E731
    t = wall_office(FRONT - BACK)
    corners(t)
    walls['left'] = t
    Zr = lambda z: (z - BACK) / S  # noqa: E731
    t = wall_office(FRONT - BACK)
    cz = P['cooler'][1]
    t.shade(Zr(cz) - 7, Y(1.4), Zr(cz) + 7, t.h - 1, 1)
    tz0, tz1, ty0, ty1 = P['tv']
    t.shade(Zr(tz0), Y(ty0) - 1, Zr(tz1) + 1, Y(ty0) + 1, 1)
    kz0, kz1, kh, _ = P['credenza']
    t.shade(Zr(kz0) - 1, Y(kh) - 2, Zr(kz1) + 1, t.h - 1, 1)
    t.shade(Zr(0.12) - 16, Y(2.44) - 1, Zr(0.12) + 16, Y(2.44) + 2, 1)  # под кондиционером
    corners(t)
    walls['right'] = t
    t = wall_office(2 * HW)
    corners(t)
    walls['front'] = t
    _ = Z
    return walls


def floor_tex(kind, P):
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 14)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    if kind == 'factory':
        # линолеум «под паркет»: квадраты по 12 текселей из трёх плашек, направление чередуется
        for by in range(0, h, 12):
            for bx in range(0, w, 12):
                horiz = ((bx // 12) + (by // 12)) % 2 == 0
                base = 14 if rng.random() < 0.85 else 15
                t.rect(bx, by, bx + 11, by + 11, base)
                for k in range(3):
                    if horiz:
                        t.rect(bx, by + k * 4, bx + 11, by + k * 4, 13)
                    else:
                        t.rect(bx + k * 4, by, bx + k * 4, by + 11, 13)
        t.noise(0, 0, w - 1, h - 1, 20, 0.03, on=[14, 15])
        t.noise(0, 0, w - 1, h - 1, 16, 0.015, on=15)
        # стёртая дорожка от двери к столу
        dz = (P['door'][0] + P['door'][1]) / 2
        t.shade_poly([(X(-HW), Zf(dz - 0.4)), (X(-1.6), Zf(0.1)), (X(-1.6), Zf(0.9)), (X(-HW), Zf(dz + 0.4))], -1)
        t.rect(0, Zf(-0.2), w - 1, Zf(-0.2), 13)  # шов линолеума
        t.rect(0, Zf(1.8), w - 1, Zf(1.8), 13)
        # солнце из окна
        wx0, wx1 = P['window'][:2]
        t.shade_poly([(X(wx0 + 0.15), 0), (X(wx1 + 0.05), 0), (X(wx1 + 0.45), Zf(-1.6)), (X(wx0 + 0.55), Zf(-1.6))], -1)
    else:
        # ковролин плиткой 50×50: полосы в разном направлении
        n = round(0.5 / S)
        for by in range(0, h, n):
            for bx in range(0, w, n):
                horiz = ((bx // n) + (by // n)) % 2 == 0
                t.rect(bx, by, bx + n - 1, by + n - 1, 40)
                for k in range(0, n, 2):
                    if horiz:
                        t.rect(bx, by + k, bx + n - 1, by + k, 41 if k % 4 == 0 else 40)
                    else:
                        t.rect(bx + k, by, bx + k, by + n - 1, 41 if k % 4 == 0 else 40)
        t.noise(0, 0, w - 1, h - 1, 39, 0.06)
        t.noise(0, 0, w - 1, h - 1, 42, 0.01)
        wx0, wx1 = P['window'][:2]
        t.shade_poly([(X(wx0 + 0.1), 0), (X(wx1), 0), (X(wx1 + 0.5), Zf(-1.2)), (X(wx0 + 0.6), Zf(-1.2))], -1)
    # тени: стол, стулья, мебель
    tx0, tx1 = X(-TABLE['halfLen']), X(TABLE['halfLen'])
    tz0, tz1 = Zf(TABLE['far']), Zf(TABLE['near'])
    t.shade(tx0 - 1, tz0 - 1, tx1 + 1, tz1 + 1, 1)
    t.shade(tx0 + 3, tz0 + 3, tx1 - 3, tz1 - 3, 1)
    for (x, z) in P['chairs']:
        t.shade_ellipse(X(x), Zf(z), 0.34 / S, 0.28 / S, 1)
    for (x0, x1, z0, z1) in P['floor_shadows']:
        t.shade(X(x0), Zf(z0), X(x1), Zf(z1), 1)
    return t


def ceiling_tex(kind, P):
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 45)
    n = round(0.6 / S)  # 24 тексели на плитку
    ox = round((HW - 0.3) / S) % n  # линии сетки на x = ±0.3 + 0.6k
    oz = round((0.3 - BACK) / S) % n
    if kind == 'factory':
        t.noise(0, 0, w - 1, h - 1, 44, 0.07)
    else:
        t.noise(0, 0, w - 1, h - 1, 44, 0.02)
    for x in range(ox, w, n):
        t.rect(x, 0, x, h - 1, 43)
        t.rect(x + 1, 0, x + 1, h - 1, 45)
    for y in range(oz, h, n):
        t.rect(0, y, w - 1, y, 43)
        t.rect(0, y + 1, w - 1, y + 1, 45)
    if kind == 'factory':
        # протечка на одной плитке и одна плитка сдвинута
        X = lambda x: (x + HW) / S  # noqa: E731
        Zf = lambda z: (z - BACK) / S  # noqa: E731
        t.blotch(X(1.9), Zf(-1.5), X(2.4), Zf(-1.0), 23, 3, 0.45, on=[45, 44])
        t.blotch(X(2.0), Zf(-1.4), X(2.3), Zf(-1.1), 16, 2, 0.35, on=23)
        t.rect(X(-2.1), Zf(0.9), X(-1.5), Zf(0.92), 38)
    t.a = darker(t.a)  # потолок на ступень темнее стен
    return t


def table_tex(kind, P):
    L, F, N = TABLE['halfLen'], TABLE['far'], TABLE['near']
    w = 256
    s = 2 * L / w
    h = round((N - F) / s)
    X = lambda x: (x + L) / s  # noqa: E731
    Zt = lambda z: (z - F) / s  # noqa: E731
    if kind == 'factory':
        t = Tex(w, h, 19)
        # шпон: широкие полосы, длинные волокна вдоль стола
        for y in range(h):
            x = -int(rng.integers(0, 40))
            while x < w:
                n = int(rng.integers(10, 60))
                r = rng.random()
                if r < 0.33:
                    t.rect(x, y, x + n, y, 18)
                elif r < 0.5:
                    t.rect(x, y, x + n // 2, y, 20)
                x += n + int(rng.integers(4, 30))
        for y in (h // 3, 2 * h // 3):  # стыки шпона
            t.rect(0, y, w - 1, y, 18)
        # лак: блик от окна у дальнего левого угла
        t.shade_poly([(X(-1.55), 0), (X(-0.75), 0), (X(-0.95), Zt(-0.45)), (X(-1.55), Zt(-0.45))], -1)
        t.frame(0, 0, w - 1, h - 1, 21)
        t.rect(0, h - 1, w - 1, h - 1, 20)
        # след от кружки и царапины
        t.shade_ellipse(X(1.12), Zt(0.08), 4, 4, -1)
        t.shade_ellipse(X(1.12), Zt(0.08), 3, 3, 1)
        t.line([(X(-0.9), Zt(0.15)), (X(-0.7), Zt(0.1))], 20)
        t.line([(X(1.3), Zt(-0.6)), (X(1.42), Zt(-0.5))], 20)
    else:
        t = Tex(w, h, 42)
        for y in range(0, h, 1):  # еле заметная «структура» ламината вдоль стола
            if rng.random() < 0.18:
                x0 = int(rng.integers(0, w))
                t.rect(x0, y, x0 + int(rng.integers(8, 40)), y, 43)
        t.shade_poly([(X(-1.55), 0), (X(-0.55), 0), (X(-0.85), Zt(-0.3)), (X(-1.55), Zt(-0.3))], -1)
        t.frame(0, 0, w - 1, h - 1, 44)
        t.frame(1, 1, w - 2, h - 2, 43)
    # контактные тени предметов на столе
    for (x, z, rx, rz) in P['table_shadows']:
        t.shade_ellipse(X(x), Zt(z), rx / s, rz / s, 1)
    return t


# ======================================================================================================
# Вид из окна, облака, пар, лампы
# ======================================================================================================

def sky(t, y_h, blues=(3, 4, 5)):
    """Небо ступенями с шахматкой на стыках; y_h — строка горизонта."""
    a, b, c = blues
    t.rect(0, 0, t.w - 1, y_h, a)
    k1, k2 = int(y_h * 0.35), int(y_h * 0.7)
    t.rect(0, k1, t.w - 1, y_h, b)
    t.checker(0, k1 - 2, t.w - 1, k1 - 1, b)
    t.rect(0, k2, t.w - 1, y_h, c)
    t.checker(0, k2 - 2, t.w - 1, k2 - 1, c)


def view_far(kind):
    # плоскость 9×6 м, 4.5 см на тексель
    t = Tex(200, 132, 5)
    hz = 78
    sky(t, hz)
    t.rect(0, hz - 1, 199, hz + 2, 43)  # дымка у горизонта
    t.rect(0, hz, 199, hz, 42)
    # Кама у горизонта и дальний берег
    t.rect(0, hz + 1, 199, hz + 3, 4)
    t.checker(0, hz + 1, 199, hz + 1, 43)
    for x in range(0, 200):
        if (x // 7) % 3 != 0:
            t.px(x, hz - 1 - (x * 7 % 3 == 0), 42)
    t.rect(0, hz + 4, 199, t.h - 1, 10)  # степь
    t.rect(0, hz + 8, 199, t.h - 1, 11)
    t.checker(0, hz + 6, 199, hz + 7, 11)
    t.noise(0, hz + 8, 199, t.h - 1, 10, 0.12)
    t.rect(0, hz + 4, 199, hz + 5, 9)
    # дальние цеха силуэтами
    for (x0, x1, hh) in ((20, 52, 4), (60, 70, 7), (96, 140, 3), (150, 170, 5)):
        t.rect(x0, hz - hh, x1, hz, 43)
        t.rect(x0, hz - hh, x1, hz - hh, 44)
    t.rect(64, hz - 14, 65, hz - 7, 42)
    return t


def clouds_tex():
    t = Tex(128, 40, T)
    for (cx, cy, s) in ((14, 26, 1.0), (52, 14, 1.4), (96, 28, 0.9), (118, 10, 0.7)):
        for dx, dy, r in ((0, 0, 6), (7, -3, 7), (14, 0, 5), (-6, 2, 4), (20, 2, 3)):
            t.ellipse(cx + dx * s, cy + dy * s, r * s * 1.3, r * s * 0.8, 45)
        t.rect(cx - 8 * s, cy + 3 * s, cx + 22 * s, cy + 4 * s, 44)
        t.checker(cx - 6 * s, cy + 5 * s, cx + 18 * s, cy + 5 * s, 44)
    # бесшовность по X
    t.a[:, -4:] = np.where(t.a[:, :4] != T, t.a[:, :4], t.a[:, -4:])
    return t


def steam_tex():
    t = Tex(16, 32, T)
    for y in range(32):
        x = 8 + 2 * np.sin(y / 32 * 2 * np.pi)
        if (y // 3) % 3 == 2:
            continue
        for xx in range(int(x - 1), int(x + 2)):
            if (xx + y) % 2 == 0:
                t.px(xx, y, 45 if (y // 6) % 2 else 44)
    return t


# Камера только вращается на месте, поэтому в окно всегда видна одна и та же полоса вида:
# плоскости ниже скомпонованы ровно под неё (VIEW в PLACE — где они стоят в мире).
VIEW = {
    # x0, x1, y0, y1, z (м) для ближнего плана; далёкий — такой же список
    'factory': {'near': [-3.55, -0.99, 0.72, 2.96, -4.3], 'far': [-7.0, 2.0, -1.5, 4.5, -6.4],
                'clouds': [-7.0, 1.0, 2.35, 3.55, -6.3], 'chimney': [-2.4, 2.42, -4.29]},
    'office': {'near': [-4.95, -1.75, -0.8, 4.0, -4.3], 'far': [-9.0, 0.0, -1.5, 4.5, -6.4],
               'clouds': [-9.0, -1.0, 2.7, 3.9, -6.3], 'chimney': [-3.2, 3.2, -4.31]},
}


def view_near_factory():
    # 128×112 при 2 см; строка r -> y = 2.96 - 0.02 r; из окна видно строки ~6..103
    t = Tex(128, 112, T)
    g = 92  # линия земли у цехов
    t.rect(0, g, 127, 111, 9)
    t.noise(0, g, 127, 111, 10, 0.25)
    t.rect(0, g + 5, 127, g + 12, 41)  # дорога
    t.rect(0, g + 5, 127, g + 5, 42)
    for x in range(0, 128, 10):
        t.rect(x, g + 9, x + 4, g + 9, 44)
    t.rect(0, g + 13, 127, 111, 8)
    t.noise(0, g + 13, 127, 111, 9, 0.3)

    def ceh(x0, x1, top, stripe=True, saw=False):
        t.rect(x0, top, x1, g, 44)
        t.rect(x0, top, x1, top, 45)
        t.rect(x0, top + 1, x1, top + 1, 43)
        if stripe:
            t.rect(x0, top + 3, x1, top + 5, 2)
            t.rect(x0, top + 3, x1, top + 3, 3)
        t.rect(x0, top + 9, x1, top + 11, 4)
        t.rect(x0, top + 9, x1, top + 9, 5)
        for x in range(x0 + 3, x1, 7):
            t.rect(x, top + 9, x, top + 11, 43)
        for x in range(x0 + 4, x1 - 7, 19):  # ворота
            t.rect(x, g - 9, x + 7, g, 42)
            for y in range(g - 8, g, 2):
                t.rect(x + 1, y, x + 6, y, 43)
        t.rect(x0, g - 1, x1, g, 42)
        if saw:
            for x in range(x0, x1 - 5, 8):
                t.poly([(x, top), (x + 8, top), (x + 8, top - 5)], 43)
                t.line([(x + 8, top), (x + 8, top - 5)], 42)
    # кран за цехами
    for y in range(14, 64, 3):
        t.line([(23, y), (26, y + 3)], 22)
        t.line([(26, y), (23, y + 3)], 22)
    t.rect(23, 14, 23, 64, 21)
    t.rect(26, 14, 26, 64, 21)
    t.rect(4, 12, 50, 13, 22)
    for x in range(6, 50, 3):
        t.px(x, 14, 21)
    t.rect(24, 7, 25, 11, 21)
    t.line([(24, 7), (6, 12)], 40)
    t.line([(25, 7), (48, 12)], 40)
    t.rect(27, 14, 31, 17, 22)
    t.rect(28, 15, 30, 15, 4)
    t.rect(12, 14, 12, 30, 40)
    t.rect(10, 30, 14, 32, 2)
    # труба с красными полосами
    t.rect(55, 30, 59, 66, 43)
    t.rect(55, 30, 56, 66, 44)
    t.rect(59, 30, 59, 66, 42)
    for y in range(30, 48, 6):
        t.rect(55, y, 59, y + 2, 27)
        t.rect(55, y, 56, y + 2, 28)
    t.rect(54, 28, 60, 29, 42)
    ceh(0, 50, 60)
    ceh(44, 76, 66, stripe=False)
    ceh(72, 127, 54, saw=True)
    for x in range(6, 128, 30):  # фонари
        t.rect(x, g - 16, x, g + 4, 40)
        t.rect(x, g - 16, x + 3, g - 16, 40)
        t.rect(x + 2, g - 15, x + 4, g - 15, 45)
    t.rect(78, g + 6, 98, g + 10, 45)  # фура
    t.rect(78, g + 6, 98, g + 6, 44)
    t.rect(99, g + 7, 104, g + 10, 2)
    t.rect(100, g + 7, 103, g + 8, 4)
    for x in (80, 85, 95, 101):
        t.rect(x, g + 11, x + 1, g + 11, 37)
    for x in range(0, 128, 8):
        t.ellipse(x + 4, g + 1, 4, 2, 8)
        t.px(x + 3, g, 9)
    return t


def view_near_office():
    # 128×192 при 2.5 см; строка r -> y = 4.0 - 0.025 r; мы на третьем этаже, земля внизу
    t = Tex(128, 192, T)
    g = 128
    t.rect(0, g, 127, 191, 9)
    t.noise(0, g, 127, 191, 10, 0.15)
    t.rect(0, g + 14, 127, g + 28, 40)  # дорога
    t.rect(0, g + 21, 127, g + 21, 44)
    for x in range(0, 128, 10):
        t.rect(x, g + 21, x + 4, g + 21, 40)
    t.rect(0, g + 13, 127, g + 13, 42)
    t.rect(0, g + 29, 127, g + 29, 42)
    for x in range(6, 128, 28):  # фонари
        t.rect(x, g - 6, x, g + 13, 39)
        t.rect(x, g - 6, x + 5, g - 6, 39)
        t.rect(x + 4, g - 5, x + 6, g - 5, 45)
    for (x, c) in ((14, 27), (48, 44), (84, 2), (110, 43)):  # машины
        t.rect(x, g + 16, x + 9, g + 19, c)
        t.rect(x + 2, g + 15, x + 7, g + 16, darker(c))
        t.rect(x + 3, g + 15, x + 5, g + 15, 4)
    t.rect(0, g + 30, 127, 191, 41)  # парковка
    for x in range(0, 128, 9):
        t.rect(x, g + 32, x, g + 44, 44)
    for i, x in enumerate(range(3, 128, 18)):
        t.rect(x, g + 35, x + 5, g + 41, [27, 44, 2, 40, 43, 3, 45][i % 7])
    for (x0, x1, top) in ((0, 40, 96), (80, 127, 100)):  # дальние цеха
        t.rect(x0, top, x1, g, 44)
        t.rect(x0, top + 3, x1, top + 5, 2)
        t.rect(x0, top + 9, x1, top + 11, 4)
        t.rect(x0, top, x1, top, 45)

    def glass(x0, x1, top, frame=44):
        t.rect(x0, top, x1, g, 2)
        for y in range(top + 2, g - 2, 5):
            t.rect(x0 + 1, y, x1 - 1, y + 3, 3)
            t.rect(x0 + 1, y, x1 - 1, y, 4)
        for x in range(x0, x1 + 1, 6):
            t.rect(x, top, x, g, frame)
        t.rect(x0, top, x1, top + 1, frame)
        t.poly([(x0 + 4, g - 2), (x0 + 14, top + 3), (x0 + 20, top + 3), (x0 + 10, g - 2)], 4)
        t.rect(x0, g - 4, x1, g, 40)
    t.rect(4, 82, 34, g, 44)  # светлый корпус с окнами
    for y in range(86, g - 4, 6):
        for x in range(7, 32, 5):
            t.rect(x, y, x + 2, y + 2, 3)
            t.px(x, y, 4)
    t.rect(4, 82, 34, 83, 45)
    t.rect(34, 82, 34, g, 42)
    glass(38, 80, 58)
    glass(86, 116, 76, frame=43)
    for x in range(84, 128, 11):  # деревья
        t.ellipse(x, g - 3, 5, 4, 8)
        t.ellipse(x - 1, g - 5, 3, 2, 9)
    for x in range(0, 40, 12):
        t.ellipse(x + 3, g - 2, 4, 3, 7)
    return t


def lamp_tex(kind):
    t = Tex(24, 24, 44)
    if kind == 'factory':
        t.frame(0, 0, 23, 23, 42)
        t.rect(2, 2, 21, 21, 43)
        for k in range(4):  # четыре трубки
            x = 3 + k * 5
            t.rect(x, 2, x + 2, 21, 45)
        for y in range(2, 22, 4):  # решётка
            t.rect(1, y, 22, y, 42)
        t.rect(11, 1, 12, 22, 42)
    else:
        t.rect(0, 0, 23, 23, 45)
        t.frame(0, 0, 23, 23, 43)
        t.frame(1, 1, 22, 22, 44)
    return t


# ======================================================================================================
# Места вещей (их же читает room.ts через room3d.gen.ts)
# ======================================================================================================

PLACE = {
    'factory': {
        'window': [-2.15, -0.95, 1.0, 2.3],
        'radiator': [-2.0, -1.1, 0.3, 0.8],
        'cabinet': [1.2, 2.3, 1.8, 0.42],
        'gramota': [-0.64, 1.79],
        'calendar': [0.74, 1.73],
        'pennant': [0.74, 1.2],
        'ficus': [-2.72, -2.25],
        'map': [-1.45, 1.6],
        'rack': [-2.98, -0.35],
        'door': [0.6, 1.55, 2.05],
        'safe': [-2.4, -1.85, 0.95, 0.5],
        'poster': [-1.05, 1.6],
        'honor': [0.5, 1.62],
        'lamps': [[-1.2, -0.6], [1.2, -0.6], [-1.2, 1.2], [1.2, 1.2], [0.0, -2.4]],
        'tea': [0.62, -0.05],
        'phone': [-1.0, -0.22],
        'desklamp': [-1.36, -0.74],
        'delo': [-0.49, -0.74, 0.12],
        'papers': [0.47, -0.76, -0.08],
        'sample': [1.18, -0.3, 0.3],
        'socket': [1.02, 0.95],
        'spare': [[2.93, 1.25], [2.93, 1.8]],
    },
    'office': {
        'window': [-3.05, -1.35, 0.05, 2.95],
        'board': [-1.3, -0.35, 1.2, 1.82],
        'slats': 0.55,
        'sansev': [1.8, -2.4],
        'cooler': [2.98, -1.7],
        'tv': [-0.45, 0.75, 1.1, 1.78],
        'credenza': [0.95, 2.05, 0.74, 0.45],
        'door': [0.7, 1.6, 2.1],
        'print': [-1.45, 1.55],
        'trench': [0.2, 1.72],
        'lamps': [[-1.2, -0.6], [1.2, -0.6], [-1.2, 1.2], [1.2, 1.2], [0.0, -2.4]],
        'laptop': [1.0, -0.32, -0.12],
        'glass': [-0.68, 0.0],
        'sticky': [-1.08, -0.42, 0.3],
        'pen': [-0.95, -0.15, 0.6],
    },
}


def seats_from_layout():
    src = open(os.path.join(ROOT, 'src', 'game', 'world3d', 'layout.ts'), encoding='utf-8').read()
    body = re.search(r'export const SEATS = \{(.*?)\n\}', src, re.S).group(1)
    return [(float(x), float(z)) for x, z in re.findall(r'\{ x: (-?[\d.]+), z: (-?[\d.]+) \}', body)]


def shadows(kind):
    P = PLACE[kind]
    seats = seats_from_layout()
    chairs = [(x, z - 0.1) for (x, z) in seats if z < 0]
    chairs = [(x - 0.1 * np.sign(x), z + 0.1) if abs(x) > 1.8 else (x, z) for (x, z) in chairs]
    if kind == 'factory':
        cx0, cx1, _, cd = P['cabinet']
        sz0, sz1, _, sd = P['safe']
        fx, fz = P['ficus']
        rx, rz = P['rack']
        floor = [(cx0 - 0.03, cx1 + 0.03, BACK, BACK + cd + 0.06), (HW - sd - 0.06, HW, sz0 - 0.04, sz1 + 0.04),
                 (fx - 0.26, fx + 0.26, fz - 0.26, fz + 0.26), (rx - 0.2, rx + 0.2, rz - 0.2, rz + 0.2),
                 (P['radiator'][0], P['radiator'][1], BACK, BACK + 0.12)]
        chairs += [(x + 0.05, z) for (x, z) in P['spare']]
        table = [(P['tea'][0] + 0.01, P['tea'][1] + 0.01, 0.05, 0.05), (P['phone'][0], P['phone'][1] + 0.01, 0.12, 0.12),
                 (P['desklamp'][0], P['desklamp'][1], 0.09, 0.09), (P['sample'][0], P['sample'][1] + 0.01, 0.16, 0.12),
                 (P['delo'][0] + 0.01, P['delo'][1] + 0.01, 0.12, 0.16), (P['papers'][0] + 0.01, P['papers'][1] + 0.01, 0.11, 0.15)]
    else:
        sx, sz = P['sansev']
        cz = P['cooler'][1]
        kz0, kz1, _, kd = P['credenza']
        floor = [(sx - 0.24, sx + 0.24, sz - 0.2, sz + 0.24), (HW - 0.4, HW, cz - 0.22, cz + 0.22),
                 (HW - kd - 0.05, HW, kz0 - 0.03, kz1 + 0.03)]
        table = [(P['laptop'][0], P['laptop'][1] + 0.01, 0.19, 0.14), (P['glass'][0] + 0.01, P['glass'][1] + 0.01, 0.045, 0.045),
                 (P['sticky'][0], P['sticky'][1], 0.05, 0.05)]
    return {'chairs': chairs, 'floor_shadows': floor, 'table_shadows': table}


# ======================================================================================================

def save(t, name, textures):
    t.image().save(os.path.join(OUT, name + '.png'))
    textures[name] = t


def sheet(textures, path, scale=4, maxw=1400):
    items = list(textures.items())
    x = y = rowh = 0
    pos = []
    for name, t in items:
        w, h = t.w * scale, t.h * scale
        if x + w > maxw:
            x, y, rowh = 0, y + rowh + 8, 0
        pos.append((x, y))
        x += w + 8
        rowh = max(rowh, h)
    im = Image.new('RGBA', (maxw, y + rowh), (40, 40, 48, 255))
    for (name, t), (x, y) in zip(items, pos):
        im.alpha_composite(t.image().resize((t.w * scale, t.h * scale), Image.NEAREST), (x, y))
    im.save(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    gen = {'atlas': {}, 'place': {}}
    shared = {}
    save(clouds_tex(), 'clouds', shared)
    save(steam_tex(), 'steam', shared)
    for kind in ('factory', 'office'):
        P = dict(PLACE[kind])
        P.update(shadows(kind))
        at = factory_atlas() if kind == 'factory' else office_atlas()
        rects = at.pack()
        tex = {}
        for k in range(3):
            v = Tex(at.size, at.h)
            v.a = darker(at.sheet.a, k)
            save(v, f'{kind}_atlas{k}', tex)
        walls = factory_walls(P) if kind == 'factory' else office_walls(P)
        for side, t in walls.items():
            if side != 'back':
                t.a = darker(t.a)  # боковые и передняя стены — на ступень темнее задней
            save(t, f'{kind}_wall_{side}', tex)
        save(floor_tex(kind, P), f'{kind}_floor', tex)
        save(ceiling_tex(kind, P), f'{kind}_ceiling', tex)
        save(table_tex(kind, P), f'{kind}_table', tex)
        save(view_far(kind), f'{kind}_view_far', tex)
        save(view_near_factory() if kind == 'factory' else view_near_office(), f'{kind}_view_near', tex)
        save(lamp_tex(kind), f'{kind}_lamp', tex)
        gen['atlas'][kind] = {'w': at.size, 'h': at.h, 'rects': rects}
        gen['place'][kind] = dict(PLACE[kind], view=VIEW[kind])
        sheet(tex, os.path.join(PREV, f'room3d_{kind}.png'))
        print('ok', kind, len(rects), 'в атласе')
    with open(GEN, 'w', encoding='utf-8') as f:
        f.write('// Сгенерировано tools/art/room3d.py — не править руками.\n')
        f.write('// Раскладка атласа (x, y, w, h в текселях) и места вещей, по которым запечены тени.\n\n')
        f.write('export const ATLAS = ' + json.dumps(gen['atlas'], ensure_ascii=False) + ' as const\n\n')
        f.write('export const PLACE = ' + json.dumps(gen['place'], ensure_ascii=False) + ' as const\n')


if __name__ == '__main__':
    main()
