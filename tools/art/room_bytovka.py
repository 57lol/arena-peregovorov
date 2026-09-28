"""Бытовка нового цеха «Водогрея» (src/game/world3d/rooms/bytovka.ts): пятница, 23:10, ночь перед запуском линии.

Лампы дневного света, синяя панель по низу стен, стол с клеёнкой в клетку, шкафчики с касками. Большое окно
в цех: оранжевые роботы под рабочими прожекторами, подвесной конвейер с баками, стеллажи с гофрокоробами.
Стены, пол, потолок, столешница и дальняя стена цеха — уникальные текстуры, мелочь — атлас в трёх вариантах света.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/room_bytovka.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rooms_common import (R, T, Tex, band_shade, darker, ellipse_mask, falloff, text_w, tint, write_all)  # noqa: E402
from room3d import BACK, FRONT, HGT, HW, S, TABLE, Atlas, solid, wood  # noqa: E402

rng = R.rng

PLACE = {
    'window': [-2.75, -0.3, 0.9, 2.5],
    'board': [0.4, 1.9, 1.34, 2.14],
    'lockers': [-2.62, -0.72, 1.8, 0.5],
    'counter': [-2.62, -1.5, 0.86, 0.56],
    'poster': [-0.62, 1.55],
    'hooks': [0.05, 0.85, 1.75],
    'door': [1.2, 2.1, 2.05],
    'extinguisher': [-2.98, 0.95],
    'stand': [0.25, 1.45, 1.1, 1.85],
    'aptechka': [2.3, 1.55],
    'cooler': [1.62, 1.22],
    'calendar': [-2.2, 1.6],
    'lamps': [[-1.3, -1.35], [1.3, -1.35], [-1.3, 0.85], [1.3, 0.85]],
    'thermos': [0.47, -0.76],
    'domino': [-0.72, -0.36],
    'bazaar': [-1.2, -0.06],
    'sushki': [0.74, -0.4],
    'mugs': [[-0.48, -0.78], [0.84, -0.18], [-1.22, -0.36], [1.18, -0.56]],
    'hats': [[-1.36, -0.74, 0.3, 'hat_w'], [1.37, -0.3, -0.5, 'hat_o'], [1.3, -0.8, 1.2, 'hat_w']],
    'robots': [[-3.4, -7.4, 0.25], [-1.75, -6.2, 2.9]],
}
# цех за окном: дальняя стена, стеллажи, растяжка, лучи прожекторов, подвесной конвейер
HALL = {
    'wall': [-11.5, -0.5, -0.5, 6.5, -13.5],
    'racks': [-10.4, -5.6, 0.0, 4.6, -11.2],
    'banner': [-7.9, -4.6, 3.2, 3.85, -9.4],
    'crane': [-11.0, 0.5, 4.1, -10.0],
    'pallets': [-2.0, -0.85, 0.0, 1.9, -9.0],
    'fence': [-5.6, -0.2, 0.0, 1.35, -5.3],
    'column': [-5.7, -6.6],
    'conveyor': [-9.0, 1.0, 2.35, -6.6],
}


# ======================================================================================================
# Атлас
# ======================================================================================================

def items(at):
    for c in (0, 1, 2, 3, 4, 7, 8, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 36, 37, 38, 39, 40, 41, 42,
              43, 44, 45):
        at.add(f'c{c}', solid(c))
    t = Tex(8, 8, 42)
    t.rect(0, 0, 7, 1, 44)
    t.rect(0, 6, 7, 7, 40)
    at.add('chrome', t)

    # часы: чёрный обод, белый циферблат
    t = Tex(40, 40, T)
    cx = cy = 20
    t.ellipse(cx, cy, 20, 20, 37)
    t.ellipse(cx, cy, 18, 18, 38)
    t.ellipse(cx, cy, 17, 17, 45)
    xs, ys = t.grid()
    m = (((xs - cx) / 17) ** 2 + ((ys - cy) / 17) ** 2 <= 1) & (((xs - cx) / 17) ** 2 + ((ys - cy + 1.5) / 16) ** 2 > 1)
    t.mask(m & (ys < cy), 43)
    for i in range(60):
        a = i / 60 * 2 * np.pi
        big = i % 5 == 0
        for rr in (np.arange(12.5, 16) if big else [15.2]):
            t.px(cx - 0.5 + rr * np.sin(a) + 0.5, cy - 0.5 - rr * np.cos(a) + 0.5, 37 if big else 42)
    t.rect(cx - 2, cy + 6, cx + 1, cy + 6, 2)
    at.add('clock', t)
    at.add('clock_rim', Tex(8, 4, 37))

    # доска: «ДО ЗАПУСКА: 3 СУТОК», график смен маркером
    t = Tex(120, 64, 45)
    t.frame(0, 0, 119, 63, 41)
    t.rect(1, 1, 118, 1, 44)
    t.text(60 - text_w('ДО ЗАПУСКА:', 2) // 2, 4, 'ДО ЗАПУСКА:', 1, 2)
    t.text(60 - text_w('3 СУТОК', 3) // 2 + 2, 17, '3 СУТОК', 27, 3)
    t.ellipse(60 - text_w('3 СУТОК', 3) // 2 + 5, 24, 8, 9.5, 27)  # тройка обведена
    t.ellipse(60 - text_w('3 СУТОК', 3) // 2 + 5, 24, 7, 8.5, 45)
    t.text(60 - text_w('3 СУТОК', 3) // 2 + 2, 17, '3', 27, 3)
    t.frame(6, 38, 113, 60, 2)
    for x in (30, 51, 72, 93):
        t.rect(x, 38, x, 60, 2)
    for y in (45, 52):
        t.rect(6, y, 113, y, 2)
    for i, d in enumerate(('ПТ', 'СБ', 'ВС', 'ПН')):
        t.text(35 + i * 21, 40, d, 1)
    t.text(9, 47, '1 СМ', 1)
    t.text(9, 54, '2 СМ', 1)
    for (x, y, c) in ((36, 47, 8), (57, 47, 8), (78, 47, 27), (36, 54, 8), (57, 54, 27), (99, 47, 8), (99, 54, 8)):
        t.line([(x, y + 2), (x + 2, y + 4), (x + 7, y - 1)], c) if c == 8 else t.line([(x, y), (x + 6, y + 4)], c)
        t.line([(x, y + 4), (x + 6, y)], c) if c == 27 else None
    t.rect(92, 30, 113, 30, 27)  # «ЗАПУСК ПН 8:00» — подчёркнуто
    t.rect(4, 62, 60, 62, 43)
    at.add('board', t)
    t = Tex(24, 4, 42)
    t.rect(0, 0, 23, 0, 44)
    t.rect(3, 1, 7, 2, 27)
    t.rect(10, 1, 14, 2, 1)
    t.rect(17, 1, 18, 2, 8)
    at.add('tray', t)

    # плакат «ОХРАНА ТРУДА»
    t = Tex(48, 68, 45)
    t.frame(0, 0, 47, 67, 42)
    t.rect(1, 1, 46, 14, 27)
    t.text(24 - text_w('ОХРАНА') // 2, 2, 'ОХРАНА', 45)
    t.text(24 - text_w('ТРУДА') // 2, 8, 'ТРУДА', 45)
    # рабочий в каске, очках и перчатках
    t.ellipse(17, 25, 6, 3.5, 22)
    t.rect(10, 26, 24, 27, 21)
    t.ellipse(17, 31, 4.5, 5, 15)
    t.rect(13, 29, 21, 30, 4)
    t.rect(13, 29, 21, 29, 3)
    t.poly([(7, 54), (9, 37), (25, 37), (27, 54)], 1)
    t.rect(8, 42, 26, 43, 29)
    t.rect(8, 48, 26, 49, 29)
    t.rect(16, 37, 18, 54, 2)
    t.rect(27, 38, 30, 42, 22)  # перчатка поднята
    t.line([(25, 40), (28, 38)], 1)
    # пиктограммы справа: каска, очки, перчатка
    for i, (col, spr) in enumerate(((2, ['.###.', '#####', '#####']), (2, ['##.##', '#####', '.#.#.']),
                                    (2, ['.#.#.', '#####', '.###.']))):
        y0 = 20 + i * 11
        t.ellipse(38.5, y0 + 3.5, 5, 5, 3)
        t.sprite(36, y0 + 2, spr, {'#': 45})
    t.rect(1, 57, 46, 66, 23)
    for x in range(-8, 48, 6):
        t.poly([(x, 66), (x + 3, 66), (x + 12, 57), (x + 9, 57)], 37)
    t.rect(1, 56, 46, 56, 37)
    at.add('poster_ot', t)

    # металлический шкафчик: дверца с жалюзи, ручка, номер
    t = Tex(16, 72, 3)
    t.rect(0, 0, 15, 71, 3)
    t.frame(0, 0, 15, 71, 2)
    t.rect(1, 1, 14, 1, 4)
    for y in range(5, 14, 2):
        t.rect(4, y, 11, y, 1)
    for y in range(58, 66, 2):
        t.rect(4, y, 11, y, 1)
    t.rect(12, 32, 13, 40, 42)
    t.rect(12, 36, 13, 36, 38)
    t.rect(4, 17, 11, 21, 45)
    t.rect(5, 19, 10, 19, 41)
    t.rect(1, 70, 14, 70, 1)
    at.add('locker', t)
    t = Tex(16, 16, 2)
    t.rect(0, 0, 15, 0, 3)
    at.add('locker_side', t)
    t = Tex(16, 16, 3)
    t.noise(0, 0, 15, 15, 4, 0.05)
    at.add('locker_top', t)
    # бирки с фамилиями на дверцах — пять вариантов через атлас не нужны: одна текстура на все

    # спецовка: тёмно-синяя куртка с оранжевыми светоотражающими полосами
    t = Tex(26, 46, T)
    t.poly([(5, 3), (21, 3), (25, 45), (1, 45)], 1)
    t.poly([(9, 0), (17, 0), (18, 6), (8, 6)], 0)
    t.rect(12, 4, 13, 45, 0)
    for y in (22, 32):
        t.rect(2, y, 24, y + 2, 29)
        t.rect(2, y + 1, 24, y + 1, 23)
    t.line([(5, 4), (2, 42)], 2)
    t.rect(4, 12, 9, 15, 0)
    t.rect(16, 12, 21, 15, 0)
    t.rect(15, 13, 20, 13, 29)  # нашивка «ВОДОГРЕЙ»
    at.add('spets', t)
    t = Tex(24, 36, T)  # сигнальный жилет
    t.poly([(4, 2), (9, 2), (12, 10), (15, 2), (20, 2), (23, 35), (1, 35)], 28)
    t.rect(1, 18, 23, 20, 44)
    t.rect(1, 26, 23, 28, 44)
    t.line([(9, 2), (12, 10), (15, 2)], 27)
    t.rect(12, 10, 12, 35, 27)
    at.add('vest', t)
    t = Tex(26, 44, T)  # серая куртка-ватник
    t.poly([(5, 3), (21, 3), (25, 43), (1, 43)], 39)
    for y in range(6, 43, 5):
        t.rect(2, y, 24, y, 38)
    t.poly([(8, 0), (18, 0), (18, 5), (8, 5)], 38)
    t.rect(12, 3, 13, 43, 37)
    at.add('vatnik', t)

    # каски: белая и оранжевая
    for name, a, b, c in (('hat_w', 45, 44, 43), ('hat_o', 22, 21, 20), ('hat_y', 23, 22, 21)):
        t = Tex(16, 12, b)
        t.rect(0, 0, 15, 3, a)
        t.rect(0, 9, 15, 11, c)
        t.rect(7, 0, 8, 11, c)
        t.rect(2, 5, 5, 6, a)
        at.add(name, t)

    # тумба, микроволновка, чайник, банка кофе
    t = Tex(36, 26, 44)
    t.rect(0, 0, 35, 1, 45)
    t.frame(1, 3, 17, 24, 42)
    t.frame(18, 3, 34, 24, 42)
    t.rect(15, 11, 15, 16, 40)
    t.rect(20, 11, 20, 16, 40)
    t.rect(0, 25, 35, 25, 40)
    at.add('counter', t)
    t = Tex(16, 16, 40)
    t.noise(0, 0, 15, 15, 41, 0.15)
    t.rect(0, 0, 15, 0, 42)
    at.add('counter_top', t)
    t = Tex(32, 18, 44)  # микроволновка: тёмное стекло, табло «23:10»
    t.rect(0, 0, 31, 0, 45)
    t.rect(2, 2, 21, 15, 37)
    t.rect(3, 3, 20, 14, 36)
    t.line([(5, 13), (11, 4)], 38)
    t.rect(21, 7, 22, 10, 40)
    t.rect(24, 2, 30, 6, 36)
    t.text(24, 2, '2', 9) if False else None
    t.rect(25, 3, 26, 5, 9)
    t.rect(28, 3, 29, 5, 9)
    for y in (9, 11, 13):
        t.rect(25, y, 29, y, 42)
    t.rect(0, 17, 31, 17, 41)
    at.add('mw', t)
    t = Tex(16, 16, 43)
    t.rect(0, 0, 15, 0, 44)
    for y in range(4, 12, 2):
        t.rect(3, y, 12, y, 41)
    at.add('mw_side', t)
    t = Tex(32, 20, 42)  # стальной чайник
    t.rect(0, 0, 31, 1, 44)
    t.rect(5, 2, 6, 19, 45)
    t.rect(7, 2, 7, 19, 44)
    t.rect(22, 2, 23, 19, 40)
    t.rect(0, 18, 31, 19, 37)
    t.rect(13, 14, 15, 15, 27)
    at.add('kettle_s', t)
    t = Tex(16, 16, 42)
    t.ellipse(8, 8, 5, 5, 43)
    t.rect(7, 5, 8, 10, 37)
    at.add('kettle_s_top', t)
    t = Tex(24, 16, 12)  # банка растворимого кофе
    t.rect(0, 0, 23, 2, 22)
    t.rect(0, 5, 23, 11, 27)
    t.rect(2, 7, 12, 9, 23)
    t.rect(0, 13, 23, 15, 12)
    at.add('coffee_jar', t)

    # огнетушитель, аптечка, дверь, стенд, календарь
    t = Tex(16, 32, 27)
    t.rect(0, 0, 15, 2, 28)
    t.rect(3, 3, 3, 31, 28)
    t.rect(4, 3, 4, 31, 29)
    t.rect(12, 3, 13, 31, 26)
    t.rect(1, 10, 14, 22, 45)
    t.rect(2, 11, 13, 13, 27)
    for y in (16, 18, 20):
        t.rect(3, y, 12, y, 41)
    t.rect(0, 30, 15, 31, 26)
    at.add('ext', t)
    t = Tex(20, 16, 45)
    t.frame(0, 0, 19, 15, 42)
    t.rect(8, 3, 11, 12, 27)
    t.rect(5, 6, 14, 9, 27)
    t.rect(1, 1, 18, 1, 44)
    at.add('aptechka', t)
    t = Tex(48, 104, 42)  # железная дверь, табличка «БЫТОВКА»
    t.noise(0, 0, 47, 103, 41, 0.05)
    t.frame(0, 0, 47, 103, 40)
    t.rect(1, 1, 46, 1, 43)
    t.frame(5, 6, 42, 97, 41)
    t.rect(6, 7, 41, 7, 43)
    t.rect(4, 52, 7, 62, 40)
    t.rect(5, 53, 6, 61, 44)
    t.rect(4, 66, 7, 68, 38)
    t.rect(24 - text_w('БЫТОВКА') // 2 - 3, 22, 24 + text_w('БЫТОВКА') // 2 + 3, 30, 45)
    t.frame(24 - text_w('БЫТОВКА') // 2 - 3, 22, 24 + text_w('БЫТОВКА') // 2 + 3, 30, 2)
    t.text(24 - text_w('БЫТОВКА') // 2, 24, 'БЫТОВКА', 1)
    t.ellipse(24, 40, 5, 5, 27)  # «не курить»
    t.ellipse(24, 40, 4, 4, 45)
    t.rect(21, 40, 27, 40, 37)
    t.line([(21, 37), (27, 43)], 27)
    t.noise(0, 88, 47, 103, 40, 0.1)
    at.add('door_m', t)
    t = Tex(60, 38, 19)  # стенд: приказы, фото бригады, схема эвакуации
    t.frame(0, 0, 59, 37, 20)
    t.rect(2, 2, 57, 35, 17)
    t.noise(2, 2, 57, 35, 16, 0.2)
    for (x0, y0, w, h, c) in ((4, 4, 14, 18, 45), (20, 5, 14, 18, 45), (37, 4, 19, 13, 44), (6, 24, 18, 11, 45),
                              (28, 20, 14, 15, 45), (45, 19, 11, 16, 5)):
        t.rect(x0, y0, x0 + w, y0 + h, c)
        t.px(x0 + w // 2, y0, 27)
        if c == 45:
            for yy in range(y0 + 3, y0 + h - 1, 2):
                t.rect(x0 + 2, yy, x0 + w - 2 - (yy % 3), yy, 41)
    t.rect(38, 6, 54, 14, 2)  # фото бригады
    for k in range(5):
        t.ellipse(40 + k * 3.3, 10, 1.2, 1.5, 15)
        t.rect(39 + k * 3.3, 12, 41 + k * 3.3, 14, 1 if k % 2 else 29)
    t.rect(46, 21, 54, 33, 45)  # схема эвакуации
    t.frame(46, 21, 54, 33, 8)
    t.line([(48, 31), (48, 24), (53, 24)], 8)
    t.text(6, 4, 'ПРИКАЗ', 1) if text_w('ПРИКАЗ') < 16 else None
    at.add('stand', t)
    t = Tex(28, 42, 45)  # календарь с цехом
    t.frame(0, 0, 27, 41, 43)
    t.rect(0, 0, 27, 2, 40)
    t.rect(2, 4, 25, 17, 1)
    t.rect(2, 13, 25, 17, 38)
    t.rect(6, 8, 9, 13, 29)
    t.rect(7, 6, 12, 7, 29)
    t.rect(15, 9, 22, 13, 44)
    t.rect(2, 19, 25, 23, 2)
    t.text(6, 19, '2026', 45)
    for r in range(3):
        for c in range(6):
            t.rect(3 + c * 4, 26 + r * 5, 4 + c * 4, 27 + r * 5, 27 if c >= 5 else 40)
    t.frame(18, 30, 22, 34, 27)
    at.add('calendar_b', t)
    t = Tex(24, 72, 44)  # кулер
    t.rect(0, 0, 23, 2, 45)
    t.rect(3, 8, 20, 22, 40)
    t.rect(4, 9, 19, 21, 39)
    t.rect(6, 12, 8, 16, 27)
    t.rect(15, 12, 17, 16, 2)
    t.rect(5, 26, 18, 27, 42)
    t.frame(3, 40, 20, 66, 42)
    t.rect(10, 52, 13, 53, 41)
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
    t = Tex(16, 12, 38)
    t.rect(0, 0, 15, 1, 39)
    for x in range(1, 16, 3):
        t.rect(x, 3, x, 11, 37)
    at.add('bin', t)
    t = Tex(8, 8, 45)
    t.frame(0, 0, 7, 7, 43)
    t.rect(3, 2, 4, 5, 43)
    at.add('switch', t)
    t = Tex(40, 4, 38)
    t.rect(0, 0, 39, 0, 40)
    for x in range(3, 40, 9):
        t.rect(x, 1, x + 1, 2, 43)
    at.add('hooks', t)
    t = Tex(8, 8, 40)  # алюминий рамы
    t.rect(0, 0, 7, 0, 42)
    t.rect(0, 1, 7, 1, 41)
    t.rect(0, 7, 7, 7, 38)
    at.add('alu', t)
    t = Tex(8, 8, 43)
    t.noise(0, 0, 7, 7, 42, 0.1)
    at.add('plaster', t)

    # ---------------------------------------------------------------- сиденья
    t = Tex(16, 16, 20)
    wood(t, 0, 0, 15, 15, 20, 19, 21, 0.3)
    t.frame(0, 0, 15, 15, 19)
    at.add('ply', t)
    t = Tex(16, 16, 13)
    t.rect(1, 1, 14, 2, 14)
    t.px(4, 8, 12)
    t.px(11, 8, 12)
    at.add('derm', t)
    t = Tex(24, 16, 2)  # ящик-сиденье: пластик с прорезями
    t.frame(0, 0, 23, 15, 1)
    t.rect(1, 1, 22, 1, 3)
    for x in range(3, 22, 4):
        t.rect(x, 4, x + 1, 11, 1)
    at.add('crate', t)
    t = Tex(16, 16, 2)
    for k in range(2, 16, 4):
        t.rect(k, 0, k, 15, 1)
        t.rect(0, k, 15, k, 1)
    at.add('crate_top', t)
    t = Tex(16, 16, 1)  # сложенная спецовка на ящике
    t.rect(0, 0, 15, 1, 2)
    t.rect(0, 8, 15, 9, 29)
    t.rect(0, 9, 15, 9, 23)
    at.add('folded', t)

    # ---------------------------------------------------------------- стол: клеёнка, домино, сушки, термос
    t = Tex(32, 6, 45)  # край клеёнки — свисает
    for x in range(0, 32, 8):
        t.rect(x, 0, x + 3, 5, 27)
    t.rect(0, 5, 31, 5, 42)
    at.add('oil_edge', t)
    t = Tex(16, 8, 37)  # доминошка сверху
    t.rect(0, 0, 15, 0, 38)
    t.rect(8, 1, 8, 6, 39)
    for (x, y) in ((2, 2), (5, 5), (3, 4)):
        t.px(x, y, 45)
    for (x, y) in ((10, 2), (13, 2), (10, 5), (13, 5)):
        t.px(x, y, 45)
    at.add('dom_top', t)
    t = Tex(16, 8, 37)
    t.rect(8, 1, 8, 6, 39)
    for (x, y) in ((11, 3), (3, 2), (5, 5)):
        t.px(x, y, 45)
    at.add('dom_top2', t)
    t = Tex(8, 4, 38)
    t.rect(0, 0, 7, 0, 39)
    at.add('dom_side', t)
    t = Tex(24, 16, 44)  # пакет сушек
    t.rect(0, 0, 23, 1, 45)
    for (x, y) in ((5, 5), (12, 4), (19, 6), (8, 11), (16, 11)):
        t.ellipse(x, y, 3.5, 3, 21)
        t.ellipse(x, y - 0.5, 2.5, 2, 22)
        t.ellipse(x, y, 1, 1, 44)
    t.rect(0, 14, 23, 15, 42)
    t.rect(20, 1, 22, 3, 27)
    at.add('sushki', t)
    t = Tex(10, 10, T)
    t.ellipse(5, 5, 5, 5, 21)
    t.ellipse(5, 4.5, 4, 4, 22)
    t.ellipse(4, 3.5, 1.5, 1, 23)
    t.ellipse(5, 5, 1.6, 1.6, T)
    at.add('sushka', t)
    t = Tex(32, 28, 42)  # термос: сталь, чёрная крышка-чашка
    t.rect(0, 0, 31, 7, 37)
    t.rect(0, 0, 31, 0, 38)
    t.rect(0, 7, 31, 7, 36)
    t.rect(6, 8, 7, 27, 44)
    t.rect(8, 8, 8, 27, 43)
    t.rect(22, 8, 24, 27, 40)
    t.rect(12, 14, 18, 19, 27)
    t.rect(13, 15, 17, 15, 45)
    t.rect(0, 26, 31, 27, 38)
    at.add('thermos', t)
    t = Tex(12, 12, 37)
    t.ellipse(6, 6, 4, 4, 38)
    at.add('thermos_top', t)
    # кружки: «ВОДОГРЕЙ», зелёная эмаль со сколом, красная
    t = Tex(24, 10, 45)
    t.rect(0, 0, 23, 0, 44)
    t.rect(2, 3, 21, 6, 2)
    t.rect(4, 4, 19, 5, 45)
    t.rect(0, 9, 23, 9, 43)
    at.add('mug_v', t)
    t = Tex(24, 10, 8)
    t.rect(0, 0, 23, 0, 45)
    t.rect(0, 9, 23, 9, 7)
    t.rect(15, 3, 17, 5, 37)
    t.px(16, 4, 45)
    at.add('mug_g', t)
    t = Tex(24, 10, 27)
    t.rect(0, 0, 23, 0, 28)
    t.rect(0, 9, 23, 9, 26)
    t.rect(6, 3, 9, 6, 45)
    at.add('mug_r', t)
    t = Tex(8, 8, 12)
    t.rect(1, 1, 6, 6, 13)
    t.rect(2, 2, 3, 3, 14)
    at.add('coffee_top', t)

    # ---------------------------------------------------------------- цех за окном: роботы, конвейер, ограждение
    t = Tex(16, 16, 22)  # оранжевая краска робота под прожектором
    t.rect(0, 0, 15, 1, 23)
    t.rect(0, 14, 15, 15, 21)
    t.px(3, 5, 23)
    at.add('rob', t)
    t = Tex(16, 16, 21)
    t.rect(0, 0, 15, 1, 22)
    t.rect(0, 14, 15, 15, 20)
    t.rect(6, 6, 9, 9, 37)  # логотип-кружок
    t.rect(7, 7, 8, 8, 22)
    at.add('rob_side', t)
    t = Tex(16, 16, 20)
    t.rect(0, 0, 15, 1, 21)
    at.add('rob_dark', t)
    t = Tex(16, 16, 38)
    t.rect(0, 0, 15, 1, 39)
    for (x, y) in ((3, 4), (12, 4), (3, 11), (12, 11)):
        t.px(x, y, 41)
    at.add('rob_joint', t)
    t = Tex(16, 16, 23)  # сигнальная разметка
    for k in range(-16, 16, 8):
        t.poly([(k, 16), (k + 4, 16), (k + 20, 0), (k + 16, 0)], 37)
    at.add('hazard', t)
    t = Tex(24, 32, 44)  # бак водонагревателя
    t.rect(0, 0, 23, 1, 45)
    t.rect(4, 2, 5, 29, 45)
    t.rect(18, 2, 20, 29, 42)
    t.rect(7, 12, 16, 18, 2)
    t.rect(8, 14, 15, 14, 45)
    t.rect(0, 30, 23, 31, 42)
    at.add('tank', t)
    t = Tex(12, 12, 44)
    t.ellipse(6, 6, 3, 3, 42)
    at.add('tank_top', t)
    t = Tex(16, 8, 39)
    t.rect(0, 0, 15, 0, 41)
    t.rect(0, 7, 15, 7, 37)
    at.add('rail', t)
    t = Tex(48, 32, T)  # ограждение: стойки, две перекладины в сигнальной разметке, табличка
    for y0 in (0, 13):
        for x in range(48):
            t.rect(x, y0, x, y0 + 1, 22 if (x // 3) % 2 else 37)
    for x in (1, 24, 46):
        t.rect(x - 1, 0, x + 1, 31, 22)
        t.rect(x + 1, 0, x + 1, 31, 21)
    t.rect(30, 10, 41, 18, 23)  # треугольник «опасно»
    t.poly([(35.5, 11), (40, 17), (31, 17)], 37)
    t.poly([(35.5, 13), (38, 16), (33, 16)], 23)
    t.px(35, 15, 37)
    at.add('fence', t)
    t = Tex(16, 16, 40)  # колонна: бетон, внизу разметка
    t.noise(0, 0, 15, 15, 39, 0.1)
    t.rect(0, 0, 1, 15, 41)
    at.add('column', t)
    return at


# ======================================================================================================
# Большие поверхности
# ======================================================================================================

PANEL = 1.25  # высота синей панели


def wall(width_m):
    """Бытовка нового цеха: сверху побелка, снизу синяя масляная панель, плинтус."""
    w, h = round(width_m / S), round(HGT / S)
    t = Tex(w, h, 44)
    t.noise(0, 0, w - 1, h - 1, 43, 0.004)
    p = h - round(PANEL / S)
    t.rect(0, p, w - 1, h - 1, 3)
    t.rect(0, p - 2, w - 1, p - 1, 2)
    t.rect(0, p, w - 1, p, 4)
    for _ in range(w // 8):  # мазки кисти по панели
        x = int(rng.integers(0, w))
        y = int(rng.integers(p + 3, h - 6))
        t.rect(x, y, x, y + int(rng.integers(2, 6)), 4 if rng.random() < 0.5 else 2)
    t.rect(0, h - 4, w - 1, h - 1, 38)
    t.rect(0, h - 4, w - 1, h - 4, 39)
    return t, p


def lamps_light(t, cols, cy, r):
    """Лампы дневного света: у лампы как есть, дальше — ступенями темнее. cols — столбцы ламп в текстуре."""
    ys, xs = np.mgrid[0:t.h, 0:t.w]
    d = np.full(t.a.shape, 9.0)
    for c in cols:
        d = np.minimum(d, np.sqrt(((xs + 0.5 - c) / r) ** 2 + ((ys + 0.5 - cy) / (r * 0.9)) ** 2))
    by = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])[ys % 4, xs % 4] / 16
    lv = np.clip(np.floor((d - 1.0) / 0.7 + 1 + (by - 0.5) * 0.25), 0, 2).astype(int)
    from rooms_common import shade_levels
    shade_levels(t, lv)


def walls(P):
    X = lambda x: (x + HW) / S  # noqa: E731
    Y = lambda y: (HGT - y) / S  # noqa: E731
    out = {}
    lampx = sorted({x for x, _ in P['lamps']})
    lampz = sorted({z for _, z in P['lamps']})
    # задняя
    t, p = wall(2 * HW)
    wx0, wx1, wy0, wy1 = P['window']
    band_shade(t, X(wx0) - 1, Y(wy0) + 1, X(wx1) + 1, Y(wy0) + 2, 1)  # тень под подоконником
    bx0, bx1, by0, by1 = P['board']
    band_shade(t, X(bx0) + 1, Y(by0) + 1, X(bx1) + 1, Y(by0) + 2, 1)
    t.rect(X(2.2), Y(0.3), X(2.2) + 7, Y(0.3) + 5, 45)  # розетка
    t.frame(X(2.2), Y(0.3), X(2.2) + 7, Y(0.3) + 5, 42)
    kx0, kx1 = P['lockers'][:2]
    lamps_light(t, [X(x) for x in lampx], Y(2.2), 2.6 / S)
    corners(t)
    out['back'] = t
    # левая: столбец 0 — перед комнаты
    t, p = wall(FRONT - BACK)
    Z = lambda z: (FRONT - z) / S  # noqa: E731
    cz0, cz1, ch, cd = P['counter']
    band_shade(t, Z(cz1), Y(ch) - 1, Z(cz0), t.h - 1, 1)
    t.blotch(Z(cz1), Y(ch + 0.35), Z(cz0), Y(ch), 43, 2, 0.2, on=44)  # брызги у чайника
    dz0, dz1, dh = P['door']
    band_shade(t, Z(dz1) - 3, Y(dh) - 3, Z(dz0) + 3, t.h - 1, 1)
    hz0, hz1, hy = P['hooks']
    band_shade(t, Z(hz1) + 2, Y(hy) + 2, Z(hz0) - 2, Y(0.95), 1)
    lamps_light(t, [Z(z) for z in lampz], Y(2.2), 2.2 / S)
    corners(t)
    out['left'] = t
    # правая: столбец 0 — зад комнаты
    t, p = wall(FRONT - BACK)
    Zr = lambda z: (z - BACK) / S  # noqa: E731
    lz0, lz1, lh, ld = P['lockers']
    band_shade(t, Zr(lz0) - 2, Y(lh) - 2, Zr(lz1) + 2, t.h - 1, 1)
    sz0, sz1, sy0, sy1 = P['stand']
    band_shade(t, Zr(sz0) + 1, Y(sy0) + 1, Zr(sz1) + 1, Y(sy0) + 2, 1)
    t.rect(Zr(1.98), Y(1.7), Zr(1.98) + 12, Y(1.7) + 16, 41)  # электрощиток
    t.frame(Zr(1.98), Y(1.7), Zr(1.98) + 12, Y(1.7) + 16, 39)
    t.rect(Zr(1.98) + 4, Y(1.7) + 5, Zr(1.98) + 8, Y(1.7) + 8, 23)
    t.poly([(Zr(1.98) + 6, Y(1.7) + 5), (Zr(1.98) + 8, Y(1.7) + 8), (Zr(1.98) + 4, Y(1.7) + 8)], 37)
    lamps_light(t, [Zr(z) for z in lampz], Y(2.2), 2.2 / S)
    corners(t)
    out['right'] = t
    # передняя
    t, p = wall(2 * HW)
    Xf = lambda x: (HW - x) / S  # noqa: E731
    lamps_light(t, [Xf(x) for x in lampx], Y(2.2), 2.6 / S)
    corners(t)
    out['front'] = t
    return out


def corners(t):
    t.shade(0, 0, 1, t.h - 1, 1)
    t.shade(t.w - 2, 0, t.w - 1, t.h - 1, 1)


def floor_tex(P, seats):
    """Керамогранит 30×30, у двери резиновый коврик и разметка, следы ботинок к столу."""
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 41)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    n = 12
    for y in range(0, h, n):
        t.rect(0, y, w - 1, y, 40)
    for x in range(0, w, n):
        t.rect(x, 0, x, h - 1, 40)
    t.noise(0, 0, w - 1, h - 1, 42, 0.02, on=41)
    dz0, dz1 = P['door'][:2]
    t.blotch(X(-HW), Zf(dz0 - 0.4), X(-0.6), Zf(dz1), 39, 2, 0.12, on=[41, 42])  # натоптали
    t.blotch(X(-1.8), Zf(-0.9), X(1.8), Zf(0.6), 39, 2, 0.05, on=[41, 42])
    # коврик у двери и жёлто-чёрная полоса порога
    t.rect(X(-HW), Zf(dz0), X(-HW + 0.7), Zf(dz1), 37)
    for y in range(int(Zf(dz0)), int(Zf(dz1)) + 1, 2):
        t.rect(X(-HW), y, X(-HW + 0.7), y, 36)
    for y in range(int(Zf(dz0)), int(Zf(dz1)) + 1):
        for x in range(0, 3):
            t.px(x, y, 23 if ((y // 3) % 2) else 37)
    # тени
    tx0, tx1 = X(-TABLE['halfLen']), X(TABLE['halfLen'])
    tz0, tz1 = Zf(TABLE['far']), Zf(TABLE['near'])
    band_shade(t, tx0, tz0, tx1, tz1, 1)
    t.shade(tx0 + 3, tz0 + 3, tx1 - 3, tz1 - 3, 1)
    for (x, z) in seats:
        t.shade_ellipse(X(x), Zf(z), 0.24 / S, 0.22 / S, 1)
    lz0, lz1, _, ld = P['lockers']
    band_shade(t, X(HW - ld) - 1, Zf(lz0) - 1, w - 1, Zf(lz1) + 1, 1)
    cz0, cz1, _, cd = P['counter']
    band_shade(t, 0, Zf(cz0) - 1, X(-HW + cd) + 1, Zf(cz1) + 1, 1)
    return t


def ceiling_tex(P):
    w, h = round(2 * HW / S), round((FRONT - BACK) / S)
    t = Tex(w, h, 45)
    X = lambda x: (x + HW) / S  # noqa: E731
    Zf = lambda z: (z - BACK) / S  # noqa: E731
    n = round(0.6 / S)
    ox = round((HW - 0.3) / S) % n
    oz = round((0.3 - BACK) / S) % n
    t.noise(0, 0, w - 1, h - 1, 44, 0.05)
    for x in range(ox, w, n):
        t.rect(x, 0, x, h - 1, 42)
    for y in range(oz, h, n):
        t.rect(0, y, w - 1, y, 42)
    for (x, z) in P['lamps']:
        falloff(t, X(x), Zf(z), 1.3 / S, 1.1 / S, steps=1, start=1.0, width=0.6, soft=0.2) if False else None
    t.a = darker(t.a)
    for (x, z) in P['lamps']:
        t.shade_ellipse(X(x), Zf(z), 1.0 / S, 0.6 / S, -1)
    return t


def table_tex(P):
    """Клеёнка в красную клетку: протёрта на краях, порезы, кольца от кружек, ожог от сигареты."""
    L, Fz, N = TABLE['halfLen'], TABLE['far'], TABLE['near']
    w = 256
    s = 2 * L / w
    h = round((N - Fz) / s)
    X = lambda x: (x + L) / s  # noqa: E731
    Zt = lambda z: (z - Fz) / s  # noqa: E731
    t = Tex(w, h, 45)
    c = 6  # клетка ~7 см
    ys, xs = np.mgrid[0:h, 0:w]
    a = ((xs // c) % 2).astype(bool)
    b = ((ys // c) % 2).astype(bool)
    t.a = np.where(a & b, 26, np.where(a | b, 27, 44))
    # потёртости: клеёнка вытерлась до ткани
    for (x, z, rx, rz) in ((-1.35, 0.18, 0.18, 0.06), (1.3, 0.14, 0.18, 0.08)):
        m = ellipse_mask(t, X(x), Zt(z), rx / s, rz / s) & ((xs + ys) % 2 == 0) & (xs % 4 == 0)
        t.a[m & (t.a == 27)] = 28
        t.a[m & (t.a == 26)] = 27
        t.a[m & (t.a == 44)] = 43
    for (x, z, r) in ((-0.95, -0.2, 0.042), (0.3, -0.72, 0.04), (1.05, -0.3, 0.04), (-1.1, -0.65, 0.04)):
        d = np.sqrt(((xs - X(x)) * s) ** 2 + ((ys - Zt(z)) * s) ** 2)
        t.a[(d > r - s) & (d < r + s * 0.3) & (xs % 4 != 0)] = 12
    for (p0, p1) in (((-0.6, 0.1), (-0.46, 0.02)), ((1.15, 0.18), (1.35, 0.16)), ((0.62, -0.05), (0.7, -0.14))):
        t.line([(X(p0[0]), Zt(p0[1])), (X(p1[0]), Zt(p1[1]))], 17)
    t.ellipse(X(1.4), Zt(-0.05), 2, 1.5, 12)
    # тени от вещей
    for (x, z) in P['mugs']:
        t.shade_ellipse(X(x + 0.01), Zt(z + 0.01), 0.05 / s, 0.05 / s, 1)
    tx, tz = P['thermos']
    t.shade_ellipse(X(tx + 0.01), Zt(tz + 0.01), 0.07 / s, 0.07 / s, 1)
    sx, sz = P['sushki']
    t.shade_ellipse(X(sx + 0.01), Zt(sz + 0.015), 0.15 / s, 0.1 / s, 1)
    for (x, z, _, _) in P['hats']:
        t.shade_ellipse(X(x + 0.01), Zt(z + 0.02), 0.16 / s, 0.14 / s, 1)
    dx, dz = P['domino']
    t.shade(X(dx - 0.22), Zt(dz - 0.1), X(dx + 0.24), Zt(dz + 0.12), 0) if False else None
    t.frame(0, 0, w - 1, h - 1, 42)
    return t


# ======================================================================================================
# Цех за окном: дальняя стена, стеллажи, растяжка, лучи
# ======================================================================================================

def hall_wall():
    x0, x1, y0, y1, _ = HALL['wall']
    s = 0.05
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, 37)
    X = lambda x: (x - x0) / s  # noqa: E731
    Y = lambda y: (y1 - y) / s  # noqa: E731
    # сэндвич-панели: горизонтальные швы, сверху ленточное остекление с ночью
    for y in range(0, h, 12):
        t.rect(0, y, w - 1, y, 36)
    t.rect(0, Y(5.6), w - 1, Y(4.7), 0)
    for x in range(0, w, 14):
        t.rect(x, Y(5.6), x + 1, Y(4.7), 36)
    t.rect(0, Y(5.6), w - 1, Y(5.6), 38)
    t.rect(0, Y(4.7), w - 1, Y(4.7), 38)
    for _ in range(12):
        t.px(int(rng.integers(0, w)), int(rng.integers(Y(5.55), Y(4.75))), 1)
    # кабельный лоток и трубы
    t.rect(0, Y(4.2), w - 1, Y(4.12), 39)
    t.rect(0, Y(4.12), w - 1, Y(4.12), 38)
    t.rect(0, Y(3.8), w - 1, Y(3.76), 8)
    t.rect(0, Y(3.66), w - 1, Y(3.62), 27)
    # шкафы автоматики и зелёное табло «ВЫХОД»
    for (a, b) in ((-9.8, -9.0), (-8.9, -8.1), (-3.2, -2.5)):
        t.rect(X(a), Y(2.1), X(b), Y(0.0), 39)
        t.frame(X(a), Y(2.1), X(b), Y(0.0), 38)
        t.rect(X(a) + 3, Y(1.8), X(a) + 5, Y(1.7), 9)
        t.rect(X(a) + 7, Y(1.8), X(a) + 9, Y(1.7), 27)
    t.rect(X(-1.6), Y(2.6), X(-1.0), Y(2.35), 8)
    t.text(X(-1.55), Y(2.58), 'ВЫХОД', 11) if text_w('ВЫХОД') < 12 else None
    # рабочие лампы под лотком: яркие планки и пятно света под ними
    for x in range(10, w, 44):
        t.rect(x, Y(4.45), x + 7, Y(4.4), 45)
        t.rect(x + 1, Y(4.4) + 1, x + 6, Y(4.4) + 1, 23)
        t.checker(x - 3, Y(4.4) + 2, x + 10, Y(3.9), 38)
    # пол цеха (виден издалека): серый бетон с жёлтой линией
    t.rect(0, Y(0.0), w - 1, h - 1, 38)
    t.rect(0, Y(-0.1), w - 1, Y(-0.12), 22)
    return t


def racks():
    x0, x1, y0, y1, _ = HALL['racks']
    s = 0.04
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, T)
    Y = lambda y: (y1 - y) / s  # noqa: E731
    levels = [0.0, 1.5, 3.0, 4.45]
    bays = list(range(0, w, 30))
    for li in range(3):
        top, bot = Y(levels[li + 1]) + 2, Y(levels[li]) - 1
        for bx in bays:
            x = bx + 3
            while x < bx + 27:
                bw = int(rng.integers(6, 10))
                bh = int(rng.integers(int((bot - top) * 0.6), bot - top))
                col = [15, 16, 14, 15][int(rng.integers(0, 4))]
                t.rect(x, bot - bh, min(x + bw, bx + 27), bot, col)
                t.rect(x, bot - bh, min(x + bw, bx + 27), bot - bh, 17 if col != 14 else 15)
                t.rect(min(x + bw, bx + 27), bot - bh, min(x + bw, bx + 27), bot, 13)
                t.rect(x + 1, bot - bh // 2, min(x + bw, bx + 27) - 1, bot - bh // 2, 16 if col == 15 else 17)
                x += bw + 1
        t.rect(0, Y(levels[li + 1]), w - 1, Y(levels[li + 1]) + 2, 2)  # балки стеллажа
        t.rect(0, Y(levels[li + 1]), w - 1, Y(levels[li + 1]), 3)
    for bx in bays + [w - 1]:
        t.rect(bx, 0, bx + 1, h - 1, 1)
        for y in range(0, h, 4):
            t.px(bx, y, 0)
    return t


def banner():
    t = Tex(96, 22, 27)
    t.rect(0, 0, 95, 1, 26)
    t.rect(0, 20, 95, 21, 26)
    t.text(48 - text_w('НОВАЯ ЛИНИЯ', 2) // 2, 4, 'НОВАЯ ЛИНИЯ', 45, 2)
    t.rect(4, 16, 91, 16, 23)
    for x in (3, 92):
        t.rect(x, 0, x, 1, 43)
    return t


def pallets():
    x0, x1, y0, y1, _ = HALL['pallets']
    s = 0.03
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, T)
    # два поддона с коробами в стрейч-плёнке, один на другом
    for (a, b, top, bot) in ((2, w - 3, int(h * 0.52), h - 5), (6, w - 8, int(h * 0.08), int(h * 0.5))):
        t.rect(a, top, b, bot, 15)
        for x in range(a, b, 9):
            t.rect(x, top, x, bot, 13)
        for y in range(top, bot, 8):
            t.rect(a, y, b, y, 14)
        t.rect(a, top, b, top + 1, 16)
        for y in range(top + 2, bot, 3):
            t.rect(a + 1 + (y % 5), y, a + 4 + (y % 5), y, 44)  # плёнка бликует
        t.rect(a + 12, top + 6, a + 18, top + 10, 45)
    t.rect(0, h - 5, w - 1, h - 1, 20)
    for x in range(3, w, 10):
        t.rect(x, h - 4, x + 4, h - 2, 18)
    return t




def lamp_tex():
    """Потолочный светильник с двумя трубками."""
    t = Tex(8, 32, 43)
    t.frame(0, 0, 7, 31, 41)
    t.rect(2, 1, 2, 30, 45)
    t.rect(5, 1, 5, 30, 45)
    return t


# ======================================================================================================

def main():
    at = items(Atlas(320, 256))
    P = dict(PLACE)
    seats = [(x, z - 0.05) for (x, z) in R.seats_from_layout() if z < 0]
    surfaces = {f'wall_{k}': v for k, v in walls(P).items()}
    surfaces['floor'] = floor_tex(P, seats)
    surfaces['ceiling'] = ceiling_tex(P)
    surfaces['table'] = table_tex(P)
    surfaces['hall'] = hall_wall()
    surfaces['racks'] = racks()
    surfaces['banner'] = banner()
    surfaces['pallets'] = pallets()
    surfaces['lamp'] = lamp_tex()
    write_all('bytovka', at, surfaces, dict(PLACE, hall=HALL), 'tools/art/room_bytovka.py')


if __name__ == '__main__':
    main()
