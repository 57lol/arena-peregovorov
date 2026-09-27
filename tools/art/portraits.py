"""Портреты оппонентов: собираются из частей по сетке 96x96, как лица в Papers, Please.
Одно лицо — все эмоции (меняются только брови, глаза, рот), поэтому персонаж узнаваем.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/portraits.py
Выход: public/assets/portraits/<id>.png — лист 3 кадра x 4 эмоции (idle, talk, blink),
плюс превью в tools/art/out/.
"""
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from apollo import RGB  # noqa: E402

W = H = 96
T = -1  # прозрачный
EMOTIONS = ['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry']
FRAMES = ['idle', 'talk', 'blink']
LIGHT = np.array([-0.5, -0.22, 0.84])
LIGHT = LIGHT / np.linalg.norm(LIGHT)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


# ---------- примитивы ----------

def grid():
    ys, xs = np.mgrid[0:H, 0:W]
    return xs + 0.5, ys + 0.5


def ellipse_mask(cx, cy, rx, ry, p=2.0, p_low=None):
    xs, ys = grid()
    dx = np.abs(xs - cx) / rx
    dy = np.abs(ys - cy) / ry
    pp = np.where(ys > cy, p_low or p, p)
    return dx ** pp + dy ** pp <= 1.0


def shade_ellipsoid(cx, cy, rx, ry):
    """Ламберт по псевдо-нормали эллипсоида, 0..1."""
    xs, ys = grid()
    nx = (xs - cx) / rx
    ny = (ys - cy) / ry
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0.02, 1))
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return np.clip(n @ LIGHT, 0, 1)


def band(val, cuts, ramp):
    """Кусочно-постоянная заливка: cuts по возрастанию, ramp на 1 длиннее."""
    idx = np.digitize(val, cuts)
    return np.array(ramp)[idx]


def poly_mask(pts):
    from PIL import ImageDraw
    im = Image.new('L', (W, H), 0)
    ImageDraw.Draw(im).polygon(pts, fill=1)
    return np.array(im).astype(bool)


def paint(canvas, mask, color):
    canvas[mask] = color if np.isscalar(color) else color[mask]


def put(canvas, x0, y0, rows, legend, flip=False):
    """ASCII-спрайт: '.' — не трогать."""
    for dy, row in enumerate(rows):
        if flip:
            row = row[::-1]
        for dx, ch in enumerate(row):
            if ch == '.':
                continue
            x, y = x0 + dx, y0 + dy
            if 0 <= x < W and 0 <= y < H:
                canvas[y, x] = legend[ch]


def line(canvas, pts, color, thick=1):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            x = round(x0 + (x1 - x0) * i / n)
            y = round(y0 + (y1 - y0) * i / n)
            for t in range(thick):
                canvas[y + t, x] = color


def outline(canvas, dark_of):
    """Внешний контур: пиксель фигуры рядом с прозрачным -> тёмный тон своего материала."""
    solid = canvas != T
    edge = np.zeros_like(solid)
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(solid, sy, 0), sx, 1)
        if sy == 1:
            sh[0, :] = False
        if sy == -1:
            sh[-1, :] = False
        if sx == 1:
            sh[:, 0] = False
        if sx == -1:
            sh[:, -1] = False
        edge |= solid & ~sh
    edge[H - 1, :] = False  # низ кадра обрезан, не обводим
    out = canvas.copy()
    for y, x in zip(*np.nonzero(edge)):
        out[y, x] = dark_of.get(int(canvas[y, x]), 37)
    return out


def to_image(canvas):
    rgba = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        for x in range(W):
            c = canvas[y, x]
            if c != T:
                rgba[y, x] = (*RGB[c], 255)
    return Image.fromarray(rgba, 'RGBA')


# ---------- персонажи ----------

EYE_ROWS = 4


def eyes_for(state):
    """Глаз 8x4 (левый; правый зеркалим, кроме взгляда в сторону)."""
    return {
        'open':   ['.LLLLLL.', 'LwwppwwL', '.wwppww.', '..ssss..'],
        'smile':  ['........', '.LLLLLL.', 'LwwppwwL', '.hhhhhh.'],
        'narrow': ['........', 'LLLLLLLL', '.wwppww.', '..ssss..'],
        'side':   ['.LLLLLL.', 'LwwwwppL', '.wwwwpp.', '..ssss..'],
        'closed': ['........', '........', '.LLLLLL.', '..ssss..'],
        'arc':    ['........', '..LLLL..', '.L....L.', '........'],
        'glare':  ['L.......', 'LLLLLLLL', '.wwwpww.', '.ssssss.'],
    }[state]


