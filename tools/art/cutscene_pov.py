"""Пролог от первого лица: салон междугороднего автобуса с места у окна и телефон в руке крупно.

Сидим у левого окна и смотрим вперёд, в телефон: слева уходит к точке схода стена с окнами (за стёклами — та же
трасса вдоль Камы, что снаружи, слоями с параллаксом), впереди спинки кресел в белых чехлах и затылки пассажиров,
справа проход и кресла другого ряда, вдали лобовое стекло и табло маршрута. Закатное солнце из окон кладёт
на спинки кресел тёплые пятна (отдельный слой bus_pov_sun.png — рисовальщик гасит его тенями проезжающих столбов).

Вызывается из cutscene_people.py (main) — там же сохранение и people.gen.ts.
"""
import math

import numpy as np
from PIL import Image, ImageDraw

from room3d import FONT, T, Tex, darker, lighter

BW, BH = 320, 180
VIEW = -29            # сдвиг дальних лент (небо, берег, Кама) вверх: горизонт — на уровне глаз
# боковое окно: смотрим перпендикулярно ходу, дороги не видно. Ленты пейзажа и их параллакс (доля скорости автобуса)
FAR_PAR, RIVER_PAR = 0.12, 0.3   # дальний берег с заводами ОЭЗ и Кама
FIELD_DY, NEAR_DY = 15, 9   # поля и обочина ниже: горизонт — в нижней трети стекла
FIELD_PAR = 0.8       # поля и опушка на нашем берегу
NEAR_PAR = 3.2        # кусты и трава у самой обочины — проносятся смазанно
NEAR_BUSHES = [(90, 30), (420, 18), (700, 36)]   # центр и полуширина кустов на ленте 960
rng = np.random.default_rng(1610)    # свой генератор: остальные листы не меняются

SKIN, SKIN_S, SKIN_D, SKIN_L = 16, 15, 14, 17
JACK, JACK_S, JACK_L = 3, 2, 4
SEAT, SEAT_S, SEAT_L = 2, 1, 3        # обивка
COVER, COVER_S, COVER_L = 43, 42, 44  # белые чехлы подголовников (в тени салона — сероватые)
CURT, CURT_S, CURT_L = 26, 25, 27     # бордовые шторки
GLYPH = dict(FONT, **{'У': ['#.#', '#.#', '.##', '..#', '##.'], 'Г': ['###', '#..', '#..', '#..', '#..']})

# --- камера: глаз в начале координат, x вправо, y вверх, z вперёд по ходу; метры -----------------------------
# Сидим у левого окна; голова чуть повёрнута к окну (точка схода правее центра) и опущена к телефону.
F = 128.0
CX, CY = 160.0, 92.0
YAW = math.radians(64)
PITCH = math.radians(7)
ZN = 0.12
FLOOR, CEIL = -1.15, 0.92
WALL_L, WALL_R = -0.34, 1.96
SILL, WTOP = -0.24, 0.36              # низ и верх стёкол
RACK_Y, RACK_IN = 0.50, 0.06          # низ багажной полки и её кромка (x)
FRONT = 9.5
PANES = [(-0.8, 1.02), (1.42, 3.0), (3.14, 4.75), (4.89, 6.5), (6.64, 8.25)]
ROW_Z = [0.92 + 0.8 * i for i in range(11)]
LEFT_PAIR = [(-0.31, 0.14), (0.17, 0.62)]
RIGHT_PAIR = [(1.04, 1.49), (1.51, 1.95)]
SEAT_TOP, SEAT_LOW = -0.2, -0.8
SUN = np.array([0.9, -0.28, 0.42])   # куда летит свет заката: из окон слева сзади — на спинки впереди
SUN = SUN / np.linalg.norm(SUN)


EYE = (0.50, 0.0, -0.2)   # глаз: чуть дальше от стены и сзади — окно видно целиком, трапецией


def cam(p):
    x, y, z = p[0] - EYE[0], p[1] - EYE[1], p[2] - EYE[2]
    xc = x * math.cos(YAW) + z * math.sin(YAW)
    zc = -x * math.sin(YAW) + z * math.cos(YAW)
    yc = y * math.cos(PITCH) + zc * math.sin(PITCH)
    zc2 = -y * math.sin(PITCH) + zc * math.cos(PITCH)
    return np.array([xc, yc, zc2])


def screen(pc):
    return (CX + F * pc[0] / pc[2], CY - F * pc[1] / pc[2])


def ray(sx, sy):
    """Направление луча через центр пикселя в мировых координатах (массивы)."""
    xc, yc, zc = (sx - CX) / F, -(sy - CY) / F, np.ones_like(sx)
    # обратно по наклону
    y = yc * math.cos(PITCH) - zc * math.sin(PITCH)
    zz = yc * math.sin(PITCH) + zc * math.cos(PITCH)
    x = xc * math.cos(YAW) - zz * math.sin(YAW)
    z = xc * math.sin(YAW) + zz * math.cos(YAW)
    return x, y, z


