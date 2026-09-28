"""Карта кампании «Новенький»: Елабуга и ОЭЗ «Алабуга» по мотивам, вид сверху с наклоном, конец сентября.

320×200 точек в палитре Apollo. Слева ОЭЗ с тремя заводами, в центре жилой район с общагами,
справа старая Елабуга, внизу Кама с мостом на Челны. Меток глав на картинке нет — их ставит интерфейс
по координатам из src/game/map.gen.ts (этот же скрипт пишет их вместе с маршрутом недели по дорогам).

Запуск: ~/Arena-materials/.venv/bin/python tools/art/map.py
Пишет public/assets/map/elabuga.png, src/game/map.gen.ts и превью tools/art/out/map_x3.png.
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from font import GLYPHS  # noqa: E402
from room3d import Tex, darker, lighter  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W, H = 320, 200
rng = np.random.default_rng(926)


# ---------------------------------------------------------------------------------------------------
# палитра по ролям
GRASS, GRASS_D, GRASS_L, GRASS_Y = 9, 8, 10, 11
ASPH, ASPH_E, MARK = 40, 39, 44
WATER, WATER_D, WATER_L, FOAM = 2, 1, 3, 4
SAND, SAND_L = 16, 17
INK = 38

# деревья: свет, тон, тень
TREE = {
    'green': (10, 9, 8), 'lime': (11, 10, 8), 'birch': (23, 22, 21), 'maple': (29, 28, 20),
    'pine': (8, 7, 6), 'oak': (22, 21, 20),
}
AUTUMN = ['green', 'lime', 'lime', 'birch', 'birch', 'green', 'maple', 'oak']


class Map(Tex):
    def text(self, x, y, s, c, outline=None, gap=1):
        if outline is not None:
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)):
                self._text(x + dx, y + dy, s, outline, gap)
        self._text(x, y, s, c, gap)

    def _text(self, x, y, s, c, gap):
        for ch in s:
            g = GLYPHS[ch]
            for dy, row in enumerate(g):
                for dx, v in enumerate(row):
                    if v == '#':
                        self.px(x + dx, y + dy - (len(g) - 5), c)
            x += len(g[0]) + gap


def text_w(s, gap=1):
    return sum(len(GLYPHS[ch][0]) + gap for ch in s) - gap


m = Map(W, H, GRASS)
occupied = np.zeros((H, W), bool)   # куда не сажать деревья (дороги, здания, вода, поля)


def occupy(x0, y0, x1, y1, pad=0):
    occupied[max(0, y0 - pad):min(H, y1 + pad + 1), max(0, x0 - pad):min(W, x1 + pad + 1)] = True


# ---------------------------------------------------------------------------------------------------
# 1. земля: трава с пятнами и осенней желтизной
m.blotch(0, 0, W - 1, H - 1, GRASS_D, 3, 0.10)
m.blotch(0, 0, W - 1, H - 1, GRASS_L, 4, 0.16)
m.noise(0, 0, W - 1, H - 1, GRASS_Y, 0.025, on=GRASS_L)
m.noise(0, 0, W - 1, H - 1, GRASS_D, 0.03, on=GRASS)
m.noise(0, 0, W - 1, H - 1, 22, 0.006)


# ---------------------------------------------------------------------------------------------------
# 2. Кама: берег y(x), мыс под городищем, за мысом берег уходит вверх — там мост
def bank(x):
    y = 168 + 1.6 * math.sin(x / 21) + 0.9 * math.sin(x / 7.3 + 1)
    y += 11 * math.exp(-((x - 258) / 17) ** 4)          # мыс с городищем
    y -= 9 / (1 + math.exp(-(x - 296) / 5))              # за мысом берег поднимается
    return round(y)


BANK = [bank(x) for x in range(W)]
ys, xs = np.mgrid[0:H, 0:W]
water = ys >= np.array(BANK)[None, :]
m.a[water] = WATER
deep = 189 + np.round(1.5 * np.sin(xs / 13.0) + 0.8 * np.sin(xs / 5.0 + 2))
m.a[water & (ys >= deep)] = WATER_D
m.a[water & (ys == deep - 1) & ((xs + ys) % 2 == 0)] = WATER_D
occupied |= water
# песок у кромки
for x in range(W):
    b = BANK[x]
    for k, c in ((1, SAND), (2, SAND_L if (x // 3) % 3 else SAND)):
        if b - k >= 0:
            m.px(x, b - k, c)
    if (x * 7) % 11 < 6:
        m.px(x, b - 3, SAND)
    m.px(x, b, FOAM if (x // 2) % 3 else WATER_L)
    occupied[max(0, b - 4):b, x] = True
# рябь
for _ in range(210):
    x, y = int(rng.integers(0, W - 4)), int(rng.integers(0, H))
    if y < BANK[x] + 3 or y >= H:
        continue
    ln = int(rng.integers(2, 6))
    c = WATER_L if y < 190 else WATER
    if rng.random() < 0.15:
        c = FOAM
    m.rect(x, y, x + ln - 1, y, c)
for _ in range(60):  # блики-пары
    x, y = int(rng.integers(0, W - 4)), int(rng.integers(0, H))
    if y > BANK[x] + 2:
        m.px(x, y, 5)


# ---------------------------------------------------------------------------------------------------
# 3. поля и лесополосы (до дорог и домов)
def field(x0, y0, x1, y1, kind):
    base, row, spot = {'plough': (20, 19, 21), 'stubble': (23, 22, 17), 'winter': (10, 9, 11),
                       'meadow': (11, 10, 23)}[kind]
    m.rect(x0, y0, x1, y1, base)
    for y in range(y0 + 1, y1 + 1, 2):
        m.rect(x0, y, x1, y, row)
    m.noise(x0, y0, x1, y1, spot, 0.04)
    if kind == 'stubble':  # рулоны сена
        for _ in range((x1 - x0) * (y1 - y0) // 90):
            x, y = int(rng.integers(x0 + 1, x1 - 1)), int(rng.integers(y0 + 1, y1 - 1))
            m.rect(x, y, x + 1, y, 21)
            m.px(x, y - 1, 22)
    m.frame(x0 - 1, y0 - 1, x1 + 1, y1 + 1, darker(base, 2) if kind != 'winter' else 8)
    occupy(x0, y0, x1, y1, 1)


FIELDS = [
    (156, 8, 200, 30, 'stubble'), (156, 36, 200, 54, 'winter'),
    (156, 70, 184, 90, 'plough'),
    (152, 110, 186, 128, 'stubble'), (152, 134, 186, 152, 'plough'), (192, 110, 206, 126, 'meadow'),
    (240, 2, 316, 8, 'stubble'),
]
for f in FIELDS:
    field(*f)


# ---------------------------------------------------------------------------------------------------
# 4. дороги
def stamp_line(pts, w, c):
    r0 = -(w // 2)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            x, y = round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)
            m.rect(x + r0, y + r0, x + r0 + w - 1, y + r0 + w - 1, c)
            occupy(x + r0, y + r0, x + r0 + w - 1, y + r0 + w - 1)


def road(pts, w=5, surface=ASPH, edge=ASPH_E, marks=True):
    stamp_line(pts, w + 2, edge)
    stamp_line(pts, w, surface)
    if marks:
        k = 0
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = max(abs(x1 - x0), abs(y1 - y0), 1)
            for i in range(n + 1):
                if k % 5 < 2 and 3 < i < n - 3:
                    m.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), MARK)
                k += 1


def path(pts, c=43):
    stamp_line(pts, 2, c)


# геометрия дорог — от неё считаются и маршрут недели
HY = 100          # шоссе Елабуга — ОЭЗ
KPP1 = (148, HY)  # главный въезд ОЭЗ
SX = 84           # продольная улица ОЭЗ
A1, A2 = 62, 148  # улицы ОЭЗ: северная (Водогрей) и южная (Иней, Штамп-К, порт)
RX = 210          # улица Молодёжная (общаги)
OX = 278          # улица к мосту
O2 = 134          # поперечная улица старого города
BRIDGE_Y = 176

road([(KPP1[0], HY), (W - 1, HY)])                                   # шоссе
road([(SX, HY), (KPP1[0], HY)], 5)                                    # въезд в ОЭЗ
road([(SX, A1), (SX, A2)], 5)
road([(12, A1), (RX, A1)], 5)                                         # северная ОЭЗ + дорога к общагам
road([(12, A2), (142, A2)], 5)
road([(RX, 0), (RX, HY)], 5)                                          # Молодёжная
road([(OX, HY), (OX, BRIDGE_Y)], 5)                                   # к мосту
road([(214, O2), (W - 1, O2)], 3, marks=False)
road([(236, HY), (236, O2)], 3, marks=False)
road([(RX, 26), (W - 1, 26)], 3, marks=False)                        # улица за общагами
road([(58, A2), (58, 166)], 3, marks=False)                           # к причалу

# мост на Челны
bx0 = next(x for x in range(OX, W) if BANK[x] <= BRIDGE_Y - 3)
stamp_line([(OX, BRIDGE_Y), (bx0 + 2, BRIDGE_Y)], 7, ASPH_E)
stamp_line([(OX, BRIDGE_Y), (bx0 + 2, BRIDGE_Y)], 5, ASPH)
m.rect(bx0 - 2, BRIDGE_Y - 4, W - 1, BRIDGE_Y + 4, 42)           # пролёт
m.rect(bx0 - 2, BRIDGE_Y - 2, W - 1, BRIDGE_Y + 2, ASPH)
m.rect(bx0 - 2, BRIDGE_Y - 4, W - 1, BRIDGE_Y - 4, 44)           # перила
m.rect(bx0 - 2, BRIDGE_Y + 4, W - 1, BRIDGE_Y + 4, 41)
for x in range(bx0 + 2, W, 3):
    m.px(x, BRIDGE_Y - 3, 43)
    m.px(x, BRIDGE_Y + 3, 41)
for x in range(bx0 + 4, W, 5):
    if x % 10 < 5:
        m.px(x, BRIDGE_Y, MARK)
m.rect(bx0 - 2, BRIDGE_Y + 5, W - 1, BRIDGE_Y + 6, WATER_D)     # тень моста на воде
for x in range(bx0 + 8, W, 14):                                     # опоры
    m.rect(x, BRIDGE_Y + 5, x + 2, BRIDGE_Y + 8, 40)
    m.rect(x, BRIDGE_Y + 9, x + 2, BRIDGE_Y + 9, WATER_L)


# ---------------------------------------------------------------------------------------------------
# 5. постройки: вид сверху с наклоном — крыша + фасад на юг, тень на восток
def shadow(x0, y0, x1, y1, h, sd=None):
    sd = sd if sd is not None else max(2, h // 3)
    for i in range(sd):
        x = x1 + 1 + i
        m.shade(x, y0 + i + 1, x, y1 + h, 1)


def box(x0, y0, x1, y1, h, roof, wall, win=None, fl=2, wstep=3, door=None, trim=None, sd=None, edge=None):
    """Крыша x0..x1 × y0..y1, фасад высотой h под ней. Возвращает низ фасада."""
    shadow(x0, y0, x1, y1, h, sd)
    edge = INK if edge is None else edge
    m.rect(x0, y0, x1, y1, roof)
    m.rect(x0, y0, x1, y0, lighter(roof))
    m.rect(x0, y1, x1, y1, darker(roof))
    fy0, fy1 = y1 + 1, y1 + h
    m.rect(x0, fy0, x1, fy1, wall)
    m.rect(x0, fy1, x1, fy1, darker(wall, 2))
    if trim is not None:
        m.rect(x0, fy0, x1, fy0, trim)
    if win is not None and h >= 4:
        floors = max(1, (h - 2) // fl)
        for f in range(floors):
            y = fy0 + 1 + f * fl
            if y >= fy1 - 1:
                break
            for x in range(x0 + 2, x1 - 1, wstep):
                m.px(x, y, win)
    if door is not None:
        dx, dc = door
        m.rect(dx, fy1 - 2, dx + 1, fy1 - 1, dc)
    m.frame(x0 - 1, y0 - 1, x1 + 1, fy1 + 1, edge)
    occupy(x0, y0, x1, fy1, 1)
    return fy1


def gable(x0, y0, x1, h, roof, wall, win=None, door=None):
    """Купеческий домик: скатная крыша (конёк вдоль улицы) и двухэтажный фасад."""
    ry1 = y0 + 3
    shadow(x0, y0, x1, ry1, h, 2)
    m.rect(x0, y0, x1, ry1, roof)
    m.rect(x0, y0, x1, y0, darker(roof))
    m.rect(x0, y0 + 1, x1, y0 + 1, lighter(roof))           # конёк на свету
    m.rect(x0, ry1, x1, ry1, darker(roof))
    fy0, fy1 = ry1 + 1, ry1 + h
    m.rect(x0, fy0, x1, fy1, wall)
    m.rect(x0, fy1, x1, fy1, darker(wall, 2))
    if win is not None:
        for y in range(fy0 + 1, fy1 - 1, 3):
            for x in range(x0 + 2, x1 - 1, 3):
                m.px(x, y, win)
                m.px(x, y + 1, darker(win))
    if door is not None:
        m.rect(door, fy1 - 2, door, fy1 - 1, 19)
    m.frame(x0 - 1, y0 - 1, x1 + 1, fy1 + 1, INK)
    occupy(x0, y0, x1, fy1, 1)


def chimney(x, top, bot, cloud=True):
    m.rect(x, top, x + 2, bot, 44)
    for y in range(top, bot, 4):
        m.rect(x, y, x + 2, y + 1, 27)
    m.rect(x + 2, top, x + 2, bot, darker(44, 2))
    m.px(x, top - 1, 38)
    m.px(x + 2, top - 1, 38)
    occupy(x, top, x + 2, bot)
    if cloud:
        steam(x + 1, top - 3)


def steam(x, y):
    """Пар уходит на восток, редеет."""
    puffs = [(0, 0, 2.2), (4, -2, 2.8), (9, -3, 3.2), (15, -3, 2.8), (20, -2, 2.0)]
    for i, (dx, dy, r) in enumerate(puffs):
        cx, cy = x + dx, y + dy
        for yy in range(int(cy - r), int(cy + r) + 1):
            for xx in range(int(cx - r), int(cx + r) + 1):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r:
                    if i < 3 or (xx + yy) % 2 == 0:
                        m.px(xx, yy, 45 if yy < cy else 44)


# --- 5a. ОЭЗ «Алабуга» ----------------------------------------------------------------------------
# асфальтированные площадки
m.rect(10, 52, 146, 58, 42)          # перед цехами «Водогрея»
m.noise(10, 52, 146, 58, 43, 0.15)
m.rect(90, 68, 146, 94, 42)          # склад и стоянка
m.rect(10, 138, 146, 144, 42)        # перед «Инеем» и «Штамп-К»
m.noise(10, 138, 146, 144, 43, 0.15)
for x in range(96, 142, 3):          # разметка стоянки
    m.rect(x, 86, x, 92, 44)


def sawtooth(x0, y0, x1, y1, base, glass, step=4):
    for y in range(y0 + 1, y1, step):
        m.rect(x0 + 1, y, x1 - 1, y, glass)
        m.rect(x0 + 1, y + 1, x1 - 1, y + 1, lighter(base))


# трубы «Водогрея» за корпусом (рисуем до корпуса — нижняя часть скрыта)
# «Водогрей»: главный корпус (синяя крыша с фонарями), слева красная полоса — цвет марки
box(14, 12, 74, 40, 10, 2, 43, win=1, fl=3, wstep=2, trim=27, sd=4)
sawtooth(14, 12, 74, 40, 2, 4, 5)
m.rect(14, 12, 16, 40, 27)
m.rect(52, 22, 63, 29, 41)       # котельная на крыше
m.rect(52, 22, 63, 22, 42)
chimney(55, 7, 28)
chimney(61, 11, 28)
# ворота цеха
for gx in (22, 40, 58):
    m.rect(gx, 44, gx + 6, 50, 41)
    for y in range(45, 51, 2):
        m.rect(gx, y, gx + 6, y, 40)
# административный корпус «Водогрея» (кабинет закупок) — стекло, три этажа
TARA_DOOR = (84, 51)
box(76, 30, 92, 35, 15, 41, 3, win=5, fl=3, wstep=2, trim=44, door=(83, 45), sd=3)
m.rect(83, 49, 84, 50, 45)
m.rect(81, 47, 86, 47, 44)       # козырёк
m.rect(79, 38, 89, 39, 27)       # вывеска-полоса
# новый цех «Водогрея» — свежая светлая крыша, рядом кран и контейнеры с оборудованием
LAUNCH_DOOR = (121, 51)
box(102, 22, 140, 40, 10, 3, 44, win=2, fl=3, wstep=2, trim=27, sd=4)
sawtooth(102, 22, 140, 40, 3, 5, 4)
m.rect(116, 44, 125, 50, 41)
for y in range(45, 51, 2):
    m.rect(116, y, 125, y, 40)
m.rect(120, 48, 121, 50, 23)     # свет в воротах
# башенный кран за новым цехом
m.line([(144, 8), (144, 40)], 22)
m.line([(145, 8), (145, 40)], 21)
m.line([(128, 8), (150, 8)], 22)
m.line([(130, 9), (150, 9)], 21)
m.line([(134, 9), (134, 16)], 38)
m.rect(132, 16, 135, 17, 40)
m.rect(146, 9, 150, 11, 40)
occupy(126, 6, 150, 40)
# склад логистики и стоянка
box(94, 70, 128, 76, 6, 41, 42, win=None, trim=40, sd=3)
for gx in range(98, 126, 6):
    m.rect(gx, 79, gx + 3, 82, 40)
# грузовики на стоянке
for i, x in enumerate(range(132, 146, 5)):
    m.rect(x, 70, x + 2, 77, 45)
    m.rect(x, 78, x + 2, 80, (27, 3, 22)[i % 3])
    m.frame(x - 1, 69, x + 3, 81, INK)
# солнечные панели
for y in range(70, 92, 5):
    for x in range(14, 78, 9):
        if (60 <= x <= 78 and y >= 80):
            continue
        m.rect(x, y, x + 6, y + 2, 1)
        m.rect(x, y, x + 6, y, 3)
        m.rect(x, y + 3, x + 6, y + 3, darker(GRASS))
        occupy(x, y, x + 6, y + 3)

# «Иней» — завод холодильников: белая крыша, голубые полосы
CLIENT_DOOR = (42, 137)
box(14, 106, 70, 128, 8, 45, 44, win=3, fl=3, wstep=2, trim=4, sd=3)
for x in range(20, 68, 8):
    m.rect(x, 108, x + 3, 126, 5)
m.rect(14, 106, 70, 106, 44)
m.rect(38, 131, 46, 136, 3)       # стеклянный вход
m.rect(41, 134, 43, 136, 5)
m.rect(38, 130, 46, 130, 4)
m.rect(62, 100, 64, 108, 44)      # вытяжки
m.rect(62, 100, 64, 100, 42)
m.rect(24, 104, 26, 106, 43)

# «Штамп-К» — прессовый завод: серая крыша, оранжевая полоса, пресс-корпус выше
OFFER_DOOR = (118, 139)
box(96, 110, 140, 130, 8, 41, 43, win=40, fl=3, wstep=2, trim=29, sd=3)
box(96, 104, 112, 112, 6, 40, 42, win=None, sd=2)     # высокий прессовый пролёт
sawtooth(96, 110, 140, 130, 41, 42, 4)
m.rect(114, 132, 122, 138, 29)
m.rect(116, 134, 120, 138, 40)
chimney(134, 96, 110)

# порт на Каме: причал, портальный кран, контейнеры
pier_y1 = BANK[58] + 12
m.rect(46, 160, 78, pier_y1, 42)
m.rect(46, 160, 78, 160, 43)
m.rect(46, pier_y1, 78, pier_y1, 40)
m.rect(46, pier_y1 + 1, 78, pier_y1 + 1, WATER_D)
for x in range(48, 78, 4):
    m.px(x, pier_y1 - 1, 41)
for i, (cx, cy) in enumerate([(48, 163), (54, 163), (48, 167), (66, 163), (72, 163), (72, 167)]):
    c = (27, 3, 8, 21, 27, 2)[i]
    m.rect(cx, cy, cx + 4, cy + 2, c)
    m.rect(cx, cy, cx + 4, cy, lighter(c))
    m.rect(cx, cy + 3, cx + 4, cy + 3, darker(c, 2))
m.line([(60, 158), (60, pier_y1 - 2)], 22)
m.line([(64, 158), (64, pier_y1 - 2)], 22)
m.rect(58, 156, 70, 158, 22)
m.rect(58, 156, 70, 156, 23)
m.rect(66, 159, 68, 160, 38)
occupy(44, 150, 80, pier_y1 + 1)
# баржа
m.rect(90, 186, 124, 190, 1)
m.rect(91, 186, 123, 186, 41)
m.rect(92, 187, 110, 188, 21)
m.rect(114, 183, 120, 187, 44)
m.rect(114, 183, 120, 183, 45)
m.rect(115, 185, 119, 185, 3)
for x in range(80, 90, 2):
    m.px(x, 188 + (x // 2) % 2, WATER_L)

# забор ОЭЗ и КПП
FX0, FY0, FX1, FY1 = 6, 2, 148, 156
for x in range(FX0, FX1 + 1):
    for y in (FY0, FY1):
        if not occupied[y, x] or m.a[y, x] in (GRASS, GRASS_D, GRASS_L, GRASS_Y, 22):
            m.px(x, y, 41 if x % 3 else 43)
for y in range(FY0, FY1 + 1):
    for x in (FX0, FX1):
        if m.a[y, x] not in (ASPH, ASPH_E, MARK):
            m.px(x, y, 41 if y % 3 else 43)
occupied[FY0, FX0:FX1 + 1] = occupied[FY1, FX0:FX1 + 1] = True
occupied[FY0:FY1 + 1, FX0] = occupied[FY0:FY1 + 1, FX1] = True


def kpp(x, y):
    box(x - 7, y - 10, x - 2, y - 7, 4, 44, 43, win=3, fl=2, wstep=2, sd=1)
    for i in range(x - 1, x + 7):   # шлагбаум
        m.px(i, y - 3, 27 if (i // 2) % 2 else 45)
    m.px(x - 1, y - 3, 38)


kpp(FX1, HY)
kpp(FX1, A1)

# --- 5b. жилой район --------------------------------------------------------------------------------
# двор общаг
m.rect(216, 44, 300, 56, 43)
m.noise(216, 44, 300, 56, 42, 0.2)
occupy(216, 44, 300, 56)
# общежития: высокие панельки с цветными полосами (как у кампусов ОЭЗ)
DORM_DOOR = (234, 42)
box(218, 14, 252, 20, 20, 41, 44, win=3, fl=2, wstep=2, sd=6, door=(233, 0))
for y in range(23, 40, 4):
    m.rect(218, y, 219, y + 1, 29)
    m.rect(251, y, 252, y + 1, 29)
m.rect(231, 38, 237, 40, 40)
m.rect(233, 39, 235, 40, 23)
m.rect(230, 37, 238, 37, 29)
box(260, 14, 296, 20, 20, 41, 44, win=3, fl=2, wstep=2, sd=6)
for y in range(23, 40, 4):
    m.rect(260, y, 261, y + 1, 3)
    m.rect(295, y, 296, y + 1, 3)
m.rect(275, 38, 281, 40, 40)
m.rect(277, 39, 279, 40, 23)
m.rect(274, 37, 282, 37, 3)
# детская площадка во дворе
m.rect(284, 47, 294, 53, 21)
m.rect(285, 48, 293, 52, 16)
m.rect(287, 45, 287, 50, 27)
m.rect(291, 45, 291, 50, 27)
m.rect(287, 45, 291, 45, 27)
m.px(289, 49, 3)
# пятиэтажки за Молодёжной и у шоссе
box(176, 4, 204, 8, 10, 41, 16, win=0, fl=2, wstep=2, sd=4)
box(302, 32, 316, 36, 10, 41, 43, win=1, fl=2, wstep=2, sd=2)
box(244, 64, 276, 68, 10, 41, 15, win=0, fl=2, wstep=2, sd=4)
box(282, 64, 314, 68, 10, 41, 43, win=1, fl=2, wstep=2, sd=4)
box(188, 66, 204, 70, 8, 41, 16, win=0, fl=2, wstep=2, sd=3)
# «Семёрочка»: павильон с зелёной вывеской и жёлтой полосой
SHOP_DOOR = (228, 77)
box(216, 66, 238, 70, 7, 42, 44, win=None, sd=3)
m.rect(216, 71, 238, 72, 8)
m.rect(216, 71, 238, 71, 9)
m.rect(218, 71, 236, 71, 22)
for x in range(219, 236, 2):
    m.px(x, 72, 23)
m.rect(218, 74, 224, 76, 4)       # витрина
m.rect(231, 74, 236, 76, 4)
m.rect(227, 74, 229, 77, 3)
m.rect(216, 73, 238, 73, 43)
road([(RX, 80), (230, 80)], 3, marks=False)
path([(228, 78), (228, 79)])
# остановка «Молодёжная» и ларёк «Шаурма 24»
STOP_SPOT = (195, 95)
m.rect(186, 91, 204, 96, 43)       # тротуар
box(188, 86, 197, 87, 3, 3, 1, win=None, sd=1)   # навес (стекло)
m.rect(189, 89, 196, 89, 5)
box(200, 85, 205, 87, 4, 21, 44, win=None, sd=1)  # ларёк
m.rect(200, 89, 205, 89, 27)
m.rect(201, 90, 204, 90, 23)
m.rect(191, 94, 193, 94, 20)       # столик
m.px(192, 95, 38)
# жёлтый служебный автобус на шоссе
m.rect(166, 97, 180, 100, 22)
m.rect(166, 97, 180, 97, 23)
for x in range(168, 179, 3):
    m.rect(x, 98, x + 1, 98, 1)
m.rect(166, 101, 180, 101, 38)
m.px(167, 101, 36)
m.px(178, 101, 36)
# машины
for x, y, c in ((250, 98, 27), (292, 101, 45), (212, 40, 3), (70, 63, 44), (84, 118, 45), (278, 150, 22)):
    if x in (RX, OX, SX) or x in (212,):
        m.rect(x - 1, y, x, y + 3, c)
        m.px(x - 1, y, lighter(c))
    else:
        m.rect(x, y - 1, x + 3, y, c)
        m.px(x, y - 1, lighter(c))

# --- 5c. старая Елабуга -----------------------------------------------------------------------------
# Спасский собор: белый, золотой купол, колокольня со шпилем
cx0, cx1 = 240, 262
box(cx0, 118, cx1, 122, 9, 44, 45, win=None, sd=3)
for x in range(cx0 + 3, cx1 - 1, 4):
    m.rect(x, 125, x, 128, 40)
    m.px(x, 124, 43)
m.rect(249, 127, 252, 131, 19)
m.rect(249, 126, 252, 126, 23)
# барабан и купол
m.rect(247, 110, 255, 118, 45)
m.rect(254, 110, 255, 118, 44)
for x in range(248, 255, 2):
    m.rect(x, 112, x, 115, 42)
m.sprite(246, 101, ['....yY....', '...yYYy...', '..yYYyyd..', '.yYYyyyyd.', '.yYyyyyyd.', '..yyyyyd..', '...dddd...',
                    '..wwwwww..', '..........'], {'y': 22, 'Y': 23, 'd': 21, 'w': 44})
m.rect(250, 98, 250, 101, 22)
m.rect(249, 99, 251, 99, 22)
# малые купола
for kx in (242, 258):
    m.sprite(kx - 2, 112, ['.yY.', 'yYyd', '.dd.', '.ww.'], {'y': 22, 'Y': 23, 'd': 21, 'w': 44})
# колокольня к западу от собора (на улицу)
tx = 224
shadow(tx, 104, tx + 6, 130, 0, 3)
m.rect(tx, 116, tx + 6, 130, 45)
m.rect(tx + 5, 116, tx + 6, 130, 44)
m.rect(tx + 1, 108, tx + 5, 116, 45)
m.rect(tx + 5, 108, tx + 5, 116, 44)
m.rect(tx + 2, 110, tx + 3, 112, 40)   # арка звона
m.rect(tx + 2, 119, tx + 3, 121, 40)
m.rect(tx + 2, 125, tx + 3, 127, 40)
m.rect(tx + 2, 104, tx + 4, 108, 22)
m.rect(tx + 4, 104, tx + 4, 108, 21)
m.rect(tx + 3, 96, tx + 3, 104, 22)
m.px(tx + 3, 95, 23)
m.rect(tx + 2, 98, tx + 4, 98, 22)
m.frame(tx - 1, 115, tx + 7, 131, INK)
m.rect(tx, 107, tx, 114, INK)
m.rect(tx + 6, 107, tx + 6, 114, INK)
occupy(tx - 1, 94, cx1 + 1, 132, 1)
# купеческие домики
HOUSES = [
    (216, 140, 228, 7, 27, 17), (232, 140, 244, 7, 8, 45), (248, 140, 262, 7, 26, 16), (266, 140, 272, 6, 41, 4),
    (284, 106, 298, 7, 8, 17), (302, 106, 316, 7, 27, 45), (284, 118, 298, 7, 41, 15), (302, 118, 316, 7, 7, 16),
    (284, 140, 298, 7, 27, 45), (302, 140, 314, 6, 8, 17),
    (216, 106, 222, 6, 26, 16),
]
for x0, y0, x1, h, roof, wall in HOUSES:
    gable(x0, y0, x1, h, roof, wall, win=3 if wall in (45, 17) else 2, door=(x0 + x1) // 2)

# Чёртово городище: зелёный холм на мысу, белая башня с шатром
hx, hy = 256, 164
for r, c in ((13, 8), (11, 9), (8, 10)):
    for y in range(hy - 7, hy + 8):
        for x in range(hx - r - 2, hx + r + 3):
            if ((x - hx) / (r + 2)) ** 2 + ((y - hy) / (r * 0.55)) ** 2 <= 1 and y < BANK[x] - 2:
                m.px(x, y, c)
occupy(hx - 16, hy - 8, hx + 16, hy + 8)
m.line([(hx - 9, hy + 3), (hx - 4, hy - 1), (hx + 1, hy - 2)], 16)   # тропа
m.rect(hx - 1, hy - 14, hx + 4, hy - 2, 45)                          # башня
m.rect(hx + 3, hy - 14, hx + 4, hy - 2, 44)
m.rect(hx + 1, hy - 11, hx + 2, hy - 9, 40)
m.rect(hx + 1, hy - 6, hx + 2, hy - 4, 40)
m.sprite(hx - 2, hy - 20, ['...r....', '..rrR...', '.rrrRR..', 'rrrrRRR.', 'ddddddd.'], {'r': 20, 'R': 19, 'd': 18})
m.frame(hx - 2, hy - 15, hx + 5, hy - 1, INK)
m.rect(hx - 6, hy - 4, hx - 2, hy - 2, 44)                           # остаток стены
m.rect(hx - 6, hy - 2, hx - 2, hy - 2, 42)
m.shade(hx + 6, hy - 11, hx + 7, hy - 1, 1)


# ---------------------------------------------------------------------------------------------------
# под надписи — без деревьев
occupy(216, 151, 250, 161)
occupy(15, 87, 80, 97)
# 6. деревья: лесополосы, дворы, парк у собора, берег
TREES = []


def tree(x, y, kind=None):
    TREES.append((y, x, kind or AUTUMN[int(rng.integers(0, len(AUTUMN)))]))


def belt(x0, y0, x1, y1, step=4, kinds=None):
    n = max(abs(x1 - x0), abs(y1 - y0)) // step + 1
    for i in range(n):
        t = i / max(1, n - 1)
        x = round(x0 + (x1 - x0) * t + rng.integers(-1, 2))
        y = round(y0 + (y1 - y0) * t + rng.integers(-1, 2))
        tree(x, y, kinds[int(rng.integers(0, len(kinds)))] if kinds else None)


def grove(x0, y0, x1, y1, n, kinds=None):
    for _ in range(n):
        x, y = int(rng.integers(x0, x1 + 1)), int(rng.integers(y0, y1 + 1))
        tree(x, y, kinds[int(rng.integers(0, len(kinds)))] if kinds else None)


belt(150, 4, 150, 90, 4, ['pine', 'pine', 'birch', 'lime'])
belt(150, 106, 150, 150, 4, ['pine', 'birch'])        # вдоль забора ОЭЗ
belt(158, 33, 200, 33, 4, ['birch', 'lime', 'green'])
belt(158, 60, 200, 60, 5)
belt(158, 131, 188, 131, 4, ['birch', 'lime', 'maple'])
belt(188, 108, 188, 152, 4, ['pine', 'birch'])
grove(150, 0, W - 1, 12, 60)
grove(150, 56, 206, 96, 40)
grove(152, 100, 212, 164, 70)
grove(212, 76, 316, 96, 50)
grove(290, 38, 316, 62, 16)
grove(8, 4, 146, 11, 30, ['pine', 'green', 'lime'])
grove(8, 146, 146, 166, 60)
grove(190, 130, 212, 162, 22)
grove(152, 154, 236, 164, 30)
grove(214, 58, 302, 62, 12, ['birch', 'lime', 'maple'])
grove(212, 44, 300, 56, 10, ['birch', 'maple', 'green'])
grove(240, 76, 312, 94, 18)
grove(212, 104, 316, 166, 120)
grove(160, 70, 206, 94, 14)
grove(8, 150, 146, 164, 26)
grove(8, 64, 146, 98, 18, ['lime', 'birch', 'green'])
grove(8, 4, 146, 10, 18, ['pine', 'green', 'lime'])
grove(286, 150, 316, 164, 14)

SPR = ['.LLM.', 'LLMMD', 'LMMDD', '.MDD.', '..t..']
PINE = ['..L..', '.LMD.', '.LMD.', 'LMMDD', '..t..']
for y, x, kind in sorted(TREES):
    if not (2 <= x < W - 3 and 1 <= y < H - 5):
        continue
    if occupied[y:y + 5, x:x + 5].any():
        continue
    L_, M_, D_ = TREE[kind]
    sp = PINE if kind == 'pine' else SPR
    for dy, row in enumerate(sp):     # тень на землю
        for dx, ch in enumerate(row):
            if ch != '.':
                m.shade(x + dx + 1, y + dy + 1, x + dx + 1, y + dy + 1, 1)
    m.sprite(x, y, sp, {'L': L_, 'M': M_, 'D': D_, 't': 19})
    occupied[y + 1:y + 4, x + 1:x + 4] = True


# ---------------------------------------------------------------------------------------------------
# 7. надписи районов
def label(x, y, s, c=45, o=37, gap=1):
    m.text(x, y, s, c, outline=o, gap=gap)


label(18, 90, 'ОЭЗ «АЛАБУГА»')
label(219, 154, 'ЕЛАБУГА')
m.text(160, 180, 'КАМА', 4, gap=4)
label(250, 190, 'НАБ. ЧЕЛНЫ →', c=45, o=1)


# ---------------------------------------------------------------------------------------------------
# 8. точки глав и маршрут недели по дорогам
PINS = {
    'dorm': DORM_DOOR, 'stop': STOP_SPOT, 'tara': TARA_DOOR, 'shop': SHOP_DOOR,
    'offer': OFFER_DOOR, 'client': CLIENT_DOOR, 'launch': LAUNCH_DOOR,
}
ROUTE = [
    DORM_DOOR, (234, 44), (RX, 44), (RX, HY), (195, HY), STOP_SPOT, (195, HY),                       # общага → остановка
    (SX, HY), (SX, A1), (84, A1), TARA_DOOR,                                                          # автобус в ОЭЗ
    (84, A1), (RX, A1), (RX, 80), (228, 80), SHOP_DOOR,                                                # вечером к магазину
    (228, 80), (RX, 80), (RX, HY), (SX, HY), (SX, A2), (118, A2), OFFER_DOOR,                          # «Штамп-К»
    (118, A2), (42, A2), CLIENT_DOOR,                                                                  # «Иней»
    (42, A2), (SX, A2), (SX, A1), (121, A1), LAUNCH_DOOR,                                              # ночью в новый цех
]
# склеить повторы
route = [ROUTE[0]]
for p in ROUTE[1:]:
    if p != route[-1]:
        route.append(p)


def check():
    names = list(PINS)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            d = math.dist(PINS[a], PINS[b])
            assert d >= 18, f'{a}–{b}: {d:.1f}'
    for k, (x, y) in PINS.items():
        assert 24 <= x <= W - 24 and 24 <= y <= H - 24, (k, x, y)


check()


def main():
    out = os.path.join(ROOT, 'public', 'assets', 'map')
    prev = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(out, exist_ok=True)
    os.makedirs(prev, exist_ok=True)
    im = m.image()
    im.save(os.path.join(out, 'elabuga.png'))
    from PIL import Image, ImageDraw
    big = im.resize((W * 3, H * 3), Image.NEAREST)
    big.save(os.path.join(prev, 'map_x3.png'))
    # отладочное превью с точками и маршрутом
    dbg = big.copy()
    d = ImageDraw.Draw(dbg)
    d.line([(x * 3 + 1, y * 3 + 1) for x, y in route], fill=(255, 255, 255), width=2)
    for k, (x, y) in PINS.items():
        d.ellipse([x * 3 - 7, y * 3 - 7, x * 3 + 8, y * 3 + 8], outline=(255, 60, 60), width=3)
        d.text((x * 3 + 10, y * 3 - 6), k, fill=(255, 255, 255))
    dbg.save(os.path.join(prev, 'map_pins_x3.png'))
    gen = os.path.join(ROOT, 'src', 'game', 'map.gen.ts')
    with open(gen, 'w', encoding='utf-8') as f:
        f.write('// Сгенерировано tools/art/map.py — не править руками.\n')
        f.write('// Карта кампании: размер в точках, где стоит метка каждой главы (у входа в здание)\n')
        f.write('// и маршрут недели по дорогам в порядке глав: dorm → stop → tara → shop → offer → client → launch.\n\n')
        body = {'w': W, 'h': H, 'pins': {k: list(v) for k, v in PINS.items()}, 'route': [list(p) for p in route]}
        f.write('export const MAP = ' + json.dumps(body, ensure_ascii=False) + ' as const\n')
    print('ok map', len(route), 'точек маршрута')


if __name__ == '__main__':
    main()
