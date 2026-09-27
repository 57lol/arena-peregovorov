"""Фоны сцен 192x108 (16:9), рисуются прямоугольниками по сетке в палитре Apollo.
Каждая сцена = фон (bg) + передний план со столом (fg), между ними встаёт портрет.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/scenes.py
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from apollo import RGB  # noqa: E402

W, H = 192, 108
T = -1
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


class Canvas:
    def __init__(self, fill=T):
        self.a = np.full((H, W), fill, int)

    def rect(self, x0, y0, x1, y1, c):
        """Включительно по обоим краям."""
        x0, x1 = max(0, x0), min(W - 1, x1)
        y0, y1 = max(0, y0), min(H - 1, y1)
        if x0 <= x1 and y0 <= y1:
            self.a[y0:y1 + 1, x0:x1 + 1] = c

    def frame(self, x0, y0, x1, y1, c):
        self.rect(x0, y0, x1, y0, c)
        self.rect(x0, y1, x1, y1, c)
        self.rect(x0, y0, x0, y1, c)
        self.rect(x1, y0, x1, y1, c)

    def px(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.a[y, x] = c

    def line(self, pts, c):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = max(abs(x1 - x0), abs(y1 - y0), 1)
            for i in range(n + 1):
                self.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), c)

    def sprite(self, x0, y0, rows, legend):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch != '.':
                    self.px(x0 + dx, y0 + dy, legend[ch])

    def checker(self, x0, y0, x1, y1, c, phase=0):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if (x + y + phase) % 2 == 0:
                    self.px(x, y, c)

    def image(self):
        rgba = np.zeros((H, W, 4), np.uint8)
        for y in range(H):
            for x in range(W):
                c = self.a[y, x]
                if c != T:
                    rgba[y, x] = (*RGB[c], 255)
        return Image.fromarray(rgba, 'RGBA')


# ---------------------------------------------------------------------------
# 1. Кабинет коммерческого директора на заводе: крашеная панель, окно на цеха,
#    шкаф с папками, вымпел, чай в подстаканнике.
# ---------------------------------------------------------------------------

def factory():
    bg = Canvas()
    # стена: побелка сверху, крашеная панель снизу, между ними бордюр
    bg.rect(0, 0, W - 1, 57, 44)
    bg.rect(0, 0, W - 1, 3, 43)            # тень у потолка
    bg.rect(0, 58, W - 1, 59, 40)
    bg.rect(0, 60, W - 1, H - 1, 41)
    bg.rect(0, 60, W - 1, 60, 42)
    # солнечный прямоугольник от окна на стене
    bg.rect(64, 20, 80, 56, 45)

    # окно
    wx0, wy0, wx1, wy1 = 6, 8, 58, 56
    bg.rect(wx0, wy0, wx1, wy1, 45)
    sky = [(wy0 + 2, 5), (wy0 + 14, 4), (wy0 + 30, 4)]
    bg.rect(wx0 + 2, wy0 + 2, wx1 - 2, wy1 - 2, 5)
    bg.rect(wx0 + 2, wy0 + 16, wx1 - 2, wy1 - 2, 4)
    bg.checker(wx0 + 2, wy0 + 14, wx1 - 2, wy0 + 15, 4)
    # облако
    bg.rect(14, 16, 26, 18, 45)
    bg.rect(17, 14, 23, 15, 45)
    # цеха за окном: ангары, трубы, кран
    bg.rect(wx0 + 2, 40, wx1 - 2, wy1 - 2, 2)
    bg.rect(10, 36, 30, 44, 3)
    bg.line([(10, 36), (20, 32), (30, 36)], 3)
    bg.rect(12, 33, 28, 35, 3)
    bg.rect(34, 30, 36, 44, 2)             # труба
    bg.rect(34, 30, 36, 30, 27)
    bg.rect(40, 26, 42, 44, 2)
    bg.rect(40, 26, 42, 26, 27)
    bg.checker(41, 20, 44, 25, 44)         # пар
    bg.checker(35, 25, 38, 29, 44, 1)
    bg.line([(46, 22), (46, 44)], 1)       # кран
    bg.line([(46, 22), (56, 22)], 1)
    bg.line([(46, 26), (52, 22)], 1)
    bg.line([(54, 22), (54, 28)], 0)
    bg.rect(44, 38, 56, 44, 3)
    for x in range(12, 30, 4):
        bg.rect(x, 40, x + 1, 41, 23)      # окна цеха
    bg.rect(wx0 + 2, 46, wx1 - 2, wy1 - 2, 1)  # забор/дорога
    # рама и импост
    bg.frame(wx0, wy0, wx1, wy1, 43)
    bg.rect(wx0 + 1, wy0 + 1, wx1 - 1, wy0 + 1, 45)
    bg.rect(31, wy0, 32, wy1, 45)
    bg.rect(wx0, 30, wx1, 31, 45)
    bg.rect(33, wy0, 33, wy1, 43)
    # жалюзи, приподнятые
    bg.rect(wx0 - 1, wy0 - 3, wx1 + 1, wy0 + 4, 43)
    for y in range(wy0 - 2, wy0 + 5, 2):
        bg.rect(wx0 - 1, y, wx1 + 1, y, 44)
    bg.line([(50, wy0 + 5), (50, 22)], 40)
    bg.rect(49, 22, 51, 23, 40)
    # подоконник и батарея
    bg.rect(wx0 - 3, wy1 + 1, wx1 + 3, wy1 + 2, 45)
    bg.rect(wx0 - 3, wy1 + 3, wx1 + 3, wy1 + 3, 42)
    bg.rect(12, 64, 52, 80, 43)
    for x in range(13, 52, 3):
        bg.rect(x, 65, x, 79, 42)
    bg.rect(12, 80, 52, 80, 40)
    # горшок с алоэ на подоконнике
    bg.rect(12, 50, 18, 56, 20)
    bg.rect(12, 50, 18, 50, 21)
    bg.sprite(10, 40, ['..9...9..', '.9.9.9...', '..999.9..', '.9.989...', '...898.9.', '..99899..', '...888...', '.........', '.........', '.........'],
              {'9': 9, '8': 8})

    # вымпел за спиной
    bg.rect(122, 42, 138, 42, 20)
    bg.sprite(123, 43, ['RRRRRRRRRRRRRRR', 'rRRRRRRRRRRRRRr', '.rRRyyyyyyyRRr.', '..rRRRRRRRRRr..', '...rRRyyyRRr...',
                       '....rRRRRRr....', '.....rRRRr.....', '......rRr......', '.......r.......'],
              {'R': 27, 'r': 26, 'y': 22})
    for x in range(123, 138, 2):
        bg.px(x, 52, 22)

    # грамота в рамке
    bg.rect(64, 10, 80, 30, 20)
    bg.rect(65, 11, 79, 29, 17)
    bg.rect(67, 13, 77, 14, 27)
    bg.rect(68, 17, 76, 17, 15)
    bg.rect(68, 19, 76, 19, 15)
    bg.rect(68, 21, 74, 21, 15)
    bg.rect(73, 25, 76, 27, 22)
    bg.rect(64, 31, 80, 31, 42)

    # календарь
    bg.rect(118, 12, 134, 36, 45)
    bg.rect(118, 12, 134, 17, 27)
    bg.rect(125, 10, 127, 12, 38)
    for yy in range(20, 35, 3):
        for xx in range(120, 133, 3):
            bg.px(xx, yy, 42)
    bg.frame(124, 25, 127, 27, 27)
    bg.rect(118, 37, 134, 37, 42)

    # шкаф с папками
    sx0, sx1 = 140, 186
    bg.rect(sx0, 14, sx1, 92, 20)
    bg.rect(sx0, 14, sx1, 15, 21)
    bg.rect(sx0 + 2, 17, sx1 - 2, 90, 19)
    for top in (18, 42, 66):
        bg.rect(sx0 + 2, top + 21, sx1 - 2, top + 22, 20)
    binders = [27, 2, 22, 27, 8, 2, 2, 42, 26, 22, 8]
    x = sx0 + 3
    for i, col in enumerate(binders):
        w = 3 + (i % 2)
        bg.rect(x, 22, x + w - 1, 38, col)
        bg.rect(x, 25, x + w - 1, 28, 45)
        bg.rect(x, 22, x, 38, 37 if col in (2, 26) else 18)
        x += w + 1
        if x > sx1 - 6:
            break
    # вторая полка: наклонённые папки и каска
    x = sx0 + 3
    for i, col in enumerate([2, 2, 42, 27]):
        bg.rect(x, 48, x + 3, 62, col)
        bg.rect(x, 51, x + 3, 54, 45)
        x += 5
    bg.rect(x, 50, x + 3, 62, 22)
    bg.rect(x, 53, x + 3, 55, 45)
    # глобус-пресс-папье
    bg.sprite(sx1 - 16, 52, ['..bbbb..', '.bBbggb.', 'bBbbbggb', 'bggbbbbb', 'bbggbbgb', '.bbbbbb.', '..bbbb..', '...dd...', '.dddddd.', '.dddddd.'],
              {'b': 3, 'B': 4, 'g': 8, 'd': 20})
    # нижняя полка: коробки образцов
    bg.rect(sx0 + 4, 76, sx0 + 18, 88, 16)
    bg.rect(sx0 + 4, 76, sx0 + 18, 77, 17)
    bg.rect(sx0 + 9, 80, sx0 + 13, 82, 14)
    bg.rect(sx0 + 22, 80, sx0 + 38, 88, 15)
    bg.rect(sx0 + 22, 80, sx0 + 38, 81, 16)
    bg.rect(sx0 + 29, 80, sx0 + 30, 88, 14)
    bg.frame(sx0, 14, sx1, 92, 18)
    bg.sprite(sx0 + 22, 6, ['.....yyyyy.....', '...yyYYyyyyy...', '..yYYyyyyyyyy..', '.yyyyyyyyyyyyy.', '.yyyyyyyyyyyyy.',
                            'ddddddddddddddd', '.ddddddddddddd.', '...............'], {'y': 22, 'Y': 23, 'd': 21})

    # розетка и выключатель
    bg.rect(112, 68, 116, 72, 44)
    bg.px(113, 70, 40)
    bg.px(115, 70, 40)

    # --- передний план: стол ---
    fg = Canvas()
    fg.rect(0, 92, W - 1, H - 1, 19)
    fg.rect(0, 92, W - 1, 94, 20)
    fg.rect(0, 92, W - 1, 92, 21)
    for x in range(8, W, 23):
        fg.rect(x, 96, x + 9, 96, 18)
    fg.rect(0, 95, W - 1, 95, 18)
    # стопка бумаг
    fg.rect(16, 87, 44, 93, 45)
    fg.rect(17, 88, 43, 88, 44)
    fg.rect(16, 90, 44, 90, 43)
    fg.rect(18, 86, 42, 86, 44)
    fg.rect(38, 85, 41, 86, 27)  # скрепка-закладка
    # стакан чая в подстаканнике
    fg.sprite(150, 80, [
        '......s......',
        '......s......',
        '..gggggsggg..',
        '..gwttttstg..',
        '..gwttttttg..',
        '..gwTTTTTTg..',
        '..gwTTTTTTg..',
        '.mMMMMMMMMMm.',
        '.mMmMmMmMmMmmm',
        '.mMMMMMMMMMm.m',
        '.mMmMmMmMmMmmm',
        '.mMMMMMMMMMm..',
        '..mmmmmmmmm...',
        '.mmmmmmmmmmm..',
    ], {'s': 43, 'g': 44, 'w': 45, 't': 22, 'T': 21, 'm': 40, 'M': 42})
    # табличка с именем
    fg.rect(86, 88, 106, 93, 20)
    fg.rect(86, 88, 106, 88, 21)
    fg.rect(88, 90, 104, 91, 23)
    return bg, fg


# ---------------------------------------------------------------------------
# 2. Переговорная в бизнес-центре: окно на город, маркерная доска, рейки,
#    монстера, кулер.
# ---------------------------------------------------------------------------

def office():
    bg = Canvas()
    bg.rect(0, 0, W - 1, H - 1, 43)
    bg.rect(0, 0, W - 1, 2, 42)
    # деревянные рейки справа
    bg.rect(126, 0, W - 1, H - 1, 20)
    for x in range(127, W, 4):
        bg.rect(x, 0, x + 1, H - 1, 21)
        bg.rect(x + 2, 0, x + 2, H - 1, 19)
    # окно на город (слева, во всю высоту)
    bg.rect(0, 6, 44, 90, 4)
    bg.rect(0, 6, 44, 30, 5)
    bg.checker(0, 31, 44, 33, 5)
    bldg = [(0, 40, 8, 3), (9, 28, 17, 2), (18, 46, 25, 3), (26, 22, 34, 1), (35, 36, 44, 2)]
    for x0, y0, x1, col in bldg:
        bg.rect(x0, y0, x1, 90, col)
        for yy in range(y0 + 3, 88, 4):
            for xx in range(x0 + 2, x1 - 1, 3):
                bg.px(xx, yy, 5 if (xx * 7 + yy) % 5 else 23)
    bg.rect(27, 16, 27, 21, 1)             # шпиль
    bg.rect(0, 84, 44, 90, 1)
    bg.frame(0, 6, 44, 90, 39)
    bg.rect(22, 6, 22, 90, 39)
    bg.rect(0, 91, 44, 92, 42)

    # маркерная доска
    bx0, by0, bx1, by1 = 52, 12, 104, 50
    bg.rect(bx0, by0, bx1, by1, 45)
    bg.frame(bx0, by0, bx1, by1, 42)
    bg.rect(bx0, by1 + 1, bx1, by1 + 2, 41)
    bg.rect(bx0 + 4, by1 + 1, bx0 + 7, by1 + 1, 27)
    bg.rect(bx0 + 10, by1 + 1, bx0 + 13, by1 + 1, 2)
    # на доске: «воронка» из стрелок, круг вокруг цифры, зачёркнутое
    bg.line([(57, 18), (70, 18)], 2)
    bg.line([(57, 21), (66, 21)], 2)
    bg.line([(57, 24), (68, 24)], 2)
    bg.line([(74, 17), (82, 22), (74, 27)], 2)
    bg.frame(84, 17, 98, 27, 27)
    bg.line([(87, 22), (95, 22)], 27)
    bg.line([(58, 34), (76, 34)], 40)
    bg.line([(57, 36), (77, 32)], 27)
    bg.line([(58, 42), (62, 38), (66, 41), (72, 36), (78, 39), (84, 33)], 8)
    # стикеры
    bg.rect(88, 32, 95, 39, 23)
    bg.rect(88, 32, 95, 32, 22)
    bg.rect(90, 35, 93, 35, 21)
    bg.rect(96, 38, 102, 44, 35)
    bg.rect(98, 41, 100, 41, 33)

    # часы на стене
    bg.sprite(108, 10, ['...kkkk...', '.kkwwwwkk.', '.kwwwkwwk.', 'kwwwwkwwwk', 'kwwwwkwwwk', 'kwwwwkkkwk', 'kwwwwwwwwk',
                        '.kwwwwwwk.', '.kkwwwwkk.', '...kkkk...'], {'k': 38, 'w': 45})

    # сансевиерия в кашпо
    bg.rect(158, 74, 180, 92, 38)
    bg.rect(158, 74, 180, 75, 40)
    bg.rect(159, 76, 160, 91, 39)
    blades = [(160, 44, 3, 7), (164, 34, 4, 8), (168, 40, 3, 7), (171, 28, 4, 8), (175, 42, 3, 7), (178, 50, 3, 8)]
    for x, top, w, col in blades:
        for y in range(top, 74):
            k = (y - top) / 5
            ww = min(w, 1 + int(k))
            bg.rect(x, y, x + ww - 1, y, col)
            bg.px(x, y, 10 if y > top + 2 else col)
            if (y + x) % 7 == 0 and ww > 2:
                bg.px(x + 1, y, 6)
    # плинтус
    bg.rect(46, 92, 125, 93, 41)

    # --- передний план: светлый переговорный стол ---
    fg = Canvas()
    fg.rect(0, 91, W - 1, H - 1, 42)
    fg.rect(0, 91, W - 1, 93, 44)
    fg.rect(0, 91, W - 1, 91, 45)
    fg.rect(0, 94, W - 1, 94, 41)
    # ноутбук (крышкой к нам)
    fg.rect(128, 76, 162, 92, 42)
    fg.rect(128, 76, 162, 76, 44)
    fg.rect(129, 77, 161, 91, 43)
    fg.rect(143, 82, 147, 85, 44)
    fg.rect(151, 86, 156, 89, 27)
    fg.frame(128, 76, 162, 92, 40)
    fg.rect(126, 92, 164, 93, 40)
    # стакан воды
    fg.rect(28, 82, 34, 92, 5)
    fg.rect(29, 86, 33, 91, 4)
    fg.rect(28, 82, 28, 92, 45)
    fg.rect(34, 82, 34, 92, 43)
    # ручка и блокнот
    fg.rect(44, 88, 66, 93, 45)
    fg.rect(44, 88, 66, 88, 44)
    fg.line([(48, 90), (60, 90)], 42)
    fg.line([(70, 92), (82, 88)], 1)
    return bg, fg


SCENES = {'factory': factory, 'office': office}


def main():
    out = os.path.join(ROOT, 'public', 'assets', 'scenes')
    prev = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(out, exist_ok=True)
    os.makedirs(prev, exist_ok=True)
    port = {'factory': 'rinat', 'office': 'olga'}
    for name, fn in SCENES.items():
        bg, fg = fn()
        bgi, fgi = bg.image(), fg.image()
        bgi.save(os.path.join(out, f'{name}.png'))
        fgi.save(os.path.join(out, f'{name}-desk.png'))
        # превью с портретом
        comp = bgi.copy()
        sheet = os.path.join(ROOT, 'public', 'assets', 'portraits', port[name] + '.png')
        if os.path.exists(sheet):
            p = Image.open(sheet).crop((0, 0, 96, 96))
            comp.alpha_composite(p, ((W - 96) // 2, H - 96 - 8))
        comp.alpha_composite(fgi)
        comp.resize((W * 5, H * 5), Image.NEAREST).save(os.path.join(prev, f'{name}_x5.png'))
        print('ok', name)


if __name__ == '__main__':
    main()