class Scene:
    """Холст с плоскостями: каждый пиксель помнит, какая плоскость его закрасила (для света из окон)."""

    def __init__(self):
        self.t = Tex(BW, BH, 42)
        self.plane = np.full((BH, BW), -1, int)
        self.planes = []          # (нормаль, c): n·p = c
        self.kind = np.zeros((BH, BW), int)   # 1 — спинка, сюда падает свет; 2 — шторка справа; 3 — проход
        self.acc = None                       # куда копить силуэт предмета (для контура)

    def mask(self, pts3, plane=None):
        cs = [cam(np.array(p, float)) for p in pts3]
        # отсечь всё, что ближе ZN
        out = []
        for i in range(len(cs)):
            a, b = cs[i], cs[(i + 1) % len(cs)]
            ina, inb = a[2] >= ZN, b[2] >= ZN
            if ina:
                out.append(a)
            if ina != inb:
                u = (ZN - a[2]) / (b[2] - a[2])
                out.append(a + (b - a) * u)
        if len(out) < 3:
            return np.zeros((BH, BW), bool)
        im = Image.new('L', (BW, BH), 0)
        ImageDraw.Draw(im).polygon([screen(c) for c in out], fill=1)
        return np.array(im).astype(bool)

    def quad(self, pts3, c, normal=None, kind=0):
        m = self.mask(pts3)
        self.t.a[m] = c
        if self.acc is not None:
            self.acc |= m
        if normal is not None:
            n = np.array(normal, float)
            self.planes.append((n, float(n @ np.array(pts3[0], float))))
            self.plane[m] = len(self.planes) - 1
        else:
            self.plane[m] = -1
        self.kind[m] = kind
        return m

    def line(self, p0, p1, c):
        a, b = cam(np.array(p0, float)), cam(np.array(p1, float))
        if a[2] < ZN and b[2] < ZN:
            return
        if a[2] < ZN:
            a = a + (b - a) * (ZN - a[2]) / (b[2] - a[2])
        if b[2] < ZN:
            b = b + (a - b) * (ZN - b[2]) / (a[2] - b[2])
        self.t.line([screen(a), screen(b)], c)

    def pt(self, p):
        return screen(cam(np.array(p, float)))


def wall_l(x0z, x1z, y0, y1, x=WALL_L):
    return [(x, y1, x0z), (x, y1, x1z), (x, y0, x1z), (x, y0, x0z)]


def wall_rr(z0, z1, y0, y1, r, n=4, x=WALL_L):
    """Скруглённый прямоугольник на левой стене (в плоскости y–z)."""
    pts = []
    for cz, cy, a0 in ((z1 - r, y1 - r, 0), (z0 + r, y1 - r, 90), (z0 + r, y0 + r, 180), (z1 - r, y0 + r, 270)):
        for k in range(n + 1):
            ang = math.radians(a0 + 90 * k / n)
            pts.append((x, cy + r * math.sin(ang), cz + r * math.cos(ang)))
    return pts


