"""Люди и салон для катсцен: новенький сбоку (ходьба, с чемоданом, с коробкой, сидя в автобусе), салон автобуса
в разрезе, телефон в руках крупно и Тимур с кружкой.

Новенький тот же, что на карте (newbie.py): каштановые волосы, синяя ветровка, горчичный рюкзак, джинсы, белые
кроссовки, контур 37. Ноги и руки собраны «скелетом»: бедро, колено по двухзвенной IK, стопа; опорная стопа едет назад
ровно с шагом, поэтому при движении тела на CYCLE/8 точек за кадр ноги не скользят.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/cutscene_people.py
Пишет public/assets/cutscene/{newbie_walk,newbie_case,newbie_box,newbie_sit,bus_in,bus_fg,phone,timur}.png,
src/game/cutscene/people.gen.ts и превью tools/art/out/cs_*.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from room3d import T, Tex, darker, lighter  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'cutscene')
PREV = os.path.join(os.path.dirname(__file__), 'out')
GEN = os.path.join(ROOT, 'src', 'game', 'cutscene', 'people.gen.ts')
rng = np.random.default_rng(2909)

OUTLINE = 37
SKIN, SKIN_S, SKIN_D = 16, 15, 14
HAIR, HAIR_L = 19, 20
JACK, JACK_S, JACK_L = 3, 2, 4
PACK, PACK_S, PACK_L = 22, 21, 23
CASE, CASE_S, CASE_L = 27, 26, 28
BOX, BOX_S, BOX_T = 16, 15, 17

# ---------------------------------------------------------------------------------------------------
# геометрия ходьбы: кадр 32×48, пятки на y=46, бедро над якорем
# ---------------------------------------------------------------------------------------------------
FW, FH = 32, 48
GROUND = 46          # нижний ряд подошвы
HIP_Y = 29
L_THIGH, L_SHIN = 8, 8
STEP = 16            # расстояние между стопами в момент касания
CYCLE = 2 * STEP     # за 8 кадров тело проходит два шага
BOB = [0, 1, 0, -1, 0, 1, 0, -1]
# положение стопы относительно бедра по фазе (восьмые доли цикла) и подъём над землёй
FOOT = [(8, 0), (4, 0), (0, 0), (-4, 0), (-8, 0), (-4, 3), (1, 4), (6, 2)]


def grow(m):
    """Маска плюс её 4-соседи — без переноса через край кадра (np.roll заворачивает)."""
    e = m.copy()
    e[1:, :] |= m[:-1, :]
    e[:-1, :] |= m[1:, :]
    e[:, 1:] |= m[:, :-1]
    e[:, :-1] |= m[:, 1:]
    return e


def outline(t, c=OUTLINE):
    m = t.a != T
    t.a[grow(m) & ~m] = c


def brush(t, x, y, w, c):
    """Квадратная кисть w×w с центром в (x, y)."""
    x0 = int(round(x - (w - 1) / 2))
    y0 = int(round(y - (w - 1) / 2))
    t.rect(x0, y0, x0 + w - 1, y0 + w - 1, c)


def stroke(t, p0, p1, w, c):
    (x0, y0), (x1, y1) = p0, p1
    n = int(max(abs(x1 - x0), abs(y1 - y0), 1)) * 2
    for i in range(n + 1):
        brush(t, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, w, c)


def ik(hip, ankle, l1, l2, forward=1):
    """Колено по двум длинам; сгиб вперёд (forward=1 — вправо)."""
    hx, hy = hip
    ax, ay = ankle
    dx, dy = ax - hx, ay - hy
    d = math.hypot(dx, dy)
    d = min(d, l1 + l2 - 1e-3)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    ux, uy = dx / max(d, 1e-6), dy / max(d, 1e-6)
    mx, my = hx + ux * a, hy + uy * a
    # перпендикуляр, смотрящий вперёд
    px, py = -uy, ux
    if px * forward < 0:
        px, py = -px, -py
    return (mx + px * h, my + py * h)


def shoe(t, ax, ay, near, toe_down=False):
    """Кроссовок: пятка чуть позади лодыжки, носок вперёд. ay — лодыжка."""
    top, base, sole = (45, 44, 41) if near else (43, 42, 40)
    x0 = int(round(ax)) - 2
    y0 = int(round(ay)) + 1
    if toe_down:
        t.rect(x0, y0 - 1, x0 + 3, y0, top)
        t.rect(x0 + 2, y0 + 1, x0 + 5, y0 + 1, base)
        t.rect(x0 + 3, y0 + 2, x0 + 5, y0 + 2, sole)
        t.px(x0 + 1, y0 - 1, 3 if near else 2)
    else:
        t.rect(x0, y0, x0 + 5, y0 + 1, top)
        t.rect(x0 + 3, y0, x0 + 5, y0, base)
        t.rect(x0, y0 + 2, x0 + 5, y0 + 2, sole)
        t.px(x0 + 1, y0, 3 if near else 2)   # синяя полоска на кроссовке


def leg(t, hip, ankle, near, lift):
    knee = ik(hip, ankle, L_THIGH, L_SHIN, 1)
    base, shade, hi = (1, 0, 2) if near else (0, 0, 1)
    stroke(t, hip, knee, 4, base)
    stroke(t, knee, ankle, 3, base)
    # складка по переднему краю — светлее у ближней ноги
    if near:
        stroke(t, (hip[0] + 1.5, hip[1]), (knee[0] + 1, knee[1]), 1, hi)
        stroke(t, (knee[0] + 1, knee[1] + 1), (ankle[0] + 1, ankle[1] - 1), 1, hi)
    shoe(t, ankle[0], ankle[1], near, toe_down=lift > 0)
    return knee


def arm(t, shoulder, phi, bend, near, l1=7, l2=6, cuff=True):
    """Рука от плеча: phi — угол плеча от вертикали (+ вперёд), bend — сгиб локтя вперёд. Возвращает кисть."""
    sx, sy = shoulder
    ex, ey = sx + l1 * math.sin(phi), sy + l1 * math.cos(phi)
    hx, hy = ex + l2 * math.sin(phi + bend), ey + l2 * math.cos(phi + bend)
    base = JACK if near else JACK_S
    stroke(t, (sx, sy), (ex, ey), 4 if near else 3, base)
    stroke(t, (ex, ey), (hx, hy), 3, base)
    if near:
        stroke(t, (sx - 1.5, sy + 1), (ex - 1.5, ey), 1, JACK_S)
        stroke(t, (ex - 1, ey + 0.5), (hx - 1, hy - 1), 1, JACK_S)
        stroke(t, (sx + 1.5, sy + 1), (ex + 1, ey - 0.5), 1, JACK_L)
    # манжета и кисть
    cx, cy = ex + (l2 - 1.5) * math.sin(phi + bend), ey + (l2 - 1.5) * math.cos(phi + bend)
    if cuff:
        brush(t, cx, cy, 2, 44 if near else 43)
    brush(t, hx, hy + 0.5, 2, SKIN if near else SKIN_S)
    return (hx, hy)


HEAD = [
    '....hhhhh...',
    '..hhhHHHHh..',
    '.hhhhhhhHHh.',
    'hhhhhhhhhhh.',
    'hhhhhhhhsss.',
    'hhhoOhhssss.',
    'hhhoOhssses.',
    'hhhhhssssssn',
    '.hhhssssssS.',
    '.hhhssssmm..',
    '..hhsssssS..',
    '....SSSSS...',
]
HEAD_DOWN = [  # взгляд в телефон: голова наклонена, глаз ниже и прикрыт
    '....hhhhh...',
    '..hhhHHHHh..',
    '.hhhhhhhHHh.',
    'hhhhhhhhhhhh',
    'hhhhhhhhhhhh',
    'hhhoOhhhsss.',
    'hhhoOhsssss.',
    'hhhhhsssssS.',
    '.hhhsssssEsn',
    '.hhhssssss..',
    '..hhssssmS..',
    '....SSSSS...',
]
HEAD_UP = [  # смотрит вверх-вперёд, в окно
    '....hhhhh...',
    '..hhhHHHHh..',
    '.hhhhhhhHHh.',
    'hhhhhhhhhhs.',
    'hhhhhhhssse.',
    'hhhoOhsssssn',
    'hhhoOhsssssn',
    'hhhhhssssss.',
    '.hhhssssmm..',
    '.hhhsssssS..',
    '..hhSSSSS...',
    '............',
]
HEAD_SLEEP = [  # дремлет: голова на грудь, глаз закрыт
    '............',
    '....hhhhh...',
    '..hhhHHHHh..',
    '.hhhhhhhHHh.',
    'hhhhhhhhhhhh',
    'hhhhhhhhhhhh',
    'hhhoOhhhsss.',
    'hhhoOhssssS.',
    '.hhhhssssssn',
    '.hhhsssccss.',
    '..hhhssssS..',
    '....SSSSS...',
]
HEAD_LEG = {'h': HAIR, 'H': HAIR_L, 's': SKIN, 'S': SKIN_S, 'o': SKIN, 'O': SKIN_S, 'e': 37, 'E': 13, 'n': SKIN,
            'm': SKIN_D, 'c': SKIN_S}


def head(t, x, y, rows=HEAD, flip=False):
    if flip:
        rows = [r[::-1] for r in rows]
    t.sprite(x, y, rows, HEAD_LEG)


def torso(t, hx, top, lean=1):
    """Ветровка сбоку: спина слева, грудь справа; top — линия плеч."""
    bot = HIP_Y + 1 + (top - 15)
    t.poly([(hx - 5, top), (hx + 3 + lean, top - 1), (hx + 5 + lean, top + 3), (hx + 5, bot), (hx - 4, bot)], JACK)
    t.poly([(hx - 5, top), (hx - 3, top), (hx - 2, bot), (hx - 4, bot)], JACK_S)       # спина в тени
    t.rect(hx - 4, bot - 1, hx + 5, bot, JACK_S)                                        # резинка низа
    t.rect(hx - 3, top - 2, hx + 3, top, JACK_L)                                        # капюшон-воротник
    t.rect(hx - 2, top - 1, hx + 2, top - 1, JACK)
    t.rect(hx + 5, top + 4, hx + 5, bot - 2, 45)                                        # молния по переднему краю
    t.rect(hx, top + 8, hx + 3, top + 8, JACK_S)                                        # клапан кармана


def backpack(t, hx, top):
    x1 = hx - 5
    t.rect(x1 - 5, top + 1, x1, top + 14, PACK)
    t.rect(x1 - 5, top + 1, x1, top + 1, PACK_L)
    t.rect(x1 - 5, top + 2, x1 - 5, top + 14, PACK_S)
    t.rect(x1 - 4, top + 8, x1 - 1, top + 12, PACK_S)                                  # карман
    t.rect(x1 - 4, top + 8, x1 - 1, top + 8, PACK)
    t.px(x1 - 3, top + 10, 41)
    t.px(x1 - 5, top + 1, T)
    t.px(x1 - 5, top + 14, T)


def strap(t, hx, top):
    stroke(t, (hx - 4, top), (hx + 1, top + 1), 1, PACK_S)
    stroke(t, (hx + 1, top + 1), (hx + 1, top + 10), 1, PACK_S)
    t.px(hx + 1, top + 6, 40)


def neck(t, hx, top):
    t.rect(hx + 1, top - 3, hx + 3, top - 1, SKIN_S)


def walker(i, hx, ground_shift=0, near_arm=None, far_arm=None, extra_back=None, extra_front=None, frame_w=FW,
           head_rows=HEAD, stand=False):
    """Кадр ходьбы i (0..7) или стойка. near_arm/far_arm(t, shoulder, bob) рисуют руку сами, если заданы."""
    t = Tex(frame_w, FH)
    bob = 0 if stand else BOB[i]
    hip = (hx, HIP_Y + bob)
    top = 15 + bob
    if stand:
        fa, fb = (-2, 0), (2, 0)
        pa = pb = 0.0
    else:
        fa = FOOT[i % 8]
        fb = FOOT[(i + 4) % 8]
        pa, pb = i / 8, (i + 4) / 8
    # a — ближняя нога, b — дальняя
    if extra_back:
        extra_back(t, hip, top, bob)
    # дальняя рука: в противофазе дальней ноге = в фазе с ближней ногой
    if far_arm:
        far_arm(t, (hx, top + 1), bob)
    else:
        arm(t, (hx, top + 1), 0.45 * math.cos(2 * math.pi * pa) if not stand else 0.05, 0.35, False)
    leg(t, hip, (hx + fb[0], GROUND - 3 - fb[1]), False, fb[1])
    backpack(t, hx, top)
    leg(t, hip, (hx + fa[0], GROUND - 3 - fa[1]), True, fa[1])
    neck(t, hx, top)
    torso(t, hx, top)
    strap(t, hx, top)
    if near_arm:
        near_arm(t, (hx + 1, top + 1), bob)
    else:
        arm(t, (hx + 1, top + 1), -0.5 * math.cos(2 * math.pi * pa) if not stand else -0.05,
            0.3 + 0.35 * max(0.0, -math.cos(2 * math.pi * pa)) if not stand else 0.15, True)
    head(t, hx - 4, top - 12, head_rows)
    if extra_front:
        extra_front(t, hip, top, bob)
    outline(t)
    return t


# ---------------------------------------------------------------------------------------------------
# варианты: телефон у уха, телефон в руках, чемодан, коробка
# ---------------------------------------------------------------------------------------------------

def phone_ear(t, sh, bob):
    sx, sy = sh
    e = (sx + 4, sy + 6)
    h = (sx + 2, sy - 6)
    stroke(t, sh, e, 4, JACK)
    stroke(t, e, h, 3, JACK)
    brush(t, e[0] - 0.5, e[1] - 4, 2, 44)
    t.rect(int(h[0]) - 1, int(h[1]) - 3, int(h[0]) + 1, int(h[1]) + 1, 38)      # телефон
    t.px(int(h[0]) - 1, int(h[1]) - 3, 40)
    t.rect(int(h[0]) + 1, int(h[1]) - 1, int(h[0]) + 2, int(h[1]) + 1, SKIN)    # пальцы


def phone_hold(t, sh, bob):
    sx, sy = sh
    e = (sx + 1, sy + 8)
    h = (sx + 6, sy + 5)
    stroke(t, sh, e, 4, JACK)
    stroke(t, e, h, 3, JACK)
    brush(t, h[0] - 1, h[1] + 0.5, 2, 44)
    t.rect(int(h[0]), int(h[1]) - 2, int(h[0]) + 3, int(h[1]) - 1, 38)        # телефон экраном к себе
    t.rect(int(h[0]) + 1, int(h[1]) - 2, int(h[0]) + 2, int(h[1]) - 2, 4)     # свет экрана
    t.rect(int(h[0]), int(h[1]), int(h[0]) + 2, int(h[1]) + 1, SKIN)


def phone_hold_far(t, sh, bob):
    sx, sy = sh
    stroke(t, sh, (sx + 1, sy + 8), 3, JACK_S)
    stroke(t, (sx + 1, sy + 8), (sx + 5, sy + 6), 3, JACK_S)
    brush(t, sx + 6, sy + 6, 2, SKIN_S)


CASE_HAND = (-8, 27)     # кисть на ручке чемодана относительно бедра по x и абсолютный y
CASE_TILT = 0.8          # наклон чемодана от вертикали к идущему, рад


def case_behind(t, hip, top, bob):
    """Чемодан позади: выдвижная ручка в ближней руке, корпус наклонён к идущему, катится на нижнем заднем углу."""
    hx = hip[0]
    H = (hx + CASE_HAND[0], CASE_HAND[1] + bob)
    up = (math.sin(CASE_TILT), -math.cos(CASE_TILT))
    ac = (math.cos(CASE_TILT), math.sin(CASE_TILT))
    w, h, rod = 9, 16, 6

    def at(p, a, b):
        return (p[0] + up[0] * a + ac[0] * b, p[1] + up[1] * a + ac[1] * b)

    T0 = at(H, -rod, 0)
    TL, TR = at(T0, 0, -w / 2), at(T0, 0, w / 2)
    BL, BR = at(TL, -h, 0), at(TR, -h, 0)
    # колесо на земле: сдвигаем всё так, чтобы нижний задний угол стоял на GROUND-1
    dy = (GROUND - 1) - BR[1]
    TL, TR, BL, BR, T0 = [(x, y + dy) for x, y in (TL, TR, BL, BR, T0)]
    t.poly([TL, TR, BR, BL], CASE)
    t.poly([at(TR, 0, -2), TR, BR, at(BR, 0, -2)], CASE_S)          # бок в тени
    stroke(t, TL, TR, 1, CASE_L)                                     # верхняя грань в свету
    for k in (3, 6):                                                 # рёбра корпуса
        stroke(t, at(at(BL, 2, 0), 0, k), at(at(TL, -2, 0), 0, k), 1, CASE_S)
    tag = at(TL, -3, 2)
    brush(t, tag[0], tag[1], 2, 23)
    brush(t, BR[0] - 0.5, BR[1] + 0.5, 2, 38)                        # колёса
    brush(t, BL[0] + 0.5, BL[1], 2, 38)
    # выдвижная ручка — две штанги от верхней грани к кисти
    stroke(t, at(T0, 0, -1.5), (H[0] - 1, H[1] + dy), 1, 42)
    stroke(t, at(T0, 0, 1.5), (H[0] + 1, H[1] + dy), 1, 41)
    t.rect(int(H[0]) - 1, int(H[1] + dy) - 1, int(H[0]) + 1, int(H[1] + dy) - 1, 40)


def near_arm_case(t, sh, bob):
    sx, sy = sh
    hx = sx - 1
    hand = (hx + CASE_HAND[0], CASE_HAND[1] + bob)
    e = ((sx + hand[0]) / 2 - 0.5, (sy + hand[1]) / 2 + 1.5)
    stroke(t, sh, e, 4, JACK)
    stroke(t, e, hand, 3, JACK)
    stroke(t, (sx - 1, sy + 1), (e[0] - 1, e[1]), 1, JACK_S)
    brush(t, (e[0] + hand[0]) / 2 + 0.5, (e[1] + hand[1]) / 2 + 1, 2, 44)
    brush(t, hand[0], hand[1] - 0.5, 2, SKIN)


def box_front(i, stand):
    def draw(t, hip, top, bob):
        hx = hip[0]
        sway = 0 if stand else (1 if i in (1, 2, 3) else 0) - (1 if i in (5, 6, 7) else 0)
        x0, y0 = hx + 2 + sway, top + 17
        x1, y1 = x0 + 10, y0 + 11
        # ручка-петля к кисти
        t.rect(x0 + 3, y0 - 3, x0 + 3, y0 - 1, 41)
        t.rect(x0 + 7, y0 - 3, x0 + 7, y0 - 1, 41)
        t.rect(x0 + 3, y0 - 4, x0 + 7, y0 - 4, 41)
        t.rect(x0, y0, x1, y1, BOX)
        t.rect(x1 - 1, y0 + 1, x1, y1, BOX_S)
        t.rect(x0, y0, x1, y0, BOX_T)
        t.rect(x0 + 1, y0 + 2, x1 - 3, y1 - 3, 45)                   # окно с картинкой
        t.sprite(x0 + 2, y0 + 3, ['.hh..', 'wwww.', 'wbWwg', 'wbWw.', 'gggg.'],
                 {'h': 40, 'w': 44, 'W': 45, 'b': 3, 'g': 42})
        t.rect(x0 + 1, y1 - 1, x0 + 4, y1 - 1, 27)
        # кисть держит петлю
        brush(t, x0 + 5, y0 - 5, 2, SKIN)
    return draw


def near_arm_box(i, stand):
    def draw(t, sh, bob):
        sx, sy = sh
        sway = 0 if stand else (1 if i in (1, 2, 3) else 0) - (1 if i in (5, 6, 7) else 0)
        hand = (sx + 5 + sway, sy + 11)
        e = (sx + 1, sy + 6)
        stroke(t, sh, e, 4, JACK)
        stroke(t, e, hand, 3, JACK)
        stroke(t, (sx - 1, sy + 1), (e[0] - 1, e[1]), 1, JACK_S)
        brush(t, hand[0] - 0.5, hand[1] - 1.5, 2, 44)
    return draw


def sheet(frames):
    w = frames[0].w
    h = frames[0].h
    out = Tex(w * len(frames), h)
    for k, f in enumerate(frames):
        out.a[:, k * w:(k + 1) * w] = f.a
    return out


def build_walk():
    hx = 16
    frames = [walker(i, hx) for i in range(8)]
    frames.append(walker(0, hx, stand=True))
    frames.append(walker(0, hx, stand=True, near_arm=phone_ear))
    frames.append(walker(0, hx, stand=True, near_arm=phone_hold, far_arm=phone_hold_far, head_rows=HEAD_DOWN))
    return frames, hx


def build_case():
    hx = 32
    frames = []
    for i in list(range(8)) + [None]:
        stand = i is None
        k = 0 if stand else i
        frames.append(walker(k, hx, stand=stand, frame_w=48, near_arm=near_arm_case, extra_back=case_behind))
    return frames, hx


def build_box():
    hx = 14
    frames = []
    for i in list(range(8)) + [None]:
        stand = i is None
        k = 0 if stand else i
        frames.append(walker(k, hx, stand=stand, near_arm=near_arm_box(k, stand), extra_front=box_front(k, stand)))
    return frames, hx


# ---------------------------------------------------------------------------------------------------
# сидя в автобусе: крупнее (кадр салона ближе), 48×56, лицом вправо
# ---------------------------------------------------------------------------------------------------
SW, SH = 48, 56
HEADL = [
    '.....hhhhh.....',
    '...hhhHHHHhh...',
    '..hhhhhhhHHHh..',
    '.hhhhhhhhhhHHh.',
    'hhhhhhhhhhhhhh.',
    'hhhhhhhhhhhsss.',
    'hhhhhoohhsssss.',
    'hhhhoOOhsssbbs.',
    'hhhhoOOhssssEs.',
    'hhhhhoohssssssn',
    '.hhhhhhssssssss',
    '.hhhhhssssssS..',
    '..hhhssssmmm...',
    '..hhhhsssssS...',
    '....hSSSSSS....',
]
HEADL_LEG = {'h': HAIR, 'H': HAIR_L, 's': SKIN, 'S': SKIN_S, 'o': SKIN, 'O': SKIN_S, 'b': HAIR, 'E': 37, 'n': SKIN,
             'm': SKIN_D, 'c': SKIN_S, 'l': 13}


def headl(kind):
    rows = [list(r) for r in HEADL]
    if kind in ('down', 'sleep'):
        rows[7][11:13] = ['s', 's']
        rows[8][11:13] = ['b', 'b']
        rows[9][11:13] = ['l', 'l'] if kind == 'down' else ['S', 'S']
        rows[9][12] = 'E' if kind == 'down' else 'l'
        rows[9][11] = 's' if kind == 'down' else 'l'
        rows[8][12] = 'b'
    if kind == 'up':
        rows[6][11:13] = ['b', 'b']
        rows[7][11:13] = ['s', 'E']
        rows[8][12] = 's'
    return [''.join(r) for r in rows]


def seated(frame):
    t = Tex(SW, SH)
    hip = (13, 37)
    knee = (30, 36)
    ankle = (32, 50)
    far_ankle = (29, 50)
    # дальняя нога
    stroke(t, (hip[0], hip[1] - 1), (knee[0] - 1, knee[1] - 1), 6, 0)
    stroke(t, (knee[0] - 1, knee[1]), far_ankle, 5, 0)
    t.rect(far_ankle[0] - 2, 51, far_ankle[0] + 6, 54, 43)
    t.rect(far_ankle[0] - 2, 55, far_ankle[0] + 6, 55, 40)
    # ближняя нога
    stroke(t, hip, knee, 6, 1)
    stroke(t, knee, ankle, 5, 1)
    stroke(t, (hip[0] + 1, hip[1] - 3), (knee[0] + 1, knee[1] - 3), 1, 2)      # складка по верху бедра
    stroke(t, (knee[0] + 2, knee[1] - 1), (ankle[0] + 2, ankle[1] - 2), 1, 2)
    t.rect(ankle[0] - 2, 51, ankle[0] + 6, 54, 45)
    t.rect(ankle[0] + 3, 51, ankle[0] + 6, 51, 44)
    t.rect(ankle[0] - 2, 55, ankle[0] + 6, 55, 41)
    t.rect(ankle[0] - 1, 52, ankle[0] + 1, 52, 3)
    # корпус: ветровка, спиной к спинке кресла
    lean = 0 if frame != 3 else 1
    t.poly([(7, 19), (17 + lean, 17), (21 + lean, 22), (21, 38), (8, 39)], JACK)
    t.poly([(7, 19), (10, 19), (11, 39), (8, 39)], JACK_S)
    t.rect(8, 37, 21, 39, JACK_S)
    t.rect(20 + lean, 23, 20 + lean, 35, 45)                                   # молния
    t.rect(10, 15, 19, 18, JACK_L)                                             # воротник
    t.rect(11, 16, 18, 17, JACK)
    # голова
    hk = {0: 'down', 1: 'down', 2: 'up', 3: 'sleep'}[frame]
    hx, hy = (8, 2) if frame != 3 else (10, 4)
    if frame == 2:
        hy = 1
    t.rect(15 + (1 if frame == 3 else 0), 15, 18 + (1 if frame == 3 else 0), 17, SKIN_S)    # шея
    t.sprite(hx, hy, headl(hk), HEADL_LEG)
    # дальняя рука (за корпусом) и ближняя с телефоном
    phone_y = {0: 26, 1: 25, 2: 33, 3: 34}[frame]
    phone_x = {0: 26, 1: 26, 2: 25, 3: 24}[frame]
    stroke(t, (14, 21), (18, 31), 4, JACK)
    stroke(t, (18, 31), (phone_x - 1, phone_y + 2), 4, JACK)
    stroke(t, (12.5, 22), (16.5, 31), 1, JACK_S)
    stroke(t, (15.5, 21), (19, 29), 1, JACK_L)
    brush(t, phone_x - 3, phone_y + 2.5, 2, 44)                                   # манжета
    # телефон: видим его спинку, экран к нему
    px0, py0 = phone_x, phone_y - 4
    if frame in (0, 1):
        t.rect(px0, py0, px0 + 2, py0 + 6, 38)
        t.rect(px0, py0, px0, py0 + 6, 40)
        t.px(px0 + 1, py0 + 1, 41)
        t.rect(px0 - 1, py0 + 3, px0 + 1, py0 + 6, SKIN)                        # пальцы
        t.px(px0 + 1, py0 + 6, SKIN_S)
        if frame == 1:
            t.rect(px0 + 3, py0 + 1, px0 + 3, py0 + 2, SKIN)                     # большой палец листает
        # свет экрана на лице
        t.px(21, 12, 17)
        t.px(22, 13, 17)
    else:
        t.rect(px0 - 1, py0 + 3, px0 + 5, py0 + 4, 38)                           # лежит на коленях
        t.rect(px0 - 1, py0 + 3, px0 + 5, py0 + 3, 40)
        t.rect(px0 - 2, py0 + 4, px0 + 1, py0 + 6, SKIN)
    outline(t)
    return t


def build_sit():
    return [seated(k) for k in range(4)]


# ---------------------------------------------------------------------------------------------------
# салон автобуса в разрезе: 320×180, стёкла прозрачные
# ---------------------------------------------------------------------------------------------------
BW, BH = 320, 180
FLOOR = 172
WIN_Y0, WIN_Y1 = 58, 133
WINDOWS = [(6, 98), (110, 206), (218, 314)]
SEAT_Y = 152              # верх подушки
SEAT_PITCH = 52
SEATS = [4, 56, 108, 160, 212, 264]
NEWBIE_SEAT = 160
SIT_AT = (NEWBIE_SEAT + 1, SEAT_Y - 35)   # левый верхний угол кадра newbie_sit в салоне


def seat_back(t, bx, fg=False):
    """Кресло в профиль лицом вправо: спинка слева с подголовником в белом чехле, подушка вправо."""
    # опора и ножка
    t.rect(bx + 8, SEAT_Y + 6, bx + 10, FLOOR - 1, 40)
    t.rect(bx + 6, FLOOR - 2, bx + 22, FLOOR - 1, 39)
    t.rect(bx + 20, SEAT_Y + 6, bx + 21, FLOOR - 1, 39)
    # подушка
    t.rect(bx + 2, SEAT_Y, bx + 26, SEAT_Y + 6, 2)
    t.rect(bx + 2, SEAT_Y, bx + 26, SEAT_Y, 3)
    t.rect(bx + 2, SEAT_Y + 6, bx + 26, SEAT_Y + 6, 1)
    t.px(bx + 26, SEAT_Y, 2)
    # спинка — с небольшим наклоном назад
    t.poly([(bx - 1, SEAT_Y - 28), (bx + 6, SEAT_Y - 28), (bx + 9, SEAT_Y + 4), (bx + 1, SEAT_Y + 4)], 2)
    t.poly([(bx - 1, SEAT_Y - 28), (bx + 1, SEAT_Y - 28), (bx + 3, SEAT_Y + 4), (bx + 1, SEAT_Y + 4)], 1)
    t.poly([(bx + 5, SEAT_Y - 26), (bx + 6, SEAT_Y - 26), (bx + 9, SEAT_Y + 2), (bx + 8, SEAT_Y + 2)], 3)
    # узор обивки — редкие точки
    for yy in range(SEAT_Y - 22, SEAT_Y, 5):
        t.px(bx + 3 + (yy - SEAT_Y + 28) // 10, yy, 1)
    # подголовник в белом чехле
    t.rect(bx - 2, SEAT_Y - 39, bx + 6, SEAT_Y - 27, 44)
    t.rect(bx - 2, SEAT_Y - 39, bx + 6, SEAT_Y - 39, 45)
    t.rect(bx - 2, SEAT_Y - 38, bx - 1, SEAT_Y - 27, 43)
    t.rect(bx + 1, SEAT_Y - 28, bx + 5, SEAT_Y - 28, 42)
    # ручка за спинкой (держаться в проходе)
    t.rect(bx - 4, SEAT_Y - 37, bx - 3, SEAT_Y - 31, 41)
    t.px(bx - 4, SEAT_Y - 37, 42)


def armrest(t, bx):
    t.rect(bx + 5, SEAT_Y - 12, bx + 22, SEAT_Y - 9, 39)
    t.rect(bx + 5, SEAT_Y - 12, bx + 22, SEAT_Y - 12, 41)
    t.rect(bx + 20, SEAT_Y - 9, bx + 22, SEAT_Y - 1, 39)
    t.px(bx + 22, SEAT_Y - 12, 40)


def plaid(t, x0, y0, x1, y1):
    """Клетчатая «челночная» сумка."""
    t.rect(x0, y0, x1, y1, 43)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            if (x - x0) % 5 in (0, 1):
                t.px(x, y, 27 if (y - y0) % 5 in (0, 1) else 3)
            elif (y - y0) % 5 in (0, 1):
                t.px(x, y, 2)
    t.rect(x0, y1, x1, y1, 41)


def babka(t, bx):
    """Бабушка в платке и пальто, сумка-тележка рядом."""
    sh = SEAT_Y - 19
    hip = (bx + 14, SEAT_Y + 1)
    knee = (bx + 29, SEAT_Y)
    ankle = (bx + 31, FLOOR - 6)
    stroke(t, hip, knee, 6, 31)
    stroke(t, (knee[0], knee[1] + 1), ankle, 4, 13)                               # чулки
    t.rect(ankle[0] - 2, FLOOR - 5, ankle[0] + 6, FLOOR - 1, 37)                  # боты
    t.rect(ankle[0] - 2, FLOOR - 5, ankle[0] + 6, FLOOR - 5, 39)
    # пальто
    t.poly([(bx + 7, sh), (bx + 17, sh - 2), (bx + 21, sh + 3), (bx + 22, SEAT_Y + 3), (bx + 8, SEAT_Y + 3)], 31)
    t.poly([(bx + 7, sh), (bx + 10, sh), (bx + 11, SEAT_Y + 3), (bx + 8, SEAT_Y + 3)], 30)
    t.rect(bx + 21, sh + 4, bx + 21, SEAT_Y - 2, 32)
    for yy in (sh + 6, sh + 12):
        t.px(bx + 20, yy, 22)
    # рука на коленях
    stroke(t, (bx + 13, sh + 2), (bx + 16, sh + 11), 4, 31)
    stroke(t, (bx + 16, sh + 11), (bx + 25, sh + 14), 4, 31)
    t.rect(bx + 25, sh + 12, bx + 27, sh + 15, SKIN_S)
    # голова в платке: лицо вправо
    t.sprite(bx + 7, sh - 14, [
        '...RRRRRR....',
        '.RRRRRRRRRR..',
        'RRwRRRRwRRRR.',
        'RRRRRRRRRRsR.',
        'RRwRRRRsssssR',
        'RRRRRRssssEss',
        'RRRRRssssssss',
        'RRRRRssssssSn',
        '.RRwRsssssmS.',
        '.RRRRRssssS..',
        '..RRRRRSSS...',
        '...RRRR.RR...',
    ], {'R': 27, 'w': 45, 's': SKIN, 'S': SKIN_S, 'E': 37, 'n': SKIN, 'm': 13})
    t.rect(bx + 13, sh - 2, bx + 15, sh, 26)                                      # узел платка
    # сумка-тележка
    plaid(t, bx + 37, FLOOR - 22, bx + 47, FLOOR - 4)
    t.rect(bx + 46, FLOOR - 34, bx + 46, FLOOR - 22, 41)
    t.rect(bx + 44, FLOOR - 35, bx + 47, FLOOR - 35, 39)
    t.rect(bx + 38, FLOOR - 3, bx + 40, FLOOR - 1, 37)


def worker(t, bx):
    """Рабочий в оранжевом жилете спит: голова запрокинута на подголовник, руки на груди."""
    sh = SEAT_Y - 19
    hip = (bx + 14, SEAT_Y + 1)
    knee = (bx + 31, SEAT_Y - 1)
    ankle = (bx + 35, FLOOR - 6)
    stroke(t, hip, knee, 6, 39)
    stroke(t, knee, ankle, 5, 39)
    stroke(t, (hip[0], hip[1] - 3), (knee[0], knee[1] - 3), 1, 40)
    t.rect(ankle[0] - 3, FLOOR - 6, ankle[0] + 6, FLOOR - 1, 37)                  # рабочие ботинки
    t.rect(ankle[0] - 3, FLOOR - 6, ankle[0] + 6, FLOOR - 6, 20)
    # куртка и жилет
    t.poly([(bx + 6, sh), (bx + 16, sh - 2), (bx + 22, sh + 4), (bx + 23, SEAT_Y + 3), (bx + 8, SEAT_Y + 3)], 39)
    t.poly([(bx + 9, sh + 1), (bx + 17, sh), (bx + 21, sh + 5), (bx + 22, SEAT_Y - 2), (bx + 10, SEAT_Y - 2)], 29)
    t.poly([(bx + 9, sh + 1), (bx + 12, sh + 1), (bx + 13, SEAT_Y - 2), (bx + 10, SEAT_Y - 2)], 28)
    t.rect(bx + 10, sh + 12, bx + 22, sh + 13, 44)                                # светоотражающая полоса
    # руки скрещены на груди
    stroke(t, (bx + 13, sh + 2), (bx + 15, sh + 10), 4, 39)
    stroke(t, (bx + 15, sh + 10), (bx + 22, sh + 7), 4, 39)
    t.rect(bx + 22, sh + 5, bx + 23, sh + 8, SKIN_S)
    # голова запрокинута на подголовник: подбородок вверх, кепка съехала на глаза, рот открыт
    t.sprite(bx + 3, sh - 15, [
        '.......cc....',
        '....cccccC...',
        '..cccccccCCC.',
        '.hccccccccCCC',
        'hhhhhhhsssS..',
        'hhhoOsslllss.',
        'hhhoOsssssssn',
        'hhhhhssssssss',
        '.hhhhsssmmms.',
        '..hhhhssssS..',
        '....hSSSSS...',
    ], {'c': 38, 'C': 39, 'h': 38, 's': SKIN_S, 'S': SKIN_D, 'o': SKIN_S, 'O': SKIN_D, 'l': 13, 'n': SKIN_S, 'm': 12})


def luggage(t):
    # рюкзак новенького над его креслом
    x = NEWBIE_SEAT + 4
    t.rect(x, 16, x + 13, 29, PACK)
    t.rect(x, 16, x + 13, 16, PACK_L)
    t.rect(x, 17, x, 29, PACK_S)
    t.rect(x + 3, 22, x + 10, 27, PACK_S)
    t.rect(x + 3, 22, x + 10, 22, PACK)
    t.px(x + 6, 24, 41)
    t.px(x, 16, T)
    t.px(x + 13, 16, T)
    # клетчатая сумка над бабушкой, коробка, чей-то пакет
    plaid(t, 20, 14, 44, 29)
    t.rect(70, 20, 90, 29, BOX)
    t.rect(70, 20, 90, 20, BOX_T)
    t.rect(88, 21, 90, 29, BOX_S)
    t.rect(78, 20, 80, 29, 23)                                                  # скотч
    t.rect(230, 18, 246, 29, 33)
    t.rect(230, 18, 246, 18, 34)
    t.rect(236, 15, 240, 17, 32)


def build_bus_in():
    t = Tex(BW, BH)
    # потолок и светильник
    t.rect(0, 0, BW - 1, 10, 43)
    t.rect(0, 4, BW - 1, 6, 45)
    t.checker(0, 2, BW - 1, 3, 45)
    t.checker(0, 7, BW - 1, 8, 44, 1)
    t.rect(0, 10, BW - 1, 10, 41)
    # багажная полка
    t.rect(0, 11, BW - 1, 29, 41)
    t.rect(0, 11, BW - 1, 12, 40)
    luggage(t)
    t.rect(0, 30, BW - 1, 34, 42)                                               # бортик полки
    t.rect(0, 30, BW - 1, 30, 43)
    t.rect(0, 34, BW - 1, 34, 40)
    for x in range(8, BW, 26):
        t.rect(x, 30, x + 1, 34, 40)
    # верх стены: панель, обдув и лампочки над креслами
    t.rect(0, 35, BW - 1, 57, 42)
    t.rect(0, 35, BW - 1, 36, 40)
    for bx in SEATS:
        cx = bx + 14
        t.rect(cx - 6, 42, cx + 6, 47, 40)
        t.rect(cx - 5, 43, cx + 5, 46, 41)
        t.rect(cx - 4, 44, cx - 2, 45, 38)
        t.rect(cx + 2, 44, cx + 4, 45, 23 if bx == NEWBIE_SEAT else 43)          # у новенького горит лампа
    t.rect(0, 56, BW - 1, 57, 41)
    # окна: рама, стекло прозрачное
    t.rect(0, WIN_Y0, BW - 1, WIN_Y1, 41)
    for x0, x1 in WINDOWS:
        t.rect(x0 - 2, WIN_Y0, x1 + 2, WIN_Y1, 38)
        t.rect(x0 - 1, WIN_Y0 + 1, x1 + 1, WIN_Y1 - 1, 39)
        t.rect(x0, WIN_Y0 + 2, x1, WIN_Y1 - 2, T)
        # форточка сверху
        t.rect(x0, WIN_Y0 + 16, x1, WIN_Y0 + 17, 39)
        # блики на стекле
        for k in range(6):
            t.px(x1 - 18 + k, WIN_Y0 + 20 + k * 2, 45)
            t.px(x1 - 17 + k, WIN_Y0 + 20 + k * 2, 44)
        for k in range(3):
            t.px(x1 - 10 + k, WIN_Y0 + 22 + k * 2, 44)
    # простенки со шторками
    for xp in [0] + [x1 + 3 for _, x1 in WINDOWS[:-1]] + [WINDOWS[-1][1] + 3]:
        t.rect(xp, WIN_Y0, xp + 8, WIN_Y1, 42)
        t.rect(xp, WIN_Y0, xp, WIN_Y1, 43)
    for x0, x1 in WINDOWS:
        for side, xs in ((0, x0), (1, x1 - 6)):
            # собранная шторка: складки, подхват посередине
            t.rect(xs, WIN_Y0 + 2, xs + 6, WIN_Y0 + 48, 26)
            for k in range(0, 7, 2):
                t.rect(xs + k, WIN_Y0 + 2, xs + k, WIN_Y0 + 48, 25)
            t.rect(xs, WIN_Y0 + 2, xs + 6, WIN_Y0 + 3, 27)
            t.rect(xs - 1, WIN_Y0 + 28, xs + 7, WIN_Y0 + 29, 22)
            t.poly([(xs, WIN_Y0 + 48), (xs + 6, WIN_Y0 + 48), (xs + 8 if side else xs + 4, WIN_Y0 + 56), (xs + 2 if side else xs - 2, WIN_Y0 + 56)], 26)
    # подоконник и нижняя стенка
    t.rect(0, WIN_Y1 + 1, BW - 1, WIN_Y1 + 4, 43)
    t.rect(0, WIN_Y1 + 1, BW - 1, WIN_Y1 + 1, 44)
    t.rect(0, WIN_Y1 + 5, BW - 1, FLOOR - 1, 40)
    t.rect(0, WIN_Y1 + 5, BW - 1, WIN_Y1 + 5, 39)
    for x in range(0, BW, 4):                                                   # решётка отопителя
        t.rect(x, FLOOR - 16, x + 1, FLOOR - 11, 39)
    t.rect(0, FLOOR - 17, BW - 1, FLOOR - 17, 41)
    # пол
    t.rect(0, FLOOR, BW - 1, BH - 1, 38)
    for y in range(FLOOR + 2, BH, 3):
        t.rect(0, y, BW - 1, y, 39)
    t.rect(0, FLOOR, BW - 1, FLOOR, 40)
    # кресла и люди
    for bx in SEATS:
        seat_back(t, bx)
    babka(t, SEATS[0])
    worker(t, SEATS[5])
    for bx in SEATS:
        if bx != NEWBIE_SEAT:
            armrest(t, bx)
    # на пустом кресле — забытая газета
    x = SEATS[2] + 11
    t.rect(x, SEAT_Y - 2, x + 11, SEAT_Y - 1, 44)
    t.rect(x, SEAT_Y - 3, x + 9, SEAT_Y - 3, 45)
    for k in range(1, 10, 3):
        t.rect(x + k, SEAT_Y - 2, x + k + 1, SEAT_Y - 2, 41)
    t.px(x + 11, SEAT_Y - 1, 42)
    return t


def build_bus_fg():
    t = Tex(BW, BH)
    armrest(t, NEWBIE_SEAT)
    return t


# ---------------------------------------------------------------------------------------------------
# телефон в руках крупно: 2 кадра 160×180
# ---------------------------------------------------------------------------------------------------
PW, PH = 160, 180
SCREEN = (38, 20, 121, 159)          # x0, y0, x1, y1 включительно — 84×140


def rounded(t, x0, y0, x1, y1, r, c):
    t.rect(x0 + r, y0, x1 - r, y1, c)
    t.rect(x0, y0 + r, x1, y1 - r, c)
    t.ellipse(x0 + r, y0 + r, r + 0.3, r + 0.3, c)
    t.ellipse(x1 - r + 1, y0 + r, r + 0.3, r + 0.3, c)
    t.ellipse(x0 + r, y1 - r + 1, r + 0.3, r + 0.3, c)
    t.ellipse(x1 - r + 1, y1 - r + 1, r + 0.3, r + 0.3, c)


def capsule_mask(t, p0, p1, r0, r1):
    """Пиксели в пределах радиуса от отрезка; радиус плавно меняется от r0 к r1."""
    xs, ys = t.grid()
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    u = np.clip(((xs - x0) * dx + (ys - y0) * dy) / L2, 0, 1)
    d = np.hypot(xs - (x0 + u * dx), ys - (y0 + u * dy))
    return d <= r0 + (r1 - r0) * u, u, (xs - x0) * dy - (ys - y0) * dx


def thumb(t, base, tip, r0=6.5, r1=4.6, light_side=1):
    """Большой палец: капсула, тень по одной стороне, ноготь у кончика."""
    m, u, side = capsule_mask(t, base, tip, r0, r1)
    t.a[m] = SKIN
    # тень — по стороне, противоположной свету, и у основания
    L = math.hypot(tip[0] - base[0], tip[1] - base[1])
    sd = side / L
    t.a[m & (sd * light_side > r0 * 0.3)] = SKIN_S
    t.a[m & (sd * light_side < -r0 * 0.62) & (u > 0.45) & (u < 0.85)] = 17
    # ноготь
    nm, nu, nside = capsule_mask(t, (tip[0] - (tip[0] - base[0]) * 2.6 / L, tip[1] - (tip[1] - base[1]) * 2.6 / L), tip, 2.0, 1.6)
    t.a[nm & m] = 17
    t.a[nm & m & (nside / L * light_side > 0.9)] = SKIN
    return m


def build_phone(frame):
    t = Tex(PW, PH)
    x0, y0, x1, y1 = SCREEN
    bx0, by0, bx1, by1 = x0 - 6, y0 - 9, x1 + 6, y1 + 10
    xs, ys = t.grid()
    # ладони за телефоном: выглядывают у нижних углов
    for cx, sgn in ((bx0 + 2, -1), (bx1 - 1, 1)):
        palm = ((xs - cx) / 17) ** 2 + ((ys - (by1 - 6)) / 24) ** 2 <= 1
        t.a[palm] = SKIN
        t.a[palm & ((xs - cx) * sgn > 9)] = SKIN_S
    # кончики пальцев за телефоном: слева и справа, лесенкой
    for k in range(4):
        yy = 92 + k * 11
        dx = [1, 0, 0, 1][k]
        for side in (-1, 1):
            if side < 0:
                fx0, fx1 = bx0 - 6 + dx, bx0 + 3
            else:
                fx0, fx1 = bx1 - 3, bx1 + 6 - dx
            rounded(t, fx0, yy, fx1, yy + 9, 3, SKIN)
            t.rect(fx0 + 1, yy + 8, fx1 - 1, yy + 9, SKIN_S)
            if side < 0:
                t.rect(fx0, yy + 2, fx0, yy + 6, SKIN_S)
            else:
                t.rect(fx1, yy + 2, fx1, yy + 6, SKIN_S)
    # корпус
    rounded(t, bx0, by0, bx1, by1, 6, 37)
    rounded(t, bx0 + 1, by0 + 1, bx1 - 1, by1 - 1, 5, 38)
    t.rect(bx0 + 1, by0 + 7, bx0 + 1, by1 - 7, 40)                               # блик по левой грани
    t.rect(bx0 + 7, by0 + 1, bx1 - 9, by0 + 1, 39)
    t.rect(x0 + 34, by0 + 4, x0 + 49, by0 + 5, 36)                               # динамик
    t.ellipse(x0 + 56, by0 + 5, 1.6, 1.6, 36)                                    # камера
    t.px(x0 + 56, by0 + 4, 40)
    t.rect(x0 + 30, by1 - 5, x0 + 53, by1 - 4, 39)                               # полоска «домой»
    t.rect(x0, y0, x1, y1, 36)
    # рукава ветровки снизу, у манжеты светлая кромка по дуге
    for cx in (bx0 - 2, bx1 + 2):
        sl = ((xs - cx) / 25) ** 2 + ((ys - (PH + 10)) / 17) ** 2 <= 1
        t.a[sl] = JACK
        t.a[sl & (((xs - cx - (6 if cx > PW / 2 else -6)) / 20) ** 2 + ((ys - (PH + 13)) / 12) ** 2 <= 1)] = JACK_S
        t.a[sl & ~(((xs - cx) / 25) ** 2 + ((ys - (PH + 11)) / 17) ** 2 <= 1)] = 44
    # большие пальцы поверх
    lb = (bx0 - 5, by1 + 1)
    thumb(t, lb, (bx0 + 8, by1 - 34), light_side=-1)
    rb = (bx1 + 5, by1 + 1)
    if frame == 0:
        thumb(t, rb, (bx1 - 8, by1 - 34), light_side=1)
    else:
        thumb(t, rb, (x1 - 24, y1 - 30), r0=6.5, r1=4.6, light_side=1)
    outline(t)
    # экран — ровный прямоугольник; палец на экране обводим заново
    scr = np.zeros_like(t.a, bool)
    scr[y0:y1 + 1, x0:x1 + 1] = True
    skin = np.isin(t.a, [SKIN, SKIN_S, 17])
    t.a[scr & ~skin] = 36
    t.a[scr & grow(skin & scr) & ~skin] = 37
    return t


# ---------------------------------------------------------------------------------------------------
# Тимур с кружкой: 32×48, лицом влево, 2 кадра
# ---------------------------------------------------------------------------------------------------
TIMUR_HEAD = [
    '..h.hh.h....',
    '.hhhhhhhhh..',
    'hhhHhhhHhhh.',
    'hhhhhhhhhhhh',
    'hhhhhhhhsss.',
    'hhhoOhhssss.',
    'hhhoOhssses.',
    'hhhhhssssssn',
    '.hhhssssssS.',
    '.hhhsssmmm..',
    '..hhsssssS..',
    '....SSSSS...',
]


def timur(frame):
    t = Tex(FW, FH)
    hx = 16
    hip = (hx, HIP_Y)
    top = 15
    # дальняя рука висит
    arm(t, (hx, top + 1), 0.05, 0.1, False)
    t.a[t.a == JACK_S] = 1
    # треники и тапки
    for dx, near in ((2, False), (-2, True)):
        ank = (hx + dx, GROUND - 3)
        knee = ik(hip, ank, L_THIGH, L_SHIN, 1)
        c = 40 if near else 39
        stroke(t, hip, knee, 4, c)
        stroke(t, knee, ank, 3, c)
        t.rect(ank[0] - 2, GROUND - 1, ank[0] + 4, GROUND, 27 if near else 26)       # тапки
        t.rect(ank[0] - 2, GROUND - 1, ank[0] + 1, GROUND - 1, 1 if near else 0)
    stroke(t, (hx + 1.5, HIP_Y + 1), (hx + 1, GROUND - 5), 1, 44)                     # лампас
    # худи
    t.poly([(hx - 5, top), (hx + 4, top - 1), (hx + 6, top + 3), (hx + 6, HIP_Y + 2), (hx - 5, HIP_Y + 2)], 2)
    t.poly([(hx - 5, top), (hx - 3, top), (hx - 2, HIP_Y + 2), (hx - 5, HIP_Y + 2)], 1)
    t.rect(hx - 5, HIP_Y + 1, hx + 6, HIP_Y + 2, 1)
    t.rect(hx - 4, top - 2, hx + 1, top + 1, 3)                                         # капюшон
    t.rect(hx + 1, top + 12, hx + 6, top + 13, 1)                                       # карман-кенгуру
    t.rect(hx + 1, top - 3, hx + 3, top - 1, SKIN_S)
    # наушники на шее
    t.rect(hx + 2, top - 1, hx + 4, top + 1, 45)
    t.px(hx + 4, top, 28)
    # ближняя рука с кружкой
    if frame == 0:
        e = (hx + 2, top + 8)
        h = (hx + 7, top + 10)
    else:
        e = (hx + 4, top + 7)
        h = (hx + 7, top + 1)
    stroke(t, (hx + 1, top + 1), e, 4, 2)
    stroke(t, e, h, 3, 2)
    stroke(t, (hx + 2.5, top + 1), (e[0] + 1, e[1] - 0.5), 1, 3)
    mx, my = int(h[0]) + 1, int(h[1]) - 4
    t.rect(mx, my, mx + 4, my + 5, 45)                                                  # кружка
    t.rect(mx + 4, my + 1, mx + 4, my + 5, 43)
    t.rect(mx, my, mx + 4, my, 44)
    t.px(mx + 1, my, 20)                                                                # чай
    t.px(mx + 2, my, 20)
    t.rect(mx - 2, my + 1, mx - 1, my + 3, 44)                                          # ручка
    t.rect(mx - 1, my + 2, mx, my + 4, SKIN)                                            # пальцы
    t.sprite(hx - 4, top - 12, TIMUR_HEAD, {'h': 37, 'H': 39, 's': SKIN, 'S': SKIN_S, 'o': SKIN, 'O': SKIN_S, 'e': 37,
                                            'n': SKIN, 'm': SKIN_D})
    if frame == 1:
        t.px(hx + 6, top - 6, 13)                                                       # губы у кружки
    outline(t)
    # пар над кружкой (без контура)
    for k, (dx, dy) in enumerate(((1, -2), (2, -4), (1, -6)) if frame == 0 else ((3, -2), (2, -4))):
        t.px(mx + dx, my + dy, 44)
    t.a = t.a[:, ::-1].copy()                                                           # лицом влево
    return t


# ---------------------------------------------------------------------------------------------------
# превью и запись
# ---------------------------------------------------------------------------------------------------

def save(t, name):
    os.makedirs(OUT, exist_ok=True)
    im = t.image()
    im.save(os.path.join(OUT, name))
    return im


def preview_strip(frames, name, k=4, bg=(88, 96, 90, 255), ground=True):
    w, h = frames[0].w, frames[0].h
    im = Image.new('RGBA', (w * len(frames) + 2 * (len(frames) - 1), h), bg)
    for i, f in enumerate(frames):
        im.alpha_composite(f.image(), (i * (w + 2), 0))
    if ground:
        for x in range(im.width):
            im.putpixel((x, GROUND + 1), (60, 66, 62, 255))
    im.resize((im.width * k, im.height * k), Image.NEAREST).save(os.path.join(PREV, name))


def preview_gif(frames, name, cycle, k=4, steps=24):
    """Идёт по полосе: тело смещается на cycle/8 за кадр — видно, скользят ли ноги."""
    w, h = frames[0].w, frames[0].h
    W = w + cycle * 3
    out = []
    for s in range(steps):
        im = Image.new('RGBA', (W, h + 2), (88, 96, 90, 255))
        for x in range(0, W, 8):
            im.putpixel((x, GROUND + 1), (40, 44, 42, 255))
        x = int(s * cycle / 8) % (cycle * 3)
        im.alpha_composite(frames[s % 8].image(), (x, 0))
        out.append(im.resize((W * k, (h + 2) * k), Image.NEAREST).convert('P', palette=Image.ADAPTIVE))
    out[0].save(os.path.join(PREV, name), save_all=True, append_images=out[1:], duration=100, loop=0)


def preview_bus(sit, fg, bus):
    bg = Image.new('RGBA', (BW, BH), (164, 221, 219, 255))
    px = bg.load()
    for y in range(BH):
        for x in range(BW):
            if 96 <= y < 118:
                px[x, y] = (79, 143, 186, 255) if (x // 7 + y) % 9 else (164, 221, 219, 255)
            elif 80 <= y < 96:
                px[x, y] = (70, 130, 50, 255)
    bg.alpha_composite(bus.image())
    bg.alpha_composite(sit.image(), SIT_AT)
    bg.alpha_composite(fg.image())
    bg.resize((BW * 3, BH * 3), Image.NEAREST).save(os.path.join(PREV, 'cs_bus_in_x3.png'))


def main():
    os.makedirs(PREV, exist_ok=True)
    walk, walk_hx = build_walk()
    case, case_hx = build_case()
    box, box_hx = build_box()
    sit = build_sit()
    bus = build_bus_in()
    fg = build_bus_fg()
    phone = [build_phone(0), build_phone(1)]
    tim = [timur(0), timur(1)]
    save(sheet(walk), 'newbie_walk.png')
    save(sheet(case), 'newbie_case.png')
    save(sheet(box), 'newbie_box.png')
    save(sheet(sit), 'newbie_sit.png')
    save(bus, 'bus_in.png')
    save(fg, 'bus_fg.png')
    save(sheet(phone), 'phone.png')
    save(sheet(tim), 'timur.png')
    preview_strip(walk, 'cs_people_walk_x4.png')
    preview_strip(case, 'cs_people_case_x4.png')
    preview_strip(box, 'cs_people_box_x4.png')
    preview_strip(tim + [walk[8]], 'cs_people_timur_x4.png')
    preview_strip(sit, 'cs_people_sit_x4.png', ground=False)
    preview_gif(walk, 'cs_walk.gif', CYCLE)
    preview_gif(case, 'cs_walk_case.gif', CYCLE)
    preview_bus(sit[0], fg, bus)
    ph = Image.new('RGBA', (PW * 2 + 8, PH), (40, 46, 56, 255))
    for k, f in enumerate(phone):
        ph.alpha_composite(f.image(), (k * (PW + 8), 0))
    ph.resize((ph.width * 3, PH * 3), Image.NEAREST).save(os.path.join(PREV, 'cs_phone_x3.png'))
    walk_meta = {'walk': list(range(8)), 'stand': 8, 'ay': GROUND, 'cycle': CYCLE}
    meta = {
        'walk': {'src': '/assets/cutscene/newbie_walk.png', 'w': FW, 'h': FH, 'frames': len(walk), **walk_meta,
                 'phoneEar': 9, 'phoneLook': 10, 'ax': walk_hx},
        'case': {'src': '/assets/cutscene/newbie_case.png', 'w': 48, 'h': FH, 'frames': len(case), **walk_meta, 'ax': case_hx},
        'box': {'src': '/assets/cutscene/newbie_box.png', 'w': FW, 'h': FH, 'frames': len(box), **walk_meta, 'ax': box_hx},
        'sit': {'src': '/assets/cutscene/newbie_sit.png', 'w': SW, 'h': SH, 'frames': len(sit),
                'phone': 0, 'scroll': 1, 'window': 2, 'doze': 3, 'at': list(SIT_AT)},
        'busIn': {'src': '/assets/cutscene/bus_in.png', 'fg': '/assets/cutscene/bus_fg.png', 'w': BW, 'h': BH,
                  'windows': [[x0, WIN_Y0 + 2, x1, WIN_Y1 - 2] for x0, x1 in WINDOWS], 'floor': FLOOR},
        'phone': {'src': '/assets/cutscene/phone.png', 'w': PW, 'h': PH, 'frames': 2, 'rest': 0, 'swipe': 1,
                  'screen': list(SCREEN)},
        'timur': {'src': '/assets/cutscene/timur.png', 'w': FW, 'h': FH, 'frames': 2, 'idle': 0, 'sip': 1,
                  'ax': FW - 1 - 16, 'ay': GROUND, 'faces': 'left'},
    }
    os.makedirs(os.path.dirname(GEN), exist_ok=True)
    with open(GEN, 'w') as f:
        f.write('// Сгенерировано tools/art/cutscene_people.py — не править руками.\n')
        f.write('// Люди и салон для катсцен. Кадры листов идут слева направо; ax, ay — точка между пятками в кадре\n')
        f.write('// (ставим её на линию земли), cycle — сколько точек тело проходит за 8 кадров ходьбы (ноги не скользят).\n')
        f.write('// Прямоугольники — [x0, y0, x1, y1] включительно: окна салона (стёкла прозрачные), экран телефона.\n\n')
        f.write('export const PEOPLE = ' + json.dumps(meta, ensure_ascii=False) + ' as const\n')
    return meta


if __name__ == '__main__':
    main()
