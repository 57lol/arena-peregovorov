"""Новенький для шапки карты кампании: только что вышел из автобуса — ветровка, рюкзак, чемодан на колёсиках
и коробка с чайником. Второй кадр — чемодан стоит, коробка на земле, рука поднята: «привет» (конец недели).

64×72, прозрачный фон, палитра Apollo, контур снаружи тёмный — читается на любой подложке.
Запуск: ~/Arena-materials/.venv/bin/python tools/art/newbie.py
Пишет public/assets/map/newbie.png, newbie-2.png и превью ×4 в tools/art/out/newbie_x4.png.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from room3d import Tex  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W, H = 64, 72
OUTLINE = 37
SKIN, SKIN_S, SKIN_D = 16, 15, 14
HAIR, HAIR_L = 19, 20
JACK, JACK_S, JACK_L = 3, 2, 4          # синяя ветровка
PACK, PACK_S = 22, 21                   # горчичный рюкзак
JEANS, JEANS_S = 1, 0
CASE, CASE_S, CASE_L = 27, 26, 28       # красный чемодан
BOX, BOX_S, BOX_T = 16, 15, 17          # картон

HEAD = [
    '....hhhhh...',
    '..hhHHHHhh..',
    '.hhHHHHHHhh.',
    '.hhhHHhhhhhh',
    '.hhhhhhhhhhh',
    '.hhssssshhhh',
    '.hsssssssshh',
    '.hssessseshh',
    '.hsssssssshh',
    '..sSssssssh.',
    '..sssmmssS..',
    '...sssssS...',
    '....SSSS....',
]


def outline(t):
    m = t.a != -1
    edge = np.zeros_like(m)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        edge |= np.roll(np.roll(m, dy, 0), dx, 1)
    t.a[edge & ~m] = OUTLINE


def suitcase(t, handle_top=28):
    """Чемодан слева, на колёсиках, выдвижная ручка."""
    x0, x1, y0, y1 = 3, 15, 40, 65
    t.rect(x0, y0, x1, y1, CASE)
    t.rect(x1 + 1, y0 + 1, x1 + 3, y1, CASE_S)                 # бок
    t.rect(x0, y0, x1, y0, CASE_L)
    t.rect(x0 + 1, y0 - 1, x1 + 2, y0 - 1, CASE_S)              # верхняя грань
    for x in (x0 + 4, x0 + 8):                                   # рёбра корпуса
        t.rect(x, y0 + 2, x, y1 - 2, CASE_S)
    t.rect(x0 + 1, y0 + 6, x0 + 3, y0 + 9, 23)                  # бирка
    t.px(x0 + 2, y0 + 5, 42)
    t.rect(x0 + 10, y0 + 12, x0 + 12, y0 + 14, 45)              # наклейка
    t.rect(x0 + 1, y1 + 1, x0 + 3, y1 + 3, 38)                  # колёса
    t.rect(x1, y1 + 1, x1 + 2, y1 + 3, 38)
    t.px(x0 + 2, y1 + 2, 41)
    t.px(x1 + 1, y1 + 2, 41)
    t.rect(10, handle_top, 10, y0 - 2, 42)                      # ручка
    t.rect(13, handle_top, 13, y0 - 2, 42)
    t.rect(10, handle_top, 13, handle_top + 1, 40)


def kettle_box(t, x0, y0):
    """Коробка 17×19 с картинкой чайника и пластиковой ручкой сверху."""
    x1, y1 = x0 + 15, y0 + 18
    t.rect(x0, y0, x1, y1, BOX)
    t.rect(x1 + 1, y0 + 1, x1 + 2, y1, BOX_S)
    t.rect(x0 + 1, y0 - 1, x1 + 2, y0 - 1, BOX_T)
    t.rect(x0, y1, x1, y1, BOX_S)
    t.rect(x0 + 2, y0 + 2, x1 - 2, y1 - 3, 45)                   # белое окно
    t.sprite(x0 + 3, y0 + 3, [
        '..hhhh....',
        '.h....h...',
        'wwwwwwwg..',
        'wWbWWWWwg.',
        'wWbWWWWw.g',
        'wWbWWWWwg.',
        'wWWWWWWw..',
        'ggggggggg.',
    ], {'h': 40, 'w': 44, 'W': 45, 'b': 3, 'g': 42})
    t.rect(x0 + 2, y1 - 2, x0 + 7, y1 - 2, 27)                  # полоска бренда
    t.rect(x0 + 9, y1 - 2, x1 - 2, y1 - 2, 42)
    t.rect(x0 + 5, y0 - 4, x0 + 5, y0 - 2, 41)                  # ручка
    t.rect(x0 + 10, y0 - 4, x0 + 10, y0 - 2, 41)
    t.rect(x0 + 5, y0 - 5, x0 + 10, y0 - 5, 41)


def body(t, wave=False):
    # рюкзак за спиной (виден слева от корпуса)
    t.rect(17, 21, 23, 41, PACK)
    t.rect(17, 21, 23, 21, 23)
    t.rect(17, 30, 22, 31, PACK_S)
    t.rect(18, 33, 21, 38, PACK_S)                              # карман
    t.rect(18, 33, 21, 33, PACK)
    t.px(20, 35, 41)
    # ноги в джинсах, кроссовки
    t.rect(23, 45, 28, 63, JEANS)
    t.rect(31, 45, 36, 63, JEANS)
    t.rect(29, 45, 30, 50, JEANS)
    t.rect(27, 47, 28, 63, JEANS_S)
    t.rect(35, 47, 36, 63, JEANS_S)
    t.rect(24, 48, 24, 60, 2)
    t.rect(32, 48, 32, 60, 2)
    for x0 in (22, 31):
        t.rect(x0, 64, x0 + 7, 67, 45)
        t.rect(x0, 64, x0 + 7, 64, 44)
        t.rect(x0 + 5, 65, x0 + 7, 66, 44)
        t.rect(x0, 68, x0 + 7, 68, 41)
        t.px(x0 + 2, 65, 3)
    # ветровка
    t.rect(21, 20, 38, 46, JACK)
    t.rect(21, 20, 38, 21, JACK_L)
    t.rect(34, 22, 38, 46, JACK_S)                              # тень справа
    t.rect(21, 44, 38, 46, JACK_S)                              # резинка низа
    t.rect(21, 44, 38, 44, JACK)
    t.rect(30, 21, 30, 43, 45)                                  # молния
    t.rect(23, 32, 27, 32, JACK_S)                              # клапан кармана
    t.rect(25, 18, 34, 21, JACK_L)                              # воротник-капюшон
    t.rect(26, 19, 33, 20, JACK)
    # лямки рюкзака
    t.rect(23, 21, 24, 36, PACK_S)
    t.rect(35, 21, 36, 34, PACK_S)
    t.px(23, 30, 40)
    t.px(35, 30, 40)
    # левая рука к ручке чемодана
    t.poly([(21, 21), (23, 25), (17, 33), (14, 31)], JACK)      # рукав к чемодану
    t.poly([(22, 25), (23, 25), (17, 33), (16, 33)], JACK_S)
    t.rect(11, 28, 14, 31, SKIN)                                # кисть на ручке
    t.rect(11, 31, 14, 31, SKIN_S)
    # правая рука
    if wave:
        t.poly([(37, 21), (43, 10), (47, 11), (41, 26)], JACK)    # рукав вверх
        t.poly([(41, 25), (46, 12), (47, 12), (42, 26)], JACK_S)
        t.rect(44, 9, 46, 10, 45)                               # манжета
        t.sprite(43, 2, ['.s.s..', '.s.s.s', 'ssssss', 'ssssS.', 'sssS..', '.sS...', '.s....'],
                 {'s': SKIN, 'S': SKIN_S})
        t.px(41, 3, SKIN)
        t.px(41, 4, SKIN)
    else:
        t.rect(38, 22, 41, 38, JACK_S)
        t.rect(38, 22, 39, 36, JACK)
        t.rect(38, 38, 41, 39, 44)                              # манжета
        t.rect(38, 40, 42, 43, SKIN)
        t.rect(38, 43, 42, 43, SKIN_S)
    # голова
    t.sprite(24, 5, HEAD, {'h': HAIR, 'H': HAIR_L, 's': SKIN, 'S': SKIN_S, 'e': 37, 'm': SKIN_D})
    if wave:  # улыбка
        t.rect(28, 15, 31, 15, SKIN)
        t.px(28, 14, SKIN_D)
        t.rect(29, 15, 30, 15, 13)
        t.px(31, 14, SKIN_D)
        t.px(26, 13, 28)
        t.px(33, 13, 28)


def frame(wave=False):
    t = Tex(W, H)
    suitcase(t)
    body(t, wave)
    if wave:
        kettle_box(t, 43, 50)          # коробка стоит у ног
    else:
        kettle_box(t, 34, 48)          # висит в руке
        t.rect(39, 41, 41, 43, SKIN)   # пальцы поверх ручки
    outline(t)
    return t


def main():
    out = os.path.join(ROOT, 'public', 'assets', 'map')
    prev = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(out, exist_ok=True)
    os.makedirs(prev, exist_ok=True)
    ims = []
    for name, wave in (('newbie', False), ('newbie-2', True)):
        im = frame(wave).image()
        im.save(os.path.join(out, f'{name}.png'))
        ims.append(im)
    sheet = Image.new('RGBA', (W * 2 + 8, H), (72, 74, 60, 255))
    sheet.alpha_composite(ims[0], (0, 0))
    sheet.alpha_composite(ims[1], (W + 8, 0))
    sheet.resize((sheet.width * 4, H * 4), Image.NEAREST).save(os.path.join(prev, 'newbie_x4.png'))
    print('ok newbie')


if __name__ == '__main__':
    main()