def build_bus_pov():
    s = Scene()
    t = s.t
    # --- потолок: панели, полоса плафонов над проходом, стыки
    s.quad([(WALL_L, CEIL, -1), (WALL_R, CEIL, -1), (WALL_R, CEIL, FRONT), (WALL_L, CEIL, FRONT)], 42)
    for z in np.arange(-0.4, FRONT, 0.9):
        s.line((RACK_IN, CEIL, z), (1.55, CEIL, z), 43)
    for z in np.arange(0.2, FRONT - 0.5, 1.8):
        s.quad([(0.70, CEIL, z), (0.94, CEIL, z), (0.94, CEIL, z + 0.9), (0.70, CEIL, z + 0.9)], 45)
        s.line((0.70, CEIL, z), (0.94, CEIL, z), 44)
    # кондиционерный короб по оси
    s.line((0.66, CEIL, -1), (0.66, CEIL, FRONT), 43)
    s.line((0.98, CEIL, -1), (0.98, CEIL, FRONT), 43)
    # --- пол
    s.quad([(WALL_L, FLOOR, -1), (WALL_R, FLOOR, -1), (WALL_R, FLOOR, FRONT), (WALL_L, FLOOR, FRONT)], 39)
    s.quad([(0.66, FLOOR, -1), (0.98, FLOOR, -1), (0.98, FLOOR, FRONT), (0.66, FLOOR, FRONT)], 40, (0, 1, 0), kind=3)
    # --- правая стена: шторы задёрнуты, по краям светятся
    s.quad([(WALL_R, CEIL, -1), (WALL_R, CEIL, FRONT), (WALL_R, FLOOR, FRONT), (WALL_R, FLOOR, -1)], 41)
    for z0, z1 in PANES:
        s.quad([(WALL_R, WTOP, z0), (WALL_R, WTOP, z1), (WALL_R, SILL, z1), (WALL_R, SILL, z0)], 38)
        s.quad([(WALL_R, WTOP - 0.02, z0 + 0.03), (WALL_R, WTOP - 0.02, z1 - 0.03), (WALL_R, SILL + 0.02, z1 - 0.03),
                (WALL_R, SILL + 0.02, z0 + 0.03)], 23)
        zz = np.linspace(z0 + 0.06, z1 - 0.06, 9)
        for a, b in zip(zz, zz[1:]):
            s.quad([(WALL_R - 0.01, WTOP - 0.03, a), (WALL_R - 0.01, WTOP - 0.03, b), (WALL_R - 0.01, SILL + 0.1, b),
                    (WALL_R - 0.01, SILL + 0.1, a)], CURT, (-1, 0, 0), kind=2)
            s.line((WALL_R - 0.01, WTOP - 0.03, a), (WALL_R - 0.01, SILL + 0.1, a), CURT_S)
    # правая полка
    s.quad([(1.55, RACK_Y, -1), (WALL_R, RACK_Y, -1), (WALL_R, RACK_Y, FRONT), (1.55, RACK_Y, FRONT)], 39)
    s.quad([(1.55, RACK_Y, -1), (1.55, RACK_Y + 0.1, -1), (1.55, RACK_Y + 0.1, FRONT), (1.55, RACK_Y, FRONT)], 41)
    s.line((1.55, RACK_Y, -1), (1.55, RACK_Y, FRONT), 43)
    # --- передняя стенка: лобовое стекло в закате, силуэт водителя, табло маршрута
    s.quad([(WALL_L, CEIL, FRONT), (WALL_R, CEIL, FRONT), (WALL_R, FLOOR, FRONT), (WALL_L, FLOOR, FRONT)], 40)
    for k, (y0, y1, c) in enumerate(((0.40, 0.18, 29), (0.18, 0.02, 23), (0.02, -0.06, 22), (-0.06, -0.22, 7))):
        s.quad([(-0.1, y0, FRONT - 0.01), (1.85, y0, FRONT - 0.01), (1.85, y1, FRONT - 0.01), (-0.1, y1, FRONT - 0.01)], c)
    s.quad([(-0.1, -0.22, FRONT - 0.02), (1.85, -0.22, FRONT - 0.02), (1.85, -0.5, FRONT - 0.02), (-0.1, -0.5, FRONT - 0.02)], 38)
    s.quad([(0.0, 0.16, FRONT - 0.3), (0.34, 0.16, FRONT - 0.3), (0.40, -0.5, FRONT - 0.3), (-0.06, -0.5, FRONT - 0.3)], 37)
    hx, hy = s.pt((0.17, 0.24, FRONT - 0.3))
    t.ellipse(hx, hy, 3.2, 3.6, 37)
    s.quad([(-0.25, 0.78, FRONT - 0.03), (1.85, 0.78, FRONT - 0.03), (1.85, 0.5, FRONT - 0.03), (-0.25, 0.5, FRONT - 0.03)], 36)
    bx, by = s.pt((-0.2, 0.74, FRONT - 0.03))
    ex, _ = s.pt((1.8, 0.74, FRONT - 0.03))
    word = 'ЕЛАБУГА'
    x = int((bx + ex) / 2 - (sum(len(GLYPH[ch][0]) + 1 for ch in word) - 1) / 2)
    for ch in word:
        rows = GLYPH[ch]
        if x + len(rows[0]) > ex:
            break
        for dy, row in enumerate(rows):
            for dx, c in enumerate(row):
                if c == '#':
                    t.px(x + dx, int(by) + 1 + dy, 22)
        x += len(rows[0]) + 1
    # --- левая стена (как на фото с места у окна): окно в перспективе — трапеция, толстая светлая рама со
    # скруглёнными углами и тёмный уплотнитель, под окном вдоль стены горизонтальная решётка обдува, ниже — столик
    s.quad([(WALL_L, CEIL, -1), (WALL_L, CEIL, FRONT), (WALL_L, FLOOR, FRONT), (WALL_L, FLOOR, -1)], 41)
    s.quad(wall_l(-1, FRONT, FLOOR, SILL - 0.1), 40)
    for y in np.arange(SILL - 0.11, SILL - 0.27, -0.026):                         # решётка обдува
        s.line((WALL_L + 0.005, y, -1), (WALL_L + 0.005, y, FRONT), 38)
        s.line((WALL_L + 0.005, y - 0.009, -1), (WALL_L + 0.005, y - 0.009, FRONT), 42)
    for k, (z0, z1) in enumerate(PANES):
        s.quad(wall_rr(z0 - 0.09, z1 + 0.09, SILL - 0.08, WTOP + 0.08, 0.14), 43)   # рама
        s.quad(wall_rr(z0 - 0.09, z1 + 0.09, SILL - 0.08, SILL - 0.04, 0.0), 42)
        s.quad(wall_rr(z0 - 0.03, z1 + 0.03, SILL - 0.025, WTOP + 0.025, 0.1), 38)  # уплотнитель
        s.quad(wall_rr(z0 - 0.015, z1 + 0.015, SILL - 0.012, WTOP + 0.012, 0.09), 39)
        s.quad(wall_rr(z0, z1, SILL, WTOP, 0.08), T if k < 2 else 29)             # стекло; дальние вскользь — отблеск
        if k >= 2:
            s.quad(wall_l(z0 + 0.05, z1 - 0.05, SILL, (SILL + WTOP) / 2), 28)
        # блики на стекле — косые полоски, стоят на месте, пока пейзаж едет
        if k < 2:
            for u, h in ((0.6, 0.22), (0.66, 0.12)):
                z = z0 + (z1 - z0) * u
                a_, b_ = s.pt((WALL_L, 0.36, z)), s.pt((WALL_L, 0.36 - h, z + h * 0.8))
                n = int(max(abs(b_[0] - a_[0]), abs(b_[1] - a_[1])))
                for j in range(n):
                    xx = a_[0] + (b_[0] - a_[0]) * j / max(1, n)
                    yy = a_[1] + (b_[1] - a_[1]) * j / max(1, n)
                    t.px(xx, yy, 44 if j % 4 == 0 else T)
    # столик у окна: столешница и кромка — ниже решётки, коротким выступом у нашего места
    ty, tx, tz = SILL - 0.32, WALL_L + 0.16, 0.25
    s.quad([(WALL_L, ty, -1), (tx, ty, -1), (tx, ty, tz), (WALL_L, ty, tz)], 13)
    s.quad([(tx, ty, -1), (tx, ty - 0.035, -1), (tx, ty - 0.035, tz), (tx, ty, tz)], 12)
    s.quad([(WALL_L, ty, tz), (tx, ty, tz), (tx, ty - 0.035, tz), (WALL_L, ty - 0.035, tz)], 12)
    s.line((tx, ty, -1), (tx, ty, tz), 14)
    s.line((WALL_L, ty, tz), (tx, ty, tz), 14)
    # --- багажная полка слева: низ, кромка, лампочки и обдув над рядами
    s.quad([(WALL_L, RACK_Y, -1), (RACK_IN, RACK_Y, -1), (RACK_IN, RACK_Y, FRONT), (WALL_L, RACK_Y, FRONT)], 39)
    s.quad([(RACK_IN, RACK_Y, -1), (RACK_IN, RACK_Y + 0.12, -1), (RACK_IN, RACK_Y + 0.12, FRONT), (RACK_IN, RACK_Y, FRONT)], 41)
    s.line((RACK_IN, RACK_Y, -1), (RACK_IN, RACK_Y, FRONT), 43)
    s.line((RACK_IN, RACK_Y + 0.12, -1), (RACK_IN, RACK_Y + 0.12, FRONT), 42)
    for i, z in enumerate(ROW_Z[:-1]):
        z = z + 0.25
        s.quad([(-0.24, RACK_Y - 0.005, z), (-0.04, RACK_Y - 0.005, z), (-0.04, RACK_Y - 0.005, z + 0.12),
                (-0.24, RACK_Y - 0.005, z + 0.12)], 38)
        lx, ly = s.pt((-0.08, RACK_Y - 0.01, z + 0.06))
        t.px(lx, ly, 23 if i in (1, 4) else 43)
    # сумки на полке над нами — видны снизу кромки
    s.quad([(-0.3, RACK_Y + 0.3, 0.1), (RACK_IN + 0.02, RACK_Y + 0.3, 0.1), (RACK_IN + 0.02, RACK_Y + 0.01, 0.1),
            (-0.3, RACK_Y + 0.01, 0.1)], 27)
    # --- кресла и затылки: от дальних к ближним
    items = []
    for i, z in enumerate(ROW_Z):
        for (x0, x1) in LEFT_PAIR + RIGHT_PAIR:
            items.append((z, 'seat', (x0, x1, z, i)))
    for (x, z, kind) in HEADS:
        items.append((z, 'head', (x, z, kind)))
    for z, what, arg in sorted(items, key=lambda it: -it[0]):
        if what == 'seat':
            seat(s, *arg)
        else:
            head(s, *arg)
    # поручень над проходом справа
    s.line((1.0, 0.68, -1), (1.0, 0.68, FRONT), 43)
    s.line((1.0, 0.665, -1), (1.0, 0.665, FRONT), 40)
    # --- свои колени в джинсах внизу
    xs, ys = t.grid()
    knee = ((xs - 150) / 70) ** 2 + ((ys - 204) / 32) ** 2 <= 1
    t.a[knee] = 1
    t.a[knee & (((xs - 140) / 52) ** 2 + ((ys - 200) / 24) ** 2 <= 1)] = 2
    t.a[knee & (((xs - 128) / 22) ** 2 + ((ys - 186) / 7) ** 2 <= 1)] = 3
    t.a[knee & ~(((xs - 150) / 69) ** 2 + ((ys - 205) / 31) ** 2 <= 1)] = 0
    s.kind[knee] = 0
    sun = sunlight(s)
    return t, sun


