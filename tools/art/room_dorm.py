"""Комната 214 в общежитии (src/game/world3d/rooms/dorm.ts): воскресенье, 21:10, тёплая лампа и экран приставки.

Как в room3d.py: стены, пол, потолок и столешница — уникальные текстуры с запечённым светом, мелочь — атлас
в трёх вариантах освещённости. Места вещей (PLACE) уходят в rooms/dorm.gen.ts, по ним же запечены тени.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/room_dorm.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rooms_common import (R, T, Tex, band_shade, darker, ellipse_mask, falloff, lighter, text_w, tint,  # noqa: E402
                          write_all)
from room3d import BACK, FRONT, HGT, HW, S, TABLE, Atlas, solid, wood  # noqa: E402

rng = R.rng

PLACE = {
    'window': [-1.55, -0.45, 0.92, 2.3],
    'radiator': [-1.38, -0.62, 0.22, 0.72],
    'fridge': [-2.3, -1.78, 0.84, 0.56],
    'shelfTV': [-2.32, -1.76, 1.74],
    'wardrobe': [1.2, 2.3, 2.05, 0.58],
    'poster': [0.68, 1.76],
    'bedL': [-3.17, -2.37, -2.64, -0.76],
    'bedR': [2.37, 3.17, -2.64, -0.76],
    'rug': [-2.58, -0.9, 0.98, 2.22],
    'guitar': [-3.0, -0.04],
    'hooks': [0.28, 1.02, 1.74],
    'door': [1.32, 2.2, 2.05],
    'calendar': [-2.45, 1.55],
    'shelf': [0.05, 0.83, 1.28, 0.3],
    'sink': [1.5, 0.84],
    'dishes': [2.3, 1.62],
    'lamp': [0.0, -0.45],
    'kettle': [0.47, -0.76],
    'noodles': [-0.49, -0.77],
    'pad': [-0.7, -0.38, 0.5],
    'mug1': [0.72, -0.4],
    'mug2': [-1.32, -0.14],
    'sugar': [0.86, -0.58, 0.3],
    'teabags': [0.66, -0.2],
    'suitcase': [2.08, -1.9],
    'garland': [-1.78, -0.22, 2.36],
}
VIEW = {'near': [-2.8, -0.2, 0.3, 3.3, -4.3], 'far': [-3.9, -0.3, 0.0, 4.1, -6.4], 'beacon': [-2.3, 1.74, -6.38]}
LAMP_Y = 2.34


# ======================================================================================================
# Атлас
# ======================================================================================================

def base_items(at):
    for c in (0, 1, 2, 3, 4, 5, 8, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 36, 37, 38, 39, 40, 41, 42,
              43, 44, 45):
        at.add(f'c{c}', solid(c))
    t = Tex(8, 8, 43)
    t.rect(0, 0, 7, 1, 45)
    t.rect(0, 6, 7, 7, 41)
    at.add('chrome', t)


def clock_face():
    """Дешёвые пластиковые часы: красный обод, белый циферблат, крупные цифры-риски."""
    t = Tex(40, 40, T)
    cx = cy = 20
    t.ellipse(cx, cy, 20, 20, 26)
    t.ellipse(cx, cy, 18.5, 18.5, 27)
    t.ellipse(cx, cy, 17, 17, 45)
    xs, ys = t.grid()
    m = (((xs - cx) / 17) ** 2 + ((ys - cy) / 17) ** 2 <= 1) & (((xs - cx) / 17) ** 2 + ((ys - cy + 1.5) / 16) ** 2 > 1)
    t.mask(m & (ys < cy), 43)
    for i in range(60):
        a = i / 60 * 2 * np.pi
        big = i % 5 == 0
        for rr in (np.arange(12.5, 16) if big else [15.2]):
            t.px(cx - 0.5 + rr * np.sin(a) + 0.5, cy - 0.5 - rr * np.cos(a) + 0.5, 37 if big else 42)
    t.rect(cx - 3, cy + 6, cx + 2, cy + 6, 41)  # «SLAVA» — штрих
    return t


def items(at):
    base_items(at)
    at.add('clock', clock_face())
    at.add('clock_rim', Tex(8, 4, 26))

    # ---------------------------------------------------------------- окно
    t = Tex(8, 8, 44)
    t.noise(0, 0, 7, 7, 45, 0.3)
    t.noise(0, 0, 7, 7, 42, 0.06)
    at.add('wframe', t)
    t = Tex(8, 8, 44)
    t.rect(0, 0, 7, 0, 45)
    t.noise(0, 1, 7, 7, 43, 0.12)
    at.add('sill', t)
    t = Tex(8, 8, 15)
    t.noise(0, 0, 7, 7, 14, 0.12)
    at.add('jamb', t)
    # батарея: чугун, крашенный в бежевый
    t = Tex(40, 22, 16)
    for x in range(0, 40, 4):
        t.rect(x, 1, x, 20, 15)
        t.rect(x + 2, 2, x + 2, 19, 17)
        t.rect(x + 3, 0, x + 3, 21, 14)
    t.rect(0, 0, 39, 0, 15)
    t.rect(0, 21, 39, 21, 13)
    t.rect(0, 4, 39, 4, 15)
    t.rect(0, 17, 39, 17, 15)
    at.add('radiator', t)
    # носки на батарее: полосатые, чёрные, с дыркой на пятке
    t = Tex(44, 16, T)

    def sock(x0, col, stripe=None, hole=False):
        t.rect(x0, 0, x0 + 5, 11, col)
        t.rect(x0 + 1, 11, x0 + 8, 14, col)
        t.px(x0 + 8, 11, T)
        t.rect(x0, 0, x0 + 5, 0, darker(col))
        if stripe is not None:
            for y in (2, 5, 8):
                t.rect(x0, y, x0 + 5, y, stripe)
        t.rect(x0 + 5, 1, x0 + 5, 10, darker(col))
        t.rect(x0 + 1, 14, x0 + 8, 14, darker(col))
        if hole:
            t.rect(x0 + 1, 12, x0 + 2, 13, 16)
    sock(1, 45, 27)
    sock(11, 37, hole=True)
    sock(22, 2, 45)
    sock(33, 40, 41)
    at.add('socks', t)
    # шторы: винные, складками
    t = Tex(16, 64, 26)
    for x in range(16):
        c = [25, 26, 26, 27, 27, 26, 26, 25][x % 8]
        t.rect(x, 0, x, 63, c)
    t.rect(0, 0, 15, 1, 25)
    for x in range(0, 16, 2):
        t.px(x, 2, 22)  # колечки
    t.rect(0, 61, 15, 63, 25)
    t.noise(0, 3, 15, 60, 25, 0.03)
    at.add('curtain', t)
    # тюль: кружево с дырками
    t = Tex(24, 48, 43)
    for x in range(0, 24, 3):
        t.rect(x, 0, x, 47, 44)
        t.rect(x + 2, 0, x + 2, 47, 42)
    for yy in range(5, 48, 10):
        for xx in range(3, 24, 8):
            cx_ = xx + (yy // 10 % 2) * 4
            t.ellipse(cx_, yy, 2.5, 2.5, 44)
            t.px(cx_, yy, T)
            t.px(cx_ - 2, yy, T)
            t.px(cx_ + 2, yy, T)
    t.rect(0, 0, 23, 1, 43)
    t.rect(0, 45, 23, 47, 44)
    at.add('tulle', t)
    # колонка на полке: чёрная, с голубым кольцом
    t = Tex(28, 16, 38)
    t.rect(0, 0, 27, 0, 39)
    t.rect(0, 15, 27, 15, 37)
    for y in range(2, 14, 2):
        for x in range(2, 26, 2):
            t.px(x + (y // 2) % 2, y, 37)
    t.ellipse(8, 8, 5, 5, 37)
    t.ellipse(8, 8, 4, 4, 3)
    t.ellipse(8, 8, 3, 3, 37)
    t.ellipse(20, 8, 5, 5, 37)
    t.ellipse(20, 8, 4, 4, 3)
    t.ellipse(20, 8, 3, 3, 37)
    t.px(7, 7, 4)
    t.px(19, 7, 4)
    at.add('speaker', t)

    # ---------------------------------------------------------------- холодильник, телевизор, приставка
    t = Tex(26, 44, 44)
    t.rect(0, 0, 25, 0, 45)
    t.rect(1, 1, 1, 42, 45)
    t.rect(0, 43, 25, 43, 40)
    t.rect(0, 12, 25, 12, 42)  # морозилка
    t.rect(21, 3, 22, 10, 41)  # ручки
    t.rect(21, 15, 22, 24, 41)
    t.rect(4, 3, 12, 4, 42)  # надпись
    t.rect(4, 17, 9, 21, 27)  # магниты: Казань, сердечко, листок «ТИМУР — КУПИ МОЛОКО»
    t.rect(5, 18, 8, 18, 45)
    t.rect(12, 17, 14, 19, 22)
    t.px(13, 18, 23)
    t.rect(4, 25, 15, 34, 45)
    t.rect(4, 25, 15, 25, 3)
    for yy in (28, 30, 32):
        t.rect(5, yy, 14 - (yy % 3), yy, 1)
    t.rect(10, 22, 11, 26, 27)
    t.px(24, 40, 41)
    at.add('fridge', t)
    t = Tex(16, 16, 43)
    t.rect(0, 0, 15, 0, 44)
    t.rect(0, 15, 15, 15, 41)
    at.add('fridge_side', t)
    t = Tex(16, 16, 44)
    t.noise(0, 0, 15, 15, 43, 0.1)
    at.add('fridge_top', t)

    # телевизор: меню футбольного симулятора, светится
    t = Tex(64, 40, 37)
    t.rect(0, 0, 63, 0, 38)
    t.rect(1, 36, 62, 39, 36)
    t.rect(2, 2, 61, 35, 1)
    # поле в перспективе на фоне
    t.poly([(2, 24), (61, 24), (61, 35), (2, 35)], 7)
    for y in range(25, 36, 2):
        t.rect(2, y, 61, y, 8)
    t.line([(31, 24), (31, 35)], 11)
    t.line([(2, 30), (61, 30)], 11) if False else None
    t.ellipse(31.5, 29.5, 6, 2.5, 11)
    t.ellipse(31.5, 29.5, 5, 1.5, 8)
    # трибуны и прожекторы
    t.rect(2, 18, 61, 23, 0)
    for x in range(3, 61, 2):
        t.px(x, 19 + (x % 3), [27, 45, 22, 2][x % 4])
    for x in (6, 57):
        t.rect(x - 2, 3, x + 2, 4, 45)
        t.rect(x, 5, x, 17, 38)
    # логотип «ФУТБОЛ 26» и меню
    t.rect(16, 4, 47, 12, 27)
    t.rect(16, 4, 47, 4, 28)
    t.text(18, 6, 'ФУТБОЛ 26', 45)
    t.rect(4, 14, 22, 18, 22)  # выбранный пункт
    t.text(5, 14, 'ИГРАТЬ', 18)
    t.text(26, 14, 'КАРЬЕРА', 44) if False else None
    t.rect(25, 15, 40, 17, 2)
    t.rect(43, 15, 58, 17, 2)
    t.rect(26, 16, 38, 16, 43)
    t.rect(44, 16, 55, 16, 43)
    t.frame(3, 13, 23, 19, 23)
    t.px(60, 34, 27)  # диод
    at.add('tv', t)
    t = Tex(28, 6, 37)
    t.rect(0, 0, 27, 0, 39)
    t.rect(22, 2, 25, 2, 3)
    t.rect(3, 3, 6, 3, 38)
    at.add('console', t)
    t = Tex(28, 20, 37)
    t.rect(0, 0, 27, 0, 38)
    t.rect(1, 1, 26, 18, 36)
    t.rect(8, 7, 19, 12, 37)
    t.rect(1, 19, 27, 19, 38)
    at.add('console_top', t)

    # ---------------------------------------------------------------- стены: плакат, ковёр, шарф, календарь
    # плакат выдуманной группы «ПРОМЗОНА»: трубы, молния, тур
    t = Tex(42, 60, 36)
    t.rect(0, 0, 41, 59, 30)
    t.rect(0, 30, 41, 59, 31)
    t.checker(0, 28, 41, 29, 31)
    t.rect(0, 44, 41, 59, 32)
    t.checker(0, 42, 41, 43, 32)
    t.ellipse(21, 30, 14, 14, 29)  # закатное солнце
    t.ellipse(21, 30, 11, 11, 23)
    for y in range(20, 45, 3):
        t.rect(6, y, 36, y, 30 if y > 30 else 31) if y > 30 else None
    # силуэт завода и четверо музыкантов
    t.poly([(0, 44), (6, 44), (6, 36), (10, 36), (10, 44), (16, 44), (16, 40), (26, 40), (26, 44), (30, 44), (31, 30),
            (33, 30), (34, 44), (41, 44), (41, 50), (0, 50)], 36)
    for x, h in ((8, 9), (15, 8), (24, 9), (32, 8)):
        t.ellipse(x, 50 - h - 2, 2, 2, 36)
        t.rect(x - 2, 50 - h, x + 2, 52, 36)
    t.line([(15, 42), (20, 46)], 36)
    t.rect(0, 52, 41, 59, 36)
    t.rect(0, 0, 41, 25, 36)
    t.text(21 - text_w('ПРОМ', 2) // 2, 2, 'ПРОМ', 23, 2)
    t.text(21 - text_w('ЗОНА', 2) // 2, 14, 'ЗОНА', 28, 2)
    t.text(21 - text_w('ТУР 2026') // 2, 53, 'ТУР 2026', 44)
    t.poly([(36, 25), (32, 32), (35, 32), (31, 38), (38, 30), (35, 30), (38, 25)], 23)  # молния
    for (x, y) in ((0, 0), (37, 0), (0, 55), (37, 55)):  # скотч по углам
        t.rect(x, y, x + 4, y + 4, 17)
        t.checker(x, y, x + 4, y + 4, 16)
    at.add('poster_band', t)

    # ковёр на стене: бордовый, медальон, кайма
    t = Tex(84, 64, 26)
    t.rect(0, 0, 83, 63, 25)
    t.rect(3, 3, 80, 60, 26)
    t.frame(3, 3, 80, 60, 22)
    t.frame(5, 5, 78, 58, 1)
    for x in range(6, 78, 4):  # кайма «ёлочкой»
        t.px(x, 4, 17)
        t.px(x + 2, 59, 17)
    for y in range(6, 58, 4):
        t.px(4, y, 17)
        t.px(79, y, 17)
    t.rect(7, 7, 76, 56, 27)
    t.frame(7, 7, 76, 56, 25)
    cx, cy = 41.5, 31.5
    xs, ys = t.grid()
    dd = np.abs(xs - cx) / 26 + np.abs(ys - cy) / 20
    t.mask((dd <= 1) & (xs > 7) & (xs < 77), 1)
    t.mask((dd <= 0.86) & (xs > 7) & (xs < 77), 26)
    t.mask((dd <= 0.62) & (xs > 7) & (xs < 77), 22)
    t.mask((dd <= 0.5) & (xs > 7) & (xs < 77), 25)
    t.mask((dd <= 0.3), 17)
    t.mask((dd <= 0.18), 27)
    for k in range(-3, 4):  # узор-цветы в полях
        for (px_, py_) in ((12, 12), (71, 12), (12, 51), (71, 51)):
            t.px(px_ + k, py_, 22)
            t.px(px_, py_ + k, 22)
        t.px(cx + k * 3, cy, 45 if k % 2 else 22)
    for (px_, py_) in ((24, 18), (59, 18), (24, 45), (59, 45)):
        t.sprite(px_ - 2, py_ - 2, ['.#.#.', '#.#.#', '.#.#.', '#.#.#', '.#.#.'], {'#': 1})
    t.noise(7, 7, 76, 56, 25, 0.03)
    t.rect(0, 0, 83, 0, 18)
    at.add('rug', t)
    # шарф «РУБИН»: красно-зелёный, с бахромой
    t = Tex(100, 16, 27)
    t.rect(0, 0, 99, 1, 7)
    t.rect(0, 14, 99, 15, 7)
    t.rect(0, 2, 99, 2, 45)
    t.rect(0, 13, 99, 13, 45)
    t.text(7, 3, 'РУБИН', 45, 2)
    t.text(50, 3, 'КАЗАНЬ', 45, 2)
    for x in range(0, 4):
        t.rect(x, 0, x, 15, 7 if x % 2 else 45)
        t.rect(99 - x, 0, 99 - x, 15, 7 if x % 2 else 45)
    at.add('scarf', t)
    t = Tex(10, 26, T)  # висящие концы шарфа
    t.rect(1, 0, 8, 21, 27)
    t.rect(1, 0, 8, 1, 26)
    for y in (4, 12):
        t.rect(1, y, 8, y + 2, 7)
    for x in range(1, 9, 2):
        t.rect(x, 22, x, 25, 45)
    at.add('scarf_end', t)

    # календарь 2026 с котом
    t = Tex(28, 44, 45)
    t.frame(0, 0, 27, 43, 43)
    t.rect(0, 0, 27, 2, 40)
    for x in range(2, 27, 3):
        t.px(x, 1, 43)
    t.rect(2, 4, 25, 19, 4)
    t.rect(2, 14, 25, 19, 16)
    t.ellipse(13, 13, 6, 5, 22)  # рыжий кот
    t.ellipse(13, 9, 4, 3.5, 22)
    t.px(10, 5, 22)
    t.px(16, 5, 22)
    t.rect(11, 9, 11, 9, 37)
    t.rect(15, 9, 15, 9, 37)
    t.rect(13, 11, 13, 11, 27)
    t.rect(9, 12, 17, 12, 21)
    t.rect(2, 21, 25, 25, 27)
    t.text(7, 21, '2026', 45)
    for r in range(3):
        for c in range(6):
            t.rect(3 + c * 4, 28 + r * 5, 4 + c * 4, 29 + r * 5, 27 if c >= 5 else 40)
    t.frame(10, 32, 14, 36, 27)
    at.add('calendar_d', t)

    # гитара: светлая дека, тёмный гриф
    t = Tex(22, 64, T)
    t.rect(9, 0, 12, 4, 19)  # голова
    for y in (1, 3):
        t.px(8, y, 43)
        t.px(13, y, 43)
    t.rect(10, 5, 11, 30, 19)
    for y in range(7, 30, 3):
        t.px(10, y, 42)
    t.ellipse(10.5, 38, 7, 6.5, 21)
    t.ellipse(10.5, 52, 10, 10.5, 21)
    t.ellipse(10.5, 52, 9, 9.5, 22)
    t.ellipse(10.5, 38, 6, 5.5, 22)
    t.ellipse(10.5, 44, 3, 3, 18)
    t.ellipse(10.5, 44, 2, 2, 12)
    t.rect(7, 55, 14, 56, 19)
    t.rect(10, 30, 11, 55, 44)
    t.line([(2, 50), (6, 58)], 21)
    t.px(4, 60, 20)
    t.rect(5, 40, 5, 58, 23) if False else None
    at.add('guitar', t)

    # вешалка-планка с крючками, куртки
    t = Tex(40, 4, 20)
    t.rect(0, 0, 39, 0, 21)
    t.rect(0, 3, 39, 3, 19)
    for x in range(3, 40, 9):
        t.rect(x, 1, x + 1, 2, 43)
    at.add('hooks', t)
    t = Tex(28, 48, T)  # парка Тимура: хаки, мех на капюшоне
    t.poly([(6, 4), (22, 4), (27, 47), (1, 47)], 7)
    t.poly([(8, 0), (20, 0), (22, 8), (6, 8)], 16)
    t.checker(8, 0, 20, 7, 15)
    t.rect(13, 6, 14, 47, 6)
    t.line([(6, 8), (3, 45)], 8)
    t.line([(22, 8), (25, 45)], 6)
    t.rect(4, 26, 10, 29, 6)
    t.rect(18, 26, 24, 29, 6)
    t.rect(1, 44, 27, 47, 6)
    t.px(12, 16, 22)
    t.px(12, 24, 22)
    at.add('parka', t)
    t = Tex(24, 40, T)  # худи красная
    t.poly([(4, 3), (20, 3), (23, 39), (1, 39)], 27)
    t.ellipse(12, 5, 6, 4, 26)
    t.rect(9, 10, 9, 16, 45)
    t.rect(15, 10, 15, 16, 45)
    t.rect(6, 24, 18, 30, 26)
    t.rect(1, 36, 23, 39, 26)
    at.add('hoodie', t)
    t = Tex(26, 50, T)  # ваша куртка: тёмно-синий пуховик
    t.poly([(5, 2), (21, 2), (25, 49), (1, 49)], 1)
    for y in range(6, 49, 7):
        t.rect(2, y, 24, y, 0)
    t.rect(12, 2, 13, 49, 2)
    t.poly([(8, 0), (18, 0), (19, 5), (7, 5)], 2)
    t.line([(5, 4), (2, 46)], 2)
    at.add('coat', t)
    t = Tex(24, 8, T)  # кроссовки у двери
    t.poly([(0, 7), (0, 3), (4, 2), (9, 4), (11, 7)], 45)
    t.rect(0, 6, 11, 7, 41)
    t.rect(4, 3, 7, 3, 27)
    t.poly([(12, 7), (12, 3), (16, 2), (21, 4), (23, 7)], 38)
    t.rect(12, 6, 23, 7, 44)
    t.rect(16, 3, 19, 3, 3)
    at.add('sneakers', t)

    # дверь: крашеная, светло-серая, с номером
    t = Tex(48, 104, 43)
    t.noise(0, 0, 47, 103, 42, 0.04)
    t.frame(0, 0, 47, 103, 41)
    t.rect(1, 1, 46, 1, 44)
    for (y0, y1) in ((6, 48), (54, 98)):  # филёнки
        t.frame(5, y0, 42, y1, 41)
        t.rect(6, y0 + 1, 41, y0 + 1, 44)
        t.rect(6, y0 + 1, 6, y1 - 1, 44)
    t.rect(4, 58, 6, 70, 40)  # ручка и замок
    t.rect(5, 59, 5, 69, 43)
    t.rect(3, 62, 7, 63, 38)
    t.rect(4, 74, 5, 76, 38)
    t.noise(0, 90, 47, 103, 40, 0.06)  # следы ног внизу
    at.add('door_d', t)
    t = Tex(26, 14, 22)  # номер на латунной табличке
    t.frame(0, 0, 25, 13, 20)
    t.rect(1, 1, 24, 1, 23)
    t.text(2, 2, '214', 18, 2)
    at.add('num214', t)
    # «ГРАФИК ДЕЖУРСТВ» на половине ватмана: таблица пустая
    t = Tex(72, 92, 45)
    t.frame(0, 0, 71, 91, 43)
    t.text(36 - text_w('ГРАФИК', 2) // 2, 3, 'ГРАФИК', 27, 2)
    t.text(36 - text_w('ДЕЖУРСТВ', 2) // 2, 16, 'ДЕЖУРСТВ', 27, 2)
    t.frame(4, 30, 67, 87, 1)
    t.frame(5, 31, 66, 86, 1)
    for y in range(38, 87, 7):
        t.rect(4, y, 67, y, 2)
    t.rect(19, 30, 20, 87, 1)
    t.rect(43, 30, 44, 87, 2)
    for i, d in enumerate(('ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС')):
        t.text(7, 39 + i * 7, d, 2)
    t.rect(22, 33, 39, 34, 1)  # «ТИМУР» — зачёркнуто
    t.line([(21, 36), (40, 32)], 27)
    t.rect(0, 0, 6, 2, 17)  # скотч
    t.rect(65, 0, 71, 2, 17)
    at.add('schedule', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.rect(3, 2, 4, 5, 43)
    at.add('switch', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.px(2, 4, 40)
    t.px(5, 4, 40)
    at.add('socket', t)

    # умывальник, зеркало, полотенце, ведро
    t = Tex(24, 10, 45)
    t.rect(0, 0, 23, 0, 44)
    t.rect(0, 9, 23, 9, 42)
    t.rect(2, 4, 21, 4, 44)
    at.add('sink_front', t)
    t = Tex(24, 18, 45)
    t.ellipse(12, 9, 10, 7, 43)
    t.ellipse(12, 10, 9, 6, 42)
    t.ellipse(12, 11, 1.5, 1.5, 38)
    t.rect(0, 0, 23, 0, 44)
    at.add('sink_top', t)
    t = Tex(20, 26, 38)
    t.rect(1, 1, 18, 24, 40)
    t.rect(1, 1, 18, 12, 39)
    t.line([(4, 22), (14, 3)], 43)
    t.line([(6, 22), (16, 3)], 42)
    t.rect(1, 20, 18, 24, 15)  # в зеркале — край обоев
    t.frame(0, 0, 19, 25, 42)
    t.px(9, 0, 45)
    at.add('mirror', t)
    t = Tex(14, 26, T)
    t.rect(1, 0, 12, 25, 3)
    t.rect(1, 0, 12, 1, 2)
    for y in (18, 20):
        t.rect(1, y, 12, y, 45)
    t.rect(1, 23, 12, 25, T)
    for x in range(1, 13, 2):
        t.rect(x, 23, x, 24, 4)
    t.rect(12, 2, 12, 22, 2)
    at.add('towel', t)
    t = Tex(20, 12, 3)
    t.rect(0, 0, 19, 1, 4)
    t.rect(0, 10, 19, 11, 2)
    t.rect(4, 3, 5, 9, 4)
    at.add('bucket', t)

    # этажерка с учебниками
    t = Tex(40, 64, 19)
    wood(t, 0, 0, 39, 63, 19, 18, 20, 0.3, vertical=True)
    for si, (top, bot) in enumerate(((3, 20), (23, 40), (43, 60))):
        t.rect(2, top, 37, bot, 18)
        x = 3
        cols = [2, 27, 43, 8, 22, 45, 26, 1, 41, 21, 3]
        i = si * 3
        while x < 34:
            w = 2 + (i % 3 == 0)
            hh = int(rng.integers(0, 5))
            c = cols[i % len(cols)]
            if si == 2 and x > 24:
                t.rect(x, bot - 7, 36, bot, 17)  # стопка тетрадей
                t.rect(x, bot - 7, 36, bot - 7, 45)
                for yy in range(bot - 5, bot, 2):
                    t.rect(x, yy, 36, yy, 16)
                break
            t.rect(x, top + hh, x + w - 1, bot, c)
            t.rect(x + w - 1, top + hh, x + w - 1, bot, darker(c))
            t.px(x, top + hh + 3, 45)
            x += w
            i += 1
        t.rect(2, bot + 1, 37, bot + 2, 20)
    at.add('books', t)
    t = Tex(16, 16, 20)
    wood(t, 0, 0, 15, 15, 20, 19, 21, 0.4, vertical=True)
    at.add('wood_l', t)
    t = Tex(16, 16, 19)
    wood(t, 0, 0, 15, 15, 19, 18, 20, 0.4)
    at.add('wood_d', t)
    t = Tex(12, 16, T)  # кактус
    t.rect(4, 2, 7, 15, 8)
    t.rect(4, 2, 4, 15, 9)
    t.rect(1, 6, 3, 8, 8)
    t.rect(1, 3, 2, 6, 8)
    t.rect(8, 8, 10, 10, 8)
    t.rect(9, 5, 10, 8, 8)
    t.px(5, 1, 34)
    t.px(6, 1, 35)
    t.noise(1, 2, 10, 15, 11, 0.12, on=8)
    at.add('cactus', t)
    t = Tex(12, 8, 28)
    t.rect(0, 0, 11, 1, 29)
    t.rect(0, 7, 11, 7, 27)
    at.add('pot_s', t)
    # полка с посудой у двери: тарелки на ребре, кастрюлька, кружки
    t = Tex(48, 20, T)
    for i, x in enumerate(range(1, 20, 4)):
        t.ellipse(x + 4, 11, 4.5, 7.5, 45 if i % 2 else 44)
        t.ellipse(x + 4, 11, 2.5, 5, 43)
    t.rect(22, 8, 35, 18, 42)
    t.rect(22, 8, 35, 9, 44)
    t.rect(20, 10, 21, 11, 38)
    t.rect(36, 10, 37, 11, 38)
    t.rect(24, 12, 33, 12, 43)
    t.rect(39, 11, 45, 18, 27)
    t.rect(39, 11, 45, 11, 28)
    t.rect(46, 13, 47, 16, 27)
    t.rect(41, 14, 43, 15, 45)
    t.rect(0, 19, 47, 19, 38)
    at.add('dishes', t)

    # ---------------------------------------------------------------- кровати
    t = Tex(8, 8, 3)
    t.rect(0, 0, 7, 1, 4)
    t.rect(0, 6, 7, 7, 2)
    t.px(5, 3, 44)
    at.add('bedmetal', t)
    t = Tex(32, 24, 44)  # матрас: тик в полоску, пятна
    for x in range(0, 32, 5):
        t.rect(x, 0, x, 23, 2)
        t.rect(x + 2, 0, x + 2, 23, 3)
    t.blotch(0, 0, 31, 23, 16, 3, 0.08, on=44)
    t.frame(0, 0, 31, 23, 43)
    at.add('mattress', t)
    t = Tex(32, 6, 44)
    for x in range(0, 32, 5):
        t.rect(x, 0, x, 5, 2)
        t.rect(x + 2, 0, x + 2, 5, 3)
    t.rect(0, 0, 31, 0, 42)
    t.rect(0, 5, 31, 5, 42)
    at.add('mattress_side', t)
    t = Tex(16, 16, 44)
    t.noise(0, 0, 15, 15, 45, 0.25)
    t.line([(0, 4), (7, 7), (15, 5)], 43)
    t.line([(2, 12), (11, 10)], 43)
    at.add('sheet', t)
    t = Tex(24, 24, 26)  # плед в клетку
    for k in range(0, 24, 8):
        t.rect(k, 0, k + 2, 23, 25)
        t.rect(0, k, 23, k + 2, 25)
        t.rect(k, k, k + 2, k + 2, 36)
        t.rect(k + 5, 0, k + 5, 23, 22)
        t.rect(0, k + 5, 23, k + 5, 22)
    t.noise(0, 0, 23, 23, 27, 0.05, on=26)
    at.add('plaid', t)
    t = Tex(20, 12, 44)
    t.rect(0, 0, 19, 0, 45)
    t.line([(3, 3), (9, 5), (16, 3)], 43)
    t.rect(0, 11, 19, 11, 42)
    t.px(0, 0, T)
    t.px(19, 0, T)
    at.add('pillow', t)
    t = Tex(20, 12, 44)
    for x in range(0, 20, 5):
        t.rect(x, 0, x, 11, 2)
        t.rect(x + 2, 0, x + 2, 11, 3)
    t.rect(0, 11, 19, 11, 42)
    at.add('pillow_bare', t)
    t = Tex(24, 16, 1)  # экран ноутбука: видео
    t.rect(0, 0, 23, 15, 38)
    t.rect(1, 1, 22, 14, 2)
    t.rect(1, 9, 22, 14, 7)
    t.ellipse(8, 7, 3, 3, 22)
    t.rect(14, 4, 20, 8, 3)
    t.rect(1, 13, 22, 14, 36)
    t.rect(2, 13, 9, 13, 27)
    at.add('laptop_scr', t)
    t = Tex(24, 16, 39)
    t.rect(0, 0, 23, 0, 40)
    t.rect(10, 6, 13, 9, 40)
    t.rect(3, 11, 7, 13, 27)  # наклейка
    at.add('laptop_lid', t)
    t = Tex(24, 16, 39)
    for y in range(2, 10, 2):
        for x in range(2, 22, 2):
            t.px(x, y, 37)
    t.rect(8, 11, 15, 14, 40)
    at.add('laptop_kb', t)
    t = Tex(24, 16, 40)  # казённое одеяло: серое, с полосой
    t.rect(0, 5, 23, 7, 26)
    t.rect(0, 5, 23, 5, 27)
    t.noise(0, 0, 23, 15, 39, 0.12)
    at.add('blanket', t)
    t = Tex(24, 8, 40)
    for y in range(0, 8, 2):
        t.rect(0, y, 23, y, 39)
    t.rect(0, 3, 23, 3, 45)
    t.rect(0, 5, 23, 5, 44)
    at.add('blanket_side', t)
    t = Tex(24, 36, 2)  # ваш чемодан: синий пластик с рёбрами
    t.rect(0, 0, 23, 1, 3)
    for x in range(3, 22, 5):
        t.rect(x, 3, x, 33, 3)
        t.rect(x + 1, 3, x + 1, 33, 1)
    t.rect(0, 34, 23, 35, 1)
    t.rect(20, 14, 21, 20, 37)
    t.rect(2, 4, 8, 8, 22)  # бирка от багажа
    t.rect(3, 5, 7, 5, 45)
    at.add('suitcase', t)
    t = Tex(12, 36, 1)
    t.rect(0, 0, 11, 1, 2)
    t.rect(5, 2, 6, 35, 36)
    at.add('suitcase_side', t)
    t = Tex(32, 16, 37)  # спортивная сумка
    t.rect(0, 0, 31, 1, 38)
    t.rect(0, 7, 31, 8, 27)
    t.rect(0, 14, 31, 15, 36)
    t.rect(4, 3, 10, 5, 45)
    at.add('bag', t)
    t = Tex(32, 12, 38)
    t.rect(0, 5, 31, 6, 44)
    t.rect(14, 2, 18, 9, 37)
    at.add('bag_top', t)
    # коробка от чайника: картинка и надпись
    t = Tex(20, 20, 45)
    t.rect(0, 0, 19, 3, 27)
    t.text(1, 0, 'ЧАЙНИК', 45) if False else None
    t.rect(0, 16, 19, 19, 27)
    t.ellipse(9.5, 10, 5, 5, 42)
    t.rect(6, 6, 13, 6, 44)
    t.rect(14, 8, 16, 12, 42)
    t.rect(4, 7, 5, 9, 42)
    t.rect(8, 9, 10, 12, 3)
    t.px(12, 14, 3)
    at.add('kbox', t)
    t = Tex(20, 20, 45)
    t.rect(0, 0, 19, 3, 27)
    t.text(1, 6, 'ЧАЙНИК', 27) if text_w('ЧАЙНИК') <= 19 else None
    t.rect(1, 13, 18, 13, 43)
    t.rect(1, 15, 12, 15, 43)
    t.rect(0, 16, 19, 19, 27)
    at.add('kbox_side', t)
    t = Tex(20, 16, 44)
    t.rect(9, 0, 10, 15, 17)  # скотч, разрезанный
    t.rect(0, 0, 19, 0, 45)
    at.add('kbox_top', t)

    # ---------------------------------------------------------------- шкаф и клетчатая сумка на нём
    t = Tex(44, 82, 14)
    wood(t, 0, 0, 43, 81, 14, 13, 15, 0.18, vertical=True)
    t.rect(0, 0, 43, 1, 15)
    t.rect(21, 2, 22, 79, 12)  # притвор
    t.frame(0, 0, 43, 81, 12)
    t.rect(24, 6, 40, 70, 40)  # зеркало на правой дверце
    t.rect(24, 6, 40, 36, 39)
    t.frame(24, 6, 40, 70, 13)
    t.line([(27, 66), (37, 10)], 43)
    t.line([(29, 66), (39, 10)], 42)
    t.rect(25, 58, 39, 69, 14)  # в зеркале — обои
    t.rect(18, 36, 19, 44, 42)  # ручки
    t.rect(24, 36, 25, 44, 42)
    t.rect(1, 76, 42, 80, 12)
    t.rect(3, 10, 12, 13, 45)  # наклейка-вкладыш от жвачки
    t.rect(4, 11, 7, 12, 27)
    t.px(10, 11, 2)
    at.add('wardrobe', t)
    t = Tex(24, 82, 13)
    wood(t, 0, 0, 23, 81, 13, 12, 14, 0.2, vertical=True)
    at.add('wardrobe_side', t)
    t = Tex(16, 16, 14)
    t.noise(0, 0, 15, 15, 13, 0.2)
    at.add('laminate', t)
    t = Tex(24, 20, 45)  # клетчатая сумка «челнок»
    for k in range(0, 24, 6):
        t.rect(k, 0, k + 2, 19, 27)
        t.rect(0, k, 23, k + 2, 2)
        t.rect(k, k, k + 2, k + 2, 1)
    t.rect(0, 0, 23, 0, 37)
    t.rect(0, 19, 23, 19, 37)
    at.add('chelnok', t)
    t = Tex(24, 14, 45)
    for k in range(0, 24, 6):
        t.rect(k, 0, k + 2, 13, 27)
        t.rect(0, k, 23, k + 2, 2)
    t.rect(0, 6, 23, 7, 37)
    t.rect(4, 3, 5, 10, 37)
    t.rect(18, 3, 19, 10, 37)
    at.add('chelnok_top', t)

    # ---------------------------------------------------------------- стулья и табуретки
    t = Tex(32, 56, 37)  # игровое кресло Тимура
    t.rect(0, 0, 31, 55, 37)
    t.rect(3, 0, 28, 3, 38)
    t.rect(7, 0, 9, 55, 27)
    t.rect(22, 0, 24, 55, 27)
    t.rect(8, 0, 8, 55, 28)
    t.rect(23, 0, 23, 55, 28)
    t.rect(10, 6, 21, 8, 36)  # прорези под ремни
    t.rect(10, 20, 21, 30, 36)
    t.rect(12, 21, 19, 29, 38)
    t.rect(13, 23, 18, 27, 27)  # логотип-крыло
    t.rect(0, 0, 1, 55, 36)
    t.rect(30, 0, 31, 55, 36)
    for y in range(34, 56, 4):
        t.rect(10, y, 21, y, 36)
    at.add('gaming', t)
    t = Tex(24, 24, 37)
    t.rect(6, 0, 7, 23, 27)
    t.rect(16, 0, 17, 23, 27)
    t.rect(0, 0, 23, 1, 38)
    at.add('gaming_seat', t)
    t = Tex(16, 16, 21)  # сиденье табуретки: затёртое
    wood(t, 0, 0, 15, 15, 21, 20, 22, 0.3)
    t.ellipse(8, 8, 5, 4, 22)
    t.checker(3, 4, 12, 12, 21)
    t.frame(0, 0, 15, 15, 20)
    at.add('stool_top', t)
    t = Tex(16, 16, 14)  # полумягкий стул: дерматин
    t.rect(1, 1, 14, 14, 13)
    t.rect(1, 1, 14, 2, 14)
    t.px(5, 6, 12)
    t.px(10, 6, 12)
    t.px(5, 11, 12)
    t.px(10, 11, 12)
    t.line([(3, 12), (6, 9)], 12)  # порез
    at.add('chair_seat', t)
    t = Tex(24, 12, 13)
    t.rect(0, 0, 23, 1, 14)
    t.rect(0, 10, 23, 11, 12)
    at.add('chair_back', t)

    # ---------------------------------------------------------------- стол и что на нём
    t = Tex(32, 4, 13)
    t.rect(0, 0, 31, 0, 14)
    t.rect(0, 3, 31, 3, 12)
    t.rect(5, 1, 20, 1, 14)
    at.add('tedge', t)
    t = Tex(32, 24, 44)  # чайник: белый пластик, окошко воды, синий диод
    t.rect(0, 0, 31, 1, 45)
    t.rect(0, 22, 31, 23, 42)
    t.rect(4, 3, 4, 21, 45)
    t.rect(5, 3, 5, 21, 45)
    t.rect(20, 4, 23, 20, 42)
    t.rect(21, 5, 22, 19, 3)
    t.rect(21, 12, 22, 19, 2)
    t.rect(21, 5, 21, 11, 4)
    for y in range(7, 19, 3):
        t.px(23, y, 38)
    t.rect(26, 18, 27, 19, 3)
    t.rect(10, 9, 14, 11, 43)  # надпись-лого
    at.add('kettle_side', t)
    t = Tex(16, 16, 44)
    t.ellipse(8, 8, 5, 5, 43)
    t.rect(7, 4, 8, 11, 45)
    at.add('kettle_top', t)
    t = Tex(32, 4, 38)
    t.rect(0, 0, 31, 0, 40)
    t.rect(4, 2, 5, 2, 3)
    at.add('kettle_base', t)
    t = Tex(32, 12, 45)  # стакан лапши
    t.rect(0, 0, 31, 1, 44)
    t.rect(0, 3, 31, 8, 27)
    t.rect(0, 3, 31, 3, 28)
    t.text(3, 3, 'ЛАПША', 45) if text_w('ЛАПША') < 20 else None
    t.ellipse(25, 6, 3, 2, 22)
    t.rect(0, 10, 31, 11, 43)
    at.add('noodle_side', t)
    t = Tex(16, 16, 22)
    t.ellipse(8, 8, 8, 8, 21)
    for k in range(6):
        t.line([(2 + k * 2, 3), (4 + k * 2, 8), (2 + k * 2, 13)], 23)
    t.rect(4, 6, 6, 7, 9)
    t.rect(10, 10, 11, 11, 27)
    at.add('noodle_top', t)
    t = Tex(12, 12, 43)
    t.rect(0, 0, 11, 11, 42)
    t.rect(1, 1, 10, 10, 43)
    t.rect(2, 3, 9, 5, 27)
    at.add('noodle_lid', t)
    t = Tex(24, 12, 37)  # джойстик сверху
    t.rect(0, 0, 23, 0, 38)
    t.ellipse(6, 5, 2.5, 2.5, 36)
    t.ellipse(6, 5, 1.5, 1.5, 39)
    t.ellipse(15, 8, 2.5, 2.5, 36)
    t.ellipse(15, 8, 1.5, 1.5, 39)
    t.px(18, 3, 9)
    t.px(20, 5, 27)
    t.px(16, 5, 3)
    t.px(18, 7, 22)
    t.rect(10, 3, 13, 4, 2)
    t.px(11, 10, 45)
    at.add('pad_top', t)
    t = Tex(24, 10, 45)  # кружка «Лучший сосед» с сердечком
    t.rect(0, 0, 23, 0, 44)
    t.sprite(8, 2, ['.#.#.', '#####', '#####', '.###.', '..#..'], {'#': 27})
    t.rect(0, 9, 23, 9, 43)
    at.add('mug_a', t)
    t = Tex(24, 10, 2)  # синяя в горошек, со сколом
    t.rect(0, 0, 23, 0, 3)
    for x in range(2, 24, 5):
        t.px(x, 3, 45)
        t.px(x + 2, 6, 45)
    t.rect(10, 0, 11, 1, 44)
    t.rect(0, 9, 23, 9, 1)
    at.add('mug_b', t)
    t = Tex(8, 8, 20)
    t.rect(1, 1, 6, 6, 19)
    t.rect(2, 2, 3, 3, 21)
    at.add('tea_top', t)
    t = Tex(16, 24, 45)  # сахар в бумажной пачке
    t.rect(0, 0, 15, 1, 44)
    t.rect(0, 4, 15, 9, 2)
    t.text(8 - text_w('САХАР') // 2, 5, 'САХАР', 45) if text_w('САХАР') <= 16 else None
    t.rect(0, 11, 15, 11, 2)
    t.rect(3, 14, 12, 14, 43)
    t.rect(3, 16, 9, 16, 43)
    t.rect(0, 22, 15, 23, 43)
    at.add('sugar', t)
    t = Tex(8, 24, 44)
    t.rect(0, 4, 7, 9, 2)
    t.rect(0, 22, 7, 23, 43)
    at.add('sugar_side', t)
    t = Tex(16, 8, 44)
    t.line([(0, 4), (15, 4)], 43)
    t.rect(0, 0, 15, 0, 45)
    at.add('sugar_top', t)
    t = Tex(8, 8, 45)
    t.rect(0, 0, 7, 0, 44)
    t.rect(2, 2, 5, 5, 22)
    t.rect(3, 3, 4, 4, 21)
    at.add('teabag', t)
    # абажур: оранжевая ткань, бахрома
    t = Tex(32, 12, 22)
    for x in range(0, 32, 4):
        t.rect(x, 0, x, 9, 21)
    t.rect(0, 0, 31, 0, 21)
    for x in range(0, 32, 2):
        t.rect(x, 10, x, 11, 20)
    at.add('abajur', t)
    return at


# ======================================================================================================
# Большие поверхности
# ======================================================================================================

def wallpaper(width_m):
    """Обои 80-х: бежевые, редкая полоса и мелкий цветок, стыки полотен через 53 см."""
    w, h = round(width_m / S), round(HGT / S)
    t = Tex(w, h, 16)
    for x0 in range(0, w, 12):
        t.rect(x0 + 6, 0, x0 + 6, h - 1, 15)
    for yy in range(3, h, 12):
        for xx in range(0, w, 12):
            x = xx
            t.px(x, yy, 15)
            t.px(x - 1, yy + 1, 15)
            t.px(x + 1, yy + 1, 15)
            t.px(x, yy + 2, 15)
            t.px(x, yy + 1, 17)
    for x in range(21, w, 21):  # стыки, где-то отошли
        t.rect(x, 0, x, h - 1, 17) if x % 12 != 6 else None
        if rng.random() < 0.4:
            y0 = int(rng.integers(20, h - 30))
            t.rect(x + 1, y0, x + 1, y0 + int(rng.integers(4, 12)), 14)
    t.rect(0, 0, w - 1, 1, 44)  # потолочный плинтус
    t.rect(0, 2, w - 1, 2, 42)
    t.rect(0, h - 4, w - 1, h - 1, 19)  # плинтус
    t.rect(0, h - 4, w - 1, h - 4, 20)
    t.rect(0, h - 1, w - 1, h - 1, 18)
    return t


def lamp_light(t, cx, rx, ry=1.25, cy_m=1.0):
    """Свет абажура на стене: абажур светит вниз, поэтому светло у стола, а выше и к углам — ступенями темнее."""
    falloff(t, cx, (HGT - cy_m) / S, rx / S, ry / S, steps=2, start=1.0, width=0.55, soft=0.14)


def dorm_walls(P):
    X = lambda x: (x + HW) / S  # noqa: E731
    Y = lambda y: (HGT - y) / S  # noqa: E731
    walls = {}
    # задняя
    t = wallpaper(2 * HW)
    wx0, wx1, wy0, wy1 = P['window']
    rx0, rx1, ry0, ry1 = P['radiator']
    t.blotch(X(rx0), Y(ry1) - 5, X(rx1), Y(ry1) - 1, 15, 2, 0.35, on=[16, 17])  # копоть над батареей
    fx0, fx1, fh, _ = P['fridge']
    # отсвет экрана на обоях — холодный, у телевизора плотнее
    tvx = (fx0 + fx1) / 2
    m = ellipse_mask(t, X(tvx), Y(fh + 0.25), 0.62 / S, 0.5 / S)
    tint(t, m, checker=True)
    tint(t, ellipse_mask(t, X(tvx), Y(fh + 0.25), 0.44 / S, 0.34 / S))
    band_shade(t, X(fx0) - 1, Y(fh) + 1, X(fx1) + 1, t.h - 1, 1)  # тень за холодильником
    kx0, kx1, kh, _ = P['wardrobe']
    band_shade(t, X(kx0) - 2, Y(kh) - 1, X(kx1), t.h - 1, 1)
    # светлый прямоугольник от старого плаката и дырка от гвоздя
    t.rect(X(-0.36) + 0, Y(1.62), X(-0.36) + 12, Y(1.62) + 16, 17)
    t.px(X(-0.36) + 6, Y(1.62) - 1, 13)
    lamp_light(t, X(0), 2.5)
    # угол у кровати Тимура и под окном темнее
    band_shade(t, X(wx0) - 1, Y(wy0) + 1, X(wx1) + 1, Y(wy0) + 3, 1)
    band_shade(t, 0, 0, 1, t.h - 1, 1, soft=False)
    band_shade(t, t.w - 2, 0, t.w - 1, t.h - 1, 1, soft=False)
    walls['back'] = t

    # левая: смотрим на −X, столбец 0 — перед комнаты (z = FRONT)
    t = wallpaper(FRONT - BACK)
    Z = lambda z: (FRONT - z) / S  # noqa: E731
    bz0, bz1 = P['bedL'][2:]
    t.rect(Z(bz1) + 2, Y(0.86), Z(bz0) - 2, Y(0.62), 15)  # затёрто спинами
    dz0, dz1, dh = P['door']
    band_shade(t, Z(dz1) - 3, Y(dh) - 3, Z(dz0) + 3, t.h - 1, 1)
    hz0, hz1, hy = P['hooks']
    t.rect(Z(hz1) + 3, Y(hy) + 4, Z(hz0) - 3, Y(0.95), 15)  # куртки трутся
    gx, gz = P['guitar']
    band_shade(t, Z(gz) - 5, Y(1.0), Z(gz) + 4, t.h - 1, 1)
    lamp_light(t, Z(-0.45), 1.9, 1.1)
    t.shade(0, 0, 1, t.h - 1, 1)
    t.shade(t.w - 2, 0, t.w - 1, t.h - 1, 1)
    walls['left'] = t

    # правая: смотрим на +X, столбец 0 — зад комнаты
    t = wallpaper(FRONT - BACK)
    Zr = lambda z: (z - BACK) / S  # noqa: E731
    # следы прежнего жильца: светлые прямоугольники от плакатов, кусочки скотча
    for (z0, y0, ww, hh) in ((-2.1, 1.95, 0.42, 0.6), (-1.45, 1.8, 0.3, 0.42)):
        t.rect(Zr(z0), Y(y0), Zr(z0 + ww), Y(y0 - hh), 17)
        for (a, b) in ((Zr(z0), Y(y0)), (Zr(z0 + ww) - 2, Y(y0)), (Zr(z0), Y(y0 - hh) - 1), (Zr(z0 + ww) - 2, Y(y0 - hh) - 1)):
            t.rect(a, b, a + 2, b + 1, 23)
    sz, sy = P['sink']
    tz0, tz1 = Zr(sz - 0.34), Zr(sz + 0.34)  # кафель за умывальником
    ty0, ty1 = Y(sy + 0.62), Y(sy - 0.1)
    t.rect(tz0, ty0, tz1, ty1, 45)
    for x in range(int(tz0), int(tz1) + 1, 6):
        t.rect(x, ty0, x, ty1, 43)
    for y in range(int(ty0), int(ty1) + 1, 6):
        t.rect(tz0, y, tz1, y, 43)
    t.px(tz0 + 8, ty0 + 9, 42)
    t.rect(tz0 + 13, ty0 + 20, tz0 + 18, ty0 + 20, 41)  # трещина по плитке
    band_shade(t, Zr(sz - 0.26), Y(sy) + 1, Zr(sz + 0.26), Y(sy) + 4, 1)
    kx0, kx1, kh, kd = P['wardrobe']
    band_shade(t, 0, Y(kh) - 1, Zr(BACK + kd), t.h - 1, 1)
    sz0, sz1, sh, _ = P['shelf']
    band_shade(t, Zr(sz0) - 1, Y(sh) - 1, Zr(sz1) + 1, t.h - 1, 1)
    lamp_light(t, Zr(-0.45), 1.9, 1.1)
    t.shade(0, 0, 1, t.h - 1, 1)
    t.shade(t.w - 2, 0, t.w - 1, t.h - 1, 1)
    walls['right'] = t

    # передняя (за спиной): столбец 0 — x = +HW
    t = wallpaper(2 * HW)
    Xf = lambda x: (HW - x) / S  # noqa: E731
    dx, dy = P['dishes']
    band_shade(t, Xf(dx + 0.3), Y(dy + 0.03), Xf(dx - 0.3), Y(dy - 0.02), 1)
    lamp_light(t, Xf(0), 2.0, 1.0)
    t.shade(0, 0, 1, t.h - 1, 1)
    t.shade(t.w - 2, 0, t.w - 1, t.h - 1, 1)
    walls['front'] = t
    return walls


def floor_tex(P, seats):
    """Крашеные доски вдоль комнаты, половик у кровати Тимура, тени мебели, отсвет экрана."""
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 20)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    for x0 in range(0, w, 5):
        t.rect(x0, 0, x0, h - 1, 19)
        y = -int(rng.integers(0, 60))
        while y < h:
            y += int(rng.integers(50, 110))
            t.rect(x0, y, x0 + 4, y, 19)
    t.noise(0, 0, w - 1, h - 1, 21, 0.01, on=20)
    # краска стёрта до дерева: от двери к столу и к кроватям
    dz0, dz1 = P['door'][:2]
    t.blotch(X(-HW), Zf(dz0 - 0.2), X(-1.2), Zf(dz1), 14, 3, 0.35, on=[20, 21])
    t.blotch(X(-2.2), Zf(-0.7), X(2.2), Zf(0.9), 14, 3, 0.1, on=[20, 21])
    # половик у кровати Тимура
    rx0, rx1, rz0, rz1 = X(-2.33), X(-1.3), Zf(-2.25), Zf(-1.05)
    cols = [27, 22, 2, 44, 8, 26, 3, 23]
    for i, y in enumerate(range(int(rz0), int(rz1) + 1, 2)):
        t.rect(rx0, y, rx1, y + 1, cols[(i * 5) % len(cols)])
    t.noise(rx0, rz0, rx1, rz1, 40, 0.08)
    for y in range(int(rz0), int(rz1) + 1):
        if y % 2 == 0:
            t.px(rx0 - 1, y, 45)
            t.px(rx1 + 1, y, 45)
    # тени: кровати (под сеткой темно), стол, стулья, шкаф, холодильник
    for key in ('bedL', 'bedR'):
        x0, x1, z0, z1 = P[key]
        band_shade(t, X(x0), Zf(z0), X(x1), Zf(z1), 1)
        band_shade(t, X(x0) + 2, Zf(z0) + 2, X(x1) - 2, Zf(z1) - 2, 1, soft=False)
    tx0, tx1 = X(-TABLE['halfLen']), X(TABLE['halfLen'])
    tz0, tz1 = Zf(TABLE['far']), Zf(TABLE['near'])
    band_shade(t, tx0, tz0, tx1, tz1, 1)
    t.shade(tx0 + 4, tz0 + 4, tx1 - 4, tz1 - 4, 1)
    for (x, z) in seats:
        t.shade_ellipse(X(x), Zf(z), 0.25 / S, 0.22 / S, 1)
    kx0, kx1, _, kd = P['wardrobe']
    band_shade(t, X(kx0) - 1, 0, X(kx1), Zf(BACK + kd) + 1, 1)
    fx0, fx1, _, fd = P['fridge']
    band_shade(t, X(fx0) - 1, 0, X(fx1) + 1, Zf(BACK + fd) + 1, 1)
    sz0, sz1, _, sd = P['shelf']
    band_shade(t, X(HW - sd) - 1, Zf(sz0) - 1, w - 1, Zf(sz1) + 1, 1)
    # отсвет экрана на полу у холодильника
    tvx = (fx0 + fx1) / 2
    m = ellipse_mask(t, X(tvx + 0.1), Zf(BACK + fd + 0.35), 0.5 / S, 0.3 / S)
    tint(t, m, {20: 40, 21: 41, 19: 39, 14: 41, 22: 42, 27: 38}, checker=True)
    # свет лампы: у стола светлее, к стенам темнее
    lx, lz = P['lamp']
    falloff(t, X(lx), Zf(lz), 2.4 / S, 2.0 / S, steps=1, start=1.0, width=0.6, soft=0.14)
    return t


def ceiling_tex(P):
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 45)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    t.noise(0, 0, w - 1, h - 1, 44, 0.05)
    t.line([(X(1.6), Zf(-2.7)), (X(1.3), Zf(-1.9)), (X(1.42), Zf(-1.2)), (X(1.1), Zf(-0.5))], 43)  # трещина по рустам
    t.blotch(X(-3.1), Zf(-2.65), X(-2.2), Zf(-1.9), 17, 3, 0.45, on=[45, 44])  # затекло от соседей сверху
    t.blotch(X(-3.0), Zf(-2.55), X(-2.4), Zf(-2.05), 16, 2, 0.35, on=17)
    lx, lz = P['lamp']
    t.ellipse(X(lx), Zf(lz), 4, 4, 44)
    t.ellipse(X(lx), Zf(lz), 2, 2, 43)
    falloff(t, X(lx), Zf(lz), 2.0 / S, 2.0 / S, steps=3, start=0.3, width=0.45, soft=0.3)
    return t


def table_tex(P):
    """Старый полированный стол: лак, ореховые волокна, круги от кружек, лужица под чайником."""
    L, Fz, N = TABLE['halfLen'], TABLE['far'], TABLE['near']
    w = 256
    s = 2 * L / w
    h = round((N - Fz) / s)
    X = lambda x: (x + L) / s  # noqa: E731
    Zt = lambda z: (z - Fz) / s  # noqa: E731
    t = Tex(w, h, 13)
    for y in range(h):
        x = -int(rng.integers(0, 40))
        while x < w:
            n = int(rng.integers(12, 70))
            r = rng.random()
            if r < 0.22:
                t.rect(x, y, x + n, y, 12)
            elif r < 0.34:
                t.rect(x, y, x + n // 2, y, 14)
            x += n + int(rng.integers(6, 36))
    # лак: отражение лампы и окна
    t.shade_poly([(X(-0.55), Zt(-0.86)), (X(0.62), Zt(-0.86)), (X(0.5), Zt(-0.8)), (X(-0.45), Zt(-0.8))], -1)
    t.shade_poly([(X(-1.5), 0), (X(-1.0), 0), (X(-1.12), Zt(-0.62)), (X(-1.5), Zt(-0.62))], -1)
    # круги от кружек, царапины, выжженное пятно, «Т+А»
    for (x, z, r) in ((-0.8, -0.1, 0.04), (0.28, -0.72, 0.042), (1.32, -0.38, 0.038), (-1.12, -0.62, 0.04)):
        xs, ys = t.grid()
        d = np.sqrt(((xs - X(x)) * s) ** 2 + ((ys - Zt(z)) * s) ** 2)
        t.mask((d > r - s * 0.8) & (d < r + s * 0.2) & ((xs.astype(int) % 5) != 0), 15)
    for (a, b) in (((-0.6, 0.18), (-0.45, 0.12)), ((1.2, 0.2), (1.42, 0.08)), ((-1.45, -0.3), (-1.3, -0.42))):
        t.line([(X(a[0]), Zt(a[1])), (X(b[0]), Zt(b[1]))], 14)
    t.ellipse(X(1.3), Zt(0.14), 3, 2, 12)
    t.ellipse(X(1.3), Zt(0.14), 1.5, 1, 18)
    ix, iz = X(-1.38), Zt(0.12)
    t.text(ix, iz, 'Т+А', 14)
    # контактные тени предметов
    for key, rx, rz in (('noodles', 0.06, 0.06), ('mug1', 0.05, 0.05), ('mug2', 0.05, 0.05), ('teabags', 0.05, 0.04)):
        x, z = P[key][:2]
        t.shade_ellipse(X(x + 0.01), Zt(z + 0.01), rx / s, rz / s, 1)
    px_, pz_ = P['pad'][:2]
    t.shade_ellipse(X(px_), Zt(pz_ + 0.01), 0.09 / s, 0.05 / s, 1)
    sx_, sz_ = P['sugar'][:2]
    t.shade_ellipse(X(sx_ + 0.01), Zt(sz_ + 0.01), 0.08 / s, 0.06 / s, 1)
    # лужица под чайником: растеклась к нам и вправо
    kx, kz = P['kettle']
    pud = ellipse_mask(t, X(kx), Zt(kz), 0.12 / s, 0.1 / s)
    pud |= ellipse_mask(t, X(kx + 0.1), Zt(kz + 0.1), 0.07 / s, 0.05 / s)
    pud |= ellipse_mask(t, X(kx - 0.08), Zt(kz + 0.09), 0.045 / s, 0.035 / s)
    pud |= ellipse_mask(t, X(kx + 0.19), Zt(kz + 0.16), 0.02 / s, 0.018 / s)
    t.mask(pud, 2)
    inner = pud & ~np.roll(pud, -1, 0) & False
    t.mask(pud & np.roll(pud, 1, 0) & np.roll(pud, -1, 1), 3)
    t.mask(pud & np.roll(pud, 2, 0) & np.roll(pud, -2, 1) & np.roll(pud, 2, 1), 3)
    edge_top = pud & ~np.roll(pud, 1, 0)
    t.mask(edge_top, 4)
    t.px(X(kx + 0.06), Zt(kz + 0.09), 45)
    t.rect(X(kx + 0.02), Zt(kz + 0.1), X(kx + 0.05), Zt(kz + 0.1), 5)
    t.px(X(kx + 0.13), Zt(kz + 0.13), 5)
    _ = inner
    t.shade_ellipse(X(kx + 0.01), Zt(kz + 0.01), 0.085 / s, 0.075 / s, 1)
    t.frame(0, 0, w - 1, h - 1, 12)
    t.rect(0, 1, w - 1, 1, 14)
    return t


# ======================================================================================================
# Вид из окна: ночь, огни общаг и пятиэтажек, над горизонтом — зарево ОЭЗ
# ======================================================================================================

def view_far():
    x0, x1, y0, y1, _ = VIEW['far']
    s = 0.03
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, 0)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731
    hz = int(Y(1.45))  # горизонт чуть выше глаз: иначе зарево прячется за головами
    # небо: сверху ночь, к горизонту — рыжее зарево промзоны, сильнее левее (там ОЭЗ)
    xs, ys = t.grid()
    gx = X(-1.9)
    d = np.sqrt(((xs - gx) / (w * 1.1)) ** 2 + ((ys - hz) / (hz * 1.05)) ** 2)
    by = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])[ys.astype(int) % 4, xs.astype(int) % 4] / 16
    bands = [(0.1, 29), (0.2, 28), (0.32, 26), (0.46, 25), (0.62, 31), (0.8, 30)]
    col = np.full(t.a.shape, 0)
    for lim, c in reversed(bands):
        col = np.where(d + (by - 0.5) * 0.05 < lim, c, col)
    t.a = np.where(ys < hz, col, t.a)
    for _ in range(26):  # звёзды — редкие, только в тёмной части
        sx, sy = int(rng.integers(0, w)), int(rng.integers(0, hz - 30))
        if t.a[sy, sx] in (0, 30):
            t.px(sx, sy, 44 if rng.random() < 0.3 else 41)
    t.ellipse(X(-0.9), Y(3.55), 3.2, 3.2, 44)  # месяц
    t.ellipse(X(-0.9) + 1.5, Y(3.55) - 1, 3, 3, 0)
    # далёкая промзона на горизонте: цеха, трубы с дымом, огни
    t.rect(0, hz, w - 1, h - 1, 36)
    for (a, b, hh) in ((0, 14, 3), (16, 40, 5), (44, 52, 8), (55, 80, 4), (84, 96, 6), (100, 119, 3)):
        t.rect(a, hz - hh, b, hz, 24)
        t.rect(a, hz - hh, b, hz - hh, 25)
        for x in range(a + 1, b, 3):
            if rng.random() < 0.5:
                t.px(x, hz - hh + 1 + int(rng.integers(0, max(1, hh - 1))), 23 if rng.random() < 0.6 else 5)
    for (cx, top) in ((X(-2.3), Y(1.74)), (X(-3.0), Y(1.62)), (X(-1.45), Y(1.6))):
        t.rect(cx, top, cx + 1, hz, 24)
        t.px(cx, top - 1, 27)
        for k in range(10):  # дым, подсвеченный снизу
            yy = top - 2 - k
            xx = cx + 1 + k * 1.3
            t.rect(xx, yy, xx + 2 + k // 3, yy, 26 if k < 4 else 31)
    for y in range(hz + 1, h):
        for _ in range(3):
            if rng.random() < 0.5:
                t.px(int(rng.integers(0, w)), y, 22 if rng.random() < 0.6 else 23)
    t.rect(0, hz, w - 1, hz, 25)
    return t


def view_near():
    x0, x1, y0, y1, _ = VIEW['near']
    s = 0.02
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, T)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731

    def block(a, b, top, floor_h, win_w, step, lit, base=37, edge=38):
        a, b, top = int(a), int(b), int(top)
        t.rect(a, top, b, h - 1, base)
        t.rect(a, top, b, top, edge)
        t.rect(a, top + 1, b, top + 1, 36)
        for fy in range(top + 3, h, floor_h):
            for fx in range(a + 2, b - win_w, step):
                r = rng.random()
                if r < lit:
                    c = [22, 22, 23, 21, 4, 29, 35][int(rng.integers(0, 7))]
                    t.rect(fx, fy, fx + win_w - 1, fy + floor_h - 4, c)
                    if c in (22, 23) and rng.random() < 0.5:  # штора или силуэт
                        t.rect(fx + win_w - 1, fy, fx + win_w - 1, fy + floor_h - 4, 21)
                else:
                    t.rect(fx, fy, fx + win_w - 1, fy + floor_h - 4, 36 if r < 0.9 else 30)
            t.rect(a, fy + floor_h - 2, b, fy + floor_h - 2, edge)  # плиты перекрытий

    # соседняя общага — девятиэтажка слева, пятиэтажки правее, между ними видно зарево
    block(0, X(-1.62), Y(2.42), 7, 3, 5, 0.42)
    block(X(-1.35), w - 1, Y(1.52), 6, 3, 5, 0.34, base=38, edge=39)
    t.rect(X(-1.35), Y(1.52) - 3, X(-1.2), Y(1.52) - 1, 38)  # выход на крышу
    for xx in (X(-1.0), X(-0.55)):  # антенны
        t.rect(xx, Y(1.52) - 6, xx, Y(1.52) - 1, 38)
        t.rect(xx - 2, Y(1.52) - 5, xx + 2, Y(1.52) - 5, 38)
    # надпись на торце общаги
    t.rect(X(-1.62) - 1, Y(2.42), X(-1.62), h - 1, 36)
    # деревья перед домами, фонарь с натриевым светом
    for cx in (X(-2.5), X(-2.1), X(-1.5), X(-0.9), X(-0.4)):
        cy = Y(1.02) + int(rng.integers(-3, 3))
        t.ellipse(cx, cy, 9, 7, 6)
        t.ellipse(cx - 2, cy - 2, 5, 4, 30)
        t.noise(cx - 9, cy - 7, cx + 9, cy + 7, 36, 0.2, on=6)
    lx = X(-1.25)
    t.rect(lx, Y(1.3), lx, h - 1, 36)
    t.rect(lx, Y(1.3), lx + 4, Y(1.3), 36)
    t.rect(lx + 3, Y(1.3) + 1, lx + 5, Y(1.3) + 1, 23)
    for r, c in ((7, 21), (4, 22)):
        m = ellipse_mask(t, lx + 4, Y(1.3) + 3, r, r * 0.8) & (t.a != T)
        tint(t, m, {36: 18, 6: 19, 30: 18, 37: 18, 38: 19}, checker=(c == 21))
    t.rect(0, Y(0.9), w - 1, h - 1, 36)
    return t


def lampshade_tex():
    return None


# ======================================================================================================

def shadows_seats():
    seats = R.seats_from_layout()
    return [(x, z - 0.05) for (x, z) in seats if z < 0]


def main():
    at = items(Atlas(320, 288))
    P = dict(PLACE)
    surfaces = {}
    for side, t in dorm_walls(P).items():
        surfaces[f'wall_{side}'] = t
    surfaces['floor'] = floor_tex(P, shadows_seats())
    surfaces['ceiling'] = ceiling_tex(P)
    surfaces['table'] = table_tex(P)
    surfaces['view_far'] = view_far()
    surfaces['view_near'] = view_near()
    write_all('dorm', at, surfaces, dict(PLACE, view=VIEW, lampY=LAMP_Y), 'tools/art/room_dorm.py')


if __name__ == '__main__':
    main()
