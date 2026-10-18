"""Видеозвонок с Ли Вэем: экран ноутбука и 2D-сцена «кофейня, ноутбук, звонок».

Экран (для 3D, src/game/world3d/call.ts) — 192×120, как 16:10:
  call_bg.png  — верхняя полоса окна, видео со склада в Иу, нижняя панель кнопок;
  call_ui.png  — то, что лежит поверх собеседника: плашка с именем, окошко «Вы».
Портрет (96×96) встаёт между ними в x=48, y=10. Таймер и полоски связи рисует сам браузер.

2D-сцена для классического вида встречи (scenes/cafe.png и cafe-desk.png, 192×108): то же окно звонка
на экране ноутбука, по краям — стол и кофейня. Портрет — как во всех сценах, x=48, y=4.

Запуск: ~/.venvs/saferoute/bin/python tools/art/call_screen.py
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


def warehouse(t, x0, y0, w, h):
    """Склад-шоурум в Иу: бетонная стена, лампы, стеллажи с коробками, стол с образцами."""
    x1, y1 = x0 + w - 1, y0 + h - 1
    # стена и пол
    t.rect(x0, y0, x1, y1, SLATE)
    t.rect(x0, y0, x1, y0 + h // 3, STEEL)
    t.checker(x0, y0 + h // 3, x1, y0 + h // 3 + 1, SLATE)
    floor = y0 + int(h * 0.78)
    t.rect(x0, floor, x1, y1, STEEL)
    t.rect(x0, floor, x1, floor, MIST)
    t.checker(x0, floor + 1, x1, y1, SLATE, 1)
    # лампы под потолком
    for lx in range(x0 + 10, x1 - 6, 44):
        t.rect(lx, y0 + 1, lx + 16, y0 + 2, WHITE)
        t.rect(lx, y0 + 3, lx + 16, y0 + 3, PALE)
        t.checker(lx - 2, y0 + 4, lx + 18, y0 + 6, PALE)
    # стеллажи: синие стойки, оранжевые балки, на полках коробки
    def rack(rx, rw, top):
        levels = [top, top + 18, top + 36]
        for lv in levels:
            x = rx + 2
            while x < rx + rw - 6:
                bw = int(rng.integers(7, 13))
                bh = int(rng.integers(8, 14))
                if x + bw > rx + rw - 2:
                    break
                carton(t, x, lv + 16 - bh, bw, bh, label=rng.random() < 0.7)
                if rng.random() < 0.35 and bh < 11:
                    carton(t, x + 1, lv + 16 - bh - 6, bw - 2, 6, tape=False, label=False)
                x += bw + 1
            t.rect(rx, lv + 16, rx + rw - 1, lv + 17, ORANGE)
            t.rect(rx, lv + 16, rx + rw - 1, lv + 16, ORANGE_L)
        for sx in (rx, rx + rw - 2):
            t.rect(sx, top - 4, sx + 1, floor, BLUE)
            t.rect(sx, top - 4, sx, floor, BLUE_L)
        # метка полки
    rack(x0 - 4, 62, y0 + 8)
    rack(x1 - 58, 62, y0 + 8)
    text(t, x0 + 8, y0 + 8, 'А-12', WHITE)
    text(t, x1 - 50, y0 + 8, 'В-07', WHITE)
    # середина за спиной: рольставня и стопка коробок
    mx = x0 + w // 2
    t.rect(mx - 28, y0 + 14, mx + 28, floor, MIST)
    for yy in range(y0 + 15, floor, 3):
        t.rect(mx - 28, yy, mx + 28, yy, STEEL)
    t.rect(mx - 30, y0 + 12, mx + 30, y0 + 13, SLATE)
    # стол с образцами справа внизу: столешница, датчики на подставке, кабель
    tx = x1 - 52
    ty = floor - 6
    t.rect(tx, ty, tx + 46, ty + 2, BAR2)
    t.rect(tx, ty, tx + 46, ty, SLATE)
    t.rect(tx + 2, ty + 3, tx + 3, y1, BAR)
    t.rect(tx + 43, ty + 3, tx + 44, y1, BAR)
    for k in range(5):
        sx = tx + 6 + k * 5
        t.rect(sx, ty - 7, sx + 2, ty - 1, PALE)
        t.rect(sx, ty - 7, sx + 2, ty - 7, WHITE)
        t.rect(sx + 1, ty - 9, sx + 1, ty - 8, ORANGE_L)
    t.rect(tx + 34, ty - 5, tx + 41, ty - 1, BOX)
    t.rect(tx + 34, ty - 5, tx + 41, ty - 5, BOX_L)
    # коробки на полу слева, ближе к камере — крупнее
    carton(t, x0 + 2, floor - 14, 18, 18)
    carton(t, x0 + 21, floor - 8, 14, 12)
    carton(t, x0 + 4, floor - 24, 13, 10)
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


def name_plate(t, x, y, s='ЛИ ВЭЙ', place='ИУ'):
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
    """Окошко «Вы»: тёплая кофейня за спиной, свет из окна, вы в зелёном свитере."""
    v = Tex(w, h, BOX_H)
    v.rect(0, 0, w - 1, 6, TAPE)
    # окно с утренним светом и подвесная лампа
    v.rect(2, 3, 12, 16, 5)
    v.rect(7, 3, 7, 16, 4)
    v.rect(2, 9, 12, 9, 4)
    v.rect(w - 9, 0, w - 9, 4, BAR2)
    v.rect(w - 11, 5, w - 7, 6, ORANGE_L)
    # полка с чашками
    v.rect(w - 14, 13, w - 3, 13, BOX_D)
    for k in range(3):
        v.rect(w - 13 + k * 4, 11, w - 12 + k * 4, 12, WHITE)
    # человек: плечи, шея, голова, волосы
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


def cafe_side(t, x0, x1):
    """Кофейня по краям кадра: тёплая стена, окно, растение, столешница."""
    t.rect(x0, 0, x1, H2 - 1, BOX_H)
    t.rect(x0, 0, x1, 30, TAPE)
    t.checker(x0, 31, x1, 32, BOX_H)
    # кирпич
    for yy in range(36, 84, 4):
        t.rect(x0, yy, x1, yy, BOX_L)
        off = 0 if (yy // 4) % 2 else 3
        for xx in range(x0 + off, x1 + 1, 7):
            t.px(xx, yy + 1, BOX_L)
            t.px(xx, yy + 2, BOX_L)


def scene2d():
    bg = Tex(W2, H2, BAR)
    # видео за портретом: склад, верхняя полоса окна
    top_bar(bg, SX0, 0, SX1 - SX0 + 1, 7)
    warehouse(bg, SX0, 7, SX1 - SX0 + 1, SY1 - 7 - 9)

    fg = Tex(W2, H2)
    # кофейня слева и справа
    cafe_side(fg, 0, SX0 - 5)
    cafe_side(fg, SX1 + 5, W2 - 1)
    # слева окно с осенней Елабугой
    fg.rect(2, 6, 15, 40, 5)
    fg.rect(2, 26, 15, 40, 4)
    fg.ellipse(6, 30, 4, 5, ORANGE_L)
    fg.ellipse(12, 33, 3, 4, 23)
    fg.rect(2, 36, 15, 40, BOX)
    fg.rect(8, 6, 8, 40, TAPE)
    fg.rect(1, 41, 16, 42, BOX_D)
    # справа лампа и полка с чашками
    fg.rect(184, 0, 184, 12, BAR2)
    fg.ellipse(184.5, 15, 4, 3, ORANGE_L)
    fg.checker(178, 18, 190, 22, 23)
    fg.rect(173, 40, 191, 41, BOX_D)
    for k in range(3):
        fg.rect(175 + k * 6, 36, 178 + k * 6, 39, WHITE)
    # растение слева на столе
    fg.rect(4, 72, 13, 84, BOX_D)
    fg.rect(4, 72, 13, 72, BOX)
    for (ex, ey, rx, ry) in ((6, 64, 4, 6), (11, 62, 4, 7), (8, 57, 3, 5)):
        fg.ellipse(ex, ey, rx, ry, 8)
    fg.checker(4, 56, 14, 70, 9)
    # стол
    fg.rect(0, 84, W2 - 1, H2 - 1, BOX)
    fg.rect(0, 84, W2 - 1, 84, BOX_L)
    for yy in (89, 95, 102):
        fg.rect(0, yy, W2 - 1, yy, BOX_D)
    # чашка справа
    fg.ellipse(181, 87, 8, 3, PALE)
    fg.rect(176, 78, 186, 86, WHITE)
    fg.rect(176, 78, 186, 78, PALE)
    fg.rect(177, 79, 185, 79, BOX_D)
    fg.rect(187, 80, 189, 80, WHITE)
    fg.rect(189, 81, 189, 83, WHITE)
    fg.rect(187, 84, 188, 84, WHITE)
    fg.checker(179, 72, 183, 76, PALE)
    # рамка ноутбука
    fg.rect(SX0 - 4, 0, SX0 - 1, SY1 + 4, INK)
    fg.rect(SX1 + 1, 0, SX1 + 4, SY1 + 4, INK)
    fg.rect(SX0 - 4, SY1 + 1, SX1 + 4, SY1 + 4, INK)
    fg.rect(SX0 - 4, 0, SX0 - 4, SY1 + 4, BAR)
    fg.rect(SX1 + 4, 0, SX1 + 4, SY1 + 4, BAR)
    # панель кнопок звонка — поверх портрета
    controls(fg, SX0, SY1 - 9, SX1 - SX0 + 1, 10)
    name_plate(fg, SX0 + 2, SY1 - 20)
    you_tile(fg, SX1 - 41, SY1 - 40, 38, 28)
    # корпус: шарнир и клавиатура, светлый алюминий
    fg.poly([(SX0 - 6, SY1 + 5), (SX1 + 6, SY1 + 5), (SX1 + 14, H2), (SX0 - 14, H2)], PALE)
    fg.rect(SX0 - 6, SY1 + 5, SX1 + 6, SY1 + 5, MIST)
    for row in range(3):
        y = SY1 + 8 + row * 4
        inset = 2 - row * 2
        for x in range(SX0 - 4 + inset, SX1 + 4 - inset, 5):
            fg.rect(x, y, x + 3, y + 2, MIST)
            fg.rect(x, y + 2, x + 3, y + 2, STEEL)
    # камера над экраном
    fg.rect(95, 0, 96, 0, BAR2)
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
    b2.save(os.path.join(scenes, 'cafe.png'))
    f2.save(os.path.join(scenes, 'cafe-desk.png'))
    comp = b2.copy()
    comp.alpha_composite(portrait, (48, 4))
    comp.alpha_composite(f2)
    comp.resize((W2 * 4, H2 * 4), Image.NEAREST).save(os.path.join(prev, 'cafe_x4.png'))
    print('ok call_screen, cafe')


if __name__ == '__main__':
    main()