# затылки: x, z (чуть впереди спинки ряда), кто
HEADS = [
    (-0.07, ROW_Z[0] + 0.3, 'woman'),
    (0.42, ROW_Z[1] + 0.3, 'cap'),
    (1.30, ROW_Z[0] + 0.3, 'bald'),
    (-0.08, ROW_Z[2] + 0.3, 'dark'),
    (1.72, ROW_Z[2] + 0.3, 'scarf'),
    (0.38, ROW_Z[4] + 0.3, 'woman'),
    (1.26, ROW_Z[4] + 0.3, 'cap'),
    (-0.1, ROW_Z[6] + 0.3, 'bald'),
]


def rrect(x0, y0, x1, y1, z, r_top, r_bot=0.0, n=4):
    """Скруглённый прямоугольник в плоскости z (метры): точки по контуру по часовой."""
    pts = []
    for cx, cy, r, a0 in ((x1 - r_top, y1 - r_top, r_top, 0), (x0 + r_top, y1 - r_top, r_top, 90),
                          (x0 + r_bot, y0 + r_bot, r_bot, 180), (x1 - r_bot, y0 + r_bot, r_bot, 270)):
        for k in range(n + 1):
            ang = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang), z))
    return pts


HEAD_H = 0.13          # подголовник над плечами спинки