EYE_STATE = {'neutral': 'open', 'pleased': 'smile', 'happy': 'arc', 'thinking': 'side', 'annoyed': 'narrow', 'angry': 'glare'}


def draw_eyes(c, E, eyL, eyR, ey, emotion, frame):
    st = 'closed' if frame == 'blink' else EYE_STATE[emotion]
    rows = eyes_for(st)
    put(c, eyL, ey, rows, E)
    put(c, eyR, ey, rows, E, flip=(st != 'side'))


def build_rinat(emotion, frame):
    """Марат Гимадиев, 54, коммерческий директор гофрокомбината. Седой, усы, тёмно-синий костюм."""
    c = np.full((H, W), T, int)
    cx, cy, rx, ry = 48, 40, 20, 25
    xs, ys = grid()

    # пиджак
    jacket = poly_mask([(0, 96), (1, 87), (9, 80), (27, 75), (38, 72), (58, 72), (69, 75), (87, 80), (95, 87), (96, 96)])
    jl = shade_ellipsoid(40, 104, 58, 36)
    paint(c, jacket, band(jl, [0.3, 0.62, 0.9], [0, 1, 2, 2]))
    shirt = poly_mask([(39, 72), (57, 72), (55, 83), (48, 95), (41, 83)])
    paint(c, shirt, 45)
    paint(c, shirt & (xs > 48), 44)
    tie = poly_mask([(45, 76), (51, 76), (50, 80), (53, 96), (43, 96), (46, 80)])
    paint(c, tie, 26)
    paint(c, tie & (xs < 48), 27)
    line(c, [(46, 80), (50, 80)], 25)
    lap_l = poly_mask([(39, 72), (41, 83), (48, 96), (42, 96), (33, 86), (30, 77)])
    lap_r = poly_mask([(57, 72), (55, 83), (48, 96), (54, 96), (63, 86), (66, 77)])
    paint(c, lap_l, 3)
    paint(c, lap_r, 1)
    line(c, [(39, 72), (41, 83), (47, 95)], 0)
    line(c, [(57, 72), (55, 83), (49, 95)], 0)
    put(c, 38, 70, ['WW....', 'WWWW..', '.WWWW.', '..WW..'], {'W': 45})
    put(c, 52, 70, ['....ww', '..wwww', '.wwww.', '..ww..'], {'w': 44})
    # значок завода на лацкане
    put(c, 34, 82, ['gg', 'Gg'], {'g': 22, 'G': 20})

    # шея
    neck = poly_mask([(38, 56), (58, 56), (58, 74), (48, 77), (38, 74)])
    paint(c, neck, 14)
    paint(c, neck & (ys < 66), 13)

    # уши
    for ex in (cx - rx - 0.5, cx + rx + 0.5):
        ear = ellipse_mask(ex, 42, 3.8, 6.5)
        paint(c, ear, 15 if ex < cx else 14)
        line(c, [(int(ex), 39), (int(ex), 45)], 13)

    # голова
    head = ellipse_mask(cx, cy, rx, ry, p=2.0, p_low=2.7)
    lam = shade_ellipsoid(cx - 3, cy - 4, rx + 3, ry + 2)
    paint(c, head, band(lam, [0.1, 0.36, 0.82], [13, 14, 15, 16]))
    # подбородок и скулы
    paint(c, head & ellipse_mask(cx - 1, cy + 21, 5, 2.2), 15)
    paint(c, head & ellipse_mask(cx - 11, cy + 4, 2, 1.2), 16)

    # волосы: зачёсаны назад, соль с перцем, залысины
    u = (xs - cx) / rx
    hairline = 19.5 + 3 * u ** 2 + 3.5 * np.exp(-((np.abs(u) - 0.55) / 0.16) ** 2)
    vol = ellipse_mask(cx, cy - 2, rx + 1.8, ry + 3.2)
    top = vol & (ys < hairline)
    sides = vol & (np.abs(xs - cx) > rx - 3) & (ys >= hairline - 1) & (ys < 41)
    hair = top | sides
    hl = shade_ellipsoid(cx - 4, cy - 10, rx + 2, ry)
    paint(c, hair, band(hl, [0.25, 0.55, 0.85], [40, 41, 42, 43]))
    for pts in ([(37, 15), (44, 13), (52, 13)], [(33, 19), (38, 16)], [(55, 15), (61, 18)], [(42, 17), (49, 15)]):
        line(c, pts, 41)
    line(c, [(40, 14), (47, 12)], 43)

    E = {'w': 44, 'p': 37, 'L': 12, 's': 14, 'h': 16, 'k': 15, 'K': 14, 'S': 13, 'g': 42, 'G': 41,
         'm': 13, 'M': 12, 't': 45, 'o': 19, 'r': 28}
    eyL, eyR, ey = 36, 52, 38
    draw_eyes(c, E, eyL, eyR, ey, emotion, frame)

    # брови: густые, тёмно-серые, 2px
    brows = {
        'neutral': ([(0, 0), (4, -1), (7, 0)], [(0, 0), (3, -1), (7, 0)]),
        'pleased': ([(0, 0), (4, -2), (7, -1)], [(0, -1), (3, -2), (7, 0)]),
        'annoyed': ([(0, -2), (7, 1)], [(0, 1), (7, -2)]),
        'thinking':   ([(0, 1), (7, 1)], [(0, -1), (3, -3), (7, -2)]),
        'happy':   ([(0, -1), (4, -3), (7, -2)], [(0, -2), (3, -3), (7, -1)]),
        'angry':   ([(0, -3), (7, 2)], [(0, 2), (7, -3)]),
    }
    bl, br = brows[emotion]
    line(c, [(eyL + dx, ey - 4 + dy) for dx, dy in bl], 40, thick=2)
    line(c, [(eyR + dx, ey - 4 + dy) for dx, dy in br], 40, thick=2)
    # морщины лба
    line(c, [(42, 26), (53, 26)], 14)
    line(c, [(44, 29), (51, 29)], 14)
    if emotion in ('annoyed', 'angry'):
        line(c, [(46, 32), (46, 35)], 13)
        line(c, [(49, 32), (49, 35)], 13)
    if emotion == 'thinking':
        line(c, [(44, 25), (49, 24)], 14)

    # нос
    put(c, 46, 41, ['h...', 'hs..', 'hs..', 'hs..', 'hhs.', 'hhsS', 'S.SS'], E)
    # носогубные складки
    line(c, [(40, 49), (41, 54)], 14)
    line(c, [(56, 49), (55, 54)], 13)
    if emotion in ('pleased', 'happy'):
        put(c, 35, 46, ['rr'], E)
        put(c, 59, 46, ['rr'], E)
    if emotion == 'angry':
        put(c, 34, 45, ['RRR', '.R.'], {'R': 27})
        put(c, 59, 45, ['RRR', '.R.'], {'R': 27})

    mouths = {
        'neutral': ['.........', 'MMMMMMMMM', '..kkkkk..'],
        'pleased': ['MM.....MM', '.MtttttM.', '..MMMMM..'],
        'annoyed': ['.........', '.MMMMMMM.', 'M.......M'],
        'thinking':   ['......MM.', 'MMMMMM...', '..kkk....'],
        'happy':   ['MM.....MM', '.MtttttM.', '..MoooM..'],
        'angry':   ['MMMMMMMMM', 'MtMtMtMtM', '.MMMMMMM.'],
    }
    talk = {
        'neutral': ['.MMMMMMM.', '.MoooooM.', '..MMMMM..'],
        'pleased': ['MMMMMMMMM', '.MtttttM.', '..MoooM..'],
        'annoyed': ['.MMMMMMM.', 'MtttttttM', '.MMMMMMM.'],
        'thinking':   ['....MMMM.', '.MMMooM..', '..MMMM...'],
        'happy':   ['MMMMMMMMM', 'MtttttttM', '.MoooooM.', '..MMMMM..'],
        'angry':   ['MMMMMMMMM', 'MtttttttM', 'MoooooooM', '.MMMMMMM.'],
    }
    put(c, 44, 54, talk[emotion] if frame == 'talk' else mouths[emotion], E)
    # усы
    put(c, 41, 50, ['...GGGGGGGG...', '.GggggggggggG.', 'GgG.GGGGGG.GgG'], E)

    c = outline(c, {0: 36, 1: 36, 2: 0, 3: 1, 13: 12, 14: 12, 15: 13, 16: 13, 26: 24, 27: 25, 40: 38,
                    41: 39, 42: 40, 43: 40, 44: 42, 45: 42, 25: 24})
    return c


