"""Офис продаж Marmara Coating Systems в Ускюдаре (src/game/world3d/rooms/istanbul.ts): утро, сначала чай.

Белые оштукатуренные стены, тёмный орех, килим на паркете. За спиной Эмре — два больших окна на Босфор:
Девичья башня в воде, паромы-вапуры, чайки, на том берегу — холмы старого города с куполами и минаретами,
Галата и мост. На столе — чай в стаканчиках-тюльпанах, чайданлык, поднос пахлавы, коробка лукума, веер RAL,
ноутбук с презентацией покрасочной линии. На стенах — вывеска компании, изникская плитка, образцы покрытий.
Референсы — ~/Arena-materials/final/emre-voice/room/refs (Wikimedia Commons, список в SOURCES.txt).

Запуск: ~/Arena-materials/.venv/bin/python tools/art/room_istanbul.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rooms_common import (R, T, Tex, band_shade, darker, falloff, shade_levels, write_all, BAYER)  # noqa: E402
from room3d import BACK, FRONT, HGT, HW, S, TABLE, Atlas, solid, wood  # noqa: E402

rng = np.random.default_rng(1453)

# латиница для вывески и ноутбука (в общем шрифте только кириллица); ключи — латинские буквы
LATIN = {
    'A': ['.#.', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '##.', '#.#', '##.'], 'C': ['.##', '#..', '#..', '#..', '.##'],
    'D': ['##.', '#.#', '#.#', '#.#', '##.'], 'E': ['###', '#..', '##.', '#..', '###'], 'F': ['###', '#..', '##.', '#..', '#..'],
    'G': ['.##', '#..', '#.#', '#.#', '.##'], 'H': ['#.#', '#.#', '###', '#.#', '#.#'], 'I': ['###', '.#.', '.#.', '.#.', '###'],
    'K': ['#.#', '#.#', '##.', '#.#', '#.#'], 'L': ['#..', '#..', '#..', '#..', '###'], 'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
    'N': ['#..#', '##.#', '#.##', '#..#', '#..#'], 'O': ['###', '#.#', '#.#', '#.#', '###'], 'P': ['##.', '#.#', '##.', '#..', '#..'],
    'R': ['##.', '#.#', '##.', '#.#', '#.#'], 'S': ['.##', '#..', '.#.', '..#', '##.'], 'T': ['###', '.#.', '.#.', '.#.', '.#.'],
    'U': ['#.#', '#.#', '#.#', '#.#', '###'], 'W': ['#...#', '#...#', '#.#.#', '##.##', '#...#'], 'Y': ['#.#', '#.#', '.#.', '.#.', '.#.'],
    'Z': ['###', '..#', '.#.', '#..', '###'], 'V': ['#.#', '#.#', '#.#', '#.#', '.#.'], '€': ['.##', '#..', '###', '#..', '.##'],
    ',': ['.', '.', '.', '#', '#'], '/': ['..#', '..#', '.#.', '#..', '#..'], ':': ['.', '#', '.', '#', '.'],
}
for k, v in LATIN.items():
    R.FONT[k] = v
text_w = R.text_w

PLACE = {
    # два окна на Босфор по бокам от простенка с часами
    'win': [[-2.85, -0.34], [0.34, 2.85]],
    'winY': [0.35, 2.62],
    'pier': [-0.34, 0.34],
    # левая стена: вывеска, фото линии, стойка с образцами, растение и дверь с назаром
    'sign': [-2.45, -0.35, 1.78, 2.3],  # z0 z1 y0 y1
    'poster': [-2.2, -1.05, 0.95, 1.6],
    'stand': [-1.0, -0.3, 1.2, 0.26],  # z0 z1 h d — стойка с окрашенными пластинами
    'plant': [-2.92, 0.8],
    'door': [1.25, 2.15, 2.1],
    'nazar': [1.05, 1.62],  # z y — у двери
    # правая стена: изникская плитка, буфет с чайным подносом, доска образцов RAL
    'tiles': [-2.3, -0.7, 1.2, 2.3],
    'credenza': [-2.35, -0.55, 0.78, 0.45],
    'ralboard': [0.35, 1.75, 1.05, 1.95],
    # передняя стена: низкий шкаф с папками, фото мастерской в Тузле
    'shelf': [0.9, 2.9, 0.9, 0.38],  # x0 x1 h d
    'tuzla': [1.2, 2.6, 1.3, 2.05],  # x0 x1 y0 y1
    'downlights': [[-1.8, -1.6], [0.0, -1.6], [1.8, -1.6], [-1.8, 0.4], [0.0, 0.4], [1.8, 0.4], [-1.8, 1.8], [1.8, 1.8]],
    # ковёр-килим под столом
    'kilim': [-2.35, 2.35, -2.25, 1.55],
    # на столе
    'baklava': [-0.62, -0.48, 0.12],
    'lokum': [0.48, -0.38, -0.15],
    'tea': [[0.22, -0.74], [-1.0, -0.72], [1.02, -0.76], [0.6, -0.08]],
    'caydanlik': [1.1, -0.44],
    'laptop': [-1.2, -0.3, 0.35],
    'tent': [-0.55, -0.76],
    'quote': [-0.2, -0.72, -0.08],
    'ral': [1.12, -0.12, 0.5],
    'plates': [-1.25, -0.72, 0.15],
}
# Босфор за окнами. Камера видит на 30 м, поэтому вид собран «театром»: ближние крыши Ускюдара,
# вода, Девичья башня и паромы, дальний план с европейским берегом и небом — всё в пределах 20 м.
BOS = {
    'far': [-17.0, 17.0, -1.4, 10.0, -18.0],  # x0 x1 y0 y1 z
    'water': [-16.0, 16.0, -18.0, -5.8, -1.4],  # x0 x1 z0 z1 y
    'near': [-8.0, 8.0, -1.4, 0.05, -6.4],  # x0 x1 y0 y1 z — крыши и набережная Ускюдара
    'tower': [-4.6, -13.0, 1.2, 1.7],  # x z w h — Девичья башня на островке
    'ferries': [[-6.0, -11.5, 1.0], [5.0, -15.0, -1.0]],  # x z направление
    'gulls': [[-2.0, 2.6, -5.0], [1.5, 3.4, -6.0], [3.5, 2.2, -4.6]],  # x y z
}

# палитра Apollo: синие 0–5, зелёные 6–11, кожа/дерево 12–17, золото 18–23, красные 24–29, сливы 30–35, серые 36–45
TEA, TEA_L, TEA_D = 20, 21, 19


# ======================================================================================================
# Атлас мелочи
# ======================================================================================================

def iznik_tile(t, x0, y0):
    """Одна плитка 16×16: белое поле, кобальтовые саз-листья к углам, бирюзовые розетки, красный тюльпан в центре."""
    t.rect(x0, y0, x0 + 15, y0 + 15, 45)
    xs, ys = t.grid()
    for (dx, dy) in ((0, 0), (16, 0), (0, 16), (16, 16)):  # четверти кобальтовых розеток на стыках плиток
        d = np.hypot(xs - x0 - dx, ys - y0 - dy)
        cell = (xs >= x0) & (xs < x0 + 16) & (ys >= y0) & (ys < y0 + 16)
        t.mask(cell & (d <= 4.5), 1)
        t.mask(cell & (d <= 3), 4)
        t.mask(cell & (d <= 1.5), 45)
    for k in range(4):
        a = k * np.pi / 2 + np.pi / 4
        for r in np.arange(3.0, 6.5, 0.5):
            t.px(x0 + 7.5 + r * np.cos(a), y0 + 7.5 + r * np.sin(a), 1)
    for (dx, dy) in ((7, 2), (2, 7), (13, 8), (8, 13)):
        t.px(x0 + dx, y0 + dy, 3)
    # тюльпан: красная чашечка, лепестки, зелёный стебель
    t.rect(x0 + 6, y0 + 5, x0 + 9, y0 + 8, 27)
    t.px(x0 + 6, y0 + 4, 27)
    t.px(x0 + 9, y0 + 4, 27)
    t.px(x0 + 7, y0 + 4, 28)
    t.rect(x0 + 7, y0 + 6, x0 + 7, y0 + 7, 28)
    t.rect(x0 + 7, y0 + 9, x0 + 8, y0 + 10, 9)


def items(at):
    for c in (0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45):
        at.add(f'c{c}', solid(c))
    t = Tex(8, 8, 43)
    t.rect(0, 0, 7, 1, 45)
    t.rect(0, 6, 7, 7, 41)
    at.add('chrome', t)
    t = Tex(8, 8, 44)
    t.rect(0, 0, 7, 0, 45)
    t.rect(0, 7, 7, 7, 42)
    at.add('frame_w', t)

    # часы: латунный обод, белый циферблат, кобальтовые деления
    t = Tex(40, 40, T)
    cx = cy = 20
    t.ellipse(cx, cy, 20, 20, 21)
    t.ellipse(cx, cy, 18.5, 18.5, 45)
    for i in range(12):
        a = i / 12 * 2 * np.pi
        for rr in np.arange(13.5, 17):
            t.px(cx + rr * np.sin(a), cy - rr * np.cos(a), 1)
    t.rect(cx - 3, cy + 7, cx + 3, cy + 7, 2)
    at.add('clock', t)
    at.add('clock_rim', Tex(8, 4, 21))

    # дерево: тёмный орех столешницы и мебели
    t = Tex(16, 32, 13)
    wood(t, 0, 0, 15, 31, 13, 12, 14, 0.3, vertical=True)
    at.add('wood_v', t)
    t = Tex(32, 16, 13)
    wood(t, 0, 0, 31, 15, 13, 12, 14, 0.3)
    at.add('wood_h', t)
    t = Tex(32, 4, 13)
    t.rect(0, 0, 31, 0, 14)
    t.rect(0, 3, 31, 3, 12)
    at.add('tedge', t)

    # кресло Эмре: высокая спинка, коньячная кожа
    t = Tex(36, 60, 38)
    t.rect(0, 0, 35, 2, 39)
    t.frame(0, 0, 35, 59, 37)
    for y in range(10, 56, 12):
        t.rect(3, y, 32, y, 37)
        t.rect(3, y + 1, 32, y + 1, 39)
    t.rect(3, 3, 32, 5, 39)
    t.rect(5, 6, 6, 54, 39)
    at.add('exec', t)
    t = Tex(16, 16, 38)
    t.rect(0, 0, 15, 1, 39)
    t.rect(0, 14, 15, 15, 37)
    at.add('leather_b', t)
    # стулья для гостей: орех и бирюзовая обивка
    t = Tex(32, 32, 3)
    t.noise(0, 0, 31, 31, 2, 0.1)
    t.frame(0, 0, 31, 31, 13)
    t.frame(1, 1, 30, 30, 2)
    t.rect(2, 2, 29, 3, 4)
    at.add('conf', t)
    t = Tex(16, 16, 3)
    t.noise(0, 0, 15, 15, 2, 0.1)
    t.rect(0, 0, 15, 1, 4)
    at.add('conf_seat', t)

    # ---------------------------------------------------------------- чай
    # стаканчик-тюльпан: два усечённых конуса с узкой талией — низ с чаем, верх с пустой кромкой
    t = Tex(16, 8, TEA)
    t.rect(2, 0, 3, 7, TEA_L)
    t.rect(4, 1, 4, 6, 22)
    t.rect(12, 0, 15, 7, TEA_D)
    at.add('glass_lo', t)
    t = Tex(16, 8, TEA)
    t.rect(0, 0, 15, 1, 44)
    t.rect(0, 0, 15, 0, 45)
    t.rect(2, 2, 3, 7, TEA_L)
    t.rect(4, 3, 4, 6, 22)
    t.rect(12, 2, 15, 7, TEA_D)
    at.add('glass_hi', t)
    t = Tex(8, 8, TEA)
    t.rect(2, 2, 5, 5, TEA_D)
    t.px(2, 2, 22)
    at.add('tea_top', t)
    t = Tex(16, 16, 45)  # блюдце: белое с красным ободком
    t.frame(0, 0, 15, 15, 27)
    t.ellipse(8, 8, 4, 4, 44)
    at.add('saucer', t)
    t = Tex(24, 6, 45)
    t.rect(0, 0, 23, 0, 27)
    t.rect(0, 5, 23, 5, 43)
    at.add('saucer_side', t)
    t = Tex(16, 16, 43)  # полированная сталь чайданлыка: яркий блик, тёмные отражения
    t.rect(2, 0, 4, 15, 45)
    t.rect(5, 0, 5, 15, 44)
    t.rect(8, 0, 8, 15, 41)
    t.rect(11, 0, 12, 15, 40)
    t.rect(13, 0, 15, 15, 42)
    at.add('steel', t)
    t = Tex(16, 16, 21)  # круглый медный поднос
    t.frame(0, 0, 15, 15, 22)
    t.ellipse(8, 8, 5, 5, 20)
    at.add('copper', t)
    # пахлава: прямоугольный противень-тепси, ровные ряды квадратиков с зелёной фисташковой крошкой
    t = Tex(48, 32, 41)
    t.frame(0, 0, 47, 31, 43)
    t.frame(1, 1, 46, 30, 40)
    for r in range(4):
        for c in range(7):
            x, y = 3 + c * 6, 3 + r * 6 + 1
            t.rect(x, y, x + 5, y + 5, 22)
            t.rect(x, y, x + 5, y, 23)
            t.rect(x + 5, y, x + 5, y + 5, 19)
            t.rect(x, y + 5, x + 5, y + 5, 19)
            t.rect(x + 2, y + 2, x + 3, y + 3, 9)
            t.px(x + 2, y + 2, 10)
    at.add('baklava', t)
    t = Tex(24, 4, 42)
    t.rect(0, 0, 23, 0, 44)
    t.rect(0, 3, 23, 3, 40)
    at.add('tray_side', t)
    t = Tex(24, 4, 20)
    t.rect(0, 0, 23, 0, 22)
    at.add('copper_side', t)
    # коробка лукума: открытая, кубики в сахарной пудре — белые, розовые, фисташковые
    t = Tex(40, 28, 27)
    t.frame(0, 0, 39, 27, 26)
    t.rect(2, 2, 37, 25, 44)
    for r in range(3):
        for c in range(5):
            x, y = 3 + c * 7, 3 + r * 7
            # кубики в сахарной пудре: почти белые, розовый и фисташковый только просвечивают
            col = (35, 45, 11, 35, 45)[(r * 2 + c) % 5]
            t.rect(x, y, x + 5, y + 5, 45)
            t.checker(x + 1, y + 2, x + 4, y + 5, col)
            t.rect(x, y + 5, x + 5, y + 5, 43)
            t.px(x + 5, y + 1, 44)
    at.add('lokum', t)
    t = Tex(40, 6, 27)
    t.rect(0, 0, 39, 0, 21)
    t.rect(0, 5, 39, 5, 26)
    at.add('lokum_side', t)
    t = Tex(40, 20, 27)  # откинутая крышка с золотым узором
    t.frame(1, 1, 38, 18, 22)
    t.frame(3, 3, 36, 16, 21)
    t.ellipse(20, 10, 4, 4, 22)
    t.ellipse(20, 10, 2, 2, 27)
    at.add('lokum_lid', t)

    # ---------------------------------------------------------------- деловое на столе
    # ноутбук: крышка со светлым логотипом-волной, экран с презентацией линии
    t = Tex(40, 26, 37)
    t.frame(0, 0, 39, 25, 38)
    t.rect(2, 2, 37, 23, 45)
    t.rect(2, 2, 37, 6, 1)
    t.text(4, 2, 'MARMARA', 45)
    # схема линии: подвес, камера напыления, печь
    t.rect(4, 9, 35, 9, 40)
    for x in range(6, 35, 5):
        t.rect(x, 10, x, 12, 40)
        t.rect(x - 1, 13, x + 1, 16, (27, 3, 22, 9, 27, 3, 22)[(x // 5) % 7])
    t.frame(12, 11, 20, 19, 2)
    t.frame(24, 11, 34, 19, 26)
    t.rect(4, 21, 20, 21, 42)
    t.rect(24, 21, 32, 21, 27)
    at.add('screen', t)
    t = Tex(40, 26, 40)
    t.rect(0, 0, 39, 0, 42)
    t.ellipse(20, 13, 4, 4, 43)
    t.line([(17, 14), (19, 12), (21, 14), (23, 12)], 40)
    at.add('lid', t)
    t = Tex(40, 26, 39)
    t.rect(2, 2, 37, 17, 38)
    for y in range(3, 16, 3):
        for x in range(3, 37, 3):
            t.rect(x, y, x + 1, y + 1, 40)
    t.rect(13, 19, 26, 24, 38)
    at.add('keys', t)
    # «домик» с логотипом компании, лицом к игроку
    t = Tex(48, 14, 1)
    t.rect(0, 0, 47, 0, 2)
    logo_wave(t, 3, 4)
    t.text(13, 2, 'MARMARA', 45)
    t.text(13, 8, 'COATING', 4)
    t.rect(0, 13, 47, 13, 0)
    at.add('tent', t)
    # коммерческое предложение на фирменном бланке
    t = Tex(42, 58, 45)
    t.frame(0, 0, 41, 57, 43)
    t.rect(0, 0, 41, 4, 1)
    logo_wave(t, 3, 7)
    t.text(13, 7, 'OFFER', 1)
    for y in range(15, 30, 3):
        t.rect(4, y, 37 - (y * 5) % 11, y, 41)
    t.rect(4, 33, 37, 45, 44)
    for y in (36, 39, 42):
        t.rect(6, y, 22, y, 40)
        t.rect(28, y, 35, y, 2)
    t.text(4, 48, '€480', 27)
    t.line([(26, 53), (30, 50), (33, 54), (38, 51)], 1)
    at.add('quote', t)
    # веер RAL: полоски цветов раскрыты дугой
    t = Tex(40, 24, T)
    cols = [27, 28, 29, 22, 23, 11, 9, 8, 5, 4, 3, 2, 34, 33, 45, 42, 39, 37]
    for i, c in enumerate(cols):
        a = np.pi * (0.95 - i / (len(cols) - 1) * 0.9)
        for r in np.arange(6, 22, 0.5):
            for da in (0, 0.05):
                t.px(20 + r * np.cos(a + da), 22 - r * np.sin(a + da), c)
    t.ellipse(20, 22, 3, 2.5, 45)
    t.px(20, 22, 37)
    at.add('ralfan', t)
    # окрашенные пластины-образцы: стопка, верхняя — синий металлик
    t = Tex(24, 16, 3)
    t.frame(0, 0, 23, 15, 2)
    t.rect(2, 2, 10, 4, 4)
    t.rect(3, 12, 20, 13, 2)
    t.px(20, 2, 45)
    at.add('plate_top', t)
    t = Tex(24, 4, 27)
    t.rect(0, 0, 23, 0, 3)
    t.rect(0, 2, 23, 2, 22)
    t.rect(0, 3, 23, 3, 42)
    at.add('plate_side', t)

    # ---------------------------------------------------------------- стены
    # вывеска: тёмно-синяя панель, знак-волна и название в две строки
    t = Tex(88, 24, 0)
    t.frame(0, 0, 87, 23, 1)
    t.rect(1, 1, 86, 1, 2)
    logo_wave(t, 5, 7, big=True)
    t.text(24, 4, 'MARMARA', 45, 2)
    t.text(24, 16, 'COATING SYSTEMS', 4)
    at.add('sign', t)
    # фото покрасочной линии: подвесной конвейер, детали разных цветов, оператор с пистолетом
    t = Tex(48, 28, 37)
    t.rect(1, 1, 46, 26, 41)
    t.rect(1, 1, 46, 8, 43)
    t.rect(1, 7, 46, 7, 38)
    for x in range(3, 46, 6):
        t.rect(x, 8, x, 11, 38)
        t.rect(x - 2, 12, x + 2, 20, (27, 3, 22, 45, 9, 2, 27, 22)[(x // 6) % 8])
        t.rect(x + 2, 12, x + 2, 20, 38)
    t.rect(30, 14, 40, 25, 40)  # камера напыления
    t.frame(30, 14, 40, 25, 39)
    t.checker(31, 15, 39, 24, 43)
    t.rect(1, 22, 46, 26, 40)
    at.add('poster', t)
    # стойка с образцами покрытий: пластины в прорезях, у каждой номер
    t = Tex(28, 48, 38)
    t.frame(0, 0, 27, 47, 37)
    for r in range(4):
        for c in range(3):
            x, y = 2 + c * 8, 3 + r * 11
            col = (27, 2, 22, 9, 45, 37, 3, 29, 41, 11, 26, 4)[r * 3 + c]
            t.rect(x, y, x + 6, y + 8, col)
            t.rect(x, y, x + 6, y, 45 if col != 45 else 43)
            t.rect(x + 1, y + 7, x + 3, y + 7, 45 if col in (37, 2, 26, 27) else 37)
    at.add('stand', t)
    t = Tex(16, 16, 38)
    t.rect(0, 0, 15, 0, 39)
    at.add('stand_side', t)
    # изникская плитка: панель 6×4 плиток в кобальтовой рамке с бирюзовыми точками
    tw, th = 6, 4
    t = Tex(tw * 16 + 6, th * 16 + 6, 1)
    t.frame(1, 1, t.w - 2, t.h - 2, 4)
    for x in range(3, t.w - 2, 3):
        t.px(x, 1, 45)
        t.px(x, t.h - 2, 45)
    for y in range(3, t.h - 2, 3):
        t.px(1, y, 45)
        t.px(t.w - 2, y, 45)
    for i in range(tw):
        for j in range(th):
            iznik_tile(t, 3 + i * 16, 3 + j * 16)
    at.add('tiles', t)
    # буфет орехового дерева
    t = Tex(48, 26, 13)
    t.rect(0, 0, 47, 1, 14)
    for k in range(3):
        t.frame(1 + k * 16, 3, 14 + k * 16, 24, 12)
        t.rect(6 + k * 16, 13, 9 + k * 16, 13, 21)
    t.rect(0, 25, 47, 25, 12)
    at.add('credenza', t)
    # доска образцов RAL: сетка окрашенных квадратов с подписями
    t = Tex(56, 36, 45)
    t.frame(0, 0, 55, 35, 38)
    t.text(3, 2, 'RAL', 1)
    t.rect(16, 4, 52, 4, 42)
    cols = [27, 28, 22, 23, 9, 8, 3, 2, 1, 33, 45, 44, 41, 39, 37, 17, 15, 13, 11, 5, 26]
    for i, c in enumerate(cols):
        x, y = 3 + (i % 7) * 7 + 1, 9 + (i // 7) * 9
        t.rect(x, y, x + 5, y + 5, c)
        t.rect(x, y + 7, x + 3, y + 7, 42)
    at.add('ralboard', t)
    # назар: синий стеклянный «глаз» на шнурке с бусинами
    t = Tex(12, 20, T)
    t.rect(5, 0, 6, 5, 22)
    t.rect(5, 1, 6, 1, 1)
    t.rect(5, 3, 6, 3, 45)
    t.ellipse(6, 11, 5.5, 5.5, 1)
    t.ellipse(6, 11, 4.5, 4.5, 2)
    t.ellipse(6, 11, 3, 3, 45)
    t.ellipse(6, 11, 2, 2, 4)
    t.ellipse(6, 11, 1, 1, 37)
    t.px(4, 9, 45)
    t.rect(5, 17, 6, 19, 22)
    at.add('nazar', t)
    # растение у двери: олива в глиняном горшке
    t = Tex(40, 64, T)
    t.line([(20, 63), (19, 44), (17, 30)], 13)
    t.line([(19, 48), (25, 36), (27, 22)], 13)
    xs, ys = t.grid()
    for _ in range(70):
        cx_ = float(rng.normal(20, 8))
        cy_ = float(rng.uniform(3, 46 - abs(cx_ - 20) * 0.6))
        a = rng.uniform(-1.2, 1.2)
        dx, dy = xs - cx_, ys - cy_
        uu = dx * np.cos(a) + dy * np.sin(a)
        vv = -dx * np.sin(a) + dy * np.cos(a)
        m = (uu / 3.5) ** 2 + (vv / 1.3) ** 2 <= 1
        t.mask(m, 8 if cy_ > 26 else 9)
        t.mask(m & (vv < -0.4), 10 if cy_ > 18 else 11)
    at.add('olive', t)
    t = Tex(24, 16, 28)
    t.rect(0, 0, 23, 1, 29)
    t.rect(0, 14, 23, 15, 26)
    t.rect(3, 2, 4, 13, 29)
    at.add('pot', t)
    t = Tex(16, 16, 12)
    t.noise(0, 0, 15, 15, 13, 0.3)
    at.add('soil', t)
    # дверь тёмного ореха с латунной ручкой
    t = Tex(48, 104, 13)
    wood(t, 0, 0, 47, 103, 13, 12, 14, 0.25, vertical=True)
    t.frame(0, 0, 47, 103, 12)
    t.frame(6, 8, 41, 46, 12)
    t.frame(6, 56, 41, 96, 12)
    t.rect(38, 50, 44, 51, 22)
    t.rect(38, 50, 38, 54, 21)
    at.add('door_w', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.rect(3, 2, 4, 5, 43)
    at.add('switch', t)
    # шкаф с папками у передней стены
    t = Tex(56, 24, 13)
    t.frame(0, 0, 55, 23, 12)
    t.rect(2, 2, 53, 21, 12)
    x = 3
    i = 0
    while x < 52:
        c = (1, 45, 27, 2, 44, 1, 22)[i % 7]
        t.rect(x, 4, x + 3, 21, c)
        t.rect(x + 1, 7, x + 2, 9, 45 if c != 45 else 41)
        x += 4
        i += 1
    at.add('shelf', t)
    # фото мастерской в Тузле: цех, линия, люди в касках
    t = Tex(56, 30, 21)
    t.rect(1, 1, 54, 28, 43)
    t.rect(1, 1, 54, 9, 44)
    for x in range(3, 54, 8):
        t.rect(x, 2, x + 4, 5, 5)
    t.rect(1, 18, 54, 28, 41)
    t.rect(4, 13, 50, 17, 40)
    for x in range(6, 50, 6):
        t.rect(x, 10, x + 3, 16, (27, 3, 45, 22)[(x // 6) % 4])
    for x in (12, 30, 44):
        t.rect(x, 18, x + 2, 24, 2)
        t.rect(x, 16, x + 2, 17, 22)
    t.text(3, 22, 'TUZLA', 45)
    at.add('tuzla', t)

    # ---------------------------------------------------------------- за окном: башня, паром, чайка
    t = Tex(24, 32, T)  # Девичья башня: островок, белые стены, башня с серым конусом
    t.poly([(0, 31), (3, 27), (21, 27), (23, 31)], 39)
    t.rect(1, 29, 22, 31, 40)
    t.rect(3, 21, 20, 27, 44)
    t.rect(3, 21, 20, 21, 45)
    t.rect(17, 21, 20, 27, 42)
    for x in (5, 9, 13):
        t.rect(x, 23, x + 1, 25, 2)
    t.rect(8, 9, 14, 21, 45)
    t.rect(13, 9, 14, 21, 43)
    t.rect(8, 9, 14, 10, 44)
    t.rect(10, 13, 11, 15, 2)
    t.poly([(7, 9), (11, 2), (15, 9)], 41)
    t.line([(11, 2), (15, 9)], 40)
    t.rect(11, 0, 11, 2, 40)
    t.rect(1, 24, 3, 27, 43)
    at.add('tower', t)
    t = Tex(40, 12, T)  # городской паром-вапур: белые палубы, тёмный корпус, жёлтая труба, бурун за кормой
    t.poly([(4, 7), (36, 7), (34, 10), (6, 10)], 0)
    t.rect(6, 4, 34, 6, 45)
    t.rect(9, 2, 31, 3, 45)
    for x in range(8, 33, 3):
        t.rect(x, 5, x + 1, 5, 2)
    for x in range(11, 30, 3):
        t.px(x, 2, 1)
    t.rect(19, 0, 21, 1, 22)
    t.rect(19, 0, 21, 0, 37)
    t.rect(4, 7, 36, 7, 44)
    t.rect(0, 10, 7, 10, 45)
    t.checker(0, 9, 6, 11, 45)
    t.rect(34, 11, 39, 11, 45)
    at.add('vapur', t)
    t = Tex(8, 4, T)  # чайка: белые крылья «галочкой»
    t.sprite(0, 0, ['#......#', '.#....#.', '..#..#..', '...##...'], {'#': 45})
    t.px(3, 3, 42)
    at.add('gull', t)
    return at


def logo_wave(t, x, y, big=False):
    """Знак Marmara: круг с двумя волнами — море и слой краски."""
    r = 7 if big else 4.5
    t.ellipse(x + r, y + r - (3 if big else 2), r, r, 4)
    t.ellipse(x + r, y + r - (3 if big else 2), r - 1, r - 1, 2)
    cy = y + r - (3 if big else 2)
    for k, c in ((-1, 45), (2, 5)):
        pts = [(x + r + dx, cy + k + 1.2 * np.sin(dx * 1.1)) for dx in np.arange(-r + 1.5, r - 1.2, 0.5)]
        for px_, py_ in pts:
            t.px(px_, py_, c)


# ======================================================================================================
# Большие поверхности
# ======================================================================================================

def plaster(width_m, seam_off=0.0):
    """Белая штукатурка, внизу деревянная панель-плинтус, под потолком карниз."""
    w, h = round(width_m / S), round(HGT / S)
    t = Tex(w, h, 45)
    t.noise(0, 0, w - 1, h - 1, 44, 0.03)
    t.rect(0, 0, w - 1, 2, 44)  # карниз
    t.rect(0, 3, w - 1, 3, 43)
    yb = h - round(0.12 / S)
    t.rect(0, yb, w - 1, h - 1, 13)
    t.rect(0, yb, w - 1, yb, 14)
    return t


def walls(P):
    X = lambda x: (x + HW) / S  # noqa: E731
    Y = lambda y: (HGT - y) / S  # noqa: E731
    out = {}
    # задняя: два окна, простенок между ними; у окон стена светлее, по краям тень
    t = plaster(2 * HW)
    for (g0, g1) in P['win']:
        band_shade(t, X(g0) - 4, Y(P['winY'][1]) - 3, X(g1) + 3, Y(P['winY'][1]) - 1, 1)
    t.shade(0, 0, 2, t.h - 1, 1)
    t.shade(t.w - 3, 0, t.w - 1, t.h - 1, 1)
    out['back'] = t
    # левая: столбец 0 — перед комнаты
    t = plaster(FRONT - BACK)
    Z = lambda z: (FRONT - z) / S  # noqa: E731
    sz0, sz1, sy0, _ = P['sign']
    band_shade(t, Z(sz1) - 1, Y(sy0) + 1, Z(sz0) + 1, Y(sy0) + 2, 1)
    stz0, stz1, sth, _ = P['stand']
    band_shade(t, Z(stz1) - 1, Y(sth) - 1, Z(stz0) + 1, t.h - 1, 1)
    dz0, dz1, dh = P['door']
    band_shade(t, Z(dz1) - 3, Y(dh) - 3, Z(dz0) + 3, t.h - 1, 1)
    daylight(t, lambda col: FRONT - col * S)
    out['left'] = t
    # правая: столбец 0 — зад комнаты
    t = plaster(FRONT - BACK)
    Zr = lambda z: (z - BACK) / S  # noqa: E731
    tz0, tz1, ty0, _ = P['tiles']
    band_shade(t, Zr(tz0) + 1, Y(ty0) + 1, Zr(tz1) + 1, Y(ty0) + 2, 1)
    cz0, cz1, ch, _ = P['credenza']
    band_shade(t, Zr(cz0) - 1, Y(ch) - 1, Zr(cz1) + 1, t.h - 1, 1)
    daylight(t, lambda col: BACK + col * S)
    out['right'] = t
    # передняя: столбец 0 — x = +HW; от окон дальше всего — темнее
    t = plaster(2 * HW)
    Xf = lambda x: (HW - x) / S  # noqa: E731
    bx0, bx1, bh, _ = P['shelf']
    band_shade(t, Xf(bx1) - 1, Y(bh) - 1, Xf(bx0) + 1, t.h - 1, 1)
    t.a = darker(t.a)
    out['front'] = t
    return out


def daylight(t, z_of_col):
    """Боковые стены: у окон светлее, к нам темнее."""
    ys, xs = np.mgrid[0:t.h, 0:t.w]
    z = z_of_col(xs + 0.5)
    by = BAYER[ys % 4, xs % 4]
    lv = np.where(z + (by - 0.5) * 0.1 > 0.6, 1, 0)
    lv = np.where(z + (by - 0.5) * 0.1 > 1.7, 2, lv)
    shade_levels(t, lv, m=(t.a != 13))


def floor_tex(P, seats):
    """Дубовый паркет ёлочкой не читается в 360 точках — доска вдоль комнаты; на ней килим с ромбами."""
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 14)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    for x in range(0, w, 6):
        t.rect(x, 0, x, h - 1, 13)
        off = int(rng.integers(0, 40))
        for y in range(off, h, 40):
            t.rect(x, y, x + 5, y, 13)
    t.noise(0, 0, w - 1, h - 1, 15, 0.02, on=14)
    # килим: красное поле, кайма, ряды ромбов
    k0, k1, kz0, kz1 = P['kilim']
    x0, x1, y0, y1 = int(X(k0)), int(X(k1)), int(Zf(kz0)), int(Zf(kz1))
    t.rect(x0, y0, x1, y1, 26)
    t.frame(x0, y0, x1, y1, 1)
    t.frame(x0 + 1, y0 + 1, x1 - 1, y1 - 1, 1)
    t.frame(x0 + 3, y0 + 3, x1 - 3, y1 - 3, 22)
    for x in range(x0 + 5, x1 - 4, 4):  # бахрома-зубцы каймы
        t.px(x, y0 + 5, 45)
        t.px(x, y1 - 5, 45)
    xs, ys = t.grid()
    for cy in range(y0 + 14, y1 - 10, 18):
        for cx in range(x0 + 14, x1 - 10, 18):
            d = np.abs(xs - cx - 0.5) + np.abs(ys - cy - 0.5)
            t.mask(d <= 7, 1)
            t.mask(d <= 5, 22)
            t.mask(d <= 3, 45)
            t.mask(d <= 1, 27)
    fr = (ys < y0) | (ys > y1)
    t.mask(fr & (xs > x0) & (xs < x1) & (((ys >= y0 - 2) & (ys < y0)) | ((ys > y1) & (ys <= y1 + 2))) & (xs.astype(int) % 2 == 0), 44)
    # свет из окон: светлые трапеции к нам
    for (g0, g1) in P['win']:
        t.shade_poly([(X(g0 + 0.1), 0), (X(g1 - 0.1), 0), (X(g1 * 0.85), Zf(-1.2)), (X(g0 * 0.85 + 0.05), Zf(-1.2))], -1)
    tx0, tx1 = X(-TABLE['halfLen']), X(TABLE['halfLen'])
    tz0, tz1 = Zf(TABLE['far']), Zf(TABLE['near'])
    band_shade(t, tx0, tz0, tx1, tz1, 1)
    t.shade(tx0 + 3, tz0 + 3, tx1 - 3, tz1 - 3, 1)
    for (x, z) in seats:
        t.shade_ellipse(X(x), Zf(z), 0.26 / S, 0.24 / S, 1)
    cz0, cz1, _, cd = P['credenza']
    band_shade(t, X(HW - cd) - 1, Zf(cz0) - 1, w - 1, Zf(cz1) + 1, 1)
    stz0, stz1, _, sd = P['stand']
    band_shade(t, 0, Zf(stz0) - 1, X(-HW + sd) + 1, Zf(stz1) + 1, 1)
    bx0, bx1, _, bd = P['shelf']
    band_shade(t, X(bx0) - 1, Zf(FRONT - bd) - 1, X(bx1) + 1, h - 1, 1)
    px, pz = P['plant']
    t.shade_ellipse(X(px), Zf(pz), 0.3 / S, 0.28 / S, 1)
    return t


def ceiling_tex(P):
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 45)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    t.noise(0, 0, w - 1, h - 1, 44, 0.02)
    t.rect(0, 0, w - 1, 2, 44)
    falloff(t, X(0), Zf(-1.5), 3.4 / S, 3.0 / S, steps=2, start=0.8, width=0.5, soft=0.2)
    for (x, z) in P['downlights']:
        t.ellipse(X(x), Zf(z), 2.5, 2.5, 43)
        t.ellipse(X(x), Zf(z), 1.5, 1.5, 45)
    return t


def table_tex(P):
    """Тёмный орех с длинными волокнами, блики от окон у дальнего края, тени от вещей."""
    L, Fz, N = TABLE['halfLen'], TABLE['far'], TABLE['near']
    w = 256
    s = 2 * L / w
    h = round((N - Fz) / s)
    X = lambda x: (x + L) / s  # noqa: E731
    Zt = lambda z: (z - Fz) / s  # noqa: E731
    t = Tex(w, h, 13)
    for y in range(h):
        x = -int(rng.integers(0, 50))
        while x < w:
            n = int(rng.integers(18, 80))
            r = rng.random()
            if r < 0.22:
                t.rect(x, y, x + n, y, 12)
            elif r < 0.36:
                t.rect(x, y, x + n // 2, y, 14)
            x += n + int(rng.integers(8, 40))
    for (g0, g1) in P['win']:
        t.shade_poly([(X(g0 * 0.6), 0), (X(g1 * 0.6), 0), (X(g1 * 0.5), Zt(-0.6)), (X(g0 * 0.5), Zt(-0.6))], -1)
    bx, bz, _ = P['baklava']
    t.shade_ellipse(X(bx + 0.015), Zt(bz + 0.02), 0.19 / s, 0.18 / s, 1)
    lx, lz, _ = P['lokum']
    t.shade_ellipse(X(lx + 0.01), Zt(lz + 0.02), 0.15 / s, 0.1 / s, 1)
    for (x, z) in P['tea']:
        t.shade_ellipse(X(x + 0.01), Zt(z + 0.01), 0.06 / s, 0.05 / s, 1)
    cx, cz = P['caydanlik']
    t.shade_ellipse(X(cx + 0.02), Zt(cz + 0.02), 0.15 / s, 0.13 / s, 1)
    lpx, lpz, _ = P['laptop']
    t.shade_ellipse(X(lpx + 0.02), Zt(lpz + 0.02), 0.2 / s, 0.15 / s, 1)
    t.frame(0, 0, w - 1, h - 1, 12)
    t.rect(0, 1, w - 1, 1, 14)
    return t


# ======================================================================================================
# Босфор
# ======================================================================================================

def bos_far():
    """Небо, дальняя вода и европейский берег: слева старый город с куполами и минаретами, по центру Галата,
    справа холмы Бешикташа и мост. Утро: солнце за спиной, тот берег освещён тёплым."""
    x0, x1, y0, y1, _ = BOS['far']
    s = 0.08
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731
    t = Tex(w, h, 3)
    xs, ys = t.grid()
    by = BAYER[ys.astype(int) % 4, xs.astype(int) % 4]
    # небо: сверху голубое, к горизонту светлее, ступенями с шахматным переходом
    yy = (ys - Y(10)) / (Y(-0.2) - Y(10))
    band = np.floor(yy * 3 + (by - 0.5) * 0.5)
    t.mask(band >= 1, 4)
    t.mask(band >= 2, 5)
    # облака
    for (cx, cy, rx, ry) in ((-11, 7.5, 2.4, 0.35), (-9.5, 7.8, 1.4, 0.3), (2.5, 8.6, 3.0, 0.4), (4.5, 8.9, 1.6, 0.3),
                             (11, 6.4, 2.2, 0.3), (-3.5, 5.2, 1.8, 0.25), (8.5, 4.6, 1.2, 0.2)):
        m = ((xs - X(cx)) / (rx / s)) ** 2 + ((ys - Y(cy)) / (ry / s)) ** 2 <= 1
        t.mask(m, 45)
        t.mask(m & (ys > Y(cy) + 1), 44)
    shore = 0.45
    # дальний берег: силуэт холмов (сплошная заливка до воды), дымка — светлее у горизонта
    def hill(x):
        return shore + 0.75 + 0.35 * np.sin(x * 0.35 + 1.0) + 0.25 * np.sin(x * 0.9) + np.where(x > 6, 0.25 + 0.1 * (x - 6), 0)
    top = Y(hill((xs * s) + x0))
    land = (ys >= top) & (ys <= Y(shore))
    t.mask(land, 41)
    t.mask(land & (ys > top + 3), 40)
    # дома на склонах: светлые прямоугольники с красными крышами, плотнее у воды
    for _ in range(900):
        x = rng.uniform(x0, x1)
        yt = float(hill(np.array(x)))
        y = rng.uniform(shore + 0.05, yt)
        bw, bh = rng.integers(2, 5), rng.integers(2, 4)
        px_, py_ = X(x), Y(y)
        if py_ - bh < Y(yt):
            continue
        c = (44, 43, 17, 45, 16)[int(rng.integers(0, 5))]
        t.rect(px_, py_ - bh, px_ + bw, py_, c)
        t.rect(px_ + bw, py_ - bh, px_ + bw, py_, 42)
        if rng.random() < 0.6:
            t.rect(px_, py_ - bh, px_ + bw, py_ - bh, 28 if rng.random() < 0.6 else 29)
    # зелень парков
    for (cx, cy, r) in ((-14.5, 0.6, 0.7), (-8.2, 0.5, 0.5), (9.5, 0.9, 1.0), (13.0, 1.4, 0.8)):
        m = ((xs - X(cx)) / (r / s)) ** 2 + ((ys - Y(cy)) / (r * 0.4 / s)) ** 2 <= 1
        t.mask(m & land, 8)
        t.mask(m & land & ((xs.astype(int) + ys.astype(int)) % 3 == 0), 9)

    # мечети старого города слева: купола и тонкие минареты — силуэты в дымке
    def mosque(cx, base, dome, minarets):
        px_, pb = X(cx), Y(base)
        r = dome / s
        t.rect(px_ - r * 1.6, pb - r * 0.9, px_ + r * 1.6, pb, 42)
        t.ellipse(px_, pb - r * 0.9, r, r, 42)
        t.rect(px_ - r, pb - r * 0.9, px_ + r, pb, 42)
        for k in (-1, 1):
            t.ellipse(px_ + k * r * 1.2, pb - r * 0.75, r * 0.5, r * 0.5, 42)
        t.rect(px_, pb - r * 1.9 - 1, px_, pb - r * 1.9, 41)
        t.rect(px_ - r * 0.6, pb - r * 1.3, px_ + r * 0.6, pb - r * 0.9, 43)
        for (mx, mh) in minarets:
            mxp = X(cx + mx)
            t.rect(mxp, Y(base + mh), mxp + 1, pb, 43)
            t.rect(mxp, Y(base + mh * 0.72), mxp + 1, Y(base + mh * 0.72), 41)
            t.px(mxp, Y(base + mh) - 1, 41)
            t.px(mxp, Y(base + mh) - 2, 41)
    mosque(-13.0, hill(np.array(-13.0)) - 0.15, 0.32, [(-0.75, 1.5), (0.75, 1.5), (-1.05, 1.3), (1.05, 1.3)])
    mosque(-9.6, hill(np.array(-9.6)) - 0.1, 0.26, [(-0.6, 1.25), (0.6, 1.25)])
    mosque(-6.0, hill(np.array(-6.0)) - 0.12, 0.28, [(-0.7, 1.35), (0.7, 1.35), (-0.95, 1.15), (0.95, 1.15)])
    # Галата: каменная башня с конусом над крышами
    gx, gb = X(1.8), Y(hill(np.array(1.8)) - 0.05)
    t.rect(gx - 2, gb - 18, gx + 2, gb, 16)
    t.rect(gx + 2, gb - 18, gx + 2, gb, 15)
    t.rect(gx - 3, gb - 19, gx + 3, gb - 18, 44)
    t.poly([(gx - 3, gb - 19), (gx, gb - 26), (gx + 3, gb - 19)], 40)
    t.px(gx, gb - 12, 40)
    # небоскрёбы Левента вдали справа
    for (bx, bh_) in ((7.6, 1.6), (8.1, 2.1), (8.6, 1.4), (10.4, 1.8)):
        top_ = hill(np.array(bx)) + bh_
        t.rect(X(bx), Y(top_), X(bx) + 3, Y(hill(np.array(bx))), 42)
        t.rect(X(bx) + 3, Y(top_), X(bx) + 3, Y(hill(np.array(bx))), 41)
    # мост справа: пилоны, провисающие тросы, полотно
    deck = shore + 0.55
    p1, p2 = 12.2, 17.5
    for p in (p1, p2):
        t.rect(X(p) - 1, Y(deck + 1.9), X(p) + 1, Y(shore), 40)
        t.rect(X(p) - 2, Y(deck + 0.4), X(p) + 2, Y(deck + 0.4), 40)
    for x in np.arange(p1 - 4.0, p2 + 0.5, s / 2):
        u = (x - p1) / (p2 - p1)
        cy = deck + 1.85 - 1.7 * 4 * u * (1 - u) if 0 <= u <= 1 else deck + 1.85 - (p1 - x) * 0.42
        if cy > deck:
            t.px(X(x), Y(cy), 39)
        if 0 <= u <= 1 and int(x / s) % 6 == 0:
            t.rect(X(x), Y(cy), X(x), Y(deck), 41)
    t.rect(X(p1 - 4.0), Y(deck), w - 1, Y(deck) + 1, 39)
    t.rect(X(p1 - 4.0), Y(deck) + 2, w - 1, Y(deck) + 2, 41)
    # кромка у воды: набережная, светлая полоса
    t.rect(0, Y(shore) - 1, w - 1, Y(shore), 43)
    # дальняя вода: синяя, к горизонту светлее, редкая рябь и блики
    water = ys > Y(shore)
    t.mask(water, 3)
    t.mask(water & (ys < Y(shore) + 3) & (by > 0.5), 4)
    for _ in range(260):
        x, y = rng.integers(0, w), rng.integers(int(Y(shore)) + 2, h)
        t.rect(x, y, x + rng.integers(1, 4), y, 4 if rng.random() < 0.7 else 2)
    for _ in range(60):
        x, y = rng.integers(0, w), rng.integers(int(Y(shore)) + 2, h)
        t.px(x, y, 45)
    return t


def bos_water():
    x0, x1, z0, z1, _ = BOS['water']
    s = 0.1
    w, h = round((x1 - x0) / s), round((z1 - z0) / s)
    t = Tex(w, h, 2)
    for y in range(h):
        x = -int(rng.integers(0, 10))
        while x < w:
            n = int(rng.integers(2, 7))
            r = rng.random()
            if r < 0.35:
                t.rect(x, y, x + n, y, 3)
            elif r < 0.45:
                t.rect(x, y, x + n // 2, y, 1)
            elif r < 0.48:
                t.rect(x, y, x + 1, y, 45 if y < h * 0.6 else 4)
            x += n + int(rng.integers(1, 6))
    return t


def bos_near():
    """Ближний план: крыши и кипарисы Ускюдара, набережная с фонарями. Сверху — прозрачно."""
    x0, x1, y0, y1, _ = BOS['near']
    s = 0.04
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731
    t = Tex(w, h, T)
    # набережная по низу
    t.rect(0, Y(-1.15), w - 1, h - 1, 42)
    t.rect(0, Y(-1.15), w - 1, Y(-1.15), 44)
    t.rect(0, Y(-1.05), w - 1, Y(-1.05), 37)
    for x in np.arange(x0, x1, 0.16):
        t.rect(X(x), Y(-1.05), X(x), Y(-1.15), 37)
    for x in np.arange(x0 + 0.6, x1, 2.4):  # фонари
        t.rect(X(x), Y(-0.45), X(x), Y(-1.15), 37)
        t.rect(X(x) - 1, Y(-0.43), X(x) + 1, Y(-0.4), 22)
    # дома: крыши черепицей, белые и охристые стены, окна
    x = x0
    while x < x1:
        bw = rng.uniform(0.6, 1.3)
        top = rng.uniform(-0.75, -0.35)
        c = (45, 44, 17, 16, 23)[int(rng.integers(0, 5))]
        if rng.random() < 0.25:  # просвет между домами — деревья
            for k in range(3):
                cx = X(x + rng.uniform(0, bw))
                cy = Y(rng.uniform(-0.7, -0.4))
                t.ellipse(cx, cy, rng.uniform(4, 8), rng.uniform(3, 5), 8)
                t.ellipse(cx - 1, cy - 1, 2, 1.5, 9)
            x += bw
            continue
        t.rect(X(x), Y(top), X(x + bw), Y(-1.15) - 1, c)
        t.rect(X(x + bw) - 1, Y(top), X(x + bw), Y(-1.15) - 1, darker(np.array(c)).item())
        t.poly([(X(x) - 1, Y(top)), (X(x + bw * 0.5), Y(top + 0.18)), (X(x + bw) + 1, Y(top))], 27)
        t.line([(X(x) - 1, Y(top)), (X(x + bw) + 1, Y(top))], 26)
        for wx in np.arange(x + 0.12, x + bw - 0.1, 0.22):
            for wy in np.arange(top - 0.12, -1.0, 0.25):
                t.rect(X(wx), Y(wy), X(wx) + 2, Y(wy) + 3, 2)
        x += bw + rng.uniform(0, 0.15)
    # кипарисы
    for cx in (-6.2, -2.8, 3.3, 6.6):
        t.poly([(X(cx) - 4, Y(-0.85)), (X(cx), Y(0.0)), (X(cx) + 4, Y(-0.85))], 7)
        t.line([(X(cx), Y(-0.05)), (X(cx) + 2, Y(-0.7))], 8)
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
    surfaces['bos_far'] = bos_far()
    surfaces['bos_water'] = bos_water()
    surfaces['bos_near'] = bos_near()
    write_all('istanbul', at, surfaces, dict(PLACE, bos=BOS), 'tools/art/room_istanbul.py')


if __name__ == '__main__':
    main()