def seat(s, x0, x1, z, i):
    """Кресло сзади: спинка со скруглёнными плечами, над ней подголовник в чехле, ручка у прохода, карман-сетка."""
    t = s.t
    gap = 0.018
    a, b = x0 + gap, x1 - gap
    right = x0 > 0.9
    aisle_l = right and abs(x0 - RIGHT_PAIR[0][0]) < 1e-6
    aisle_r = (not right) and abs(x1 - LEFT_PAIR[1][1]) < 1e-6
    far = i >= 5
    s.acc = np.zeros((BH, BW), bool)
    # боковой торец, видный из прохода (у кресел справа — левый) и кронштейн к полу
    if aisle_l:
        s.quad([(a, SEAT_TOP - 0.05, z), (a, SEAT_TOP - 0.05, z + 0.1), (a, FLOOR + 0.35, z + 0.1), (a, FLOOR + 0.35, z)], SEAT_S)
        s.quad([(a + 0.02, FLOOR + 0.36, z + 0.04), (a + 0.05, FLOOR + 0.36, z + 0.04), (a + 0.05, FLOOR, z + 0.04),
                (a + 0.02, FLOOR, z + 0.04)], 38)
    # подголовник: уже спинки, торчит над плечами
    ha, hb = a + 0.07, b - 0.07
    s.quad(rrect(ha, SEAT_TOP, hb, SEAT_TOP + HEAD_H, z + 0.01, 0.045), SEAT_S, (0, 0, 1), kind=1)
    # спинка
    s.quad(rrect(a, SEAT_LOW, b, SEAT_TOP, z, 0.06), SEAT, (0, 0, 1), kind=1)
    s.line((a + 0.01, SEAT_TOP - 0.06, z), (a + 0.01, SEAT_LOW, z), SEAT_L)
    s.line((b - 0.01, SEAT_TOP - 0.06, z), (b - 0.01, SEAT_LOW, z), SEAT_S)
    if not far:
        # узор обивки — редкие ромбики
        for r_, yy in enumerate(np.arange(SEAT_TOP - 0.16, SEAT_LOW + 0.05, -0.055)):
            for xx in np.arange(a + 0.05 + (0.0275 if r_ % 2 else 0), b - 0.03, 0.055):
                p = s.pt((xx, yy, z - 0.001))
                t.px(p[0], p[1], SEAT_S)
        # карман-сетка внизу спинки
        s.quad([(a + 0.06, -0.42, z - 0.005), (b - 0.06, -0.42, z - 0.005), (b - 0.06, SEAT_LOW + 0.05, z - 0.005),
                (a + 0.06, SEAT_LOW + 0.05, z - 0.005)], SEAT_S, (0, 0, 1), kind=1)
        s.line((a + 0.06, -0.42, z - 0.006), (b - 0.06, -0.42, z - 0.006), 1 if i else 39)
    # белый чехол: обтягивает подголовник и свисает на плечи спинки
    cov = rrect(ha - 0.012, SEAT_TOP - 0.09, hb + 0.012, SEAT_TOP + HEAD_H + 0.006, z - 0.012, 0.05, 0.0)
    s.quad(cov, COVER_S if far else COVER, (0, 0, 1), kind=1)
    if not far:
        s.line((ha - 0.01, SEAT_TOP - 0.09, z - 0.013), (hb + 0.01, SEAT_TOP - 0.09, z - 0.013), COVER_S)
        s.line((ha + 0.03, SEAT_TOP + HEAD_H, z - 0.013), (hb - 0.03, SEAT_TOP + HEAD_H, z - 0.013), COVER_L)
        s.line((ha - 0.005, SEAT_TOP + HEAD_H - 0.04, z - 0.013), (ha - 0.005, SEAT_TOP - 0.08, z - 0.013), COVER_L)
    if i <= 3:
        # логотип перевозчика на чехле — полоска
        s.quad([(ha + 0.05, SEAT_TOP + 0.03, z - 0.014), (hb - 0.05, SEAT_TOP + 0.03, z - 0.014),
                (hb - 0.05, SEAT_TOP + 0.012, z - 0.014), (ha + 0.05, SEAT_TOP + 0.012, z - 0.014)], 27)
    # ручка у прохода — скоба на плече спинки
    if (aisle_r or aisle_l) and i <= 6:
        hx = b - 0.035 if aisle_r else a + 0.035
        s.quad([(hx - 0.022, SEAT_TOP + 0.06, z - 0.02), (hx + 0.022, SEAT_TOP + 0.06, z - 0.02), (hx + 0.022, SEAT_TOP - 0.03, z - 0.02),
                (hx - 0.022, SEAT_TOP - 0.03, z - 0.02)], 40)
        s.line((hx - 0.022, SEAT_TOP + 0.06, z - 0.021), (hx + 0.022, SEAT_TOP + 0.06, z - 0.021), 44)
    # контур силуэта на ступень темнее — ряды не сливаются
    m = s.acc
    s.acc = None
    inner = m.copy()
    inner[1:] &= m[:-1]
    inner[:-1] &= m[1:]
    inner[:, 1:] &= m[:, :-1]
    inner[:, :-1] &= m[:, 1:]
    edge = m & ~inner
    t.a[edge] = darker(t.a[edge], 2 if i < 3 else 1)


def head(s, x, z, kind):
    t = s.t
    cx, cy = s.pt((x, 0.04, z))
    ex, _ = s.pt((x + 0.085, 0.04, z))
    _, ey = s.pt((x, 0.04 + 0.11, z))
    rx, ry = max(1.5, ex - cx), max(1.8, cy - ey)
    hair = {'woman': 20, 'cap': 19, 'bald': 15, 'scarf': 33, 'dark': 37}[kind]
    _, ny = s.pt((x, SEAT_TOP, z))
    t.rect(cx - rx * 0.3, cy, cx + rx * 0.3, ny, SKIN_D)                            # шея
    t.ellipse(cx - rx * 1.0, cy + ry * 0.1, max(0.8, rx * 0.22), max(0.9, ry * 0.26), SKIN_S)   # уши
    t.ellipse(cx + rx * 1.0, cy + ry * 0.1, max(0.8, rx * 0.22), max(0.9, ry * 0.26), SKIN_S)
    t.ellipse(cx, cy, rx, ry, hair)
    if kind == 'woman':
        t.ellipse(cx, cy - ry * 0.9, rx * 0.5, ry * 0.38, 19)                       # пучок
        t.ellipse(cx - rx * 0.35, cy - ry * 0.35, rx * 0.28, ry * 0.35, 21)        # блик
    elif kind == 'cap':
        t.ellipse(cx, cy - ry * 0.2, rx * 1.04, ry * 0.8, 7)                         # кепка
        t.rect(cx - rx * 0.2, cy + ry * 0.2, cx + rx * 0.2, cy + ry * 0.35, 6)
        t.ellipse(cx - rx * 0.35, cy - ry * 0.55, rx * 0.3, ry * 0.18, 8)
    elif kind == 'bald':
        t.ellipse(cx, cy + ry * 0.4, rx * 1.0, ry * 0.45, 42)                        # седина по бокам
        t.ellipse(cx - rx * 0.3, cy - ry * 0.45, rx * 0.3, ry * 0.2, SKIN_L)
    elif kind == 'scarf':
        t.ellipse(cx, cy + ry * 0.2, rx * 1.12, ry * 1.0, 33)
        t.ellipse(cx - rx * 0.35, cy - ry * 0.3, rx * 0.3, ry * 0.3, 34)
    elif kind == 'dark':
        t.ellipse(cx - rx * 0.3, cy - ry * 0.4, rx * 0.3, ry * 0.25, 38)


