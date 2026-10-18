"""Видеозвонок с Ли Вэем: окно связи на экранах и 2D-сцена «переговорная «Кама», большой экран, звонок».

Экран (для 3D, src/game/world3d/call.ts: ноутбук игрока и большой экран переговорной) — 192×120, как 16:10:
  call_bg.png  — верхняя полоса окна, видео из шоурума в Шэньчжэне, нижняя панель кнопок;
  call_ui.png  — то, что лежит поверх собеседника: плашка с именем, окошко «Вы» (камера переговорной).
Портрет (96×96) встаёт между ними в x=48, y=10. Таймер и полоски связи рисует сам браузер.

2D-сцена для запасного вида встречи (scenes/meet.png и meet-desk.png, 192×108): то же окно звонка на большом
экране, по краям — дубовые рейки стены и фикус, внизу край стола. Портрет — как во всех сценах, x=48, y=4.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/call_screen.py
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from font import text, text_w  # noqa: E402
from room3d import T, Tex, darker  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
rng = np.random.default_rng(1688)

# цвета Apollo
INK, DARK, BAR, BAR2, SLATE, STEEL, MIST, PALE, WHITE = 36, 37, 38, 39, 40, 41, 42, 44, 45
BOX_D, BOX, BOX_L, BOX_H, TAPE = 13, 14, 15, 16, 17
BLUE_D, BLUE, BLUE_L = 1, 2, 3
ORANGE, ORANGE_L = 21, 22
GREEN, GREEN_L = 9, 10
RED, RED_L = 27, 28

SCREEN_W, SCREEN_H = 192, 120
VIDEO_Y, VIDEO_H = 10, 96


# --------------------------------------------------------------------------------------------------- склад

def carton(t, x, y, w, h, light=BOX_L, tape=True, label=True):
    """Коробка: лицевая сторона, тень справа и снизу, скотч и наклейка."""
    t.rect(x, y, x + w - 1, y + h - 1, BOX)
    t.rect(x, y, x + w - 1, y, light)
    t.rect(x + w - 1, y + 1, x + w - 1, y + h - 1, BOX_D)
    t.rect(x, y + h - 1, x + w - 1, y + h - 1, BOX_D)
    if tape and w >= 6:
        cx = x + w // 2
        t.rect(cx, y, cx, y + min(3, h - 2), TAPE)
    if label and w >= 8 and h >= 6:
        lx = x + 2 + int(rng.integers(0, max(1, w - 7)))
        ly = y + h - 4
        t.rect(lx, ly, lx + 3, ly + 1, WHITE)
        t.px(lx + 1, ly + 1, MIST)


def product_box(t, x, y, w, h, top=BLUE, face=WHITE):
    """Коробка датчиков: белая с синей полосой и окошком-этикеткой — так упакованы образцы."""
    t.rect(x, y, x + w - 1, y + h - 1, face)
    t.rect(x, y, x + w - 1, y + 1, top)
    t.rect(x + w - 1, y + 2, x + w - 1, y + h - 1, PALE)
    if w >= 6 and h >= 6:
        t.rect(x + 1, y + h - 3, x + 3, y + h - 3, MIST)


def sensor(t, x, y, c=PALE, cable=ORANGE):
    """Индуктивный датчик M12 на крючке: резьбовой цилиндр и кабель."""
    t.rect(x, y, x + 1, y + 6, c)
    t.px(x, y + 1, WHITE)
    t.px(x, y + 3, WHITE)
    t.px(x, y + 5, WHITE)
    t.rect(x, y + 7, x + 1, y + 7, cable)
    t.line([(x + 1, y + 8), (x + 2, y + 11), (x, y + 14)], cable)


# 华明电子 штрихами 7×7: шрифта с иероглифами у нас нет
HANZI = (
    ['.#..#..', '#...#.#', '##..##.', '.#..###', '#######', '...#...', '...#...'],  # 华
    ['....###', '###.#.#', '#.#.###', '###.#.#', '#.#.###', '###.#.#', '...#..#'],  # 明
    ['...#...', '.#####.', '.#.#.#.', '.#####.', '.#.#.#.', '.#####.', '...####'],  # 电
    ['.#####.', '.....#.', '....#..', '#######', '...#...', '...#...', '..##...'],  # 子
)


def warehouse(t, x0, y0, w, h):
    """Шоурум Ли Вэя в Шэньчжэне (у рынка Хуацянбэй): вывеска «Хуамин Электроникс», светлая стена, аккуратные белые стеллажи с коробками образцов, стенд с датчиками,
    фонарик-подвеска и бамбук «на удачу». За головой — спокойная стена, чтобы лицо читалось."""
    x1, y1 = x0 + w - 1, y0 + h - 1
    # стена: светлая, к потолку чуть темнее; плинтус и пол из плитки
    t.rect(x0, y0, x1, y1, PALE)
    t.rect(x0, y0, x1, y0 + 2, MIST)
    t.checker(x0, y0 + 3, x1, y0 + 4, MIST)
    floor = y0 + int(h * 0.84)
    t.rect(x0, floor, x1, y1, MIST)
    t.rect(x0, floor, x1, floor, STEEL)
    for xx in range(x0, x1, 12):
        t.rect(xx, floor + 1, xx, y1, PALE)
    # потолочные светильники
    for lx in (x0 + 26, x1 - 42):
        t.rect(lx, y0, lx + 16, y0, WHITE)
        t.checker(lx - 1, y0 + 1, lx + 17, y0 + 1, WHITE)
    # стеллаж слева: белые стойки, три полки, коробки ровными рядами
    def shelf(sx, sw, top, rows=3):
        for r in range(rows):
            ly = top + r * 17
            x = sx + 2
            k = 0
            while x + 8 <= sx + sw - 2:
                bw = 8 if k % 3 else 10
                bh = 9 if k % 2 else 11
                product_box(t, x, ly + 14 - bh, bw, bh, top=(BLUE, BLUE_L, RED)[(k + r) % 3] if k % 4 else BLUE)
                x += bw + 1
                k += 1
            t.rect(sx, ly + 14, sx + sw - 1, ly + 15, WHITE)
            t.rect(sx, ly + 16, sx + sw - 1, ly + 16, MIST)
        for px_ in (sx, sx + sw - 1):
            t.rect(px_, top - 3, px_, floor, WHITE)
            t.rect(px_ + (1 if px_ == sx else -1), top - 3, px_ + (1 if px_ == sx else -1), floor, MIST)
    shelf(x0 + 2, 40, y0 + 12)
    # над стеллажом — красная вывеска магазина: золотые 华明电子 и белое «ХУАМИН»
    sx, sy = x0 + 3, y0 + 2
    sw = 4 * 8 + 2 + text_w('ХУАМИН') + 4
    t.rect(sx, sy, sx + sw, sy + 10, RED)
    t.frame(sx, sy, sx + sw, sy + 10, 26)
    t.rect(sx + 1, sy + 1, sx + sw - 1, sy + 1, RED_L)
    for k, g in enumerate(HANZI):
        for dy, row in enumerate(g):
            for dx, v in enumerate(row):
                if v == '#':
                    t.px(sx + 3 + k * 8 + dx, sy + 2 + dy, ORANGE_L)
    text(t, sx + 3 + 4 * 8 + 1, sy + 3, 'ХУАМИН', WHITE)
    # справа — стенд с образцами датчиков на крючках и подписи
    bx0, bx1 = x1 - 44, x1 - 4
    t.rect(bx0, y0 + 8, bx1, y0 + 52, WHITE)
    t.frame(bx0, y0 + 8, bx1, y0 + 52, MIST)
    t.rect(bx0, y0 + 8, bx1, y0 + 13, BLUE)
    text(t, bx0 + 4, y0 + 9, 'ДАТЧИКИ', WHITE)
    for r in range(2):
        for k in range(6):
            sensor(t, bx0 + 4 + k * 6, y0 + 17 + r * 18, cable=(ORANGE, BLUE_L, GREEN)[(k + r) % 3])
    # за головой: спокойная стена; правее головы на стене — красный фонарик с кисточкой
    lx, ly = bx0 - 12, y0 + 10
    t.rect(lx, y0, lx, ly - 1, STEEL)
    t.rect(lx - 3, ly, lx + 3, ly + 7, RED)
    t.rect(lx - 2, ly - 1, lx + 2, ly + 8, RED)
    t.rect(lx - 3, ly + 1, lx - 3, ly + 6, RED_L)
    t.rect(lx - 2, ly - 1, lx + 2, ly - 1, ORANGE_L)
    t.rect(lx - 2, ly + 8, lx + 2, ly + 8, ORANGE_L)
    t.rect(lx, ly + 9, lx, ly + 12, ORANGE_L)
    # бамбук «на удачу» в стеклянной вазе на тумбе слева от головы
    vx = x0 + 47
    t.rect(vx - 6, floor - 12, vx + 8, floor, WHITE)
    t.rect(vx - 6, floor - 12, vx + 8, floor - 12, PALE)
    t.rect(vx - 2, floor - 18, vx + 2, floor - 13, 4)
    for k, (dx, top) in enumerate(((-1, 34), (1, 40), (0, 28))):
        t.rect(vx + dx, floor - top, vx + dx, floor - 18, GREEN if k % 2 else GREEN_L)
        for yy in range(floor - top + 4, floor - 18, 6):
            t.px(vx + dx, yy, 8)
        t.px(vx + dx - 1, floor - top + 1, GREEN_L)
        t.px(vx + dx + 1, floor - top + 2, GREEN)
    # коробки стопкой у правого стенда на полу
    product_box(t, bx0 + 2, floor - 12, 16, 12)
    product_box(t, bx0 + 19, floor - 9, 14, 9, top=RED)
    product_box(t, bx0 + 5, floor - 20, 11, 8, top=BLUE_L)
    # лёгкая виньетка камеры телефона
    xs, ys = t.grid()
    d = ((xs - (x0 + w / 2)) / (w / 2)) ** 2 + ((ys - (y0 + h / 2)) / (h / 2)) ** 2
    edge = (d > 1.15) & (xs >= x0) & (xs <= x1 + 1) & (ys >= y0) & (ys <= y1 + 1)
    edge &= ((np.floor(xs) + np.floor(ys)) % 2 == 0)
    t.shade(0, 0, t.w - 1, t.h - 1, 1, edge)


# ------------------------------------------------------------------------------------------- окно звонка

def top_bar(t, x0, y0, w, h=10):
    t.rect(x0, y0, x0 + w - 1, y0 + h - 1, BAR)
    t.rect(x0, y0 + h - 1, x0 + w - 1, y0 + h - 1, DARK)
    # в середине — «защищённое соединение» и название: замочек и надпись
    s = 'ВИДЕОЗВОНОК'
    tw = text_w(s)
    cx = x0 + (w - tw) // 2
    ty = y0 + (h - 6) // 2
    text(t, cx + 4, ty, s, MIST)
    t.rect(cx - 3, ty + 2, cx + 1, ty + 4, MIST)
    t.rect(cx - 2, ty, cx, ty + 1, MIST)
    t.px(cx - 1, ty + 1, BAR)


def icon_mic(t, x, y, c):
    t.rect(x + 1, y, x + 3, y + 4, c)
    t.px(x, y + 3, c)
    t.px(x + 4, y + 3, c)
    t.rect(x + 1, y + 5, x + 3, y + 5, c)
    t.px(x + 2, y + 6, c)


def icon_cam(t, x, y, c):
    t.rect(x, y + 1, x + 5, y + 5, c)
    t.px(x + 6, y + 2, c)
    t.rect(x + 6, y + 3, x + 7, y + 3, c)
    t.px(x + 6, y + 4, c)
    t.rect(x + 7, y + 1, x + 7, y + 5, c)


def icon_screen(t, x, y, c):
    t.rect(x, y, x + 7, y + 4, c)
    t.rect(x + 1, y + 1, x + 6, y + 3, BAR2)
    t.rect(x + 3, y + 5, x + 4, y + 5, c)
    t.rect(x + 2, y + 6, x + 5, y + 6, c)


def icon_chat(t, x, y, c):
    t.rect(x, y, x + 7, y + 4, c)
    t.px(x + 1, y + 5, c)
    t.px(x + 1, y + 6, c)
    for k in range(3):
        t.px(x + 2 + k * 2, y + 2, BAR2)


def hangup(t, cx, y):
    t.rect(cx - 7, y, cx + 7, y + 7, RED)
    t.rect(cx - 6, y, cx + 6, y, RED_L)
    for px_ in (cx - 7, cx + 7):
        t.px(px_, y, BAR)
        t.px(px_, y + 7, BAR)
    # трубка
    t.rect(cx - 4, y + 3, cx + 4, y + 3, WHITE)
    t.rect(cx - 4, y + 4, cx - 3, y + 4, WHITE)
    t.rect(cx + 3, y + 4, cx + 4, y + 4, WHITE)


def controls(t, x0, y0, w, h=14):
    t.rect(x0, y0, x0 + w - 1, y0 + h - 1, BAR)
    t.rect(x0, y0, x0 + w - 1, y0, DARK)
    cx = x0 + w // 2
    y = y0 + 3
    for k, fn in ((-3, icon_mic), (-2, icon_cam), (2, icon_screen), (3, icon_chat)):
        x = cx + k * 15 - 4 + (0 if k < 0 else 0)
        t.rect(x - 2, y - 1, x + 9, y + 8, BAR2)
        fn(t, x, y, PALE)
    hangup(t, cx, y)


def name_plate(t, x, y, s='ЛИ ВЭЙ', place='ШЭНЬЧЖЭНЬ'):
    w = text_w(s) + text_w(place) + 14
    t.rect(x, y, x + w, y + 8, DARK)
    t.rect(x, y, x + w, y, BAR2)
    icon_mic(t, x + 2, y + 1, GREEN_L)
    text(t, x + 8, y + 2, s, WHITE)
    dx = x + 8 + text_w(s) + 2
    t.px(dx, y + 4, MIST)
    text(t, dx + 2, y + 2, place, MIST)
    return w


def you_tile(t, x, y, w=40, h=30):
    """Окошко «Вы»: камера над экраном переговорной — белая стена, окно, дубовый стол, вы и коллеги за ним."""
    v = Tex(w, h, PALE)
    v.rect(0, 0, w - 1, 3, WHITE)
    # окно справа: небо и золото берёз
    v.rect(w - 12, 2, w - 1, 17, 5)
    v.rect(w - 12, 11, w - 1, 17, 4)
    v.ellipse(w - 6, 9, 4, 3, ORANGE_L)
    v.rect(w - 13, 2, w - 13, 17, BAR2)
    # коллеги по бокам: слева светлые волосы и сиреневый, справа рыжий в фиолетовом
    for cx, hair, body in ((7, 23, 33), (w - 9, 22, 32)):
        v.ellipse(cx + 0.5, h - 6, 5, 4, body)
        v.ellipse(cx + 0.5, h - 12, 2.6, 3, BOX_L)
        v.ellipse(cx + 0.5, h - 14, 2.8, 1.6, hair)
    # вы — в центре, ближе к камере
    cx = w // 2
    v.ellipse(cx + 0.5, h + 3, 12, 10, 7)
    v.ellipse(cx + 0.5, h + 4, 11, 9, 8)
    v.rect(cx - 1, h - 9, cx + 1, h - 7, BOX)
    v.ellipse(cx + 0.5, h - 13, 5, 6, BOX_L)
    v.rect(cx + 3, h - 15, cx + 4, h - 10, BOX)
    v.ellipse(cx + 0.5, h - 17, 5.5, 3.2, BOX_D)
    v.rect(cx - 5, h - 17, cx - 4, h - 13, BOX_D)
    v.px(cx - 2, h - 13, DARK)
    v.px(cx + 2, h - 13, DARK)
    v.rect(cx - 1, h - 10, cx + 1, h - 10, BOX_D)
    # край дубового стола
    v.rect(0, h - 3, w - 1, h - 1, BOX_H)
    v.rect(0, h - 3, w - 1, h - 3, TAPE)
    # подпись
    v.rect(0, h - 7, 11, h - 1, DARK)
    text(v, 2, h - 6, 'ВЫ', WHITE)
    t.rect(x - 1, y - 1, x + w, y + h, DARK)
    t.rect(x - 1, y - 1, x + w, y - 1, SLATE)
    t.blit(v, x, y)


# ----------------------------------------------------------------------------------------------- экран 3D

def screen():
    bg = Tex(SCREEN_W, SCREEN_H, BAR)
    top_bar(bg, 0, 0, SCREEN_W)
    warehouse(bg, 0, VIDEO_Y, SCREEN_W, VIDEO_H)
    controls(bg, 0, VIDEO_Y + VIDEO_H, SCREEN_W, SCREEN_H - VIDEO_Y - VIDEO_H)
    ui = Tex(SCREEN_W, SCREEN_H)
    name_plate(ui, 3, VIDEO_Y + VIDEO_H - 11)
    you_tile(ui, SCREEN_W - 44, VIDEO_Y + VIDEO_H - 34)
    return bg, ui


def end_screen():
    """Собеседник отключился: видео гаснет, по центру — «звонок завершён»."""
    t = Tex(SCREEN_W, SCREEN_H)
    t.rect(0, VIDEO_Y, SCREEN_W - 1, VIDEO_Y + VIDEO_H - 1, BAR2)
    s = 'ЗВОНОК ЗАВЕРШЁН'
    cy = VIDEO_Y + VIDEO_H // 2
    hangup(t, SCREEN_W // 2, cy - 14)
    text(t, (SCREEN_W - text_w(s)) // 2, cy + 2, s, WHITE)
    s2 = 'ЛИ ВЭЙ ОТКЛЮЧИЛСЯ'
    text(t, (SCREEN_W - text_w(s2)) // 2, cy + 10, s2, MIST)
    return t


# ----------------------------------------------------------------------------------------------- сцена 2D

W2, H2 = 192, 108
SX0, SX1, SY1 = 24, 167, 91  # экран ноутбука внутри рамки (y от верха кадра)


def slat_wall(t, x0, x1):
    """Стена переговорной по краям кадра: дубовые рейки с тёмными щелями, подсветка сверху."""
    t.rect(x0, 0, x1, H2 - 1, BOX_L)
    for xx in range(x0, x1 + 1, 3):
        t.rect(xx, 0, xx, H2 - 1, BOX_H)
        t.rect(xx + 2, 0, xx + 2, H2 - 1, BOX_D)
    t.checker(x0, 0, x1, 3, TAPE)


def scene2d():
    bg = Tex(W2, H2, BAR)
    # видео за портретом: шоурум, верхняя полоса окна
    top_bar(bg, SX0, 0, SX1 - SX0 + 1, 7)
    warehouse(bg, SX0, 7, SX1 - SX0 + 1, SY1 - 7 - 9)

    fg = Tex(W2, H2)
    # стена из реек слева и справа от экрана
    slat_wall(fg, 0, SX0 - 4)
    slat_wall(fg, SX1 + 4, W2 - 1)
    # слева табличка «Кама», справа фикус у окна
    fg.rect(2, 30, 15, 39, WHITE)
    fg.rect(2, 30, 3, 39, BLUE)
    fg.rect(5, 33, 13, 33, BAR2)
    fg.rect(5, 36, 10, 36, MIST)
    for (ex, ey, rx, ry) in ((178, 40, 6, 8), (186, 34, 5, 7), (182, 52, 7, 8), (188, 60, 4, 7), (176, 62, 5, 6)):
        fg.ellipse(ex, ey, rx, ry, 8)
        fg.ellipse(ex - 1, ey - 2, rx * 0.6, ry * 0.5, 9)
    fg.rect(181, 62, 182, 84, 13)
    # рамка большого экрана: тонкая чёрная, сверху видеобар
    fg.rect(SX0 - 3, 0, SX0 - 1, SY1 + 3, INK)
    fg.rect(SX1 + 1, 0, SX1 + 3, SY1 + 3, INK)
    fg.rect(SX0 - 3, SY1 + 1, SX1 + 3, SY1 + 3, INK)
    fg.rect(SX0 - 3, 0, SX0 - 3, SY1 + 3, BAR)
    fg.rect(SX1 + 3, 0, SX1 + 3, SY1 + 3, BAR)
    # панель кнопок звонка — поверх портрета
    controls(fg, SX0, SY1 - 9, SX1 - SX0 + 1, 10)
    name_plate(fg, SX0 + 2, SY1 - 20)
    you_tile(fg, SX1 - 41, SY1 - 40, 38, 28)
    # под экраном — белая тумба, перед ней край длинного дубового стола
    fg.rect(SX0 + 10, SY1 + 4, SX1 - 10, 99, WHITE)
    fg.rect(SX0 + 10, SY1 + 4, SX1 - 10, SY1 + 4, BOX_H)
    for xx in range(SX0 + 40, SX1 - 10, 36):
        fg.rect(xx, SY1 + 5, xx, 99, PALE)
    fg.rect(0, 99, W2 - 1, H2 - 1, BOX_H)
    fg.rect(0, 99, W2 - 1, 99, TAPE)
    for yy in (102, 105):
        fg.rect(0, yy, W2 - 1, yy, BOX_L)
    # на столе: бутылка воды и стакан справа, блокнот слева
    fg.rect(170, 86, 173, 100, 5)
    fg.rect(171, 84, 172, 85, BLUE)
    fg.rect(170, 91, 173, 93, BLUE_L)
    fg.rect(176, 94, 179, 100, 5)
    fg.rect(176, 94, 179, 94, WHITE)
    fg.poly([(10, 101), (30, 100), (32, 106), (8, 107)], WHITE)
    fg.line([(13, 103), (25, 102)], BLUE)
    return bg, fg


def main():
    world = os.path.join(ROOT, 'public', 'assets', 'world')
    scenes = os.path.join(ROOT, 'public', 'assets', 'scenes')
    prev = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(prev, exist_ok=True)
    portrait = Image.open(os.path.join(ROOT, 'public', 'assets', 'portraits', 'china.png')).convert('RGBA').crop((0, 0, 96, 96))

    bg, ui = screen()
    end_screen().image().save(os.path.join(world, 'call_end.png'))
    bgi, uii = bg.image(), ui.image()
    bgi.save(os.path.join(world, 'call_bg.png'))
    uii.save(os.path.join(world, 'call_ui.png'))
    comp = bgi.copy()
    comp.alpha_composite(portrait, (48, VIDEO_Y))
    comp.alpha_composite(uii)
    comp.resize((SCREEN_W * 4, SCREEN_H * 4), Image.NEAREST).save(os.path.join(prev, 'call_screen_x4.png'))

    bg2, fg2 = scene2d()
    b2, f2 = bg2.image(), fg2.image()
    b2.save(os.path.join(scenes, 'meet.png'))
    f2.save(os.path.join(scenes, 'meet-desk.png'))
    comp = b2.copy()
    comp.alpha_composite(portrait, (48, 4))
    comp.alpha_composite(f2)
    comp.resize((W2 * 4, H2 * 4), Image.NEAREST).save(os.path.join(prev, 'meet_x4.png'))
    print('ok call_screen, meet')


if __name__ == '__main__':
    main()
