"""Кофейня-коворкинг «Кофейня на Казанской» в Елабуге (src/game/world3d/rooms/cafe.ts): утро, 10:00, середина октября.

Солнечно, золотая осень. Перед нами — панорамное окно на старую Елабугу: купеческие дома в два этажа, золотые
берёзы, вдали колокольня собора; солнце ложится на общий дубовый стол косыми полосами. Слева барная стойка
с кофемашиной, меловое меню и витрина с выпечкой, справа кирпич, книжный шкаф и пара столиков с розетками.
Стены, пол, потолок, столешница и вид из окна — уникальные текстуры, мелочь — атлас в трёх вариантах света.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/room_cafe.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rooms_common import (R, T, Tex, band_shade, ellipse_mask, falloff, shade_levels, text_w, tint,  # noqa: E402
                          write_all, BAYER)
from room3d import BACK, FRONT, HGT, HW, S, TABLE, Atlas, solid, wood  # noqa: E402

rng = R.rng

PLACE = {
    # панорамное окно в дальней стене: x0 x1 y0 y1, импосты, фрамуга, глубина откоса
    'window': [-2.3, 2.3, 0.9, 2.5],
    'mullions': [-0.77, 0.77],
    'transom': 2.12,
    'bench': [-2.15, 2.15, 0.5, 0.45],  # x0 x1 глубина высота сиденья — мягкая скамья вдоль окна
    'cat': [0.32, 0.18],  # x и поворот рыжего кота, спящего на скамье
    'clock': [-2.78, 1.88],  # x y на дальней стене, левее окна
    'sign': [-1.0, 1.0, 2.6, 2.9],  # x0 x1 y0 y1 — вывеска над окном
    # барная стойка у левой стены: x0 x1 z0 z1 h
    'bar': [-2.95, -2.42, -2.2, 0.55, 1.02],
    'machine': [-2.7, -1.55],
    'grinder': [-2.72, -0.98],
    'vitrine': [-2.7, -0.22, 0.45],  # x, z0, z1 — витрина с выпечкой на стойке
    'menu': [-2.3, -0.75, 1.5, 2.2],  # z0 z1 y0 y1 на левой стене
    'cupshelf': [-2.3, -0.75, 1.3],
    'stools': [[-2.2, -1.75], [-2.2, -1.12]],
    # передняя стена: дверь x0 x1 h, вешалка
    'door': [-1.3, -0.4, 2.15],
    'coat': [-2.72, 1.95],
    'print': [0.6, 1.9, 1.15, 1.95],  # x0 x1 y0 y1 на передней стене
    # правая стена: книжный шкаф z0 z1 h d, полки, картина, столики
    'bookcase': [-2.25, -1.0, 2.1, 0.36],
    'shelves': [0.25, 1.55, 1.42, 1.82],  # z0 z1 y нижней и верхней полки
    'painting': [-0.75, 0.05, 1.25, 1.85],  # z0 z1 y0 y1 — «утро в сосновом лесу»
    'tables': [[2.45, 0.95], [2.32, -1.95]],
    'outlets': [[0.5, 0.32], [1.3, 0.32], [-0.35, 0.32]],  # z y розеток на правой стене
    'bigplant': [2.75, -2.42],
    'hanging': [[2.7, 0.2], [-1.95, -2.35]],
    'pendants': [[-0.8, -0.38], [0.8, -0.38], [-2.45, -1.55], [-2.45, -0.45], [2.45, 0.95], [2.32, -1.95]],
    'pendantY': 1.98,
    # на общем столе: капучино, суккулент, салфетки с сахаром, табличка с паролем, розеточный блок
    'cup': [0.6, -0.3],
    'succulent': [-1.18, -0.62],
    'napkins': [1.12, -0.66],
    'tent': [-0.72, -0.72, 0.35],
    'powerbox': [0.0, -0.78],
}
SUN = (0.32, -0.45)  # смещение солнечного луча по x и по y на метр вглубь комнаты (z)
# Вид из окна: дальний план (дома, собор, небо), облака и ближний (берёза у окна, фонарь)
VIEW = {
    'far': [-7.6, 7.6, 0.0, 5.3, -8.5],
    'clouds': [-7.6, 7.6, 3.6, 5.2, -8.4],
    'near': [-3.5, 3.5, 0.55, 3.05, -3.4],
}


# ======================================================================================================
# Атлас
# ======================================================================================================

def clock_face():
    """Деревянный обод, кремовый циферблат с крупными метками и кофейным зёрнышком."""
    t = Tex(40, 40, T)
    cx = cy = 20
    t.ellipse(cx, cy, 20, 20, 13)
    t.ellipse(cx, cy, 18.6, 18.6, 14)
    t.ellipse(cx, cy, 17, 17, 17)
    for i in range(12):
        a = i / 12 * 2 * np.pi
        r0 = 12.5 if i % 3 == 0 else 14
        for rr in np.arange(r0, 16.2, 0.5):
            t.px(cx + rr * np.sin(a), cy - rr * np.cos(a), 37 if i % 3 == 0 else 13)
    t.ellipse(cx, cy + 7, 2.2, 3, 13)  # зерно
    t.line([(cx, cy + 5), (cx - 0.5, cy + 9)], 17)
    return t


def leafy(t, cx, cy, n, spread, cols, rx=3.0, ry=1.6, rot=0.9):
    """Куст листьев эллипсами: cols — (тень, основной, блик)."""
    xs, ys = t.grid()
    pts = [(float(rng.normal(cx, spread[0])), float(rng.normal(cy, spread[1]))) for _ in range(n)]
    pts.sort(key=lambda p: p[1])
    for x, y in pts:
        a = rng.uniform(-rot, rot)
        dx, dy = xs - x, ys - y
        u = dx * np.cos(a) + dy * np.sin(a)
        v = -dx * np.sin(a) + dy * np.cos(a)
        m = (u / rx) ** 2 + (v / ry) ** 2 <= 1
        t.mask(m, cols[1])
        t.mask(m & (v > 0.5), cols[0])
        t.mask(m & (v < -0.7) & (u > 0), cols[2])


def items(at):
    for c in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28,
              29, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45):
        at.add(f'c{c}', solid(c))
    t = Tex(8, 8, 43)
    t.rect(0, 0, 7, 1, 45)
    t.rect(0, 6, 7, 7, 41)
    at.add('chrome', t)
    t = Tex(8, 8, 21)  # латунь
    t.rect(0, 0, 7, 1, 23)
    t.rect(0, 6, 7, 7, 19)
    at.add('brass', t)
    at.add('clock', clock_face())
    at.add('clock_rim', Tex(8, 4, 13))

    # ---------------------------------------------------------------- дерево: дуб, орех, кромка, подоконник
    t = Tex(16, 32, 15)
    wood(t, 0, 0, 15, 31, 15, 14, 16, 0.35, vertical=True)
    at.add('oak_v', t)
    t = Tex(32, 16, 15)
    wood(t, 0, 0, 31, 15, 15, 14, 16, 0.35)
    at.add('oak_h', t)
    t = Tex(16, 16, 13)
    wood(t, 0, 0, 15, 15, 13, 12, 14, 0.3)
    at.add('walnut', t)
    t = Tex(32, 4, 14)
    t.rect(0, 0, 31, 0, 16)
    t.rect(0, 3, 31, 3, 13)
    at.add('tedge', t)
    t = Tex(32, 8, 16)
    wood(t, 0, 0, 31, 7, 16, 15, 17, 0.3)
    t.rect(0, 7, 31, 7, 15)
    at.add('sill', t)
    t = Tex(8, 8, 13)  # рама окна: тёмное дерево
    t.rect(0, 0, 7, 0, 14)
    t.rect(0, 7, 7, 7, 12)
    at.add('wframe', t)
    t = Tex(8, 8, 17)  # откос: светлая штукатурка, к стеклу ярче
    t.rect(0, 0, 7, 7, 16)
    t.rect(0, 0, 2, 7, 17)
    at.add('jamb', t)
    # ---------------------------------------------------------------- скамья у окна: фасад, подушки, кот
    t = Tex(96, 16, 15)
    for x in range(0, 96, 6):
        t.rect(x, 0, x, 13, 16)
        t.rect(x + 5, 0, x + 5, 13, 14)
    t.rect(0, 0, 95, 1, 16)
    t.rect(0, 2, 95, 2, 13)
    t.rect(0, 13, 95, 15, 12)  # тёмный цоколь
    for x in range(8, 96, 24):  # решётка батареи под скамьёй
        t.rect(x, 5, x + 9, 10, 13)
        for xx in range(x + 1, x + 9, 2):
            t.rect(xx, 6, xx, 9, 12)
    at.add('bench_front', t)
    t = Tex(96, 6, 7)  # сиденье: бутылочно-зелёный бархат, швы
    t.rect(0, 0, 95, 0, 8)
    t.rect(0, 5, 95, 5, 6)
    for x in range(0, 96, 16):
        t.rect(x, 1, x, 4, 6)
    at.add('cushion_f', t)
    t = Tex(96, 12, 8)
    t.noise(0, 0, 95, 11, 7, 0.06)
    t.rect(0, 11, 95, 11, 9)
    for x in range(0, 96, 16):
        t.rect(x, 0, x, 11, 7)
        t.rect(x + 1, 0, x + 1, 11, 9)
    at.add('cushion_top', t)

    def pillow(base, hi, lo, pattern):
        t = Tex(20, 16, base)
        t.rect(0, 0, 19, 0, hi)
        t.rect(0, 15, 19, 15, lo)
        t.rect(0, 0, 0, 15, hi)
        t.rect(19, 0, 19, 15, lo)
        pattern(t)
        t.px(0, 0, T)
        t.px(19, 0, T)
        t.px(0, 15, T)
        t.px(19, 15, T)
        return t

    def tulip(t):  # татарский тюльпан
        t.line([(10, 14), (10, 7)], 8)
        t.poly([(6, 7), (8, 3), (10, 5), (12, 3), (14, 7), (10, 9)], 27)
        t.px(10, 5, 29)
        t.poly([(10, 12), (5, 9), (7, 12)], 9)
        t.poly([(10, 11), (15, 8), (13, 12)], 9)
        for x in range(2, 19, 4):
            t.px(x, 2, 22)
            t.px(x, 13, 22)

    def stripes(t):
        for y in range(3, 14, 3):
            t.rect(1, y, 18, y, 17)

    def dots(t):
        for y in range(3, 14, 4):
            for x in range(3 + (y // 4) % 2 * 2, 18, 4):
                t.px(x, y, 17)

    def knit(t):
        for x in range(2, 19, 3):
            for y in range(1, 15, 2):
                t.px(x + (y // 2) % 2, y, 44)

    at.add('pillow_tulip', pillow(17, 45, 16, tulip))
    at.add('pillow_mustard', pillow(22, 23, 21, dots))
    at.add('pillow_rust', pillow(28, 29, 27, stripes))
    at.add('pillow_knit', pillow(43, 45, 42, knit))
    t = Tex(16, 16, 27)  # плед в клетку
    for k in range(0, 16, 5):
        t.rect(k, 0, k + 1, 15, 17)
        t.rect(0, k, 15, k + 1, 17)
        t.rect(k, k, k + 1, k + 1, 26)
    at.add('plaid', t)
    # рыжий кот спит клубком на скамье
    t = Tex(26, 14, T)
    t.ellipse(14, 9, 11, 5, 21)
    t.ellipse(14, 7.5, 9, 3.5, 22)
    for x in (9, 13, 17, 21):
        t.line([(x, 4), (x - 1, 8)], 20)
    t.ellipse(5.5, 8.5, 4.6, 4, 21)  # голова, уткнулась в бок
    t.ellipse(5, 7.5, 3.2, 2.6, 22)
    t.poly([(2, 6), (3, 2), (5, 5)], 21)
    t.poly([(6, 5), (8, 2), (9, 6)], 21)
    t.px(3, 4, 28)
    t.px(7, 4, 28)
    t.line([(3, 9), (5, 9)], 20)  # закрытый глаз
    t.px(6, 10, 34)
    t.line([(24, 11), (22, 13), (14, 13), (8, 12)], 21)  # хвост вокруг лап
    t.line([(9, 13), (14, 13)], 23)
    t.rect(12, 12, 15, 13, 17)  # белые лапки
    at.add('cat', t)

    # ---------------------------------------------------------------- растения
    t = Tex(44, 40, T)  # потос свисает с подоконника
    leafy(t, 22, 12, 34, (8, 4), (7, 8, 9), 3.0, 2.0)
    for (x0, x1) in ((8, 6), (16, 15), (30, 33), (37, 40)):
        t.line([(x0 + 4, 14), (x1, 36)], 7)
        for k in range(16, 37, 5):
            xx = x0 + 4 + (x1 - x0 - 4) * (k - 14) / 22
            t.ellipse(xx + (1 if k % 2 else -1), k, 2, 1.4, 8 if k % 3 else 9)
    at.add('pothos', t)
    t = Tex(18, 34, T)  # сансевиерия: торчащие листья с жёлтой каймой
    for x0, top, lean in ((3, 6, -2), (6, 1, 0), (9, 4, 1), (12, 0, 2), (15, 8, 3)):
        t.poly([(x0, 33), (x0 + 2.4, 33), (x0 + 1.4 + lean, top), (x0 + 0.6 + lean, top)], 8)
        t.line([(x0, 33), (x0 + lean + 0.6, top + 1)], 10)
        t.line([(x0 + 2, 33), (x0 + lean + 1.6, top + 3)], 7)
    at.add('snake', t)
    t = Tex(56, 76, T)  # монстера в углу
    for (x1, y1) in ((10, 20), (22, 6), (34, 4), (46, 16), (16, 40), (42, 36), (28, 24)):
        t.line([(28, 75), (x1 + 2, y1 + 8)], 7)
    for (cx, cy, r) in ((12, 22, 9), (24, 10, 10), (36, 9, 9), (46, 20, 8), (16, 42, 10), (42, 40, 9), (29, 27, 10),
                        (30, 50, 8)):
        t.ellipse(cx, cy, r, r * 0.8, 8)
        t.ellipse(cx - 1, cy - 1, r * 0.75, r * 0.55, 9)
        for k in (-1, 1):  # прорези
            t.line([(cx + k * r * 0.4, cy - 2), (cx + k * r * 0.95, cy - 3)], T)
            t.line([(cx + k * r * 0.4, cy + 2), (cx + k * r * 0.95, cy + 3)], T)
        t.line([(cx, cy - r * 0.6), (cx, cy + r * 0.6)], 7)
    at.add('monstera', t)
    t = Tex(36, 34, T)  # папоротник в подвесном кашпо
    t.line([(18, 0), (18, 8)], 37)
    t.ellipse(18, 11, 7, 4, 13)
    t.rect(11, 9, 25, 11, 14)
    for k, (dx, dy) in enumerate(((-16, 14), (-10, 22), (-3, 22), (4, 22), (11, 21), (16, 13), (-14, 4), (14, 4))):
        pts = [(18 + dx * f, 10 + dy * f + 6 * f * f) for f in np.linspace(0, 1, 7)]
        t.line(pts, 8)
        for (x, y) in pts[1:]:
            t.px(x - 1, y, 9)
            t.px(x + 1, y + 1, 7)
    at.add('fern', t)
    t = Tex(16, 8, 26)  # терракотовый горшок
    t.rect(0, 0, 15, 1, 28)
    t.rect(0, 2, 15, 2, 25)
    t.rect(2, 3, 3, 7, 27)
    at.add('pot_t', t)
    t = Tex(16, 8, 44)  # белый горшок
    t.rect(0, 0, 15, 0, 45)
    t.rect(2, 2, 3, 7, 45)
    t.rect(13, 1, 15, 7, 43)
    at.add('pot_w', t)
    t = Tex(16, 16, 12)
    t.noise(0, 0, 15, 15, 13, 0.3)
    at.add('soil', t)
    t = Tex(18, 14, T)  # тыква на подоконнике
    t.ellipse(9, 8.5, 8.5, 5.5, 21)
    for x in (4, 9, 14):
        t.line([(x, 4), (x + (x - 9) * 0.2, 13)], 20)
    t.ellipse(6, 7, 2, 2.5, 22)
    t.rect(8, 0, 9, 3, 13)
    t.px(10, 1, 9)
    at.add('pumpkin', t)
    t = Tex(14, 28, T)  # банка с осенними ветками
    t.rect(3, 16, 10, 27, 5)
    t.rect(3, 16, 3, 27, 45)
    t.rect(10, 16, 10, 27, 4)
    t.rect(4, 25, 9, 26, 3)
    for (x0, x1, y1) in ((5, 1, 3), (7, 7, 0), (8, 12, 4)):
        t.line([(x0, 18), (x1, y1)], 13)
        for (lx, ly, c) in ((x1, y1, 22), (x1 + 1, y1 + 2, 23), ((x0 + x1) / 2, (18 + y1) / 2, 21)):
            t.ellipse(lx, ly, 1.6, 1.2, c)
    at.add('jar_leaves', t)
    t = Tex(14, 12, T)  # суккулент на столе
    for (cx, cy, r, c) in ((7, 7, 5, 9), (4, 6, 3, 10), (10, 6, 3, 10), (7, 4, 3, 10), (7, 7, 2, 11)):
        t.ellipse(cx, cy, r, r * 0.7, c)
    t.px(5, 3, 34)
    t.px(10, 4, 34)
    at.add('succulent', t)
    t = Tex(16, 8, 41)  # бетонный горшочек
    t.rect(0, 0, 15, 1, 43)
    t.noise(0, 2, 15, 7, 40, 0.15)
    at.add('pot_c', t)

    # ---------------------------------------------------------------- стойка: фасад из реек, столешница, кофемашина
    t = Tex(108, 40, 14)
    for x in range(0, 108, 4):
        wood(t, x, 0, x + 2, 39, 14, 13, 15, 0.08, vertical=True)
        t.rect(x, 0, x, 39, 15)
        t.rect(x + 3, 0, x + 3, 39, 12)
    t.rect(0, 0, 107, 1, 37)
    t.rect(0, 36, 107, 39, 37)  # цоколь
    t.rect(0, 33, 107, 33, 21)  # латунная подножка
    t.rect(0, 34, 107, 34, 19)
    at.add('bar_front', t)
    t = Tex(24, 40, 14)
    for x in range(0, 24, 4):
        wood(t, x, 0, x + 2, 39, 14, 13, 15, 0.08, vertical=True)
        t.rect(x + 3, 0, x + 3, 39, 12)
    t.rect(0, 36, 23, 39, 37)
    at.add('bar_side', t)
    t = Tex(32, 16, 12)
    wood(t, 0, 0, 31, 15, 13, 12, 14, 0.4)
    t.rect(0, 0, 31, 0, 14)
    at.add('bar_top', t)
    # кофемашина: красная, с хромом, два холдера, манометр, на крыше чашки
    t = Tex(36, 26, 43)
    t.rect(0, 0, 35, 2, 45)
    t.rect(0, 3, 35, 16, 27)
    t.rect(0, 3, 35, 3, 28)
    t.rect(0, 16, 35, 16, 26)
    t.ellipse(18, 9, 3.5, 3.5, 44)
    t.ellipse(18, 9, 2.5, 2.5, 45)
    t.line([(18, 9), (19.5, 7.5)], 27)
    for x in (6, 30):
        t.rect(x - 2, 6, x + 2, 8, 44)
        t.rect(x - 1, 17, x + 1, 20, 37)  # группа и холдер
        t.rect(x - 4, 19, x + 4, 20, 38)
    t.rect(0, 21, 35, 25, 40)  # поддон
    t.rect(0, 21, 35, 21, 44)
    for x in range(2, 35, 3):
        t.px(x, 23, 38)
    t.text(12, 12, 'ЕЛ', 45)
    at.add('machine', t)
    t = Tex(24, 26, 26)
    t.rect(0, 0, 23, 2, 44)
    t.rect(0, 3, 23, 3, 27)
    t.rect(0, 21, 23, 25, 40)
    t.rect(20, 5, 21, 14, 25)
    at.add('machine_side', t)
    t = Tex(36, 24, 43)  # крыша: решётка, чашки донышками вверх
    for x in range(0, 36, 2):
        t.rect(x, 0, x, 23, 42)
    for (cx, cy) in ((6, 7), (13, 7), (20, 7), (27, 7), (9, 16), (16, 16), (23, 16), (30, 16)):
        t.ellipse(cx, cy, 3, 3, 45)
        t.ellipse(cx, cy, 1.6, 1.6, 44)
    at.add('machine_top', t)
    t = Tex(14, 30, T)  # кофемолка: прозрачный бункер с зёрнами, чёрный корпус
    t.poly([(2, 0), (12, 0), (10, 10), (4, 10)], 4)
    t.poly([(3, 3), (11, 3), (9.6, 10), (4.4, 10)], 12)
    t.noise(3, 3, 11, 10, 13, 0.4, on=12)
    t.rect(2, 0, 3, 9, 5)
    t.rect(3, 11, 10, 22, 37)
    t.rect(4, 12, 9, 13, 38)
    t.rect(4, 16, 9, 18, 36)
    t.rect(1, 26, 12, 29, 37)
    t.rect(5, 23, 8, 25, 38)
    at.add('grinder', t)
    # витрина с выпечкой: со стороны зала — стекло, полки с чак-чаком, круассанами, эклерами
    t = Tex(32, 22, 44)
    t.rect(0, 0, 31, 21, 41)
    t.rect(1, 1, 30, 18, 5)
    t.rect(1, 9, 30, 9, 44)
    for (x, c, kind) in ((2, 22, 'chak'), (11, 21, 'cro'), (20, 12, 'ecl')):
        if kind == 'chak':
            t.ellipse(x + 3.5, 6.5, 3.5, 2.2, 22)
            t.noise(x, 4, x + 7, 8, 23, 0.4, on=22)
            t.noise(x, 4, x + 7, 8, 21, 0.25, on=22)
        elif kind == 'cro':
            for k in range(2):
                t.ellipse(x + 2 + k * 4, 7, 2.2, 1.6, 21)
                t.px(x + 2 + k * 4, 6, 22)
        else:
            for k in range(3):
                t.rect(x + k * 3, 6, x + k * 3 + 2, 7, 12)
                t.px(x + k * 3, 6, 13)
    for (x, c) in ((2, 16), (8, 27), (14, 22), (20, 16), (26, 12)):  # нижняя полка: булочки, пирожки, тарт
        t.ellipse(x + 2, 15, 2.6, 1.8, c)
        t.px(x + 1, 14, 17 if c != 17 else 45)
    t.rect(1, 1, 2, 17, 45)
    t.line([(6, 17), (12, 2)], 45)
    for x in (4, 13, 22):
        t.rect(x, 9, x + 4, 10, 45)  # ценники
    t.rect(0, 19, 31, 21, 13)
    at.add('vitrine', t)
    t = Tex(16, 22, 41)
    t.rect(1, 1, 14, 18, 5)
    t.rect(1, 9, 14, 9, 44)
    t.rect(0, 19, 15, 21, 13)
    at.add('vitrine_side', t)
    t = Tex(16, 32, 5)
    t.frame(0, 0, 15, 31, 41)
    t.line([(3, 28), (12, 3)], 45)
    at.add('vitrine_top', t)
    # полка с чашками и банками зёрен (вешается на стену над стойкой)
    t = Tex(64, 12, T)
    x = 1
    for k in range(10):
        if k in (3, 7):
            t.rect(x, 1, x + 5, 11, 4)  # банка с зёрнами
            t.rect(x + 1, 3, x + 4, 11, 12)
            t.noise(x + 1, 3, x + 4, 11, 13, 0.4, on=12)
            t.rect(x, 0, x + 5, 1, 13)
            t.rect(x + 1, 6, x + 4, 7, 17)
            x += 7
        else:
            c = (45, 45, 3, 45, 21, 45, 45, 35)[k % 8]
            t.rect(x, 6, x + 4, 11, c)
            t.rect(x, 6, x + 4, 6, 44 if c == 45 else c)
            t.rect(x + 5, 7, x + 5, 9, c)
            t.rect(x + 4, 7, x + 4, 11, 43 if c == 45 else 41)
            x += 6 + (k % 2)
    at.add('cupsrow', t)
    # меловое меню
    t = Tex(128, 56, 38)
    t.noise(0, 0, 127, 55, 37, 0.06)
    t.noise(0, 0, 127, 55, 39, 0.03)
    t.frame(0, 0, 127, 55, 13)
    t.frame(1, 1, 126, 54, 14)
    t.text(4, 4, 'КОФЕ', 45, 2)
    col1 = (('ЭСПРЕССО', '120'), ('КАПУЧИНО', '190'), ('ЛАТТЕ', '210'), ('РАФ', '230'), ('ФИЛЬТР', '150'))
    for i, (n, p) in enumerate(col1):
        y = 17 + i * 7
        t.text(4, y, n, 44)
        t.text(52 - text_w(p), y, p, 22)
    t.line([(4, 15), (52, 15)], 41)
    t.text(66, 4, 'ЧАЙ', 45, 2)
    col2 = (('ЧЁРНЫЙ', '150'), ('ИВАН-ЧАЙ', '170'), ('С ЧАБРЕЦОМ', '180'))
    for i, (n, p) in enumerate(col2):
        y = 17 + i * 7
        t.text(66, y, n, 44)
        t.text(124 - text_w(p), y, p, 22)
    t.line([(66, 15), (124, 15)], 41)
    t.rect(66, 39, 124, 50, 37)
    t.text(68, 40, 'ЧАК-ЧАК', 23, 1)
    t.text(124 - text_w('140'), 40, '140', 22)
    t.text(68, 46, 'ЭЧПОЧМАК', 35)
    t.text(124 - text_w('160'), 46, '160', 22)
    for (cx, cy) in ((44, 8), (110, 8)):  # чашка мелом
        t.rect(cx - 3, cy - 1, cx + 2, cy + 3, 44)
        t.rect(cx - 2, cy, cx + 1, cy + 2, 38)
        t.rect(cx + 3, cy, cx + 3, cy + 1, 44)
        t.line([(cx - 1, cy - 2), (cx, cy - 4)], 43)
    t.line([(4, 51), (40, 51)], 34)
    at.add('menu', t)

    # ---------------------------------------------------------------- стулья, табуреты, столики
    t = Tex(24, 32, T)  # венский стул: гнутая спинка-петля
    t.ellipse(12, 12, 11.5, 11.5, 13)
    t.ellipse(12, 12, 9.5, 9.5, T)
    t.ellipse(12, 12, 6, 7.5, 13)
    t.ellipse(12, 12, 4.4, 6, T)
    t.rect(1, 12, 2, 31, 13)
    t.rect(21, 12, 22, 31, 13)
    t.rect(2, 8, 3, 14, 14)
    at.add('thonet', t)
    t = Tex(16, 16, 14)
    t.ellipse(8, 8, 7.5, 7.5, 15)
    t.ellipse(8, 8, 5, 5, 14)
    at.add('seat_round', t)
    t = Tex(16, 16, 26)  # кожаное сиденье табурета
    t.ellipse(8, 8, 7.5, 7.5, 27)
    t.ellipse(6, 6, 3, 3, 28)
    at.add('stool_top', t)
    t = Tex(24, 24, 13)  # круглая столешница столика
    wood(t, 0, 0, 23, 23, 13, 12, 14, 0.35)
    t.ellipse(12, 12, 11, 11, T)
    m = t.a == T
    t.a[m] = 14
    wood(t, 0, 0, 23, 23, 14, 13, 15, 0.3)
    t.a[~ellipse_mask(t, 12, 12, 11, 11)] = 13
    at.add('round_top', t)

    # ---------------------------------------------------------------- посуда и мелочь на столах
    t = Tex(24, 8, 45)  # белая чашка
    t.rect(0, 0, 23, 0, 44)
    t.rect(0, 7, 23, 7, 43)
    t.rect(16, 1, 23, 7, 44)
    at.add('cup', t)
    t = Tex(12, 12, 44)  # капучино: пенка с сердечком
    t.ellipse(6, 6, 5.5, 5.5, 15)
    t.ellipse(6, 6, 4.5, 4.5, 16)
    t.ellipse(4.6, 5, 1.8, 1.8, 17)
    t.ellipse(7.4, 5, 1.8, 1.8, 17)
    t.poly([(3, 5.5), (9, 5.5), (6, 9)], 17)
    at.add('capp', t)
    t = Tex(16, 16, 45)
    t.ellipse(8, 8, 7, 7, 44)
    t.ellipse(8, 8, 5, 5, 45)
    at.add('saucer', t)
    t = Tex(12, 8, 44)  # салфетница
    t.rect(1, 0, 10, 7, 45)
    t.rect(0, 4, 11, 7, 13)
    at.add('napkins', t)
    t = Tex(8, 12, 5)  # сахар в стекле
    t.rect(1, 3, 6, 11, 45)
    t.rect(0, 0, 7, 2, 43)
    t.rect(6, 3, 6, 11, 4)
    at.add('sugar', t)
    t = Tex(24, 16, 17)  # табличка: вай-фай и пароль
    t.frame(0, 0, 23, 15, 15)
    for r in (7, 5, 3):
        for a in np.linspace(-0.8, 0.8, 9):
            t.px(12 + r * np.sin(a), 8 - r * np.cos(a), 13)
    t.rect(11, 7, 12, 8, 13)
    t.text(12 - text_w('КОФЕ') // 2, 10, 'КОФЕ', 26)
    at.add('tent', t)
    t = Tex(16, 8, 38)  # розеточный блок в столе
    t.rect(0, 0, 15, 0, 40)
    for x in (2, 9):
        t.rect(x, 2, x + 4, 6, 44)
        t.px(x + 1, 4, 38)
        t.px(x + 3, 4, 38)
    at.add('powerbox', t)
    t = Tex(8, 8, 44)  # розетка
    t.frame(0, 0, 7, 7, 42)
    t.px(2, 4, 38)
    t.px(5, 4, 38)
    at.add('outlet', t)
    t = Tex(32, 6, 44)  # удлинитель с вилками
    t.rect(0, 0, 31, 0, 45)
    t.rect(0, 5, 31, 5, 42)
    for x in (2, 9, 16, 23):
        t.rect(x, 1, x + 4, 4, 43)
    t.rect(3, 1, 5, 4, 37)
    t.rect(17, 1, 19, 4, 37)
    t.px(30, 2, 27)
    at.add('strip', t)
    t = Tex(16, 12, 37)  # закрытый ноутбук соседа
    t.rect(0, 0, 15, 0, 39)
    t.rect(6, 5, 9, 6, 40)
    at.add('laptop_shut', t)
    t = Tex(16, 12, 3)  # книжка на столике
    t.rect(0, 0, 15, 11, 2)
    t.rect(1, 1, 14, 10, 3)
    t.rect(3, 4, 12, 5, 17)
    at.add('book_top', t)

    # ---------------------------------------------------------------- лампы, вывеска, книжный шкаф, полки, картина
    t = Tex(24, 10, 7)  # абажур: тёмно-зелёный эмалированный, внутри латунь
    t.rect(0, 0, 23, 1, 8)
    t.rect(0, 8, 23, 9, 21)
    t.rect(3, 2, 4, 7, 9)
    at.add('shade', t)
    t = Tex(8, 8, 23)
    t.ellipse(4, 4, 3, 3, 45)
    at.add('bulb', t)
    t = Tex(96, 16, 13)  # вывеска над окном изнутри
    wood(t, 0, 0, 95, 15, 13, 12, 14, 0.3)
    t.frame(0, 0, 95, 15, 12)
    s1 = 'КОФЕЙНЯ НА КАЗАНСКОЙ'
    t.text(48 - text_w(s1) // 2, 3, s1, 23)
    t.rect(10, 10, 85, 10, 21)
    for x in (6, 89):
        t.ellipse(x, 8, 2, 2.6, 21)
        t.px(x, 7, 13)
    t.text(48 - text_w('С 2019') // 2, 11, 'С 2019', 16) if False else None
    at.add('sign', t)
    t = Tex(50, 84, 13)  # книжный шкаф во всю высоту
    t.frame(0, 0, 49, 83, 12)
    shelves = ((2, 18), (20, 36), (38, 54), (56, 70), (72, 81))
    for si, (top, bot) in enumerate(shelves):
        t.rect(2, top, 47, bot, 36)
        t.rect(2, top, 47, top, 37)
        x = 3
        palette = [26, 2, 15, 9, 21, 33, 44, 13, 27, 3, 17, 7]
        i = si * 3
        while x < 46:
            if si == 1 and 20 <= x < 33:  # цветок в горшке
                t.rect(22, bot - 4, 30, bot, 26)
                t.rect(22, bot - 4, 30, bot - 4, 28)
                leafy(t, 26, bot - 8, 10, (3, 2), (7, 8, 10), 2.4, 1.3)
                x = 33
                continue
            if si == 3 and 30 <= x < 46:  # стопка лёжа и кружка
                for k, c in enumerate((2, 21, 26)):
                    t.rect(31, bot - 2 - k * 2, 42, bot - 1 - k * 2, c)
                t.rect(43, bot - 5, 46, bot, 45)
                break
            if si == 4 and x > 26:  # коробки с настолками
                t.rect(27, top + 2, 46, bot, 27)
                t.rect(28, top + 3, 45, top + 4, 22)
                break
            c = palette[i % len(palette)]
            hh = int(rng.integers(bot - top - 6, bot - top))
            bw = int(rng.integers(2, 4))
            t.rect(x, bot - hh, x + bw - 1, bot, c)
            t.px(x, bot - hh + 2, 45 if c not in (44, 45) else 38)
            t.rect(x + bw - 1, bot - hh, x + bw - 1, bot, 36 if c in (2, 26, 7, 13) else c - 1 if c not in (0, 6, 12, 18, 24, 30, 36) else c)
            x += bw + (1 if rng.random() < 0.2 else 0)
            i += 1
        t.rect(1, bot + 1, 48, bot + 1, 14)
    at.add('bookcase', t)
    t = Tex(16, 32, 13)
    t.rect(0, 0, 15, 0, 14)
    t.rect(0, 31, 15, 31, 12)
    at.add('bookcase_side', t)
    t = Tex(48, 12, T)  # книги на полке стоя
    x = 0
    for k in range(14):
        c = (2, 26, 15, 9, 21, 33, 44, 13, 27, 3, 17, 7, 22, 35)[k]
        hh = int(rng.integers(8, 12))
        t.rect(x, 12 - hh, x + 2, 11, c)
        t.px(x + 1, 13 - hh, 45 if c != 44 else 38)
        x += 3 + (k % 4 == 3)
        if x > 45:
            break
    at.add('bookrow', t)
    # картина «утро в сосновом лесу» (без медведей) в золочёной раме
    t = Tex(44, 34, 21)
    t.frame(0, 0, 43, 33, 19)
    t.frame(2, 2, 41, 31, 22)
    t.rect(3, 3, 40, 30, 11)
    t.rect(3, 3, 40, 12, 17)
    t.rect(3, 12, 40, 20, 10)
    t.checker(3, 11, 40, 13, 17)
    for (x, w_) in ((6, 2), (12, 3), (19, 2), (27, 3), (35, 2)):
        t.rect(x, 3, x + w_, 30, 13)
        t.rect(x, 3, x, 30, 20)
        leafy(t, x + 1, 6, 6, (3, 2), (6, 7, 8), 3, 1.4)
    t.rect(3, 26, 40, 30, 8)
    t.line([(14, 28), (34, 23)], 13)  # поваленная сосна
    t.line([(14, 29), (34, 24)], 12)
    at.add('painting', t)
    t = Tex(52, 32, 15)  # принт на передней стене: акварель Елабуги — колокольня и Кама
    t.frame(0, 0, 51, 31, 37)
    t.rect(2, 2, 49, 29, 45)
    t.rect(4, 4, 47, 27, 5)
    t.rect(4, 19, 47, 27, 3)
    t.rect(4, 17, 47, 19, 22)
    t.rect(30, 6, 33, 18, 45)
    t.poly([(29, 7), (34, 7), (31.5, 2)], 23)
    t.rect(26, 12, 37, 18, 44)
    t.rect(8, 14, 20, 18, 21)
    t.text(5, 22, 'ЕЛАБУГА', 1)
    at.add('print', t)
    # дверь: дерево, верх застеклён — за ним светлая улица
    t = Tex(36, 86, 14)
    wood(t, 0, 0, 35, 85, 14, 13, 15, 0.3, vertical=True)
    t.frame(0, 0, 35, 85, 12)
    t.rect(5, 5, 30, 44, 12)
    t.rect(6, 6, 29, 43, 5)
    t.rect(6, 28, 29, 43, 22)
    t.rect(6, 34, 29, 43, 16)
    t.line([(8, 41), (14, 8)], 45)
    t.rect(17, 6, 18, 43, 12)
    t.frame(5, 50, 30, 80, 13)
    t.rect(30, 50, 32, 58, 21)  # ручка
    t.text(18 - text_w('ОТКРЫТО') // 2, 47, 'ОТКРЫТО', 23) if text_w('ОТКРЫТО') < 30 else None
    at.add('door_c', t)
    # пальто на вешалке, шарф, зонт
    t = Tex(30, 56, T)
    t.poly([(7, 5), (23, 5), (28, 55), (2, 55)], 15)
    t.poly([(10, 5), (15, 5), (15, 55), (6, 55)], 14)
    t.rect(14, 8, 15, 55, 13)
    for y in (18, 28, 38):
        t.px(17, y, 12)
    t.poly([(9, 0), (21, 0), (23, 10), (7, 10)], 27)  # шарф
    t.poly([(17, 8), (21, 8), (22, 30), (18, 30)], 27)
    for y in range(10, 30, 4):
        t.rect(17, y, 22, y, 22)
    at.add('coat', t)
    t = Tex(26, 50, T)
    t.poly([(6, 4), (20, 4), (24, 49), (2, 49)], 7)
    t.poly([(6, 4), (12, 4), (11, 49), (3, 49)], 6)
    t.rect(12, 6, 12, 49, 6)
    t.ellipse(13, 5, 7, 4, 6)
    at.add('parka', t)
    t = Tex(10, 36, T)
    t.poly([(5, 2), (9, 28), (1, 28)], 27)
    t.line([(5, 2), (3, 28)], 26)
    t.rect(5, 28, 5, 34, 37)
    t.rect(3, 34, 5, 35, 37)
    at.add('umbrella', t)
    # подвесной листопад: лист для падающих листьев
    t = Tex(8, 8, T)
    t.ellipse(4, 4, 3.5, 2.2, 22)
    t.line([(1, 6), (7, 2)], 21)
    at.add('leaf', t)
    return at


# ======================================================================================================
# Большие поверхности
# ======================================================================================================

def plaster(w, h, base=16):
    t = Tex(w, h, base)
    t.noise(0, 0, w - 1, h - 1, base + 1 if base < 17 else base - 1, 0.02)
    return t


def brick(t, x0, y0, x1, y1, seed_shift=0):
    """Старый красный кирпич: кладка 25×6,5 см, швы, разнобой оттенков, местами сколы."""
    t.rect(x0, y0, x1, y1, 13)
    bh, bw = 3, 10
    for row, y in enumerate(range(y0, y1 + 1, bh)):
        off = (bw // 2) * (row % 2) + seed_shift
        for x in range(x0 - bw + off % bw, x1 + 1, bw):
            c = [20, 20, 20, 20, 19, 14, 20, 13][int(rng.integers(0, 8))]
            t.rect(max(x0, x), y, min(x1, x + bw - 2), min(y1, y + bh - 2), c)
            if rng.random() < 0.12:
                t.rect(max(x0, x) + 1, y, min(x1, x + bw - 3), y, 21)
            if rng.random() < 0.08:
                t.px(x + int(rng.integers(1, bw - 2)), y + 1, 15)


def wainscot(t, x0, x1, y0, y1):
    """Деревянная обшивка из вертикальных досок с полочкой-раскладкой."""
    for x in range(int(x0), int(x1) + 1, 5):
        wood(t, x, int(y0), min(int(x1), x + 3), int(y1), 15, 14, 16, 0.1, vertical=True)
        t.rect(x + 4, y0, x + 4, y1, 13)
    t.rect(x0, y0, x1, y0 + 1, 15)
    t.rect(x0, y0 + 2, x1, y0 + 2, 12)
    t.rect(x0, y1 - 3, x1, y1, 12)


def walls(P):
    X = lambda x: (x + HW) / S  # noqa: E731
    Y = lambda y: (HGT - y) / S  # noqa: E731
    out = {}
    w, h = round(2 * HW / S), round(HGT / S)
    # ---- дальняя: кремовая штукатурка, под окном обшивка; против света стена чуть темнее
    t = plaster(w, h, 16)
    wx0, wx1, wy0, wy1 = P['window']
    wainscot(t, 0, w - 1, Y(wy0) + 1, h - 1)
    t.rect(0, 0, w - 1, 2, 17)  # карниз
    t.rect(0, 3, w - 1, 3, 14)
    # вывеска висит на стене — под ней тень
    sx0, sx1, sy0, sy1 = P['sign']
    band_shade(t, X(sx0) + 2, Y(sy1) + 2, X(sx1) + 2, Y(sy0) + 2, 1)
    bx0_, bx1_, _, bsh = P['bench']
    band_shade(t, X(bx0_), Y(bsh + 0.42), X(bx1_), h - 1, 1)  # подушки и скамья заслоняют свет от зала
    cx, cy = P['clock']
    t.shade_ellipse(X(cx) + 1.5, Y(cy) + 1.5, 0.21 / S, 0.21 / S, 1)
    # контражур: всё, кроме откосов, на ступень темнее к углам
    xs, ys = t.grid()
    by = BAYER[ys.astype(int) % 4, xs.astype(int) % 4]
    edge = np.minimum(np.abs(xs - X(wx0)), np.abs(xs - X(wx1)))
    far = (xs < X(wx0) - 0.35 / S) | (xs > X(wx1) + 0.35 / S)
    lv = np.where(far & (edge * S + (by - 0.5) * 0.15 > 0.55), 1, 0)
    shade_levels(t, lv)
    # свет из окна на откосах стены: тонкая светлая кромка вокруг проёма
    t.rect(X(wx0) - 2, Y(wy1) - 2, X(wx1) + 1, Y(wy1) - 1, 17)
    t.shade(0, h - 4, w - 1, h - 1, 1)
    out['back'] = t

    # ---- левая (за стойкой): тёмно-зелёная краска, белый кабанчик над стойкой; столбец 0 — перед комнаты
    Z = lambda z: (FRONT - z) / S  # noqa: E731
    w2 = round((FRONT - BACK) / S)
    t = Tex(w2, h, 7)
    t.noise(0, 0, w2 - 1, h - 1, 8, 0.01)
    bx0, bx1, bz0, bz1, bh = P['bar']
    tile_top, tile_bot = Y(P['cupshelf'][2] - 0.02), Y(bh)
    za, zb = Z(bz1) - 2, Z(bz0) + 2
    t.rect(za, tile_top, zb, tile_bot, 45)
    for y in range(int(tile_top), int(tile_bot) + 1, 3):
        t.rect(za, y, zb, y, 43)
        off = 0 if (y // 3) % 2 else 3
        for x in range(int(za) + off, int(zb), 6):
            t.rect(x, y, x, y + 2, 43)
    t.rect(za, tile_top - 1, zb, tile_top - 1, 43)
    # стойка закрывает стену снизу — там тень
    band_shade(t, za, tile_bot, zb, h - 1, 2)
    # меню: тень от доски
    mz0, mz1, my0, my1 = P['menu']
    band_shade(t, Z(mz1) - 1, Y(my1) + 2, Z(mz0) + 1, Y(my0) + 2, 1)
    # ближе к окну светлее, у входа темнее
    xs, ys = t.grid()
    by = BAYER[ys.astype(int) % 4, xs.astype(int) % 4]
    zz = FRONT - xs * S
    lv = np.where(zz + (by - 0.5) * 0.2 > 1.0, 1, 0)
    shade_levels(t, lv, m=(t.a != 45) & (t.a != 43))
    t.rect(0, 0, w2 - 1, 2, 17)
    t.rect(0, 3, w2 - 1, 3, 14)
    t.rect(0, h - 4, w2 - 1, h - 1, 13)
    t.rect(0, h - 4, w2 - 1, h - 4, 14)
    out['left'] = t

    # ---- правая: кирпич; столбец 0 — зад комнаты
    Zr = lambda z: (z - BACK) / S  # noqa: E731
    t = Tex(w2, h, 20)
    brick(t, 0, 4, w2 - 1, h - 5)
    t.rect(0, 0, w2 - 1, 3, 16)
    t.rect(0, 3, w2 - 1, 3, 14)
    t.rect(0, h - 4, w2 - 1, h - 1, 12)
    b0, b1, bhh, _ = P['bookcase']
    band_shade(t, Zr(b0) - 1, Y(bhh) - 1, Zr(b1) + 1, h - 1, 1)
    s0, s1, sy_lo, sy_hi = P['shelves']
    for y in (sy_lo, sy_hi):
        band_shade(t, Zr(s0), Y(y) + 1, Zr(s1), Y(y) + 3, 1)
    pz0, pz1, py0, py1 = P['painting']
    band_shade(t, Zr(pz0) + 1, Y(py1) + 1, Zr(pz1) + 2, Y(py0) + 2, 1)
    # солнечное пятно из окна на кирпиче у дальнего угла, к входу темнее
    xs, ys = t.grid()
    by = BAYER[ys.astype(int) % 4, xs.astype(int) % 4]
    zz = BACK + xs * S
    lv = np.where(zz + (by - 0.5) * 0.2 > 1.1, 1, 0)
    shade_levels(t, lv)
    out['right'] = t

    # ---- передняя (за спиной): кремовая штукатурка, обшивка до 0,9 м, вход
    Xf = lambda x: (HW - x) / S  # noqa: E731
    t = plaster(w, h, 16)
    wainscot(t, 0, w - 1, Y(0.9), h - 1)
    t.rect(0, 0, w - 1, 2, 17)
    t.rect(0, 3, w - 1, 3, 14)
    d0, d1, dh = P['door']
    t.rect(Xf(d1) - 3, Y(dh) - 3, Xf(d0) + 2, h - 1, 13)  # наличник
    t.rect(Xf(d1) - 2, Y(dh) - 2, Xf(d0) + 1, h - 1, 14)
    p0, p1, py0, py1 = P['print']
    band_shade(t, Xf(p1) + 1, Y(py1) + 1, Xf(p0) + 2, Y(py0) + 2, 1)
    shade_levels(t, np.ones(t.a.shape, int))
    out['front'] = t
    return out


def sun_polys(y_plane, P):
    """Солнечные пятна от стёкол окна на горизонтали y_plane: список многоугольников (x, z)."""
    wx0, wx1, wy0, wy1 = P['window']
    m0, m1 = P['mullions']
    tr = P['transom']
    cols = [(wx0 + 0.06, m0 - 0.03), (m0 + 0.03, m1 - 0.03), (m1 + 0.03, wx1 - 0.06)]
    rows = [(wy0 + 0.08, tr - 0.03), (tr + 0.03, wy1 - 0.05)]
    sx, sy = SUN
    out = []
    for (a, b) in cols:
        for (c, d) in rows:
            pts = []
            for (x, y) in ((a, c), (b, c), (b, d), (a, d)):
                k = (y - y_plane) / -sy
                pts.append((x + sx * k, BACK + k))
            out.append(pts)
    return out


def floor_tex(P, seats):
    """Дубовый паркет досками к окну, солнечные пятна, тени мебели."""
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 14)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    for x in range(0, w, 5):  # доски вдоль z
        off = int(rng.integers(0, 40))
        wood(t, x, 0, min(w - 1, x + 3), h - 1, 14, 13, 15, 0.35, vertical=True)
        t.rect(x + 4, 0, x + 4, h - 1, 13)
        for y in range(off, h, 48):
            t.rect(x, y, x + 3, y, 12)
    # солнце
    m = np.zeros(t.a.shape, bool)
    from PIL import Image, ImageDraw
    im = Image.new('L', (w, h), 0)
    dr = ImageDraw.Draw(im)
    for poly in sun_polys(0.0, P):
        dr.polygon([(X(x), Zf(z)) for x, z in poly], fill=1)
    m = np.array(im).astype(bool)
    # стол заслоняет солнце: его тень сдвинута по лучу
    sx, sy = SUN
    k = TABLE['y'] / -sy
    L, Fz, N = TABLE['halfLen'], TABLE['far'], TABLE['near']
    im2 = Image.new('L', (w, h), 0)
    ImageDraw.Draw(im2).polygon([(X(-L + sx * k), Zf(Fz + k)), (X(L + sx * k), Zf(Fz + k)), (X(L + sx * k), Zf(N + k)),
                                 (X(-L + sx * k), Zf(N + k))], fill=1)
    m &= ~np.array(im2).astype(bool)
    shade_levels(t, np.where(m, -1, 0))
    # тени: под столом, стулья, стойка, шкаф, столики
    tx0, tx1 = X(-L), X(L)
    band_shade(t, tx0, Zf(Fz), tx1, Zf(N), 1)
    t.shade(tx0 + 3, Zf(Fz) + 3, tx1 - 3, Zf(N) - 3, 1)
    for (x, z) in seats:
        t.shade_ellipse(X(x), Zf(z), 0.24 / S, 0.22 / S, 1)
    bx0, bx1, bz0, bz1, _ = P['bar']
    band_shade(t, 0, Zf(bz0) - 1, X(bx1) + 2, Zf(bz1) + 1, 1)
    for (x, z) in P['stools']:
        t.shade_ellipse(X(x), Zf(z), 0.18 / S, 0.18 / S, 1)
    bx0_, bx1_, bd_, _ = P['bench']
    band_shade(t, X(bx0_), 0, X(bx1_), Zf(BACK + bd_ + 0.04), 2)
    b0, b1, _, bd = P['bookcase']
    band_shade(t, X(HW - bd) - 1, Zf(b0), w - 1, Zf(b1), 1)
    for (x, z) in P['tables']:
        t.shade_ellipse(X(x), Zf(z), 0.42 / S, 0.36 / S, 1)
    bx, bz = P['bigplant']
    t.shade_ellipse(X(bx), Zf(bz), 0.3 / S, 0.25 / S, 1)
    cx, cz = P['coat']
    t.shade_ellipse(X(cx), Zf(cz), 0.24 / S, 0.24 / S, 1)
    # коврик у входа
    d0, d1, _ = P['door']
    t.rect(X(d0) - 2, Zf(FRONT - 0.55), X(d1) + 2, h - 1, 37)
    t.frame(X(d0) - 2, Zf(FRONT - 0.55), X(d1) + 2, h - 1, 38)
    t.checker(X(d0), Zf(FRONT - 0.5), X(d1), h - 3, 36)
    # у входа темнее
    t.shade(0, Zf(1.4), w - 1, h - 1, 1, m=((np.mgrid[0:h, 0:w][0] + np.mgrid[0:h, 0:w][1]) % 2 == 0))
    t.shade(0, Zf(1.8), w - 1, h - 1, 1)
    return t


def ceiling_tex(P):
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 16)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    t.noise(0, 0, w - 1, h - 1, 15, 0.02)
    # балки тёмного дерева поперёк комнаты
    for z in np.arange(-2.35, 2.3, 0.75):
        y = int(Zf(z))
        wood(t, 0, y, w - 1, y + 5, 13, 12, 14, 0.3)
        t.rect(0, y + 6, w - 1, y + 7, 14)
    # тёплые пятна от подвесов и холодок от окна
    xs, ys = t.grid()
    by = BAYER[ys.astype(int) % 4, xs.astype(int) % 4]
    lit = np.zeros(t.a.shape, bool)
    for (x, z) in P['pendants']:
        d = np.hypot((xs - X(x)) * S, (ys - Zf(z)) * S)
        lit |= d + (by - 0.5) * 0.2 < 0.55
    shade_levels(t, np.where(lit, -1, 0))
    for (x, z) in P['pendants']:
        t.ellipse(X(x), Zf(z), 2, 2, 13)
    t.shade(0, Zf(1.5), w - 1, h - 1, 1, m=((xs.astype(int) + ys.astype(int)) % 2 == 0))
    return t


def table_tex(P):
    """Общий стол: толстые дубовые плиты, косые солнечные полосы из окна, тени мелочи."""
    L, Fz, N = TABLE['halfLen'], TABLE['far'], TABLE['near']
    w = 256
    s = 2 * L / w
    h = round((N - Fz) / s)
    X = lambda x: (x + L) / s  # noqa: E731
    Zt = lambda z: (z - Fz) / s  # noqa: E731
    t = Tex(w, h, 15)
    for y in range(h):
        x = -int(rng.integers(0, 50))
        while x < w:
            n = int(rng.integers(14, 70))
            r = rng.random()
            if r < 0.22:
                t.rect(x, y, x + n, y, 14)
            elif r < 0.34:
                t.rect(x, y, x + n // 2, y, 16)
            x += n + int(rng.integers(6, 36))
    for z in (Fz + (N - Fz) / 3, Fz + 2 * (N - Fz) / 3):  # стыки трёх плит вдоль стола
        t.rect(0, Zt(z), w - 1, Zt(z), 13)
    for (kx, kz) in ((-1.1, -0.2), (0.9, 0.12), (1.3, -0.7)):  # сучки
        t.ellipse(X(kx), Zt(kz), 3, 1.6, 13)
        t.ellipse(X(kx), Zt(kz), 1.4, 0.8, 12)
    # солнце: светлее на ступень, кромка шахматкой
    from PIL import Image, ImageDraw
    im = Image.new('L', (w, h), 0)
    dr = ImageDraw.Draw(im)
    for poly in sun_polys(TABLE['y'], P):
        dr.polygon([(X(x), Zt(z)) for x, z in poly], fill=1)
    m = np.array(im).astype(bool)
    xs, ys = t.grid()
    core = m.copy()
    shade_levels(t, np.where(core, -1, 0))
    # тени вещей на столе (свет — от окна, тень к нам)
    cx, cz = P['cup']
    t.shade_ellipse(X(cx + 0.03), Zt(cz + 0.04), 0.08 / s, 0.07 / s, 1)
    for key, rx, rz in (('succulent', 0.06, 0.06), ('napkins', 0.08, 0.05)):
        x, z = P[key][:2]
        t.shade_ellipse(X(x + 0.02), Zt(z + 0.04), rx / s, rz / s, 1)
    x, z = P['tent'][:2]
    t.shade_ellipse(X(x + 0.03), Zt(z + 0.06), 0.07 / s, 0.04 / s, 1)
    # стулья напротив задвинуты — от спинок тень на дальнем крае
    for sx_ in (-0.92, 0.95):
        t.shade(X(sx_ - 0.18), 0, X(sx_ + 0.22), 2, 1)
    t.frame(0, 0, w - 1, h - 1, 14)
    t.rect(0, 1, w - 1, 1, 16)
    return t


# ======================================================================================================
# Вид из окна
# ======================================================================================================

def view_far():
    """Старая Елабуга через улицу: мостовая, бульвар с золотыми берёзами, купеческие дома, колокольня собора."""
    x0, x1, y0, y1, _ = VIEW['far']
    s = 0.03
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, 5)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731
    # небо: октябрьское, высокое; к горизонту светлее
    R.sky(t, int(Y(2.2)), blues=(3, 4, 5))
    t.rect(0, Y(2.6), w - 1, h - 1, 5)
    # далеко: колокольня Спасского собора — белая, ярусами, с золотым шпилем; рядом купол с главкой
    bx = X(-0.95)
    for (hw, ytop, ybot) in ((0.5, 2.95, 1.6), (0.4, 3.45, 2.95), (0.3, 3.85, 3.45), (0.2, 4.1, 3.85)):
        t.rect(bx - hw / s, Y(ytop), bx + hw / s, Y(ybot), 45)
        t.rect(bx + hw / s * 0.45, Y(ytop), bx + hw / s, Y(ybot), 44)
        t.rect(bx - hw / s - 1, Y(ytop), bx + hw / s + 1, Y(ytop) + 1, 43)
        t.rect(bx - hw / s, Y(ybot) - 1, bx + hw / s, Y(ybot) - 1, 43)
        for k in (-1, 0, 1):  # арки звона
            ax = bx + k * hw / s * 0.55
            t.rect(ax - 1, Y(ytop) + 3, ax + 1, Y(ybot) - 4, 2)
            t.px(ax, Y(ytop) + 3, 45)
    t.poly([(bx - 0.15 / s, Y(4.1)), (bx + 0.15 / s, Y(4.1)), (bx, Y(4.85))], 22)
    t.line([(bx + 1, Y(4.1)), (bx + 1, Y(4.8))], 21)
    t.rect(bx, Y(5.05), bx, Y(4.82), 21)
    t.rect(bx - 2, Y(4.97), bx + 2, Y(4.97), 21)
    cx2 = X(0.55)  # главный храм: барабан и купол
    t.rect(cx2 - 0.6 / s, Y(2.55), cx2 + 0.6 / s, Y(1.6), 44)
    t.rect(cx2 - 0.28 / s, Y(2.95), cx2 + 0.28 / s, Y(2.55), 45)
    t.ellipse(cx2, Y(3.0), 0.3 / s, 0.24 / s, 22)
    t.ellipse(cx2 - 2, Y(3.03), 0.14 / s, 0.12 / s, 23)
    t.rect(cx2, Y(3.38), cx2, Y(3.2), 21)
    for k in (-1, 1):
        t.ellipse(cx2 + k * 0.5 / s, Y(2.62), 0.12 / s, 0.1 / s, 21)
    # дальние кроны бульвара за домами и над ними
    for xx in np.arange(-7.4, 7.6, 0.55):
        cy = Y(2.35 + 0.18 * np.sin(xx * 1.7))
        t.ellipse(X(xx), cy, 0.38 / s, 0.26 / s, 21 if int(xx * 3) % 3 else 20)
        t.ellipse(X(xx) - 2, cy - 2, 0.2 / s, 0.13 / s, 22)
    hz = Y(1.2)  # горизонт на высоте глаз
    # --- купеческие дома в два этажа: низ кирпичный/каменный, верх — штукатурка или бревно, крыши зелёные/красные
    houses = [
        # x0, x1, низ, верх, крыша, цвет низа, цвет верха, наличники, вывеска
        (-7.6, -4.9, 'brick', 'brick', 9, ('ХЛЕБ', 23)),
        (-4.8, -2.6, 'stone', 'yellow', 27, None),
        (-2.5, -0.15, 'brick', 'white', 9, ('ЦВЕТЫ', 35)),
        (-0.05, 2.3, 'stone', 'wood', 28, None),
        (2.4, 4.9, 'brick', 'yellow', 9, ('КНИГИ', 45)),
        (5.0, 7.6, 'stone', 'brick', 27, None),
    ]
    base_y, mid_y, top_y = 0.62, 1.72, 2.62
    for i, (a, b, low, up, roof, sign) in enumerate(houses):
        A, B = X(a), X(b)
        ty = top_y + (0.08 if i % 2 else 0.0)
        # верхний этаж
        if up == 'yellow':
            t.rect(A, Y(ty), B, Y(mid_y), 22)
            t.noise(A, Y(ty), B, Y(mid_y), 23, 0.05)
            trim, wall, win_c = 45, 22, 2
        elif up == 'white':
            t.rect(A, Y(ty), B, Y(mid_y), 44)
            trim, wall, win_c = 45, 44, 2
        elif up == 'wood':
            t.rect(A, Y(ty), B, Y(mid_y), 13)
            for y in range(int(Y(ty)), int(Y(mid_y)), 3):
                t.rect(A, y, B, y, 12)
            trim, wall, win_c = 45, 13, 1
        else:
            brick_far(t, A, Y(ty), B, Y(mid_y))
            trim, wall, win_c = 44, 20, 1
        # нижний
        if low == 'brick':
            brick_far(t, A, Y(mid_y), B, Y(base_y))
        else:
            t.rect(A, Y(mid_y), B, Y(base_y), 42)
            for y in range(int(Y(mid_y)) + 3, int(Y(base_y)), 4):
                t.rect(A, y, B, y, 41)
        t.rect(A, Y(mid_y) - 1, B, Y(mid_y) + 1, trim)  # межэтажный карниз
        t.rect(A - 1, Y(ty) - 2, B + 1, Y(ty), trim)  # венчающий карниз
        # крыша: скат и слуховое окно
        t.poly([(A - 2, Y(ty) - 2), (B + 2, Y(ty) - 2), (B - 6, Y(ty + 0.42)), (A + 6, Y(ty + 0.42))], roof)
        t.rect(A + 6, Y(ty + 0.42), B - 6, Y(ty + 0.42), roof + 1 if roof not in (11, 29) else roof)
        mxh = (A + B) / 2
        t.poly([(mxh - 5, Y(ty) - 2), (mxh + 5, Y(ty) - 2), (mxh, Y(ty + 0.36))], trim)
        t.rect(mxh - 2, Y(ty + 0.18), mxh + 1, Y(ty) - 3, 1)
        if i % 2 == 0:  # печная труба
            t.rect(B - 14, Y(ty + 0.62), B - 11, Y(ty + 0.3), 20)
            t.rect(B - 15, Y(ty + 0.62), B - 10, Y(ty + 0.6), 19)
        # окна верхнего этажа: высокие, с наличниками и сандриками
        n = max(3, int((b - a) / 0.55))
        step = (B - A) / n
        for k in range(n):
            wx = A + step * (k + 0.5)
            wtop, wbot = Y(ty - 0.2), Y(mid_y + 0.18)
            t.rect(wx - 4, wtop - 3, wx + 4, wtop - 2, trim)  # сандрик
            if up == 'wood':  # резной наличник
                t.poly([(wx - 5, wtop - 2), (wx + 5, wtop - 2), (wx, wtop - 6)], trim)
                t.px(wx, wtop - 4, 13)
            t.rect(wx - 4, wtop - 1, wx + 4, wbot + 1, trim)
            t.rect(wx - 3, wtop, wx + 3, wbot, win_c)
            t.rect(wx - 3, wtop, wx - 2, wtop + 3, 3)  # отражение неба
            t.rect(wx, wtop, wx, wbot, trim)
            t.rect(wx - 3, wtop + 6, wx + 3, wtop + 6, trim)
            t.rect(wx - 4, wbot + 1, wx + 4, wbot + 2, trim)
        # низ: арочные окна-витрины и дверь
        for k in range(n):
            wx = A + step * (k + 0.5)
            wtop, wbot = Y(mid_y - 0.22), Y(base_y + 0.22)
            if k == n // 2 and sign:  # вход в лавку
                t.rect(wx - 4, wtop, wx + 4, Y(base_y), 12)
                t.rect(wx - 3, wtop + 2, wx + 3, Y(base_y), 13)
                t.ellipse(wx, wtop, 4, 2.5, 12)
                t.rect(wx - 1, wtop + 10, wx + 1, wtop + 10, 21)
                continue
            t.ellipse(wx, wtop + 1, 4, 3, trim)
            t.rect(wx - 4, wtop + 1, wx + 4, wbot, trim)
            t.ellipse(wx, wtop + 1, 3, 2, 1)
            t.rect(wx - 3, wtop + 1, wx + 3, wbot - 1, 1)
            t.rect(wx - 3, wtop + 1, wx - 2, wtop + 4, 2)
            if sign and abs(k - n // 2) == 1:  # тёплый свет внутри лавки
                t.rect(wx - 2, wtop + 4, wx + 2, wbot - 2, 22)
                t.rect(wx - 2, wbot - 3, wx + 2, wbot - 2, 21)
        if sign:
            txt, c = sign
            sw = text_w(txt) + 6
            t.rect(mxh - sw / 2, Y(mid_y + 0.02), mxh + sw / 2, Y(mid_y + 0.02) + 7, 1 if c != 45 else 26)
            t.text(mxh - text_w(txt) / 2 + 0.5, Y(mid_y + 0.02) + 1, txt, c)
        t.rect(A, Y(base_y) - 1, B, Y(base_y), 41)  # цоколь
        if i < len(houses) - 1:  # тёмный проезд между домами
            t.rect(B + 1, Y(ty - 0.15), X(houses[i + 1][0]) - 1, Y(base_y), 38)
    # тротуар, бордюр, брусчатка; опавшие листья
    t.rect(0, Y(base_y), w - 1, Y(0.5), 42)
    t.noise(0, Y(base_y), w - 1, Y(0.5), 43, 0.15)
    t.rect(0, Y(0.5), w - 1, Y(0.48), 44)
    t.rect(0, Y(0.48), w - 1, h - 1, 39)
    for y in range(int(Y(0.48)) + 2, h, 2):
        off = (y // 2) % 2 * 2
        for x in range(off, w, 4):
            t.px(x, y, 38)
    t.noise(0, Y(0.62), w - 1, Y(0.52), 22, 0.12)
    t.noise(0, Y(0.62), w - 1, Y(0.52), 21, 0.06)
    t.noise(0, Y(0.47), w - 1, h - 1, 22, 0.03)
    # берёзы бульвара перед домами: белые стволы, золото крон
    for xx in (-6.2, -3.6, -1.15, 1.5, 3.65, 6.3):
        birch_far(t, X(xx), Y(0.58), Y(2.95), s)
    # фонари и скамейки
    for xx in (-5.0, -0.2, 4.95):
        lx = X(xx)
        t.rect(lx, Y(1.95), lx, Y(0.56), 37)
        t.rect(lx - 1, Y(0.62), lx + 1, Y(0.56), 37)
        t.rect(lx - 2, Y(2.05), lx + 2, Y(1.95), 37)
        t.rect(lx - 1, Y(2.02), lx + 1, Y(1.97), 23)
    for xx in (-2.5, 2.6):
        bx_ = X(xx)
        t.rect(bx_ - 7, Y(0.8), bx_ + 7, Y(0.76), 13)
        t.rect(bx_ - 7, Y(0.9), bx_ + 7, Y(0.87), 13)
        for k in (-6, 6):
            t.rect(bx_ + k, Y(0.76), bx_ + k, Y(0.6), 37)
    # ведёрки с цветами у лавки «ЦВЕТЫ»
    for k, c in enumerate((27, 22, 35, 23, 28)):
        fx = X(-1.75) + k * 3
        t.rect(fx, Y(0.72), fx + 1, Y(0.62), 41)
        t.ellipse(fx + 0.5, Y(0.76), 1.6, 1.4, c)
    # велосипед у бордюра
    vx = X(0.9)
    for k in (0, 9):
        t.ellipse(vx + k, Y(0.72), 3.2, 3.2, 37)
        t.ellipse(vx + k, Y(0.72), 2.2, 2.2, 42)
    t.line([(vx, Y(0.72)), (vx + 4, Y(0.85)), (vx + 9, Y(0.72))], 27)
    t.line([(vx + 4, Y(0.85)), (vx + 8, Y(0.86))], 27)
    _ = hz
    return t


def brick_far(t, x0, y0, x1, y1):
    t.rect(x0, y0, x1, y1, 20)
    for y in range(int(y0), int(y1) + 1, 2):
        t.rect(x0, y, x1, y, 19 if (y // 2) % 3 else 21)
    t.noise(x0, y0, x1, y1, 21, 0.05)


def birch_far(t, x, ybot, ytop, s):
    x = int(x)
    t.rect(x, ytop + 10, x + 1, ybot, 45)
    t.rect(x + 1, ytop + 10, x + 1, ybot, 43)
    for y in range(int(ytop) + 12, int(ybot), 4):
        t.px(x + (y // 4) % 2, y, 36)
    for (dx, dy, rx, ry) in ((0, 0, 11, 8), (-7, 8, 8, 7), (7, 9, 8, 7), (0, 15, 9, 6), (-4, -4, 6, 5), (5, -3, 6, 5)):
        cy = ytop + 12 + dy
        t.ellipse(x + dx, cy, rx, ry, 22)
        t.noise(x + dx - rx, cy - ry, x + dx + rx, cy + ry, 21, 0.25, on=22)
        t.noise(x + dx - rx, cy - ry, x + dx + rx, cy + ry, 23, 0.18, on=22)
    for (dx, dy) in ((-3, 4), (4, 10), (-1, 18), (-8, 12)):  # ветки сквозь листву
        t.line([(x, ytop + 22), (x + dx, ytop + 12 + dy)], 44)
    t.noise(x - 12, ytop, x + 12, ytop + 34, 10, 0.03, on=22)


def view_near():
    """Ближе к стеклу: берёза на тротуаре у кофейни, чугунный фонарь, кашпо на перилах террасы."""
    x0, x1, y0, y1, _ = VIEW['near']
    s = 0.02
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, T)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731
    # берёза слева: ствол с чёрными чечевичками, ветки, крона уходит за верх окна
    bx = X(-2.15)
    t.rect(bx - 4, Y(2.4), bx + 4, h - 1, 45)
    t.rect(bx + 3, Y(2.4), bx + 4, h - 1, 43)
    t.rect(bx - 4, Y(2.4), bx - 4, h - 1, 44)
    for y in range(int(Y(2.4)), h, 5):
        a = int(rng.integers(-3, 2))
        t.rect(bx + a, y, bx + a + 2, y, 36)
        if rng.random() < 0.4:
            t.rect(bx + a + 1, y + 1, bx + a + 3, y + 1, 37)
    for (dx, dy, r) in ((-10, 0, 1), (12, -4, 1), (18, -16, 0), (-16, -14, 0)):
        t.line([(bx, Y(2.3)), (bx + dx * 2, Y(2.3) + dy * 2 - 20)], 44)
    xs, ys = t.grid()
    for (cx, cy, rx, ry) in ((-2.15, 2.95, 0.75, 0.32), (-1.6, 2.75, 0.5, 0.25), (-2.7, 2.7, 0.5, 0.25),
                             (-1.95, 2.55, 0.35, 0.18)):
        m = ellipse_mask(t, X(cx), Y(cy), rx / s, ry / s)
        m &= rng.random(t.a.shape) < 0.7
        t.mask(m, 22)
        t.mask(m & (rng.random(t.a.shape) < 0.3), 23)
        t.mask(m & (rng.random(t.a.shape) < 0.25), 21)
    # свисающие плети берёзы
    for k in range(9):
        sx_ = X(-2.7 + k * 0.16)
        top = Y(2.6)
        ln = int(rng.integers(18, 34))
        for j in range(0, ln, 2):
            t.px(sx_ + np.sin(j / 6) * 1.5, top + j, 22 if j % 4 else 23)
    # фонарь справа
    lx = X(2.25)
    t.rect(lx - 1, Y(2.65), lx + 1, h - 1, 37)
    t.rect(lx - 3, Y(0.7), lx + 3, h - 1, 37)
    t.rect(lx - 2, Y(1.4), lx + 2, Y(1.36), 38)
    t.line([(lx, Y(2.6)), (lx + 10, Y(2.72)), (lx + 18, Y(2.62))], 37)
    t.rect(lx + 14, Y(2.62), lx + 22, Y(2.42), 37)
    t.rect(lx + 15, Y(2.6), lx + 21, Y(2.45), 17)
    # перила летней террасы и ящик с бархатцами под окном
    t.rect(0, Y(0.95), w - 1, Y(0.92), 37)
    for x in range(4, w, 18):
        t.rect(x, Y(0.92), x + 1, h - 1, 37)
    t.rect(X(-1.4), Y(0.9), X(1.4), Y(0.72), 13)
    t.rect(X(-1.4), Y(0.9), X(1.4), Y(0.89), 14)
    for x in range(int(X(-1.38)), int(X(1.38)), 3):
        c = (22, 29, 23, 28)[(x // 3) % 4]
        t.ellipse(x + 1, Y(0.93), 1.8, 1.6, c)
        t.px(x, Y(0.96), 8)
    t.noise(X(-1.4), Y(1.0), X(1.4), Y(0.9), 9, 0.3, on=T)
    t.rect(0, Y(0.7), w - 1, h - 1, 37)
    return t


# ======================================================================================================

def main():
    at = items(Atlas(384, 200))
    P = dict(PLACE)
    seats = [(-0.92, -1.1), (0.95, -1.1)]
    surfaces = {f'wall_{k}': v for k, v in walls(P).items()}
    surfaces['floor'] = floor_tex(P, seats)
    surfaces['ceiling'] = ceiling_tex(P)
    surfaces['table'] = table_tex(P)
    surfaces['view_far'] = view_far()
    surfaces['view_near'] = view_near()
    write_all('cafe', at, surfaces, dict(PLACE, view=VIEW, sun=list(SUN)), 'tools/art/room_cafe.py')


if __name__ == '__main__':
    main()