def sunlight(s):
    """Закатный свет из окон слева: для каждого пикселя спинки (и штор справа) — точка в салоне; луч к солнцу
    должен выйти через стекло левой стены и не упереться в спинку ряда позади. Слой — только освещённые пиксели,
    на ступень светлее и теплее."""
    t = s.t
    out = Tex(BW, BH)
    ys, xs = np.mgrid[0:BH, 0:BW]
    dx, dy, dz = ray(xs + 0.5, ys + 0.5)
    lit = np.zeros((BH, BW), bool)
    for pid, (n, c) in enumerate(s.planes):
        m = (s.plane == pid) & (s.kind > 0)
        if not m.any():
            continue
        den = n[0] * dx + n[1] * dy + n[2] * dz
        c0 = c - (n[0] * EYE[0] + n[1] * EYE[1] + n[2] * EYE[2])
        tt = np.where(np.abs(den) > 1e-6, c0 / np.where(np.abs(den) > 1e-6, den, 1), 0)
        px, py, pz = EYE[0] + dx * tt, EYE[1] + dy * tt, EYE[2] + dz * tt
        # к солнцу: p - u*SUN, до левой стены
        u = (px - WALL_L) / SUN[0]
        wy, wz = py - u * SUN[1], pz - u * SUN[2]
        ok = (wy > SILL) & (wy < WTOP - 0.17)
        inpane = np.zeros_like(ok)
        for z0, z1 in PANES:
            inpane |= (wz > z0 + 0.1) & (wz < z1 - 0.1)
        ok &= inpane
        # тень от ряда позади: луч пересекает плоскость его спинки ниже верха — темно
        for rz in [0.1] + ROW_Z:
            v = (pz - rz) / SUN[2]
            hit = (v > 0.02) & (v < u)
            hy, hx = py - v * SUN[1], px - v * SUN[0]
            inseat = ((hx > LEFT_PAIR[0][0]) & (hx < LEFT_PAIR[1][1])) | ((hx > RIGHT_PAIR[0][0]) & (hx < RIGHT_PAIR[1][1]))
            ok &= ~(hit & (hy < SEAT_TOP + 0.01) & inseat)
        lit |= m & ok
    base = t.a
    warm = lighter(base)
    for src, dst in {COVER: 45, COVER_S: 44, COVER_L: 45, SEAT: 3, SEAT_S: 2, SEAT_L: 4, CURT: 28, CURT_S: 27, 40: 41, 27: 28}.items():
        warm[base == src] = dst
    sel = lit & (base != T)
    out.a[sel] = warm[sel]
    return out


