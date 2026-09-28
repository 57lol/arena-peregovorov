"""2D-сцены кампании «Новенький» для классического вида встречи: комната в общаге, столик у ларька,
касса «Семёрочки», бытовка нового цеха. Формат как в scenes.py: фон 192×108 и отдельный слой стола,
между ними встаёт портрет собеседника (96×96 по центру, низом на 8 точек выше края).

Запуск: ~/Arena-materials/.venv/bin/python tools/art/scenes_story.py
Пишет public/assets/scenes/<id>.png и <id>-desk.png, превью ×4 в tools/art/out/<id>_x4.png.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from font import text, text_w  # noqa: E402
from room3d import Tex, darker, lighter  # noqa: E402

W, H = 192, 108
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
rng = np.random.default_rng(2109)


def canvas(fill=-1):
    return Tex(W, H, fill)


def mug(t, x, y, body, rim, fill=None, handle_right=True):
    """Кружка 6×7 с ручкой."""
    t.rect(x, y, x + 5, y + 6, body)
    t.rect(x, y, x + 5, y, rim)
    t.rect(x + 5, y + 1, x + 5, y + 6, darker(body))
    if fill is not None:
        t.rect(x + 1, y + 1, x + 4, y + 1, fill)
    hx = x + 6 if handle_right else x - 2
    t.rect(hx, y + 2, hx + 1, y + 2, body)
    t.rect(hx + (1 if handle_right else 0), y + 3, hx + (1 if handle_right else 0), y + 4, body)
    t.rect(hx, y + 5, hx + 1, y + 5, body)
    t.rect(x, y + 7, x + 5, y + 7, 38)


def dither_band(t, x0, y0, x1, y1, c, phase=0):
    t.checker(x0, y0, x1, y1, c, phase)


def halo(t, cx, cy, r0, r1, c_in, c_out):
    """Ореол фонаря/лампы: сплошной круг и дизеринговое кольцо."""
    xs, ys = t.grid()
    d = np.hypot(xs - cx, ys - cy)
    ring = (d > r0) & (d <= r1) & ((np.floor(xs) + np.floor(ys)) % 2 == 0)
    t.a[ring] = c_out
    t.a[d <= r0] = c_in


# ---------------------------------------------------------------------------------------------------
# 1. Комната 214 в общаге, воскресенье, 21:10: обои, ковёр на стене, окно на соседнюю общагу,
#    приставка у телевизора, на столе новый чайник.
# ---------------------------------------------------------------------------------------------------

def dorm():
    bg = canvas()
    # обои: тёплые, в вечернем свете лампы; ромбики узора
    bg.rect(0, 0, W - 1, H - 1, 15)
    for y in range(3, H, 6):
        for x in range((y // 6) % 2 * 3, W, 6):
            bg.px(x, y, 16)
            bg.px(x + 1, y + 1, 14)
    bg.rect(0, 0, W - 1, 2, 14)
    bg.shade(0, 0, W - 1, 5, 1)
    # окно слева: вечернее небо, соседняя общага с жёлтыми окнами
    wx0, wy0, wx1, wy1 = 8, 12, 46, 60
    bg.rect(wx0, wy0, wx1, wy1, 0)
    bg.rect(wx0, wy0 + 18, wx1, wy1, 30)
    dither_band(bg, wx0, wy0 + 15, wx1, wy0 + 17, 30)
    bg.rect(wx0, wy0 + 26, wx1, wy1, 31)
    dither_band(bg, wx0, wy0 + 23, wx1, wy0 + 25, 31, 1)
    bg.rect(wx0, wy0 + 30, wx1, wy0 + 31, 28)
    dither_band(bg, wx0, wy0 + 28, wx1, wy0 + 29, 28)
    for sx, sy in ((14, 16), (30, 14), (40, 19), (22, 22)):
        bg.px(sx, sy, 44)
    bg.rect(wx0, wy0 + 24, wx0 + 22, wy1, 39)          # соседний корпус
    bg.rect(wx0 + 24, wy0 + 30, wx1, wy1, 38)
    for y in range(wy0 + 27, wy1 - 1, 3):
        for x in range(wx0 + 2, wx0 + 21, 3):
            bg.px(x, y, 23 if rng.random() < 0.45 else 40)
    for y in range(wy0 + 33, wy1 - 1, 3):
        for x in range(wx0 + 26, wx1 - 1, 3):
            bg.px(x, y, 22 if rng.random() < 0.35 else 39)
    # рама
    bg.frame(wx0 - 1, wy0 - 1, wx1 + 1, wy1 + 1, 44)
    bg.frame(wx0 - 2, wy0 - 2, wx1 + 2, wy1 + 2, 42)
    bg.rect(27, wy0, 27, wy1, 44)
    bg.rect(wx0, 30, wx1, 30, 44)
    # шторы
    for x0, x1 in ((2, 10), (44, 52)):
        bg.rect(x0, 6, x1, 70, 22)
        for x in range(x0 + 1, x1, 3):
            bg.rect(x, 6, x, 70, 21)
        bg.rect(x1, 6, x1, 70, 20)
    bg.rect(0, 4, 56, 5, 40)                               # карниз
    # подоконник с кактусом и банкой
    bg.rect(4, 61, 50, 63, 44)
    bg.rect(4, 64, 50, 64, 42)
    bg.rect(14, 55, 18, 60, 20)
    bg.sprite(13, 49, ['..g..', '.gGg.', '.gGg.', 'ggGgg', '.gGg.', '.ggg.'], {'g': 8, 'G': 9})
    bg.rect(34, 55, 38, 60, 4)
    bg.rect(34, 55, 38, 55, 44)
    # батарея
    bg.rect(12, 72, 44, 86, 44)
    for x in range(13, 44, 3):
        bg.rect(x, 73, x, 85, 42)

    # ковёр на стене справа за собеседником
    kx0, ky0, kx1, ky1 = 104, 8, 150, 70
    bg.rect(kx0, ky0, kx1, ky1, 26)
    bg.frame(kx0 + 2, ky0 + 2, kx1 - 2, ky1 - 2, 22)
    bg.frame(kx0 + 4, ky0 + 4, kx1 - 4, ky1 - 4, 19)
    cx, cy = (kx0 + kx1) // 2, (ky0 + ky1) // 2
    for r, c in ((18, 27), (13, 19), (9, 22), (5, 27), (2, 23)):
        for y in range(cy - r, cy + r + 1):
            w = r - abs(y - cy)
            bg.rect(cx - w, y, cx + w, y, c)
    for y in range(ky0 + 7, ky1 - 6, 6):
        for x in (kx0 + 7, kx1 - 7):
            bg.px(x, y, 23)
            bg.px(x - 1, y + 1, 22)
            bg.px(x + 1, y + 1, 22)
    for x in range(kx0, kx1 + 1, 2):                        # бахрома
        bg.px(x, ky1 + 1, 17)
    bg.shade(kx1 + 1, ky0 + 1, kx1 + 1, ky1 + 1, 1)

    # полка с книгами и колонкой
    bg.rect(154, 22, 190, 23, 20)
    bg.rect(154, 24, 190, 24, 19)
    x = 156
    for c, h in ((3, 12), (27, 10), (8, 13), (45, 11), (22, 12), (2, 9)):
        bg.rect(x, 22 - h, x + 2, 21, c)
        bg.rect(x, 22 - h, x, 21, lighter(c))
        x += 3
    bg.rect(176, 10, 188, 21, 38)                            # колонка
    bg.rect(176, 10, 188, 10, 40)
    bg.ellipse(182, 15, 3.6, 3.6, 39)
    bg.ellipse(182, 15, 1.6, 1.6, 40)
    bg.px(186, 19, 4)
    # постер с космосом
    bg.rect(158, 30, 184, 50, 0)
    bg.frame(158, 30, 184, 50, 45)
    bg.ellipse(176, 38, 5, 5, 28)
    bg.ellipse(175, 37, 3, 3, 29)
    for sx, sy in ((162, 33), (168, 46), (181, 47), (163, 42), (171, 34)):
        bg.px(sx, sy, 45)
    bg.line([(162, 48), (168, 42)], 44)
    bg.px(169, 41, 23)
    # тумба с телевизором и приставкой
    bg.rect(152, 62, 190, 64, 20)
    bg.rect(152, 65, 190, 96, 19)
    bg.rect(154, 67, 170, 80, 20)
    bg.rect(172, 67, 188, 80, 20)
    bg.px(168, 73, 22)
    bg.px(174, 73, 22)
    bg.rect(158, 40 + 14, 186, 61, 38)                       # телевизор
    bg.rect(160, 55, 184, 60, 2)
    bg.rect(160, 58, 184, 60, 1)
    bg.rect(166, 56, 170, 57, 28)
    bg.rect(176, 57, 178, 57, 23)
    bg.rect(170, 61, 174, 61, 39)
    bg.rect(154, 58, 157, 61, 45)                            # приставка
    bg.px(155, 60, 4)
    # плинтус и пол
    bg.rect(0, 96, W - 1, H - 1, 20)
    bg.rect(0, 96, W - 1, 96, 19)

    # --- стол: светлый ламинат, новый чайник, кружки, геймпад ---
    fg = canvas()
    fg.rect(0, 92, W - 1, H - 1, 16)
    fg.rect(0, 92, W - 1, 93, 17)
    fg.rect(0, 94, W - 1, 94, 15)
    fg.rect(0, 97, W - 1, H - 1, 15)
    for x in range(6, W, 19):
        fg.rect(x, 99, x + 7, 99, 14)
    # чайник: белый, синее окошко уровня воды
    fg.sprite(14, 76, [
        '.....hhhhh.......',
        '....h.....h......',
        '...h.......h.....',
        '..wwwwwwwwww.....',
        '.wWWWWWWWWWwg....',
        '.wWWbWWWWWWwwg...',
        '.wWWbWWWWWWw.wg..',
        '.wWWbWWWWWWw..wg.',
        '.wWWbWWWWWWw...g.',
        '.wWWbWWWWWWwg....',
        '.wWWbWWWWWWwg....',
        '.wWWWWWWWWWw.....',
        '.wWWWWWWWWWw.....',
        '.gggggggggggg....',
        'dddddddddddddd...',
        'dddddddddddddd...',
        '.ddddddddddddd...',
    ], {'h': 40, 'w': 44, 'W': 45, 'b': 3, 'g': 42, 'd': 39})
    fg.px(17, 81, 4)
    # ценник-наклейка на боку
    fg.rect(20, 84, 23, 86, 23)
    # две кружки
    mug(fg, 50, 85, 27, 29, 19)
    mug(fg, 64, 86, 45, 44, 20, handle_right=False)
    # пачка печенья
    fg.rect(118, 88, 134, 93, 22)
    fg.rect(118, 88, 134, 88, 23)
    fg.rect(122, 90, 130, 91, 27)
    # геймпад
    fg.sprite(148, 84, [
        '..kkkkkkkkkk..',
        '.kKKKKKKKKKKk.',
        'kKKsKKKKKKrKKk',
        'kKsssKKKKbKgKk',
        'kKKsKKKKKKyKKk',
        'kKKKkkkkkkKKKk',
        '.kKk......kKk.',
    ], {'k': 38, 'K': 39, 's': 41, 'r': 27, 'b': 3, 'g': 8, 'y': 22})
    return bg, fg


# ---------------------------------------------------------------------------------------------------
# 2. Столик у ларька «Шаурма 24» у остановки, понедельник, 7:35: туман, фонарь ещё горит.
# ---------------------------------------------------------------------------------------------------

def street():
    bg = canvas()
    # туман: светлый сверху, чуть темнее к земле
    bg.rect(0, 0, W - 1, H - 1, 44)
    bg.rect(0, 40, W - 1, H - 1, 43)
    dither_band(bg, 0, 36, W - 1, 39, 43)
    # дальние панельки, тонут в тумане
    for x0, x1, top, c in ((0, 30, 20, 43), (40, 70, 12, 43), (84, 120, 24, 43), (150, 192, 16, 43)):
        bg.rect(x0, top, x1, 76, c)
        for y in range(top + 3, 74, 4):
            for x in range(x0 + 2, x1 - 1, 4):
                bg.px(x, y, 17 if rng.random() < 0.18 else 42)
    for x0, x1, top in ((18, 52, 34), (100, 140, 38)):         # ближний ряд, темнее
        bg.rect(x0, top, x1, 76, 42)
        for y in range(top + 3, 74, 4):
            for x in range(x0 + 2, x1 - 1, 4):
                bg.px(x, y, 23 if rng.random() < 0.25 else 41)
    dither_band(bg, 0, 60, W - 1, 76, 43, 1)                    # туман у земли
    # дорога и тротуар
    bg.rect(0, 77, W - 1, 84, 41)
    bg.rect(0, 77, W - 1, 77, 42)
    for x in range(4, W, 16):
        bg.rect(x, 80, x + 6, 80, 43)
    bg.rect(0, 85, W - 1, H - 1, 42)
    bg.rect(0, 85, W - 1, 85, 44)
    for x in range(0, W, 8):
        bg.rect(x, 86, x, H - 1, 41)
    for y in range(90, H, 6):
        bg.rect(0, y, W - 1, y, 41)
    # лужа с отражением фонаря
    bg.rect(20, 92, 44, 95, 40)
    bg.rect(22, 93, 42, 94, 41)
    bg.rect(29, 93, 31, 94, 23)

    # фонарь слева: столб, голова, ореол
    lx = 30
    bg.rect(lx, 14, lx + 1, 90, 40)
    bg.rect(lx + 1, 14, lx + 1, 90, 39)
    bg.rect(lx - 1, 86, lx + 2, 90, 39)
    bg.line([(lx, 14), (lx + 4, 10), (lx + 12, 10)], 40)
    halo(bg, lx + 12, 13, 3, 10, 45, 17)
    bg.rect(lx + 8, 10, lx + 16, 11, 39)
    bg.rect(lx + 10, 12, lx + 14, 13, 23)
    bg.shade(lx + 1, 16, lx + 1, 90, 1)
    # знак остановки
    bg.rect(52, 30, 52, 88, 40)
    bg.rect(47, 26, 57, 36, 45)
    bg.frame(47, 26, 57, 36, 2)
    text(bg, 51, 29, 'А', 2)
    bg.rect(48, 37, 56, 40, 22)
    bg.line([(49, 38), (55, 38)], 39)

    # ларёк «Шаурма 24» справа
    kx0, kx1 = 136, 191
    bg.rect(kx0, 26, kx1, 88, 44)
    bg.rect(kx0, 26, kx1, 27, 45)
    bg.rect(kx0 - 2, 28, kx1, 40, 27)                           # вывеска
    bg.rect(kx0 - 2, 28, kx1, 28, 28)
    bg.rect(kx0 - 2, 40, kx1, 40, 26)
    s = 'ШАУРМА 24'
    text(bg, kx0 + (kx1 - kx0 - text_w(s)) // 2 + 1, 32, s, 45)
    # окно выдачи: свет, вертел, меню
    bg.rect(kx0 + 4, 46, kx1 - 4, 72, 23)
    bg.rect(kx0 + 4, 46, kx1 - 4, 47, 22)
    bg.frame(kx0 + 3, 45, kx1 - 3, 73, 40)
    bg.sprite(kx0 + 8, 50, ['.rr.', 'rRRr', 'rRRr', 'rRRr', '.rRr', '.rRr', '.rr.', '..r.', '..s.', '..s.', '..s.',
                           '..s.', '..s.', '.sss'],
              {'r': 20, 'R': 21, 's': 41})
    bg.rect(kx0 + 6, 50, kx0 + 6, 63, 28)                       # спираль нагрева
    bg.rect(kx0 + 14, 50, kx0 + 14, 63, 28)
    bg.rect(kx0 + 20, 49, kx1 - 7, 60, 45)                      # меню
    for y in range(51, 59, 2):
        bg.rect(kx0 + 22, y, kx0 + 34, y, 42)
        bg.rect(kx1 - 12, y, kx1 - 9, y, 27)
    bg.rect(kx0 + 3, 74, kx1 - 3, 76, 42)                       # прилавок
    bg.rect(kx0 + 3, 74, kx1 - 3, 74, 45)
    bg.rect(kx0 + 20, 63, kx0 + 26, 72, 22)                     # пачки салфеток и соусы
    bg.rect(kx0 + 29, 66, kx0 + 31, 72, 27)
    bg.rect(kx0 + 33, 67, kx0 + 35, 72, 21)
    bg.rect(kx0, 78, kx1, 88, 43)
    for x in range(kx0 + 2, kx1, 6):
        bg.rect(x, 79, x, 87, 42)
    bg.shade(kx0 - 2, 41, kx0 - 1, 88, 1)

    # --- стол: белый пластиковый столик, шаурма в фольге, кофе, ваш телефон ---
    fg = canvas()
    fg.rect(0, 92, W - 1, H - 1, 44)
    fg.rect(0, 92, W - 1, 92, 45)
    fg.rect(0, 96, W - 1, 97, 43)
    fg.rect(0, 98, W - 1, H - 1, 42)
    for x in range(10, W, 29):
        fg.rect(x, 101, x + 3, 101, 41)
    # стаканчик кофе
    fg.sprite(20, 78, [
        '.lllllll.',
        'LLLLLLLLL',
        '.wwwwwww.',
        '.wwwwwww.',
        '.sssssss.',
        '.sSSSSSs.',
        '.sssssss.',
        '..wwwww..',
        '..wwwww..',
        '..wwwwg..',
        '..wwwwg..',
        '..wwwwg..',
        '...ggg...',
        '..ddddd..',
        '.ddddddd.',
    ], {'l': 44, 'L': 43, 'w': 45, 's': 20, 'S': 21, 'g': 43, 'd': 42})
    fg.sprite(22, 72, ['.h..', 'h.h.', '.h.h', '..h.'], {'h': 45})    # пар
    # шаурма в фольге на салфетке
    fg.rect(146, 90, 184, 93, 45)
    fg.sprite(150, 78, [
        '....ggGg........',
        '..llLLllgg......',
        '.lLLLLLLLll.....',
        'fFfFFFFfFFFf....',
        'fFFFfFFFFFFFff..',
        'ffFFFFfFFFFFFFf.',
        '.fFFFFFFfFFFfFFf',
        '..fFFfFFFFFFFFFf',
        '...ffFFFFfFFFff.',
        '.....ffffffff...',
        '................',
        '..dddddddddd....',
    ], {'g': 8, 'G': 9, 'l': 21, 'L': 22, 'f': 43, 'F': 44, 'd': 42})
    # телефон экраном вверх
    fg.rect(70, 88, 86, 94, 38)
    fg.rect(71, 89, 85, 93, 1)
    fg.rect(72, 89, 76, 89, 3)
    fg.rect(78, 91, 83, 91, 2)
    fg.rect(70, 95, 86, 95, 41)
    return bg, fg


# ---------------------------------------------------------------------------------------------------
# 3. Касса магазина «Семёрочка» у общаги, вторник, 19:40: зелёно-жёлтая вывеска, полки, лента кассы,
#    на ней коробка с чайником.
# ---------------------------------------------------------------------------------------------------

def shop():
    bg = canvas()
    bg.rect(0, 0, W - 1, H - 1, 45)
    bg.rect(0, 0, W - 1, 3, 44)
    for x in range(8, W, 40):                                   # лампы дневного света
        bg.rect(x, 0, x + 22, 1, 45)
        bg.rect(x, 2, x + 22, 2, 43)
    # фирменная полоса «Семёрочки»
    bg.rect(0, 6, W - 1, 15, 8)
    bg.rect(0, 6, W - 1, 6, 9)
    bg.rect(0, 16, W - 1, 17, 22)
    bg.rect(0, 18, W - 1, 18, 21)
    s = 'СЕМЁРОЧКА'
    text(bg, 6, 8, s, 45)
    bg.rect(6 + text_w(s) + 4, 7, 6 + text_w(s) + 10, 13, 22)    # значок с семёркой
    text(bg, 6 + text_w(s) + 6, 8, '7', 7)
    # полки слева
    for top in (22, 40, 58, 76):
        bg.rect(0, top + 15, 46, top + 16, 42)
        bg.rect(0, top + 17, 46, top + 17, 41)
        x = 1
        while x < 44:
            kind = int(rng.integers(0, 4))
            c = int(rng.choice([27, 3, 22, 8, 29, 45, 2, 21, 35]))
            if kind == 0:  # бутылка
                h = int(rng.integers(9, 14))
                bg.rect(x, top + 15 - h, x + 2, top + 14, c)
                bg.rect(x + 1, top + 13 - h, x + 1, top + 14 - h, c)
                bg.px(x, top + 15 - h, lighter(c))
                x += 4
            elif kind == 1:  # пачка
                h = int(rng.integers(7, 11))
                bg.rect(x, top + 15 - h, x + 4, top + 14, c)
                bg.rect(x, top + 15 - h, x + 4, top + 15 - h, lighter(c))
                bg.rect(x + 1, top + 11 - h + 6, x + 3, top + 11 - h + 6, 45)
                x += 6
            else:  # банки
                bg.rect(x, top + 10, x + 3, top + 14, c)
                bg.rect(x, top + 10, x + 3, top + 10, 43)
                x += 5
        for px_ in range(3, 44, 9):
            bg.rect(px_, top + 16, px_ + 3, top + 16, 23)       # ценники
    bg.rect(47, 20, 48, H - 1, 42)
    # витрина-окно в вечер
    ox0, ox1 = 56, 92
    bg.rect(ox0, 24, ox1, 62, 1)
    bg.rect(ox0, 24, ox1, 32, 0)
    for x in range(ox0 + 3, ox1, 7):
        bg.rect(x, 44, x + 4, 62, 0)
        for y in range(46, 61, 3):
            if rng.random() < 0.5:
                bg.px(x + 2, y, 23)
    bg.line([(ox0 + 4, 60), (ox0 + 14, 26)], 2)
    bg.line([(ox0 + 7, 60), (ox0 + 17, 26)], 2)
    bg.frame(ox0 - 1, 23, ox1 + 1, 63, 42)
    bg.rect(74, 24, 74, 62, 42)
    # правая стена: стеллаж за кассой и объявление про возврат
    bg.rect(154, 34, W - 1, 90, 43)
    for top in (36, 54, 72):
        bg.rect(156, top + 16, W - 1, top + 17, 41)
        x = 157
        while x < W - 3:
            c = int(rng.choice([27, 22, 3, 45, 29, 8, 33]))
            w = int(rng.integers(3, 6))
            h = int(rng.integers(6, 12))
            bg.rect(x, top + 16 - h, x + w - 1, top + 15, c)
            bg.rect(x, top + 16 - h, x, top + 15, lighter(c))
            x += w + 1
    nx0, nx1 = 120, 150                                         # объявление про возврат
    bg.rect(nx0, 30, nx1, 66, 45)
    bg.frame(nx0, 30, nx1, 66, 42)
    s = 'ВОЗВРАТ'
    text(bg, nx0 + (nx1 - nx0 + 1 - text_w(s)) // 2 + 1, 33, s, 27)
    for y in range(41, 60, 3):
        bg.rect(nx0 + 3, y, nx0 + 3 + int(rng.integers(16, 25)), y, 42)
    bg.rect(nx1 - 8, 57, nx1 - 3, 63, 2)
    bg.px(nx1 - 5, 60, 45)
    bg.rect(nx0 + 2, 28, nx0 + 4, 31, 22)                        # скотч
    bg.rect(nx1 - 4, 28, nx1 - 2, 31, 22)
    # табличка «Касса 2»
    bg.line([(164, 19), (164, 22)], 40)
    bg.line([(184, 19), (184, 22)], 40)
    bg.rect(157, 22, 190, 30, 8)
    bg.frame(157, 22, 190, 30, 7)
    text(bg, 160, 24, 'КАССА 2', 45)
    # пол
    bg.rect(0, 94, W - 1, H - 1, 43)
    for x in range(0, W, 12):
        bg.rect(x, 94, x, H - 1, 42)

    # --- касса: лента, коробка с чайником, терминал, разделитель ---
    fg = canvas()
    fg.rect(0, 90, W - 1, H - 1, 44)
    fg.rect(0, 90, W - 1, 90, 45)
    fg.rect(0, 100, W - 1, 103, 8)                              # фирменная полоса по фасаду кассы
    fg.rect(0, 100, W - 1, 100, 9)
    fg.rect(0, 104, W - 1, 104, 22)
    fg.rect(0, 105, W - 1, H - 1, 42)
    fg.rect(0, 91, 120, 97, 38)                                 # лента
    fg.rect(0, 91, 120, 91, 39)
    for x in range(3, 120, 6):
        fg.rect(x, 93, x, 96, 39)
    fg.rect(0, 98, 120, 99, 41)
    fg.rect(121, 91, W - 1, 99, 43)
    fg.rect(121, 91, W - 1, 91, 45)
    # коробка с чайником
    fg.rect(20, 70, 50, 92, 16)
    fg.rect(20, 70, 50, 71, 17)
    fg.rect(50, 70, 50, 92, 15)
    fg.rect(22, 74, 48, 88, 45)
    fg.sprite(27, 75, ['..hhhhh....', '.h.....h...', 'wwwwwwwwwg.', 'wWbWWWWWwwg', 'wWbWWWWWw.g', 'wWbWWWWWwg.',
                       'wWWWWWWWw..', 'ggggggggg..', 'ddddddddd..'],
              {'h': 40, 'w': 44, 'W': 45, 'b': 3, 'g': 42, 'd': 39})
    fg.rect(22, 86, 30, 87, 27)
    fg.rect(38, 86, 47, 87, 42)
    fg.rect(34, 68, 36, 70, 40)                                 # ручка коробки
    fg.line([(28, 69), (34, 68)], 40)
    # разделитель покупателей
    fg.rect(58, 88, 92, 91, 22)
    fg.rect(58, 88, 92, 88, 23)
    fg.rect(58, 91, 92, 91, 21)
    # терминал для карт и чек
    fg.sprite(150, 76, [
        '.kkkkkkkk.',
        'kKKKKKKKKk',
        'kKssssssKk',
        'kKssssssKk',
        'kKKKKKKKKk',
        'kKwKwKwKKk',
        'kKwKwKwKKk',
        'kKwKwKwKKk',
        'kKKKKgKKKk',
        '.kkkkkkkk.',
        '..kkkkkk..',
        '..kkkkkk..',
        '.kkkkkkkk.',
    ], {'k': 38, 'K': 39, 's': 4, 'w': 42, 'g': 8})
    fg.rect(166, 86, 176, 91, 45)
    fg.rect(166, 86, 176, 86, 44)
    for y in (88, 90):
        fg.rect(167, y, 174, y, 42)
    return bg, fg


# ---------------------------------------------------------------------------------------------------
# 4. Бытовка нового цеха «Водогрея», пятница, 23:10: крашеная панель, окно в цех с роботами,
#    шкафчики, плакат по охране труда, на столе клеёнка, кружки и домино.
# ---------------------------------------------------------------------------------------------------

def bytovka():
    bg = canvas()
    bg.rect(0, 0, W - 1, H - 1, 42)
    bg.rect(0, 0, W - 1, 3, 41)
    bg.rect(0, 50, W - 1, H - 1, 7)                             # панель
    bg.rect(0, 50, W - 1, 51, 8)
    bg.rect(0, 52, W - 1, 52, 6)
    bg.noise(0, 53, W - 1, H - 1, 6, 0.03)
    bg.noise(0, 4, W - 1, 49, 41, 0.02)
    # лампа дневного света над столом
    bg.rect(70, 0, 122, 2, 45)
    bg.rect(70, 3, 122, 3, 43)
    # окно в цех
    wx0, wy0, wx1, wy1 = 6, 10, 70, 62
    bg.rect(wx0, wy0, wx1, wy1, 38)
    bg.rect(wx0, wy0, wx1, wy0 + 8, 0)
    for x in range(wx0 + 4, wx1, 14):                          # прожекторы под крышей цеха
        bg.rect(x, wy0 + 2, x + 3, wy0 + 3, 23)
        dither_band(bg, x - 1, wy0 + 4, x + 4, wy0 + 6, 1)
    bg.rect(wx0, 50, wx1, wy1, 39)                              # пол цеха
    for x in range(wx0, wx1 + 1, 4):                           # жёлто-чёрная разметка
        bg.rect(x, 50, x + 1, 51, 22)
    bg.rect(wx0, 56, wx1, 58, 40)                               # конвейер
    bg.rect(wx0, 56, wx1, 56, 41)
    for x in range(wx0 + 2, wx1, 5):
        bg.px(x, 57, 38)

    def robot(x, y, flip=False):
        s = ['......oo....', '.....oOOo...', '....oOo.kk..', '...oOo...k..', '..oOo....kk.', '.oOo........',
             'kOOk........', 'kkkk........', '.kk.........', 'kkkk........', 'oooo........', 'kkkkk.......']
        if flip:
            s = [r[::-1] for r in s]
        bg.sprite(x, y, s, {'o': 21, 'O': 22, 'k': 37})

    robot(12, 42)
    robot(34, 40, True)
    robot(46, 42)
    for bx in (24, 58):                                         # корпуса бойлеров на ленте
        bg.rect(bx, 52, bx + 4, 55, 44)
        bg.rect(bx, 52, bx + 4, 52, 45)
    bg.rect(66, 44, 67, 49, 3)                                  # синий сигнальный огонь
    bg.px(66, 43, 4)
    bg.line([(wx0 + 6, wy1 - 2), (wx0 + 20, wy0 + 2)], 1)      # блики на стекле
    bg.line([(wx0 + 9, wy1 - 2), (wx0 + 23, wy0 + 2)], 1)
    bg.frame(wx0 - 1, wy0 - 1, wx1 + 1, wy1 + 1, 44)
    bg.frame(wx0 - 2, wy0 - 2, wx1 + 2, wy1 + 2, 40)
    bg.rect(38, wy0, 38, wy1, 44)
    bg.rect(wx0 - 3, wy1 + 2, wx1 + 3, wy1 + 3, 44)
    # микроволновка и чайник на тумбе под окном
    bg.rect(4, 70, 48, 72, 20)
    bg.rect(4, 73, 48, 96, 19)
    bg.rect(8, 58 + 2, 30, 69, 44)
    bg.rect(10, 62, 24, 67, 38)
    bg.rect(26, 62, 28, 67, 42)
    bg.px(27, 63, 27)
    bg.rect(36, 62, 44, 69, 41)
    bg.rect(36, 62, 44, 62, 42)
    bg.rect(45, 64, 46, 67, 41)
    # часы: 23:10
    bg.sprite(124, 8, ['...kkkk...', '.kkwwwwkk.', '.kwwwwwwk.', 'kwwwwkwwwk', 'kwwwwkwwwk', 'kwwwwkkkwk', 'kwwwwwwwwk',
                       '.kwwwwwwk.', '.kkwwwwkk.', '...kkkk...'], {'k': 38, 'w': 45})
    bg.px(128, 10, 38)
    bg.px(129, 12, 27)
    # плакат «Охрана труда»
    px0, py0, px1, py1 = 140, 6, 190, 30
    bg.rect(px0, py0, px1, py1, 45)
    bg.frame(px0, py0, px1, py1, 41)
    bg.rect(px0 + 1, py0 + 1, px1 - 1, py0 + 7, 27)
    s = 'ОХРАНА ТРУДА'
    text(bg, px0 + (px1 - px0 + 1 - text_w(s)) // 2, py0 + 2, s, 45)
    bg.ellipse(151, 20, 5, 4, 22)                              # каска
    bg.rect(145, 21, 157, 22, 21)
    bg.rect(145, 23, 157, 28, 45)
    bg.rect(170, 13, 185, 13, 42)
    bg.rect(170, 16, 184, 16, 42)
    bg.rect(170, 19, 182, 19, 42)
    bg.rect(170, 22, 185, 22, 42)
    bg.rect(170, 25, 180, 25, 42)
    # шкафчики
    for i, x0 in enumerate(range(146, 190, 11)):
        bg.rect(x0, 36, x0 + 9, 98, 41 if i % 2 == 0 else 3)
        c = 41 if i % 2 == 0 else 3
        bg.rect(x0, 36, x0 + 9, 36, lighter(c))
        bg.rect(x0 + 9, 36, x0 + 9, 98, darker(c))
        for y in (40, 42, 44):
            bg.rect(x0 + 2, y, x0 + 7, y, darker(c))
        bg.rect(x0 + 7, 62, x0 + 7, 66, 44)
        bg.rect(x0 + 3, 50, x0 + 6, 52, 45)
        bg.px(x0 + 4, 51, 38)
    bg.rect(145, 35, 190, 35, 38)
    bg.sprite(152, 31, ['..yyyyy..', '.yYYyyyy.', 'yyyyyyyyy', 'ddddddddd'], {'y': 22, 'Y': 23, 'd': 21})   # каска на шкафу
    bg.sprite(172, 32, ['.oooooo.', 'oOOOOOOo', 'oooooooo'], {'o': 28, 'O': 29})                          # жилет
    # пол
    bg.rect(0, 98, W - 1, H - 1, 40)
    bg.rect(0, 98, W - 1, 98, 39)

    # --- стол: клеёнка в клетку, кружки, банка кофе, домино, каска ---
    fg = canvas()
    fg.rect(0, 91, W - 1, H - 1, 45)
    for y in range(91, H):
        for x in range(W):
            if (x // 4 + y // 3) % 2 == 0:
                fg.px(x, y, 28 if y < 96 else 27)
            elif y >= 96:
                fg.px(x, y, 44)
    fg.rect(0, 91, W - 1, 91, 45)
    fg.rect(0, 101, W - 1, 101, 26)
    fg.shade(0, 102, W - 1, H - 1, 1)
    # эмалированные кружки
    mug(fg, 22, 83, 45, 2, 19)
    mug(fg, 36, 85, 8, 9, 20, handle_right=False)
    # банка растворимого кофе
    fg.rect(52, 78, 62, 91, 19)
    fg.rect(52, 78, 62, 79, 40)
    fg.rect(52, 83, 62, 87, 22)
    fg.rect(53, 84, 55, 86, 23)
    fg.rect(62, 80, 62, 91, 18)
    # домино
    for x, y, v in ((78, 88, 'h'), (92, 90, 'h'), (104, 87, 'v'), (112, 90, 'h'), (126, 88, 'h')):
        if v == 'h':
            fg.rect(x, y, x + 7, y + 3, 45)
            fg.rect(x, y + 4, x + 7, y + 4, 42)
            fg.px(x + 3, y + 1, 42)
            fg.px(x + 1, y + 1, 37)
            fg.px(x + 5, y + 2, 37)
            fg.px(x + 6, y + 1, 37)
        else:
            fg.rect(x, y - 3, x + 3, y + 3, 45)
            fg.rect(x, y + 4, x + 3, y + 4, 42)
            fg.px(x + 1, y - 2, 37)
            fg.px(x + 2, y + 2, 37)
    # каска бригадира
    fg.sprite(150, 78, [
        '.....yyyy.....',
        '...yyYYYyyy...',
        '..yYYyyyyyyy..',
        '.yYyyyyyyyyyy.',
        '.yyyyyyyyyyyd.',
        '.yyyyyyyyyydd.',
        'dddddddddddddd',
        '.ddddddddddd..',
    ], {'y': 22, 'Y': 23, 'd': 21})
    fg.rect(151, 86, 163, 86, 18)
    return bg, fg


# ---------------------------------------------------------------------------------------------------
# 5. Кабинет закупок «Инея», четверг, 15:00, солнце: тёмно-синие стены, стекло в сборочный цех
#    с белыми корпусами на конвейере, график цен на полипропилен, витринный холодильник со снежинкой.
# ---------------------------------------------------------------------------------------------------

SNOW = ['..#.#..', '#..#..#', '.#.#.#.', '..###..', '.#.#.#.', '#..#..#', '..#.#..']


def inei():
    bg = canvas()
    bg.rect(0, 0, W - 1, H - 1, 1)
    bg.rect(0, 0, W - 1, 2, 0)
    bg.noise(0, 3, W - 1, H - 1, 0, 0.015)
    # стеклянная стена в цех слева
    gx0, gx1, gy0, gy1 = 0, 58, 6, 88
    bg.rect(gx0, gy0, gx1, gy1, 44)
    bg.rect(gx0, gy0, gx1, gy0 + 7, 42)
    for x in range(gx0 + 3, gx1, 12):                          # лампы под крышей цеха
        bg.rect(x, gy0 + 3, x + 6, gy0 + 3, 45)
        bg.rect(x, gy0 + 4, x + 6, gy0 + 4, 43)
    bg.rect(gx0, 20, gx1, 22, 3)                               # кран-балка
    bg.rect(gx0, 20, gx1, 20, 4)
    bg.rect(40, 23, 40, 34, 40)
    bg.rect(37, 34, 43, 36, 22)
    bg.rect(gx0, 62, gx1, gy1, 43)                              # пол цеха
    for x in range(gx0, gx1 + 1, 4):
        bg.rect(x, 62, x + 1, 62, 22)
    bg.rect(gx0, 56, gx1, 60, 40)                               # лента конвейера
    bg.rect(gx0, 56, gx1, 56, 41)
    for x in range(gx0 + 1, gx1, 4):
        bg.px(x, 58, 38)
    for fx in (2, 20, 38, 56):                                  # корпуса холодильников
        bg.rect(fx, 34, fx + 11, 55, 45)
        bg.rect(fx + 10, 34, fx + 11, 55, 43)
        bg.rect(fx, 44, fx + 11, 44, 42)
        bg.rect(fx + 2, 37, fx + 2, 42, 42)
        bg.rect(fx + 2, 47, fx + 2, 52, 42)
        bg.frame(fx - 1, 33, fx + 12, 55, 41)
    bg.sprite(26, 26, SNOW, {'#': 4})                            # знак цеха
    bg.line([(6, gy1 - 2), (22, gy0 + 2)], 45)                  # блики стекла
    bg.line([(10, gy1 - 2), (26, gy0 + 2)], 45)
    bg.rect(gx1 + 1, gy0, gx1 + 2, gy1, 41)                     # рама
    bg.rect(29, gy0, 29, gy1, 41)
    bg.rect(gx0, gy1 + 1, gx1 + 2, gy1 + 2, 41)
    bg.rect(gx0, gy0 - 1, gx1 + 2, gy0 - 1, 41)
    # солнце из окна за спиной игрока: косой светлый прямоугольник на стене
    bg.poly([(70, 12), (100, 12), (112, 70), (82, 70)], 2)
    bg.checker(66, 12, 70, 70, 2)
    # график цен на полипропилен
    cx0, cy0, cx1, cy1 = 104, 10, 146, 44
    bg.rect(cx0, cy0, cx1, cy1, 45)
    bg.frame(cx0, cy0, cx1, cy1, 43)
    text(bg, cx0 + 3, cy0 + 3, 'ЦЕНА ПП', 38)
    bg.rect(cx0 + 4, cy0 + 11, cx0 + 4, cy1 - 4, 38)            # оси
    bg.rect(cx0 + 4, cy1 - 4, cx1 - 4, cy1 - 4, 38)
    for y in range(cy0 + 14, cy1 - 5, 5):
        for x in range(cx0 + 6, cx1 - 4, 2):
            bg.px(x, y, 43)
    pts = [(cx0 + 6, cy1 - 8), (cx0 + 12, cy1 - 10), (cx0 + 17, cy1 - 9), (cx0 + 23, cy1 - 14), (cx0 + 28, cy1 - 16),
           (cx0 + 33, cy1 - 22), (cx1 - 5, cy0 + 13)]
    bg.line(pts, 27)
    bg.line([(x, y - 1) for x, y in pts], 28)
    bg.sprite(cx1 - 8, cy0 + 11, ['..#', '.##', '###'], {'#': 27})
    # витринный холодильник «Иней» со снежинкой
    fx0, fx1 = 154, 186
    bg.rect(fx0, 8, fx1, 98, 45)
    bg.rect(fx1 - 2, 8, fx1, 98, 43)
    bg.rect(fx0, 8, fx1, 20, 3)                                  # световой короб
    bg.rect(fx0, 8, fx1, 8, 4)
    bg.sprite(fx0 + 2, 11, SNOW, {'#': 45})
    text(bg, fx0 + 11, 12, 'ИНЕЙ', 45)
    bg.rect(fx0 + 3, 23, fx1 - 5, 88, 5)                         # стеклянная дверь
    bg.rect(fx0 + 3, 23, fx1 - 5, 24, 4)
    for top in (38, 54, 70, 86):
        bg.rect(fx0 + 4, top, fx1 - 6, top, 43)
        x = fx0 + 5
        for c in (27, 8, 22, 3, 45, 29):
            if x > fx1 - 9:
                break
            h = 6 + (x * 3) % 5
            bg.rect(x, top - h, x + 2, top - 1, c)
            bg.px(x + 1, top - h - 1, lighter(c))
            x += 4
    bg.line([(fx0 + 6, 86), (fx0 + 14, 26)], 45)
    bg.rect(fx1 - 4, 44, fx1 - 4, 60, 42)                        # ручка
    bg.frame(fx0 - 1, 7, fx1 + 1, 99, 38)
    bg.shade(fx0 - 4, 10, fx0 - 2, 98, 1)
    # дипломы поставщиков и плинтус
    bg.rect(66, 76, 78, 90, 22)
    bg.rect(67, 77, 77, 89, 45)
    bg.rect(69, 80, 75, 80, 42)
    bg.rect(69, 83, 75, 83, 42)
    bg.rect(72, 86, 74, 88, 27)
    bg.rect(0, 100, W - 1, H - 1, 0)

    # --- стол: светлая берёза, ящик для овощей, полка на дверь, письмо со штампом ---
    fg = canvas()
    fg.rect(0, 91, W - 1, H - 1, 17)
    fg.rect(0, 91, W - 1, 91, 45)
    fg.rect(0, 94, W - 1, 94, 16)
    fg.rect(0, 102, W - 1, H - 1, 16)
    fg.rect(0, 102, W - 1, 102, 15)
    # ящик для овощей: прозрачный пластик с рёбрами
    fg.rect(8, 74, 50, 92, 5)
    fg.rect(8, 74, 50, 75, 45)
    fg.rect(10, 78, 48, 90, 4)
    for x in range(12, 48, 5):
        fg.rect(x, 78, x + 1, 90, 5)
    fg.rect(8, 92, 50, 92, 3)
    fg.frame(7, 73, 51, 93, 3)
    fg.rect(24, 76, 34, 76, 3)                                   # вырез-ручка
    # полка на дверь: белый пластиковый лоток
    fg.rect(142, 82, 186, 92, 45)
    fg.rect(142, 82, 186, 83, 44)
    fg.rect(144, 85, 184, 90, 44)
    fg.rect(144, 85, 184, 85, 43)
    fg.frame(141, 81, 187, 93, 42)
    fg.rect(160, 87, 168, 88, 4)                                 # наклейка-образец
    # письмо из Нинбо со штампом «СРОЧНО»
    lx0, lx1 = 86, 124
    fg.rect(lx0, 93, lx1, 106, 45)
    fg.rect(lx0, 106, lx1, 106, 43)
    for y in range(95, 104, 2):
        fg.rect(lx0 + 3, y, lx0 + 14, y, 42)
    s = 'СРОЧНО'
    sx = lx1 - 4 - text_w(s)
    fg.frame(sx - 2, 96, lx1 - 2, 104, 27)
    text(fg, sx, 98, s, 27)
    fg.px(sx + 5, 96, 45)                                        # штамп пропечатался неровно
    fg.px(lx1 - 2, 101, 45)
    # ручка
    fg.line([(128, 104), (138, 97)], 0)
    fg.px(138, 97, 27)
    return bg, fg


SCENES = {'dorm': (dorm, 'sosed'), 'street': (street, 'gopnik'), 'shop': (shop, 'admin'), 'bytovka': (bytovka, 'foreman'), 'inei': (inei, 'buyer')}


def main():
    out = os.path.join(ROOT, 'public', 'assets', 'scenes')
    prev = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(out, exist_ok=True)
    os.makedirs(prev, exist_ok=True)
    only = sys.argv[1:] or list(SCENES)
    for name in only:
        fn, face = SCENES[name]
        bg, fg = fn()
        bgi, fgi = bg.image(), fg.image()
        bgi.save(os.path.join(out, f'{name}.png'))
        fgi.save(os.path.join(out, f'{name}-desk.png'))
        comp = bgi.copy()
        sheet = os.path.join(ROOT, 'public', 'assets', 'portraits', face + '.png')
        if os.path.exists(sheet):
            p = Image.open(sheet).convert('RGBA').crop((0, 0, 96, 96))
            comp.alpha_composite(p, ((W - 96) // 2, H - 96 - 8))
        comp.alpha_composite(fgi)
        comp.resize((W * 4, H * 4), Image.NEAREST).save(os.path.join(prev, f'{name}_x4.png'))
        print('ok', name)


if __name__ == '__main__':
    main()
