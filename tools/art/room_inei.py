"""Кабинет директора по закупкам завода холодильников «Иней» (src/game/world3d/rooms/inei.ts): четверг, 15:00.

Холодный солнечный день. Тёмно-синие панели, светлый камень на полу, длинный стол светлого дерева. За спиной
Розы — стеклянная стена в сборочный цех: конвейеры с белыми корпусами, синие погрузчики, световые фонари в крыше.
Стены, пол, потолок, столешница и цех — уникальные текстуры, мелочь — атлас в трёх вариантах света.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/room_inei.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rooms_common import (R, T, Tex, band_shade, darker, ellipse_mask, falloff, shade_levels, text_w, tint,  # noqa: E402
                          write_all, BAYER)
from room3d import BACK, FRONT, HGT, HW, S, TABLE, Atlas, solid, wood  # noqa: E402

rng = R.rng

PLACE = {
    # стеклянная стена: два пролёта по бокам от колонны, облицованной деревом
    'glass': [[-2.45, -0.24], [0.24, 2.45]],
    'glassY': [0.3, 2.55],
    'column': [-0.24, 0.24],
    'vitrina': [-2.62, -1.98, 1.86, 0.66],  # z0 z1 h d — витринный холодильник у левой стены
    'kpi': [-1.45, 0.05, 1.05, 2.0],  # z0 z1 y0 y1 на левой стене
    'cooler': [0.45],
    'ficus': [-2.85, 0.95],
    'door': [1.25, 2.15, 2.1],
    'coat': [-2.95, 2.0],
    'photo': [-2.35, -1.25, 1.0, 2.25],  # z0 z1 y0 y1 на правой стене
    'diplomas': [[-0.95, 1.72], [-0.52, 1.72], [-0.09, 1.72], [-0.52, 1.24]],
    'sideboard': [-1.1, 0.35, 0.72, 0.45],
    'map': [0.65, 2.0, 1.1, 1.95],
    'binders': [2.1, 2.95, 1.9, 0.36],  # x0 x1 h d — стеллаж у передней стены
    'downlights': [[-1.8, -1.9], [0.0, -1.9], [1.8, -1.9], [-1.8, 0.0], [0.0, -0.3], [1.8, 0.0], [-1.8, 1.6], [0.0, 1.6], [1.8, 1.6]],
    # стол: образцы поставщика, письмо из Нинбо, калькулятор, чай, вода
    'crisper': [-0.76, -0.42, 0.08],
    'doorshelf': [0.8, -0.44, -0.25],
    'letter': [-0.48, -0.75, 0.12],
    'tea': [0.47, -0.76],
    'calc': [0.7, -0.22, -0.3],
    'water': [[-1.3, -0.5], [1.3, -0.42]],
    'folder': [-1.25, -0.08, 0.2],
}
# цех за стеклом: пол цеха ниже кабинета, два конвейера, погрузчики, вывеска, воздуховод, дальняя стена
SHOP = {
    'floorY': -1.6,
    'far': [-13.5, 13.5, -3.6, 8.6, -16.0],
    'floor': [-13.5, 13.5, -16.0, -8.8],
    'line1': [-12.0, 12.0, -8.4, -0.6],  # x0 x1 z верх ленты
    'line2': [-12.0, 12.0, -12.2, -1.1],
    'forklifts': [[-3.2, -7.0, 0.0], [3.6, -7.3, 3.14]],
    'sign': [-3.8, -1.5, 2.8, 3.45, -8.0],
    'duct': [3.9, -9.5],
}


# ======================================================================================================
# Атлас
# ======================================================================================================

def snowflake(t, cx, cy, r, c):
    for k in range(6):
        a = k * np.pi / 3
        t.line([(cx, cy), (cx + r * np.cos(a), cy + r * np.sin(a))], c)
        for f in (0.55,):
            bx, by = cx + r * f * np.cos(a), cy + r * f * np.sin(a)
            for s in (-1, 1):
                t.line([(bx, by), (bx + r * 0.3 * np.cos(a + s * 0.9), by + r * 0.3 * np.sin(a + s * 0.9))], c)


def items(at):
    for c in (0, 1, 2, 3, 4, 5, 8, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45):
        at.add(f'c{c}', solid(c))
    t = Tex(8, 8, 43)
    t.rect(0, 0, 7, 1, 45)
    t.rect(0, 6, 7, 7, 41)
    at.add('chrome', t)

    # часы: тонкий чёрный обод, белый циферблат, голубая снежинка «Инея»
    t = Tex(40, 40, T)
    cx = cy = 20
    t.ellipse(cx, cy, 20, 20, 37)
    t.ellipse(cx, cy, 18.5, 18.5, 45)
    for i in range(12):
        a = i / 12 * 2 * np.pi
        for rr in np.arange(13.5, 17):
            t.px(cx - 0.5 + rr * np.sin(a) + 0.5, cy - 0.5 - rr * np.cos(a) + 0.5, 37)
    snowflake(t, cx, cy + 7.5, 3, 3)
    at.add('clock', t)
    at.add('clock_rim', Tex(8, 4, 37))

    # профиль стекла, дерево колонны и стола, кромка
    t = Tex(8, 8, 37)
    t.rect(0, 0, 7, 0, 38)
    at.add('alu_d', t)
    t = Tex(16, 32, 15)
    wood(t, 0, 0, 15, 31, 15, 14, 16, 0.3, vertical=True)
    at.add('wood_v', t)
    t = Tex(32, 16, 15)
    wood(t, 0, 0, 31, 15, 15, 14, 16, 0.3)
    at.add('wood_h', t)
    t = Tex(32, 4, 14)
    t.rect(0, 0, 31, 0, 16)
    t.rect(0, 3, 31, 3, 13)
    at.add('tedge', t)

    # кресло Розы: высокая спинка, тёмно-синяя кожа со строчкой
    t = Tex(36, 60, 1)
    t.rect(0, 0, 35, 2, 2)
    t.frame(0, 0, 35, 59, 0)
    for y in range(8, 56, 8):
        t.rect(3, y, 32, y, 0)
        t.rect(3, y + 1, 32, y + 1, 2)
    t.rect(17, 4, 18, 56, 0)
    t.rect(3, 3, 32, 5, 2)
    at.add('exec', t)
    t = Tex(16, 16, 1)
    t.rect(0, 0, 15, 1, 2)
    t.rect(0, 14, 15, 15, 0)
    at.add('leather_b', t)
    # стул для переговоров: светло-серая ткань, хромированные полозья
    t = Tex(32, 32, 42)
    t.noise(0, 0, 31, 31, 41, 0.12)
    t.frame(0, 0, 31, 31, 40)
    t.rect(1, 1, 30, 2, 43)
    at.add('conf', t)
    t = Tex(16, 16, 42)
    t.noise(0, 0, 15, 15, 41, 0.12)
    t.rect(0, 0, 15, 1, 43)
    at.add('conf_seat', t)

    # ---------------------------------------------------------------- образцы и бумаги на столе
    t = Tex(32, 12, 5)  # ящик для овощей: прозрачный пластик с голубизной
    t.rect(0, 0, 31, 1, 45)
    t.rect(0, 10, 31, 11, 4)
    for x in range(3, 32, 6):
        t.rect(x, 2, x, 9, 4)
    t.rect(2, 3, 29, 3, 45)
    t.rect(10, 5, 21, 7, 45)  # вырез-ручка
    t.rect(11, 6, 20, 6, 4)
    at.add('crisper', t)
    t = Tex(32, 24, 4)
    t.frame(0, 0, 31, 23, 45)
    for x in range(4, 30, 4):
        t.rect(x, 3, x, 20, 5)
    t.rect(2, 2, 29, 2, 3)
    t.rect(5, 16, 9, 18, 44)  # бирка поставщика
    t.px(6, 17, 27)
    at.add('crisper_top', t)
    t = Tex(32, 8, 5)  # полка на дверь
    t.rect(0, 0, 31, 0, 45)
    t.rect(0, 7, 31, 7, 3)
    t.rect(2, 2, 29, 2, 45)
    t.rect(4, 4, 27, 4, 4)
    at.add('shelfd', t)
    t = Tex(32, 10, 4)
    t.frame(0, 0, 31, 9, 45)
    t.rect(2, 2, 29, 7, 3)
    at.add('shelfd_top', t)
    # письмо из Нинбо со штампом «СРОЧНО»
    t = Tex(48, 68, 45)
    t.frame(0, 0, 47, 67, 43)
    t.rect(4, 4, 18, 8, 2)  # шапка поставщика
    t.rect(4, 5, 12, 5, 45)
    for y in range(12, 58, 3):
        t.rect(4, y, 43 - (y * 7) % 13, y, 41)
    t.rect(4, 36, 24, 38, 44)  # таблица цен
    t.rect(28, 36, 43, 38, 44)
    t.rect(30, 37, 40, 37, 27)
    t.frame(8, 44, 41, 57, 27)  # штамп
    t.frame(9, 45, 40, 56, 27)
    t.text(24 - text_w('СРОЧНО') // 2, 48, 'СРОЧНО', 27)
    t.checker(8, 44, 41, 57, 45)  # штамп пропечатался неровно
    t.frame(9, 45, 40, 56, 27)
    t.text(24 - text_w('СРОЧНО') // 2, 48, 'СРОЧНО', 27)
    t.line([(30, 61), (34, 58), (37, 62), (42, 59)], 1)  # подпись
    at.add('letter', t)
    t = Tex(24, 30, 38)  # калькулятор
    t.rect(0, 0, 23, 1, 39)
    t.rect(2, 3, 21, 8, 10)
    t.rect(3, 4, 20, 7, 11)
    t.rect(12, 5, 19, 6, 37)
    for r in range(5):
        for c in range(4):
            t.rect(2 + c * 5, 11 + r * 4, 5 + c * 5, 13 + r * 4, 27 if (c == 3 and r > 2) else 43)
    at.add('calc', t)
    t = Tex(24, 10, 45)  # белая чашка с голубым ободком
    t.rect(0, 0, 23, 1, 3)
    t.rect(0, 9, 23, 9, 43)
    t.rect(4, 3, 4, 8, 45)
    at.add('cup', t)
    t = Tex(8, 8, 20)
    t.rect(1, 1, 6, 6, 21)
    t.ellipse(4, 4, 2, 2, 23)  # лимон
    t.px(4, 4, 22)
    at.add('tea_lemon', t)
    t = Tex(16, 16, 45)
    t.ellipse(8, 8, 7, 7, 44)
    t.ellipse(8, 8, 5, 5, 45)
    t.frame(0, 0, 15, 15, 45)
    at.add('saucer', t)
    t = Tex(16, 32, 4)  # бутылка воды
    t.rect(0, 0, 15, 5, 5)
    t.rect(3, 0, 4, 31, 45)
    t.rect(0, 12, 15, 18, 2)
    t.rect(4, 14, 11, 16, 45)
    t.rect(11, 0, 12, 31, 3)
    at.add('bottle_w', t)
    t = Tex(12, 12, 44)
    t.rect(1, 3, 10, 11, 5)
    t.rect(2, 0, 2, 11, 45)
    at.add('glass_w', t)
    t = Tex(24, 32, 2)  # синяя папка
    t.rect(0, 0, 23, 1, 3)
    t.rect(4, 6, 19, 10, 45)
    t.rect(5, 8, 16, 8, 41)
    t.rect(22, 0, 23, 31, 1)
    at.add('folder', t)

    # ---------------------------------------------------------------- витринный холодильник «Иней»
    t = Tex(28, 80, 45)
    t.rect(0, 0, 27, 79, 44)
    t.rect(1, 1, 26, 8, 3)  # голубая полоса с логотипом
    t.rect(1, 1, 26, 1, 4)
    t.text(14 - text_w('ИНЕЙ') // 2, 3, 'ИНЕЙ', 45)
    t.rect(2, 11, 25, 74, 43)  # стеклянная дверь, внутри светло
    t.rect(3, 12, 24, 73, 5)
    for y in (26, 41, 56):  # полки
        t.rect(3, y, 24, y, 44)
        t.rect(3, y + 1, 24, y + 1, 4)
    for (y0, cols) in ((14, (27, 22, 9, 27)), (29, (45, 3, 45)), (44, (4, 5, 4)), (59, (8, 22, 27, 45))):
        x = 4
        for c in cols:
            w_ = 4 if c not in (4, 5) else 7
            t.rect(x, y0 + 4, x + w_ - 1, y0 + 11, c)
            t.rect(x, y0 + 4, x + w_ - 1, y0 + 4, lighter_(c))
            x += w_ + 1
    t.rect(22, 30, 23, 56, 41)  # ручка
    t.line([(6, 70), (14, 14)], 45)
    t.rect(0, 76, 27, 79, 41)
    at.add('vitrina', t)
    t = Tex(16, 16, 44)
    t.rect(0, 0, 15, 1, 3)
    t.rect(0, 14, 15, 15, 42)
    at.add('vitrina_side', t)
    # кулер и бутыль
    t = Tex(24, 72, 44)
    t.rect(0, 0, 23, 2, 45)
    t.rect(3, 8, 20, 22, 40)
    t.rect(4, 9, 19, 21, 39)
    t.rect(6, 12, 8, 16, 27)
    t.rect(15, 12, 17, 16, 2)
    t.rect(5, 26, 18, 27, 42)
    t.frame(3, 40, 20, 66, 42)
    t.rect(0, 69, 23, 71, 41)
    at.add('cooler', t)
    t = Tex(16, 16, 43)
    t.rect(0, 14, 15, 15, 41)
    at.add('cooler_side', t)
    t = Tex(24, 20, 4)
    t.rect(0, 0, 23, 5, 5)
    t.rect(4, 0, 5, 19, 45)
    t.rect(17, 0, 17, 19, 3)
    t.rect(0, 12, 23, 12, 5)
    at.add('bottle', t)
    t = Tex(8, 8, 4)
    t.rect(1, 1, 3, 2, 5)
    at.add('water_top', t)
    # фикус в белом кашпо
    t = Tex(48, 72, T)
    t.line([(24, 71), (23, 48), (21, 30)], 13)
    t.line([(24, 55), (30, 40), (32, 24)], 13)
    t.line([(23, 44), (15, 34), (13, 22)], 13)
    leaves = []
    for _ in range(46):
        cx_ = float(rng.normal(24, 9))
        cy_ = float(rng.uniform(4, 58 - abs(cx_ - 24) * 0.5))
        leaves.append((cx_, cy_))
    leaves.sort(key=lambda p: p[1])
    xs, ys = t.grid()
    for cx_, cy_ in leaves:
        a = rng.uniform(-0.9, 0.9)
        dx, dy = xs - cx_, ys - cy_
        u = dx * np.cos(a) + dy * np.sin(a)
        v = -dx * np.sin(a) + dy * np.cos(a)
        m = (u / 5.5) ** 2 + (v / 2.6) ** 2 <= 1
        t.mask(m, 7 if cy_ > 36 else 8)
        t.mask(m & (v < -0.6), 8 if cy_ > 36 else 9)
        t.mask(m & (v < -1.5) & (u > 0), 10)
    at.add('ficus', t)
    t = Tex(24, 16, 45)
    t.rect(0, 0, 23, 1, 44)
    t.rect(0, 14, 23, 15, 43)
    t.rect(3, 2, 4, 13, 44)
    at.add('kashpo', t)
    t = Tex(16, 16, 12)
    t.noise(0, 0, 15, 15, 13, 0.3)
    at.add('soil', t)

    # ---------------------------------------------------------------- стены: KPI, фото, грамоты, карта
    # доска KPI закупок: цена полипропилена растёт
    t = Tex(96, 60, 45)
    t.frame(0, 0, 95, 59, 41)
    t.rect(1, 1, 94, 13, 1)
    t.text(48 - text_w('ЗАКУПКИ 2026', 2) // 2, 2, 'ЗАКУПКИ 2026', 45, 2)
    t.text(5, 16, 'ЦЕНА ПП', 1)
    t.rect(5, 22, 5, 54, 40)  # оси
    t.rect(5, 54, 58, 54, 40)
    for i, hh in enumerate((8, 9, 11, 10, 13, 15, 18, 22)):  # столбики объёмов
        t.rect(9 + i * 6, 54 - hh, 12 + i * 6, 53, 3)
    pts = [(8, 48), (14, 47), (20, 45), (26, 46), (32, 41), (38, 37), (44, 33), (50, 27), (56, 22)]
    t.line(pts, 27)
    t.line([(x, y - 1) for x, y in pts], 27)
    for x, y in pts:
        t.rect(x - 1, y - 2, x + 1, y, 26)
    t.poly([(56, 18), (60, 23), (53, 23)], 27)  # стрелка вверх
    t.text(64, 17, '+18', 27, 2)
    t.rect(64, 30, 90, 31, 42)  # показатели
    for k, (lbl, c) in enumerate((('СРОК', 8), ('БРАК', 8), ('ЦЕНА', 27))):
        y = 34 + k * 8
        t.text(64, y, lbl, 1)
        t.rect(84, y, 90, y + 4, c)
    at.add('kpi', t)
    # фото холодильника «Иней» с логотипом-снежинкой
    t = Tex(56, 72, 37)
    t.rect(2, 2, 53, 69, 2)
    t.rect(2, 2, 53, 30, 1)
    t.checker(2, 29, 53, 31, 2)
    t.ellipse(28, 18, 22, 14, 3)
    t.rect(18, 20, 37, 64, 45)  # сам холодильник
    t.rect(18, 20, 37, 20, 44)
    t.rect(18, 36, 37, 36, 43)
    t.rect(34, 24, 35, 32, 42)
    t.rect(34, 40, 35, 56, 42)
    t.rect(18, 22, 18, 64, 44)
    t.rect(37, 21, 37, 64, 43)
    t.rect(19, 58, 36, 59, 3)  # голубая полоса
    t.rect(16, 64, 39, 66, 1)
    snowflake(t, 42.5, 10.5, 5, 45)
    t.text(8, 8, 'ИНЕЙ', 45, 2)
    t.text(28 - text_w('ХОЛОД ДОМА') // 2, 67 - 1, 'ХОЛОД ДОМА', 5) if text_w('ХОЛОД ДОМА') < 50 else None
    at.add('photo_fr', t)
    # грамота «Лучший поставщик» и сертификат
    t = Tex(30, 42, 22)
    t.rect(1, 1, 28, 40, 21)
    t.rect(3, 3, 26, 38, 17)
    t.frame(4, 4, 25, 37, 22)
    snowflake(t, 15, 10, 3.5, 3)
    t.text(15 - text_w('ЛУЧШИЙ') // 2, 16, 'ЛУЧШИЙ', 26)
    t.rect(6, 23, 23, 23, 26)
    for y in (27, 30):
        t.rect(7, y, 22, y, 15)
    t.ellipse(20, 34, 2.5, 2.5, 27)
    at.add('diplom', t)
    t = Tex(30, 42, 44)
    t.rect(1, 1, 28, 40, 45)
    t.frame(3, 3, 26, 38, 3)
    t.text(15 - text_w('ГОСТ') // 2, 7, 'ГОСТ', 1)
    for y in range(15, 30, 3):
        t.rect(7, y, 22, y, 41)
    t.ellipse(15, 33, 3.5, 3.5, 2)
    t.ellipse(15, 33, 2, 2, 44)
    at.add('cert', t)
    # карта поставок: Россия и Китай, красная нить в Нинбо
    t = Tex(72, 44, 45)
    t.frame(0, 0, 71, 43, 38)
    t.rect(1, 1, 70, 42, 5)
    t.poly([(4, 10), (20, 6), (40, 5), (60, 8), (68, 14), (62, 20), (46, 18), (34, 22), (20, 20), (8, 22), (3, 16)], 11)
    t.poly([(40, 22), (52, 20), (60, 24), (58, 34), (50, 38), (42, 34)], 16)
    t.line([(4, 10), (20, 6), (40, 5), (60, 8), (68, 14)], 10)
    t.rect(12, 12, 13, 13, 27)  # Елабуга
    t.rect(56, 30, 57, 31, 27)  # Нинбо
    t.line([(13, 13), (30, 20), (45, 26), (56, 30)], 27)
    t.rect(28, 12, 29, 13, 1)
    t.rect(22, 15, 23, 16, 1)
    t.text(4, 36, 'ПОСТАВКИ', 1)
    at.add('map_sup', t)
    t = Tex(40, 24, 45)  # тумба
    t.rect(0, 0, 39, 1, 44)
    t.frame(1, 3, 19, 22, 43)
    t.frame(20, 3, 38, 22, 43)
    t.rect(8, 12, 12, 12, 40)
    t.rect(27, 12, 31, 12, 40)
    t.rect(0, 23, 39, 23, 41)
    at.add('sideboard', t)
    t = Tex(12, 20, T)  # стеклянный кубок
    t.rect(2, 0, 9, 9, 5)
    t.rect(3, 0, 3, 8, 45)
    t.rect(5, 10, 6, 14, 4)
    t.rect(2, 15, 9, 19, 1)
    t.rect(3, 16, 8, 16, 22)
    at.add('trophy', t)
    # дверь светлого дерева
    t = Tex(48, 104, 15)
    wood(t, 0, 0, 47, 103, 15, 14, 16, 0.25, vertical=True)
    t.frame(0, 0, 47, 103, 13)
    t.rect(38, 50, 44, 51, 43)
    t.rect(38, 50, 38, 54, 41)
    at.add('door_w', t)
    # шуба на вешалке-стойке
    t = Tex(28, 56, T)
    t.poly([(6, 6), (22, 6), (27, 55), (1, 55)], 13)
    t.poly([(5, 0), (23, 0), (24, 9), (4, 9)], 16)
    t.checker(5, 0, 23, 8, 15)
    t.rect(13, 8, 14, 55, 12)
    t.line([(6, 8), (3, 52)], 14)
    t.rect(1, 50, 27, 55, 16)
    t.checker(1, 50, 27, 55, 15)
    at.add('shuba', t)
    # стеллаж с папками
    t = Tex(36, 76, 44)
    t.frame(0, 0, 35, 75, 43)
    for si, (top, bot) in enumerate(((2, 24), (27, 49), (52, 74))):
        t.rect(2, top, 33, bot, 41)
        x = 3
        cols = [1, 2, 45, 1, 3, 2, 27, 1]
        i = si * 2
        while x < 30:
            c = cols[i % len(cols)]
            t.rect(x, top + 2, x + 3, bot, c)
            t.rect(x + 1, top + 5, x + 2, top + 7, 45 if c != 45 else 41)
            t.px(x + 1, bot - 4, 37)
            x += 4
            i += 1
        t.rect(2, bot + 1, 33, bot + 2, 45)
    at.add('binders', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.rect(3, 2, 4, 5, 43)
    at.add('switch', t)

    # ---------------------------------------------------------------- цех: холодильники, конвейер, погрузчики
    t = Tex(16, 32, 45)  # корпус без дверей: белая коробка с тёмным проёмом
    t.rect(0, 0, 15, 0, 44)
    t.rect(2, 2, 13, 29, 42)
    t.rect(3, 3, 12, 28, 41)
    t.rect(3, 14, 12, 14, 43)
    t.rect(0, 31, 15, 31, 43)
    at.add('fr_body', t)
    t = Tex(16, 32, 45)  # готовый холодильник: дверь, ручка, голубая полоса
    t.rect(0, 0, 15, 0, 44)
    t.rect(0, 12, 15, 12, 43)
    t.rect(12, 3, 12, 9, 42)
    t.rect(12, 15, 12, 24, 42)
    t.rect(0, 26, 15, 27, 3)
    t.rect(0, 31, 15, 31, 43)
    at.add('fr_front', t)
    t = Tex(16, 32, 44)
    t.rect(0, 26, 15, 27, 3)
    t.rect(15, 0, 15, 31, 43)
    at.add('fr_side', t)
    t = Tex(16, 16, 44)
    t.rect(0, 0, 15, 0, 45)
    at.add('fr_top', t)
    t = Tex(32, 8, 40)  # конвейер сбоку: рама, ролики
    t.rect(0, 0, 31, 1, 42)
    for x in range(1, 32, 4):
        t.rect(x, 3, x + 1, 5, 38)
    t.rect(0, 7, 31, 7, 38)
    at.add('conv', t)
    t = Tex(16, 16, 37)
    for y in range(0, 16, 4):
        t.rect(0, y, 15, y, 38)
    at.add('belt', t)
    t = Tex(24, 16, 3)  # погрузчик: синий, с жёлтой полосой
    t.rect(0, 0, 23, 1, 4)
    t.rect(0, 10, 23, 11, 22)
    t.rect(0, 14, 23, 15, 1)
    t.rect(14, 3, 20, 8, 1)
    t.ellipse(5, 15, 3, 3, 37)
    t.ellipse(18, 15, 3, 3, 37)
    at.add('forklift', t)
    t = Tex(16, 16, 2)
    t.rect(0, 0, 15, 1, 3)
    at.add('forklift_d', t)
    t = Tex(58, 16, 1)  # вывеска над линией: знак-снежинка в круге и «ИНЕЙ»
    t.rect(0, 0, 57, 15, 1)
    t.frame(0, 0, 57, 15, 3)
    t.ellipse(8.5, 8, 6.5, 6.5, 3)
    snowflake(t, 8.5, 8, 5, 45)
    t.text(19, 3, 'ИНЕЙ', 45, 2)
    at.add('sign', t)
    t = Tex(16, 16, 43)  # воздуховод
    t.rect(0, 0, 15, 2, 45)
    t.rect(0, 12, 15, 15, 41)
    for x in range(0, 16, 8):
        t.rect(x, 0, x, 15, 42)
    at.add('duct', t)
    return at


def lighter_(c):
    from room3d import LUT_L
    return int(LUT_L[c])


# ======================================================================================================
# Большие поверхности
# ======================================================================================================

def panels(width_m, seam_off=0.0):
    """Тёмно-синие стеновые панели 1,2 м с тонким швом, вверху белый карниз, внизу тёмный плинтус."""
    w, h = round(width_m / S), round(HGT / S)
    t = Tex(w, h, 1)
    t.noise(0, 0, w - 1, h - 1, 0, 0.004)
    step = round(1.2 / S)
    off = round(seam_off / S) % step
    for x in range(off, w, step):
        t.rect(x, 4, x, h - 5, 0)
        t.rect(x + 1, 4, x + 1, h - 5, 2)
    y24 = round((HGT - 2.4) / S)
    t.rect(0, y24, w - 1, y24, 0)
    t.rect(0, y24 + 1, w - 1, y24 + 1, 2)
    t.rect(0, 0, w - 1, 2, 44)  # карниз со скрытой подсветкой
    t.rect(0, 3, w - 1, 3, 3)
    t.rect(0, h - 4, w - 1, h - 1, 37)
    t.rect(0, h - 4, w - 1, h - 4, 38)
    return t


def scallops(t, cols, top=4, reach=1.5):
    """Пятна света от даунлайтов на стене: светлые «языки» под потолком, по одному на каждый светильник."""
    ys, xs = np.mgrid[0:t.h, 0:t.w]
    lv = np.zeros(t.a.shape, int)
    for c in cols:
        dy = (ys - top) * S
        dx = np.abs(xs + 0.5 - c) * S
        inside = (dy > 0.05) & (dy < reach) & (dx < 0.12 + dy * 0.4)
        core = inside & (dy < reach * 0.4) & (dx < 0.05 + dy * 0.25)
        lv = np.where(core, np.minimum(lv, -2), np.where(inside, np.minimum(lv, -1), lv))
    shade_levels(t, lv, m=(t.a != 37) & (t.a != 38) & (t.a != 44))


def walls(P):
    X = lambda x: (x + HW) / S  # noqa: E731
    Y = lambda y: (HGT - y) / S  # noqa: E731
    out = {}
    lx = sorted({x for x, _ in P['downlights']})
    lz = sorted({z for _, z in P['downlights']})
    # задняя: вокруг стекла — панели, колонна посередине облицована деревом
    t = panels(2 * HW, seam_off=0.4)
    c0, c1 = P['column']
    wood(t, int(X(c0)), 3, int(X(c1)) - 1, t.h - 5, 15, 14, 16, 0.3, vertical=True)
    t.rect(X(c0), 3, X(c0), t.h - 5, 16)
    t.rect(X(c1) - 1, 3, X(c1) - 1, t.h - 5, 13)
    for (g0, g1) in P['glass']:  # откосы стекла подсвечены цехом
        band_shade(t, X(g0) - 3, Y(P['glassY'][1]) - 1, X(g1) + 2, Y(P['glassY'][0]) + 1, -1, soft=True)
    scallops(t, [X(-2.85), X(2.85)])
    t.shade(0, 0, 1, t.h - 1, 1)
    t.shade(t.w - 2, 0, t.w - 1, t.h - 1, 1)
    out['back'] = t
    # левая: столбец 0 — перед комнаты; к стеклу светлее (цех подсвечивает)
    t = panels(FRONT - BACK, seam_off=0.25)
    Z = lambda z: (FRONT - z) / S  # noqa: E731
    vz0, vz1, vh, _ = P['vitrina']
    band_shade(t, Z(vz1) - 1, Y(vh) - 1, Z(vz0) + 2, t.h - 1, 1)
    kz0, kz1, ky0, ky1 = P['kpi']
    band_shade(t, Z(kz1) - 1, Y(ky0) + 1, Z(kz0) + 1, Y(ky0) + 2, 1)
    dz0, dz1, dh = P['door']
    band_shade(t, Z(dz1) - 3, Y(dh) - 3, Z(dz0) + 3, t.h - 1, 1)
    scallops(t, [Z(z) for z in lz])
    daylight(t, lambda col: FRONT - col * S)
    out['left'] = t
    # правая: столбец 0 — зад комнаты
    t = panels(FRONT - BACK, seam_off=0.55)
    Zr = lambda z: (z - BACK) / S  # noqa: E731
    pz0, pz1, py0, py1 = P['photo']
    band_shade(t, Zr(pz0) + 1, Y(py0) + 1, Zr(pz1) + 1, Y(py0) + 2, 1)
    sz0, sz1, sh, _ = P['sideboard']
    band_shade(t, Zr(sz0) - 1, Y(sh) - 1, Zr(sz1) + 1, t.h - 1, 1)
    scallops(t, [Zr(z) for z in lz])
    daylight(t, lambda col: BACK + col * S)
    out['right'] = t
    # передняя: столбец 0 — x = +HW
    t = panels(2 * HW, seam_off=0.1)
    Xf = lambda x: (HW - x) / S  # noqa: E731
    bx0, bx1, bh, _ = P['binders']
    band_shade(t, Xf(bx1) - 1, Y(bh) - 1, Xf(bx0) + 1, t.h - 1, 1)
    scallops(t, [Xf(x) for x in lx])
    t.a = darker(t.a)
    out['front'] = t
    return out


def daylight(t, z_of_col):
    """Боковые стены: у стекла светлее, к нам темнее — свет из цеха."""
    ys, xs = np.mgrid[0:t.h, 0:t.w]
    z = z_of_col(xs + 0.5)
    by = BAYER[ys % 4, xs % 4]
    lv = np.where(z + (by - 0.5) * 0.1 < -1.7, -1, np.where(z + (by - 0.5) * 0.1 > 1.0, 1, 0))
    shade_levels(t, lv, m=(t.a != 44))


def floor_tex(P, seats):
    """Светлый керамогранит 60×120, отражение стеклянной стены, тени мебели."""
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 44)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    for y in range(0, h, 24):
        t.rect(0, y, w - 1, y, 43)
    for i, y0 in enumerate(range(0, h, 24)):
        off = 0 if i % 2 == 0 else 24
        for x in range(off, w, 48):
            t.rect(x, y0, x, min(h - 1, y0 + 23), 43)
    t.noise(0, 0, w - 1, h - 1, 43, 0.01, on=44)
    # отражение стекла: светлые полосы от пролётов к нам
    for (g0, g1) in P['glass']:
        t.shade_poly([(X(g0 + 0.1), 0), (X(g1 - 0.1), 0), (X(g1 * 0.9), Zf(-1.4)), (X(g0 * 0.9 + 0.05), Zf(-1.4))], -1)
    tx0, tx1 = X(-TABLE['halfLen']), X(TABLE['halfLen'])
    tz0, tz1 = Zf(TABLE['far']), Zf(TABLE['near'])
    band_shade(t, tx0, tz0, tx1, tz1, 1)
    t.shade(tx0 + 3, tz0 + 3, tx1 - 3, tz1 - 3, 1)
    for (x, z) in seats:
        t.shade_ellipse(X(x), Zf(z), 0.26 / S, 0.24 / S, 1)
    vz0, vz1, _, vd = P['vitrina']
    band_shade(t, 0, Zf(vz0) - 1, X(-HW + vd) + 1, Zf(vz1) + 1, 1)
    sz0, sz1, _, sd = P['sideboard']
    band_shade(t, X(HW - sd) - 1, Zf(sz0) - 1, w - 1, Zf(sz1) + 1, 1)
    bx0, bx1, _, bd = P['binders']
    band_shade(t, X(bx0) - 1, Zf(FRONT - bd) - 1, X(bx1) + 1, h - 1, 1)
    fx, fz = P['ficus']
    t.shade_ellipse(X(fx), Zf(fz), 0.3 / S, 0.28 / S, 1)
    t.shade_ellipse(X(-HW + 0.2), Zf(P['cooler'][0]), 0.22 / S, 0.22 / S, 1)
    return t


def ceiling_tex(P):
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 45)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    t.noise(0, 0, w - 1, h - 1, 44, 0.02)
    t.rect(0, 0, w - 1, 3, 44)  # ниша с подсветкой вдоль стекла
    t.rect(0, 4, w - 1, 4, 43)
    falloff(t, X(0), Zf(-0.3), 3.0 / S, 2.4 / S, steps=1, start=1.0, width=0.6, soft=0.15)
    for (x, z) in P['downlights']:
        t.ellipse(X(x), Zf(z), 3, 3, 43)
        t.ellipse(X(x), Zf(z), 2, 2, 45)
    return t


def table_tex(P):
    """Светлое дерево (ясень) с длинными волокнами, стык двух плит, блик от стекла, тени вещей."""
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
            n = int(rng.integers(18, 80))
            r = rng.random()
            if r < 0.2:
                t.rect(x, y, x + n, y, 14)
            elif r < 0.32:
                t.rect(x, y, x + n // 2, y, 16)
            x += n + int(rng.integers(8, 40))
    t.rect(X(0), 0, X(0), h - 1, 14)  # стык плит
    # блик от стеклянной стены: две светлые полосы у дальнего края
    for (g0, g1) in P['glass']:
        t.shade_poly([(X(g0 * 0.6), 0), (X(g1 * 0.6), 0), (X(g1 * 0.5), Zt(-0.62)), (X(g0 * 0.5), Zt(-0.62))], -1)
    for key, rx, rz in (('crisper', 0.22, 0.16), ('doorshelf', 0.24, 0.08), ('calc', 0.07, 0.09)):
        x, z = P[key][:2]
        t.shade_ellipse(X(x + 0.01), Zt(z + 0.015), rx / s, rz / s, 1)
    tx, tz = P['tea']
    t.shade_ellipse(X(tx + 0.01), Zt(tz + 0.01), 0.08 / s, 0.07 / s, 1)
    for (x, z) in P['water']:
        t.shade_ellipse(X(x + 0.01), Zt(z + 0.01), 0.06 / s, 0.05 / s, 1)
    t.frame(0, 0, w - 1, h - 1, 14)
    t.rect(0, 1, w - 1, 1, 16)
    return t


# ======================================================================================================
# Цех за стеклом
# ======================================================================================================

def shop_far():
    """Дальняя стена цеха с окнами, фермы крыши и световые фонари, стеллажи и дальняя линия — всё одной картиной."""
    x0, x1, y0, y1, _ = SHOP['far']
    s = 0.06
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, 43)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731
    fy = SHOP['floorY']
    # стена: светлые сэндвич-панели, внизу синий цоколь
    for y in range(int(Y(5.0)), int(Y(fy)), 10):
        t.rect(0, y, w - 1, y, 42)
    t.rect(0, Y(fy + 1.2), w - 1, Y(fy), 2)
    t.rect(0, Y(fy + 1.2), w - 1, Y(fy + 1.2), 3)
    # окна: холодное голубое небо, солнце
    for xc in np.arange(-12, 13, 3.0):
        t.rect(X(xc - 1.0), Y(4.9), X(xc + 1.0), Y(3.8), 4)
        t.rect(X(xc - 1.0), Y(4.9), X(xc + 1.0), Y(4.45), 5)
        t.checker(X(xc - 1.0), Y(4.45), X(xc + 1.0), Y(4.3), 5)
        t.rect(X(xc), Y(4.9), X(xc), Y(3.8), 41)
        t.frame(X(xc - 1.0), Y(4.9), X(xc + 1.0), Y(3.8), 41)
    # табло «план/факт» смены
    t.rect(X(2.8), Y(3.6), X(7.0), Y(2.4), 37)
    t.frame(X(2.8), Y(3.6), X(7.0), Y(2.4), 38)
    t.text(X(3.0), Y(3.45), 'ПЛАН 1240', 9)
    t.text(X(3.0), Y(3.05), 'ФАКТ 1187', 22)
    t.rect(X(3.0), Y(2.62), X(6.8), Y(2.52), 38)
    t.rect(X(3.0), Y(2.62), X(6.5), Y(2.52), 9)
    # фермы крыши и световые фонари: светлые пролёты
    t.rect(0, 0, w - 1, Y(5.2), 44)
    for yy in (5.2, 6.3):
        t.rect(0, Y(yy), w - 1, Y(yy) + 1, 40)
    for x in range(0, w, 10):
        t.line([(x, Y(5.2)), (x + 5, Y(6.3))], 40)
        t.line([(x + 5, Y(6.3)), (x + 10, Y(5.2))], 40)
    t.rect(0, 0, w - 1, Y(6.6), 45)
    for x in range(0, w, 46):
        t.rect(x + 6, Y(8.4), x + 38, Y(6.75), 5)
        t.rect(x + 6, Y(6.9), x + 38, Y(6.75), 4)
        for k in range(x + 10, x + 38, 8):
            t.rect(k, Y(8.4), k, Y(6.75), 44)
    # колонны пролётов с жёлтой разметкой
    for xc in (-9.0, -4.5, 4.5, 9.0):
        t.rect(X(xc - 0.25), Y(5.2), X(xc + 0.25), Y(fy), 40)
        t.rect(X(xc - 0.25), Y(5.2), X(xc - 0.25), Y(fy), 41)
        for y in range(int(Y(fy + 1.4)), int(Y(fy)), 4):
            t.rect(X(xc - 0.25), y, X(xc + 0.25), y + 1, 22)
    # стеллажи с упакованными холодильниками у дальней стены
    for (a, b) in ((-12.5, -6.0), (6.0, 12.5)):
        for lvl, (yb, yt) in enumerate(((fy, fy + 1.9), (fy + 2.0, fy + 3.9))):
            t.rect(X(a), Y(yt), X(b), Y(yb), 40)
            x = X(a) + 1
            while x < X(b) - 6:
                t.rect(x, Y(yt) + 2, x + 6, Y(yb) - 1, 16)
                t.rect(x, Y(yt) + 2, x + 6, Y(yt) + 2, 17)
                t.rect(x + 6, Y(yt) + 2, x + 6, Y(yb) - 1, 14)
                t.rect(x + 2, Y(yt) + 8, x + 4, Y(yt) + 10, 3)
                x += 8
            t.rect(X(a), Y(yb) - 1, X(b), Y(yb), 29)
            t.rect(X(a), Y(yt) - 1, X(b), Y(yt), 29)
        for xc in np.arange(a, b + 0.1, (b - a) / 3):
            t.rect(X(xc), Y(fy + 4.0), X(xc) + 1, Y(fy), 2)
    # пол у стены и зелёные дорожки
    t.rect(0, Y(fy), w - 1, h - 1, 44)
    t.rect(0, Y(fy) + 1, w - 1, Y(fy) + 1, 22)
    t.rect(0, Y(fy) + 6, w - 1, Y(fy) + 7, 9)
    return t


def shop_floor():
    x0, x1, z0, z1 = SHOP['floor']
    s = 0.08
    w, h = round((x1 - x0) / s), round((z1 - z0) / s)
    t = Tex(w, h, 44)
    X = lambda x: (x - x0) / s  # noqa: E731
    Zf = lambda z: (z - z0) / s  # noqa: E731
    t.noise(0, 0, w - 1, h - 1, 43, 0.04)
    for z in (-11.9, -10.2):  # жёлтые линии проходов
        t.rect(0, Zf(z), w - 1, Zf(z), 22)
    t.rect(0, Zf(-13.2), w - 1, Zf(-12.8), 9)  # зелёная пешеходная дорожка
    for x in range(0, w, 6):
        t.rect(x, Zf(-13.2), x + 2, Zf(-12.8), 10)
    # полосы света от фонарей
    for z in (-14.5, -9.6):
        t.rect(0, Zf(z), w - 1, Zf(z) + 3, 45)
    return t


# ======================================================================================================

def main():
    at = items(Atlas(320, 320))
    P = dict(PLACE)
    seats = [(x, z - 0.05) for (x, z) in R.seats_from_layout() if z < 0]
    surfaces = {f'wall_{k}': v for k, v in walls(P).items()}
    surfaces['floor'] = floor_tex(P, seats)
    surfaces['ceiling'] = ceiling_tex(P)
    surfaces['table'] = table_tex(P)
    surfaces['shop_far'] = shop_far()
    surfaces['shop_floor'] = shop_floor()
    write_all('inei', at, surfaces, dict(PLACE, shop=SHOP), 'tools/art/room_inei.py')


if __name__ == '__main__':
    main()