def rounded(t, x0, y0, x1, y1, r, c):
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    r = max(0, min(r, (x1 - x0) // 2, (y1 - y0) // 2))
    t.rect(x0 + r, y0, x1 - r, y1, c)
    t.rect(x0, y0 + r, x1, y1 - r, c)
    if r:
        for cx, cy in ((x0 + r, y0 + r), (x1 - r + 1, y0 + r), (x0 + r, y1 - r + 1), (x1 - r + 1, y1 - r + 1)):
            t.ellipse(cx, cy, r + 0.3, r + 0.3, c)


def build_field():
    """Наш берег за обочиной: поле в стерне, перелески и опушка; верх рощ заслоняет Каму. Лента 640×180, y — в кадре."""
    t = Tex(640, BH)
    xs, ys = t.grid()
    top = 89 + 2 * np.sin(xs / 37) + np.sin(xs / 11)
    field = ys >= top
    t.a[field] = 9
    t.a[field & (ys >= top + 6)] = 8
    t.a[field & (rng.random(t.a.shape) < 0.05)] = 21          # стерня
    for k in range(0, 640, 9):                                  # борозды
        t.a[field & (np.abs(ys - (top + 3 + (k % 27) / 3)) < 0.5) & (xs > k) & (xs < k + 6)] = 8
    # перелески и опушка: ряд крон-шапок, освещены сверху слева, редкие жёлтые и рыжие пятна осени
    for cx, w in ((40, 46), (150, 20), (250, 70), (390, 28), (470, 56), (590, 32)):
        for x in range(int(cx - w), int(cx + w), 5):
            r = rng.uniform(3.5, 6.5) * (1 - 0.5 * abs(x - cx) / w)
            cy = 89 - r * 1.2 - rng.uniform(0, 3) * (1 - abs(x - cx) / w)
            crown = ((xs - x) / r) ** 2 + ((ys - cy) / r) ** 2 <= 1
            t.a[crown | ((np.abs(xs - x) < r) & (ys > cy) & (ys < top + 1))] = 6
            lit = ((xs - x + r * 0.35) / (r * 0.7)) ** 2 + ((ys - cy + r * 0.35) / (r * 0.6)) ** 2 <= 1
            t.a[lit] = 7
            t.a[lit & (rng.random(t.a.shape) < 0.12)] = 22
            t.a[crown & (rng.random(t.a.shape) < 0.04)] = 28
    return t


def build_near():
    """У самой обочины: трава снизу и кусты, которые проносятся быстро — смазаны по ходу движения длинными
    горизонтальными мазками. Лента 960×180, y — в кадре (низ окна — 116)."""
    t = Tex(960, BH)
    xs, ys = t.grid()
    # трава обочины тянется снизу, местами выше
    grass = ys >= 109 + 3 * np.sin(xs / 41) + 1.5 * np.sin(xs / 9)
    t.a[grass] = 7
    t.a[grass & (ys > 114)] = 6
    for y in range(100, 122):
        for x in range(0, 960, 1):
            if rng.random() < 0.03 and grass[min(y + 2, BH - 1), x]:
                n = int(rng.integers(12, 30))
                t.rect(x, y, x + n, y, int(rng.choice([8, 9, 21])))
    for cx, w in NEAR_BUSHES:
        h = 10 + w // 3
        for y in range(116 - h, 117):
            u = (116 - y) / h
            half = w * math.sqrt(max(0.0, 1 - u * u)) * (1.4 - 0.4 * u)
            x0 = cx - half
            x = x0
            while x < cx + half:
                n = int(rng.integers(14, 34))
                c = int(rng.choice([6, 6, 7, 7, 8, 21, 22] if u > 0.35 else [6, 6, 7, 38]))
                t.rect(x, y, min(cx + half, x + n), y, c)
                x += n + (0 if rng.random() < 0.7 else int(rng.integers(1, 4)))
            # смазанный хвост против хода (вправо): редкие мазки
            for _ in range(2):
                tx = cx + half + rng.integers(0, 20)
                t.rect(tx, y, tx + rng.integers(3, 10), y, 6)
    return t


# ---------------------------------------------------------------------------------------------------
# телефон в правой руке: кадр 160×180, экран 84×144 (сверху на нём живой текст мессенджера)
# ---------------------------------------------------------------------------------------------------
PW, PH = 160, 180
SCREEN = (38, 14, 121, 157)
CASE, CASE_S, CASE_L = 22, 21, 23          # чехол горчичный — как рюкзак новенького
OUT_SKIN = 13


def build_phone(frame):
    t = Tex(PW, PH)
    x0, y0, x1, y1 = SCREEN
    bx0, by0, bx1, by1 = x0 - 5, y0 - 7, x1 + 5, y1 + 9
    xs, ys = t.grid()
    hand = Tex(PW, PH)
    # ладонь за телефоном: снизу справа, запястье уходит в правый нижний угол
    palm = ((xs - (bx1 - 2)) / 26) ** 2 + ((ys - (by1 + 2)) / 28) ** 2 <= 1
    wrist = (xs > bx1 - 10) & (ys > by1 - 6) & (xs - bx1 + 10 > (ys - by1 + 6) * 0.3)
    hand.a[palm | wrist] = SKIN
    hand.a[(palm | wrist) & (xs > bx1 + 12)] = SKIN_S
    # мизинец снизу под корпусом
    rounded(hand, bx0 + 4, by1 - 3, bx0 + 22, by1 + 5, 4, SKIN_S)
    outline_mask(hand, OUT_SKIN)
    t.a[hand.a != T] = hand.a[hand.a != T]
    # пальцы обхватывают корпус слева: четыре фаланги выглядывают из-за грани, каждая со своим контуром
    for k, (yy, ln) in enumerate(((98, 5), (110, 7), (122, 7), (134, 5))):
        f = Tex(PW, PH)
        m, u, side = capsule(f, (bx0 + 8, yy - 1), (bx0 - ln, yy + 4), 5.2, 4.4)
        f.a[m] = SKIN
        L = math.hypot(ln + 8, 3)
        f.a[m & (side / L < -2.6)] = SKIN_S                       # низ фаланги в тени
        f.a[m & (side / L > 3.0) & (u > 0.3)] = SKIN_L             # свет экрана сверху
        f.line([(bx0 - ln + 4, yy - 1), (bx0 - ln + 4, yy + 5)], SKIN_S)   # сгиб у кончика
        outline_mask(f, OUT_SKIN)
        t.a[f.a != T] = f.a[f.a != T]
    # корпус: чехол, рамка, стекло
    rounded(t, bx0, by0, bx1, by1, 9, CASE_S)
    rounded(t, bx0, by0, bx1 - 1, by1 - 1, 9, CASE)
    t.rect(bx0, by0 + 10, bx0, by1 - 10, CASE_L)                               # блик по левой грани
    t.rect(bx0 + 9, by0, bx1 - 12, by0, CASE_L)
    rounded(t, bx0 + 2, by0 + 2, bx1 - 2, by1 - 2, 7, 37)                      # чёрная рамка экрана
    rounded(t, bx0 + 3, by0 + 3, bx1 - 3, by1 - 3, 6, 36)
    # кнопки громкости и питания чуть торчат
    t.rect(bx0 - 1, by0 + 26, bx0 - 1, by0 + 34, CASE_S)
    t.rect(bx0 - 1, by0 + 38, bx0 - 1, by0 + 46, CASE_S)
    t.rect(bx1 + 1, by0 + 32, bx1 + 1, by0 + 44, CASE_S)
    # динамик и камера над экраном
    cx = (x0 + x1) // 2
    t.rect(cx - 7, by0 + 4, cx + 7, by0 + 4, 38)
    t.px(cx + 12, by0 + 4, 39)
    t.px(cx + 12, by0 + 3, 2)
    # блик стекла по рамке: светлая диагональ в правом верхнем углу
    for j in range(4):
        t.px(bx1 - 6 + j, by0 + 3 + j, 38)
    # выход экрана
    t.rect(x0, y0, x1, y1, 0)
    # большой палец вдоль правой грани: кончик на рамке, ноготь, свет экрана на подушечке
    tip_y = by1 - 44 if frame == 0 else by1 - 54
    thumb = Tex(PW, PH)
    m, u, side = capsule(thumb, (bx1 + 18, by1 + 8), (bx1 - 2, tip_y), 7.5, 4.4)
    thumb.a[m] = SKIN
    L = math.hypot(20, by1 + 8 - tip_y)
    sd = side / L
    thumb.a[m & (sd > 2.2)] = SKIN_S
    thumb.a[m & (sd < -2.6) & (u > 0.35)] = SKIN_L                              # свет от экрана
    nm, _, nside = capsule(thumb, (bx1 - 2 + 20 * 3.4 / L, tip_y + (by1 + 8 - tip_y) * 3.4 / L), (bx1 - 2, tip_y), 2.6, 2.0)
    thumb.a[nm & m] = 17
    thumb.a[nm & m & (nside / L > 1.2)] = SKIN
    thumb.line([(bx1 + 6, by1 - 10), (bx1 + 11, by1 - 3)], SKIN_S)             # складка у основания
    outline_mask(thumb, OUT_SKIN)
    t.a[thumb.a != T] = thumb.a[thumb.a != T]
    # рукав ветровки из правого нижнего угла, у манжеты светлая кромка
    cx_, cy_ = bx1 + 30, PH + 10
    sl = ((xs - cx_) / 24) ** 2 + ((ys - cy_) / 22) ** 2 <= 1
    t.a[sl] = JACK
    t.a[sl & (((xs - cx_ - 6) / 18) ** 2 + ((ys - cy_ - 4) / 14) ** 2 <= 1)] = JACK_S
    t.a[sl & ~(((xs - cx_) / 24) ** 2 + ((ys - cy_ - 2) / 22) ** 2 <= 1)] = JACK_L
    edge = grow(sl) & ~sl & (t.a == SKIN)
    t.a[edge] = 0
    # экран — ровный прямоугольник, поверх него ничего
    t.a[y0:y1 + 1, x0:x1 + 1] = 0
    return t


def capsule(t, p0, p1, r0, r1):
    xs, ys = t.grid()
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    u = np.clip(((xs - x0) * dx + (ys - y0) * dy) / L2, 0, 1)
    d = np.hypot(xs - (x0 + u * dx), ys - (y0 + u * dy))
    return d <= r0 + (r1 - r0) * u, u, (xs - x0) * dy - (ys - y0) * dx


def grow(m):
    g = m.copy()
    g[1:] |= m[:-1]
    g[:-1] |= m[1:]
    g[:, 1:] |= m[:, :-1]
    g[:, :-1] |= m[:, 1:]
    return g


def outline_mask(t, c):
    m = t.a != T
    t.a[grow(m) & ~m] = c


# ---------------------------------------------------------------------------------------------------
# превью: салон вечером со всеми слоями и телефоном — как в кадре (тонировка — та же, что в mood.ts)
# ---------------------------------------------------------------------------------------------------
def dusk_preview(out_path, assets, pov, sun, field, near, phone, view, shift=0):
    from apollo import RGB
    pal = np.array(RGB, float) / 255

    def nearest(c):
        r, g, b = np.clip(c, 0, 255) / 255
        m = (r + pal[:, 0]) * 0.5
        d = (2 + m) * (r - pal[:, 0]) ** 2 + 4 * (g - pal[:, 1]) ** 2 + (3 - m) * (b - pal[:, 2]) ** 2
        return int(np.argmin(d))
    lut = [nearest([r * 0.84 + 6, g * 0.74 + 4, b * 0.8 + 10]) for r, g, b in RGB]

    def tone(im):
        a = np.array(im.convert('RGBA'))
        rgb = a[..., :3].reshape(-1, 3)
        idx = {tuple(c): i for i, c in enumerate(RGB)}
        outp = rgb.copy()
        for k, c in enumerate(map(tuple, rgb)):
            if c in idx:
                outp[k] = RGB[lut[idx[c]]]
        a[..., :3] = outp.reshape(a.shape[0], a.shape[1], 3)
        return Image.fromarray(a, 'RGBA')

    canvas = Image.new('RGBA', (BW, BH), (9, 10, 20, 255))
    canvas.alpha_composite(Image.open(f'{assets}/sky_dusk.png').convert('RGBA'), (0, view))
    for name, par, img, dy in (('road_far', FAR_PAR, None, view), ('road_river', RIVER_PAR, None, view),
                               (None, FIELD_PAR, field, FIELD_DY), (None, NEAR_PAR, near, NEAR_DY)):
        im = tone(Image.open(f'{assets}/{name}.png')) if name else tone(img.image())
        layer = Image.new('RGBA', (BW, BH))
        off = int(shift * par) % im.width
        for x in range(-off, BW, im.width):
            layer.alpha_composite(im, (max(0, x), max(0, dy)), (max(0, -x), max(0, -dy), im.width, BH))
        canvas.alpha_composite(layer)
    canvas.alpha_composite(tone(pov.image()))
    canvas.alpha_composite(tone(sun.image()))
    if phone is not None:
        ph = phone.image()
        canvas.alpha_composite(ph, (BW // 2 - PW // 2 + 10, 0))
    canvas.resize((BW * 4, BH * 4), Image.NEAREST).save(out_path)