def build_olga(emotion, frame):
    """Дарина Лукманова, 29, инженер-робототехник. Тёмное каре, очки, зелёная водолазка, гостевой пропуск."""
    c = np.full((H, W), T, int)
    cx, cy, rx, ry = 48, 42, 18, 23
    xs, ys = grid()
    HAIR = [24, 24, 18, 12]

    back = ellipse_mask(cx, cy + 1, rx + 5.5, ry + 4.5)
    back &= ~((ys > cy + ry - 2) & (np.abs(xs - cx) < 8))
    hb = shade_ellipsoid(cx - 5, cy - 8, rx + 8, ry + 8)
    paint(c, back, band(hb, [0.5], [24, 18]))

    body = poly_mask([(0, 96), (2, 87), (10, 80), (28, 75), (40, 72), (56, 72), (68, 75), (86, 80), (94, 87), (96, 96)])
    jl = shade_ellipsoid(40, 104, 58, 36)
    paint(c, body, band(jl, [0.3, 0.55, 0.9], [6, 6, 7, 7]))
    # вязка: вертикальные косы
    for x in range(8, 92, 6):
        for y in range(80, 96, 2):
            if body[y, x] and c[y, x] != 6:
                c[y, x] = 6
    neck = poly_mask([(41, 58), (55, 58), (55, 75), (48, 78), (41, 75)])
    paint(c, neck, 14)
    paint(c, neck & (ys < 66), 13)
    # горло водолазки
    collar = poly_mask([(39, 64), (57, 64), (58, 76), (48, 78), (38, 76)])
    paint(c, collar, 7)
    paint(c, collar & (xs < 44), 8)
    for y in (66, 69, 72):
        line(c, [(40, y), (56, y)], 6)
    # гостевой пропуск на шнурке
    line(c, [(41, 76), (44, 82), (46, 86)], 27)
    line(c, [(55, 76), (52, 82), (50, 86)], 27)
    put(c, 44, 86, ['111111', '144441', '133331', '144441', '111111'], {'1': 43, '4': 45, '3': 2})

    head = ellipse_mask(cx, cy, rx, ry, p=2.0, p_low=1.8)
    lam = shade_ellipsoid(cx - 3, cy - 4, rx + 3, ry + 2)
    paint(c, head, band(lam, [0.1, 0.36, 0.82], [13, 14, 15, 16]))
    paint(c, head & ellipse_mask(cx - 9, cy + 4, 2, 1.2), 16)

    # чёлка с пробором и боковые пряди
    part = cx + 6
    left = np.clip((part - xs) / (part - (cx - rx)), 0, 1.3)
    right = np.clip((xs - part) / (cx + rx - part), 0, 1.3)
    hairline = 27 + 10 * left ** 1.2 + 3 * right
    front = ellipse_mask(cx, cy - 1, rx + 2.5, ry + 2)
    fringe = front & (ys < hairline)
    cur_l = front & (xs < cx - rx + 3.5) & (ys < 64)
    cur_r = front & (xs > cx + rx - 3) & (ys < 64)
    hair = fringe | cur_l | cur_r
    hl = shade_ellipsoid(cx - 6, cy - 10, rx + 3, ry + 2)
    paint(c, hair, band(hl, [0.25, 0.55, 0.85], HAIR))
    line(c, [(part, 19), (part - 1, 22)], 24)
    for pts in ([(36, 24), (42, 22), (49, 20)], [(33, 30), (38, 26)], [(57, 21), (62, 25)]):
        line(c, pts, 19)

    E = {'w': 44, 'p': 37, 'L': 24, 's': 14, 'h': 16, 'k': 15, 'S': 13,
         'm': 26, 'M': 25, 'r': 27, 'R': 28, 't': 45, 'o': 24, 'f': 12, 'g': 45}
    eyL, eyR, ey = 37, 52, 40
    draw_eyes(c, E, eyL, eyR, ey, emotion, frame)
    c[ey, eyL - 1] = 24
    c[ey, eyR + 8] = 24

    brows = {
        'neutral': ([(0, 0), (4, -1), (7, 0)], [(0, 0), (3, -1), (7, 0)]),
        'pleased': ([(0, 0), (4, -2), (7, -1)], [(0, -1), (3, -2), (7, 0)]),
        'annoyed': ([(0, -2), (7, 1)], [(0, 1), (7, -2)]),
        'thinking':   ([(0, 1), (7, 1)], [(0, -1), (3, -3), (7, -2)]),
        'happy':   ([(0, -1), (4, -3), (7, -2)], [(0, -2), (3, -3), (7, -1)]),
        'angry':   ([(0, -3), (7, 2)], [(0, 2), (7, -3)]),
    }
    bl, br = brows[emotion]
    line(c, [(eyL + dx, ey - 4 + dy) for dx, dy in bl], 18)
    line(c, [(eyR + dx, ey - 4 + dy) for dx, dy in br], 18)

    # очки
    frame_rows = ['ffffffffff', 'f........f', 'f........f', 'f........f', 'f........f', '.ffffffff.']
    put(c, eyL - 1, ey - 1, frame_rows, E)
    put(c, eyR - 1, ey - 1, frame_rows, E)
    line(c, [(eyL + 9, ey), (eyR - 1, ey)], 12)
    c[ey, eyL] = 45
    c[ey, eyR] = 45

    put(c, 46, 44, ['h..', 'hs.', 'hs.', 'hs.', 'hhS', 'S.S'], E)
    if emotion in ('pleased', 'happy'):
        put(c, 36, 50, ['RR'], E)
        put(c, 59, 50, ['RR'], E)
    if emotion == 'angry':
        put(c, 35, 49, ['rrr'], E)
        put(c, 58, 49, ['rrr'], E)
        line(c, [(47, 33), (47, 35)], 13)

    mouths = {
        'neutral': ['.mmmmm.', 'MMMMMMM', '.rrRrr.', '..rrr..'],
        'pleased': ['m.....m', 'MMMMMMM', '.rrRrr.', '..rrr..'],
        'annoyed': ['.......', 'MMMMMMM', '.rrrrr.', '.......'],
        'thinking':   ['....mm.', '.MMMMM.', '.rrRr..', '.......'],
        'happy':   ['m.....m', 'MtttttM', '.MoooM.', '..rrr..'],
        'angry':   ['.......', 'MMMMMMM', 'M.rrr.M', '.......'],
    }
    talk = {
        'neutral': ['.mmmmm.', 'MoooooM', '.rrRrr.', '..rrr..'],
        'pleased': ['mmmmmmm', 'MtttttM', '.MoooM.', '..rrr..'],
        'annoyed': ['.mmmmm.', 'MtttttM', 'MoooooM', '.rrrrr.'],
        'thinking':   ['...mmm.', '.MMooM.', '.rrRr..', '.......'],
        'happy':   ['mmmmmmm', 'MtttttM', 'MoooooM', '.rrrrr.'],
        'angry':   ['mmmmmmm', 'MtttttM', 'MoooooM', '.MrrrM.'],
    }
    put(c, 45, 54, talk[emotion] if frame == 'talk' else mouths[emotion], E)

    c = outline(c, {19: 18, 20: 19, 21: 19, 22: 20, 13: 12, 14: 12, 15: 13, 16: 13, 24: 24, 18: 24,
                    12: 24, 44: 42, 45: 42, 1: 0})
    return c


CHARACTERS = {'rinat': build_rinat, 'olga': build_olga}


def main():
    out_dir = os.path.join(ROOT, 'public', 'assets', 'portraits')
    prev_dir = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(prev_dir, exist_ok=True)
    for cid, fn in CHARACTERS.items():
        sheet = Image.new('RGBA', (W * len(FRAMES), H * len(EMOTIONS)), (0, 0, 0, 0))
        for r, emo in enumerate(EMOTIONS):
            for k, fr in enumerate(FRAMES):
                sheet.paste(to_image(fn(emo, fr)), (k * W, r * H))
        sheet.save(os.path.join(out_dir, f'{cid}.png'))
        bg = Image.new('RGBA', sheet.size, RGB[41] + (255,))
        bg.alpha_composite(sheet)
        bg.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST).save(os.path.join(prev_dir, f'{cid}_x4.png'))
        print('ok', cid)


if __name__ == '__main__':
    main()
