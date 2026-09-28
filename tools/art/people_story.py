"""Лица кампании «Новенький»: сосед по общаге, парни с остановки, магазин у общаги, цех, общежитие.

Собираются тем же person() из people.py: череп по профилю, эмоции меняют брови, глаза и рот. Здесь только
одежда, причёски, головные уборы и мелочи. В пул своих дел (src/content/faces.ts) эти лица не входят.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/people_story.py — пишет только свои листы
в public/assets/portraits/ и превью tools/art/out/story_all.png.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from people import CX, SKIN_DARK, SKIN_LIGHT, SKIN_MID, Face, paint_cloth, person, shirt_collar  # noqa: E402
from pixel import ellipse_mask, grid, line, paint, poly_mask, put, shade_ellipsoid, band  # noqa: E402

# 3×5 для надписей на форме (как FONT в room3d.py, плюс Х)
GLYPH = {
    'О': ['###', '#.#', '#.#', '#.#', '###'], 'Х': ['#.#', '#.#', '.#.', '#.#', '#.#'],
    'Р': ['##.', '#.#', '##.', '#..', '#..'], 'А': ['.#.', '#.#', '###', '#.#', '#.#'],
    'Н': ['#.#', '#.#', '###', '#.#', '#.#'],
}


def text(c, x, y, s, color):
    for ch in s:
        put(c, x, y, GLYPH[ch], {'#': color})
        x += len(GLYPH[ch][0]) + 1


def hair_paint(c, mask, ramp, f, cuts=(0.25, 0.55, 0.85)):
    paint(c, mask, band(shade_ellipsoid(CX - 5, f.cy - 12, f.rx + 3, 22), list(cuts), ramp))


def squint(c, P, emotion, frame):
    """Прищур: верхнее веко опущено — глаз как у 'narrow', но без злости в бровях."""
    if frame == 'blink' or emotion not in ('neutral', 'thinking'):
        return
    ey, S = P['ey'], P['skin']
    eyL, eyR = CX - 12 + P.get('eye_in', 0), CX + 4 - P.get('eye_in', 0)
    for x0 in (eyL, eyR):
        line(c, [(x0, ey), (x0 + 7, ey)], S[2])
        line(c, [(x0, ey + 1), (x0 + 7, ey + 1)], P.get('lash', 12))


def eye_bags(c, P):
    ey, S = P['ey'], P['skin']
    eyL, eyR = CX - 12 + P.get('eye_in', 0), CX + 4 - P.get('eye_in', 0)
    line(c, [(eyL + 2, ey + 4), (eyL + 5, ey + 4)], S[1])
    line(c, [(eyR + 2, ey + 4), (eyR + 5, ey + 4)], S[0])


def hood_collar(c, ramp, cy=76, rx=18):
    hood = ellipse_mask(CX, cy, rx, 7) & ~ellipse_mask(CX, cy - 3, 11, 5)
    paint_cloth(c, hood, ramp, cuts=(0.3, 0.55, 0.85))
    line(c, [(38, cy), (58, cy)], ramp[0])


def shop_polo(c, m, badge=True):
    """Форма «Семёрочки»: зелёное поло, жёлтая полоса через грудь, бейдж."""
    xs, ys = grid()
    paint_cloth(c, m, [7, 8, 8, 9])
    stripe = m & (np.abs(ys - 84) < 1.0)
    paint(c, stripe, 22)
    paint(c, stripe & (xs > 60), 21)
    # планка с пуговицами
    placket = poly_mask([(45, 72), (51, 72), (51, 82), (45, 82)])
    paint(c, placket, 8)
    line(c, [(45, 72), (45, 82)], 7)
    c[76, 48] = 44
    c[80, 48] = 43
    if badge:
        put(c, 55, 88, ['wwwwwww', 'wgggggw', 'wwwwwww', 'wkkkkkw', 'wwwwwww'],
            {'w': 45, 'g': 8, 'k': 41})


def polo_collar(c, nw, nb):
    left = [(CX - nw - 3, nb - 4), (CX - nw, nb - 5), (CX - 3, nb), (CX - 3, nb + 3), (CX - nw - 3, nb)]
    right = [(2 * CX - x - 1, y) for x, y in left]
    paint(c, poly_mask(left), 9)
    paint(c, poly_mask(right), 8)
    line(c, [(CX - nw - 3, nb), (CX - 3, nb + 3)], 22)
    line(c, [(CX + nw + 2, nb), (CX + 2, nb + 3)], 21)


def workwear(c, m):
    """Синяя спецовка: молния, накладной карман, светоотражающая полоса по плечам."""
    xs, ys = grid()
    paint_cloth(c, m, [1, 2, 2, 3])
    line(c, [(48, 74), (48, 95)], 1)
    line(c, [(49, 74), (49, 95)], 3)
    pocket = poly_mask([(56, 82), (66, 82), (66, 91), (56, 91)])
    paint(c, pocket, 2)
    line(c, [(56, 82), (66, 82)], 3)
    line(c, [(56, 91), (66, 91)], 1)
    line(c, [(58, 84), (58, 86)], 45)  # ручка в кармане
    c[84, 59] = 27
    for y in (88, 89):
        paint(c, m & (np.abs(ys - y - 0.5) < 0.6) & ((xs < 42) | (xs > 69)), 29 if y == 88 else 28)


def work_collar(c):
    put(c, 37, 70, ['aaa...', 'aaaaa.', '.aaaaa', '..aaaa', '...aa.'], {'a': 3})
    put(c, 53, 70, ['...aaa', '.aaaaa', 'aaaaa.', 'aaaa..', '.aa...'], {'a': 2})


def helmet(c, f, ey, ramp, rim):
    """Каска: купол выше лба, козырёк, ребро по центру; тень под козырьком ложится на лоб."""
    xs, ys = grid()
    dome = ellipse_mask(CX, ey - 10, f.rx + 3.5, 20) & (ys < ey - 8)
    paint(c, dome, band(shade_ellipsoid(CX - 6, ey - 20, f.rx + 4, 16), [0.25, 0.55, 0.85], ramp))
    paint(c, dome & (np.abs(xs - CX) < 1.5) & (ys > ey - 27), ramp[3])
    line(c, [(CX + 1, ey - 27), (CX + 1, ey - 10)], ramp[1])
    brim = poly_mask([(CX - f.rx - 5, ey - 11), (CX + f.rx + 5, ey - 11), (CX + f.rx + 5, ey - 9), (CX - f.rx - 5, ey - 9)])
    paint(c, brim, ramp[2])
    line(c, [(CX - f.rx - 5, ey - 9), (CX + f.rx + 5, ey - 9)], rim)
    line(c, [(CX - f.rx + 1, ey - 8), (CX + f.rx - 1, ey - 8)], 13)


# ---------- главные собеседники ----------

def sosed():
    """Тимур, 19: скуластый, тёмные взъерошенные волосы, синее худи, наушники на шее."""
    f = Face(top=18, cy=39, rx=18, jaw_y=56, jaw_w=14, chin_y=64, chin_w=5, jaw_p=1.5, cheek=2.8)
    HAIR = [37, 38, 39, 40]

    def back(c, P):
        paint(c, ellipse_mask(CX, f.cy - 5, f.rx + 4, 20), 38)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [1, 2, 2, 3])
        line(c, [(43, 77), (42, 89)], 44)
        line(c, [(53, 77), (54, 89)], 43)
        c[90, 42] = 42
        c[90, 54] = 42
        line(c, [(31, 93), (65, 93)], 1)

    def collar(c, P):
        hood_collar(c, [1, 2, 3, 3])
        # наушники на шее: оголовье уходит за шею, белые чашки лежат на ключицах
        line(c, [(41, 64), (37, 70)], 39)
        line(c, [(42, 64), (38, 70)], 41)
        line(c, [(55, 64), (59, 70)], 38)
        line(c, [(54, 64), (58, 70)], 40)
        cup_l = ['...kkkk...', '.kkWWWWkk.', 'kWWWwwWWWk', 'kWwddddwWk', 'kWdggggdWk', 'kWdggggdWk', 'kWwddddwWk',
                 '.kkwwwwkk.', '...kkkk...']
        put(c, 28, 69, cup_l, {'k': 39, 'W': 45, 'w': 44, 'd': 38, 'g': 40})
        put(c, 58, 69, cup_l, {'k': 38, 'W': 43, 'w': 42, 'd': 37, 'g': 39})
        c[71, 64] = 28  # огонёк на чашке

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 4, f.rx + 3.5, 20)
        u = (xs - CX) / f.rx
        # взъерошенная чёлка: пряди разной длины, торчат в разные стороны
        tuft = np.array([0, 3, 5, 2, 0, 4, 6, 3, 1, 0, 4, 2, 5, 3, 0, 2])[(xs.astype(int) // 2) % 16]
        hl = 23 + 1.5 * np.abs(u) + tuft + 2 * (u < -0.4)
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2) & (ys < 37)
        h = top | sides
        hair_paint(c, h, HAIR, f)
        # вихры торчат над макушкой
        put(c, 36, 13, ['..h....h.....', '.hh..hhh..h..', 'hhhhhhhhhhhh.'], {'h': 38})
        put(c, 52, 14, ['.h...h', 'hhh.hh', 'hhhhhh'], {'h': 38})
        for pts in ([(39, 19), (45, 17)], [(50, 18), (56, 20)], [(35, 24), (38, 20)]):
            line(c, pts, 40)
        for pts in ([(42, 22), (40, 28)], [(48, 22), (47, 27)], [(55, 23), (57, 28)]):
            line(c, pts, 37)

    return dict(face=f, skin=SKIN_MID, ey=39, age=19, female=False, neck=8, nose='small', shoulders=38, drop=14,
                brow=(37, 2), pupil=18, lash=37, cuts=[0.08, 0.32, 0.92], body=body, collar=collar, back=back,
                hair=hair, blush=28, eye_in=1)


def gopnik():
    """Серый, 21: кепка-восьмиклинка, чёрный спортивный костюм с белыми полосками по плечам, прищур, пушок."""
    f = Face(top=18, cy=39, rx=17, jaw_y=55, jaw_w=14, chin_y=64, chin_w=6, jaw_p=2.0, cheek=2.0)
    CAP = [38, 39, 40, 41]

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [36, 37, 38, 39])
        # две белые полоски от ворота по плечам и вниз по рукавам
        for d, col in ((0, 45), (3, 44)):
            line(c, [(38 - d, 72 + d // 2), (24 - d, 78), (13 - d, 84), (9 - d, 95)], col)
            line(c, [(58 + d, 72 + d // 2), (72 + d, 78), (83 + d, 84), (87 + d, 95)], 44 if col == 45 else 43)
        # молния
        line(c, [(48, 78), (48, 95)], 41)
        put(c, 47, 80, ['k', 'K'], {'k': 43, 'K': 42})

    def collar(c, P):
        # стойка олимпийки, чуть расстёгнута
        put(c, 37, 69, ['aaaa......', 'aaaaaa....', '.aaaaaaa..', '...aaaaaa.', '.....aaa..'], {'a': 38})
        put(c, 50, 69, ['......aaaa', '....aaaaaa', '..aaaaaaa.', '.aaaaaa...', '..aaa.....'], {'a': 37})
        line(c, [(37, 69), (46, 73)], 45)
        line(c, [(59, 69), (50, 73)], 44)

    def hair(c, P, emotion):
        xs, ys = grid()
        ey = P['ey']
        # коротко стриженные виски из-под кепки
        face = f.mask()
        for y in range(ey - 8, ey + 1):
            w = f.hw(y + 0.5)
            for x, col in ((int(CX - w), 38), (int(CX - w) + 1, 39), (int(CX + w) - 1, 38), (int(CX + w) - 2, 38)):
                if face[y, x] and (y + x) % 3:
                    c[y, x] = col
        # восьмиклинка: пышный плоский купол чуть набок, клинья к пуговке, короткий козырёк
        dome = ellipse_mask(CX + 2, ey - 15, f.rx + 6, 9.5) & (ys < ey - 8)
        paint(c, dome, band(shade_ellipsoid(CX - 6, ey - 22, f.rx + 7, 11), [0.25, 0.5, 0.8], CAP))
        top = (CX + 2, ey - 24)
        for x1 in (CX - 17, CX - 7, CX + 11, CX + 21):
            line(c, [top, (x1, ey - 10)], CAP[0])
        put(c, top[0] - 1, top[1], ['bb'], {'b': CAP[3]})
        # ёлочка по ткани
        for y in range(ey - 22, ey - 10, 2):
            for x in range(CX - 20 + (y % 4), CX + 26, 4):
                if dome[y, x] and c[y, x] in CAP[1:]:
                    c[y, x] = CAP[max(CAP.index(c[y, x]) - 1, 0)]
        # околыш темнее купола, козырёк выступает вперёд и вниз, по кромке блик
        paint(c, dome & (ys >= ey - 10), CAP[0])
        visor = poly_mask([(CX - 12, ey - 11), (CX + 15, ey - 11), (CX + 12, ey - 7), (CX + 3, ey - 6), (CX - 8, ey - 7)])
        paint(c, visor, 37)
        paint(c, visor & (xs < CX + 2) & (ys < ey - 8), 38)
        line(c, [(CX - 11, ey - 11), (CX + 13, ey - 11)], CAP[3])
        line(c, [(CX - 7, ey - 7), (CX + 3, ey - 6)], 36)
        # тень козырька на лбу
        paint(c, face & (ys > ey - 8) & (ys < ey - 6), P['skin'][1])

    def moustache(c, P, emotion):
        # пушок над губой: редкие тёмные точки
        ey = P['ey']
        for x in range(CX - 4, CX + 5, 2):
            c[ey + 14, x] = 14
        for x in (CX - 3, CX + 1, CX + 3):
            c[ey + 13, x] = 14

    return dict(face=f, skin=SKIN_LIGHT, ey=39, age=21, female=False, neck=9, nose='straight', shoulders=40, drop=13,
             brow=(19, 1), pupil=18, lash=19, cuts=[0.08, 0.3, 0.92], body=body, collar=collar, hair=hair,
             moustache=moustache, blush=28, mouth_y=39 + 16, squint=True)


def admin():
    """Лариса Петровна, 47: рыжее крашеное каре, очки подняты на лоб, усталые глаза, форма «Семёрочки»."""
    f = Face(top=19, cy=40, rx=17, jaw_y=57, jaw_w=13, chin_y=65, chin_w=5, jaw_p=1.5, cheek=2.0)
    HAIR = [19, 20, 21, 22]

    def back(c, P):
        xs, ys = grid()
        m = ellipse_mask(CX, f.cy + 1, f.rx + 5.5, 26) & (ys < 64)
        m &= ~((ys > f.chin_y - 6) & (np.abs(xs - CX) < 10))
        paint(c, m, band(shade_ellipsoid(CX - 5, f.cy - 8, f.rx + 8, 26), [0.5], [19, 20]))

    def body(c, P, m):
        shop_polo(c, m)

    def collar(c, P):
        polo_collar(c, 7, 74)

    def hair(c, P, emotion):
        xs, ys = grid()
        part = CX - 4
        front = ellipse_mask(CX, f.cy, f.rx + 3, 24)
        left = np.clip((part - xs) / (part - (CX - f.rx)), 0, 1.3)
        right = np.clip((xs - part) / (CX + f.rx - part), 0, 1.3)
        hl = 25 + 5 * left ** 1.3 + 7 * right ** 1.2
        fringe = front & (ys < hl)
        cur_l = front & (xs < CX - f.rx + 3.5) & (ys < 62)
        cur_r = front & (xs > CX + f.rx - 3) & (ys < 62)
        h = fringe | cur_l | cur_r
        hair_paint(c, h, HAIR, f)
        # отросшие тёмные корни у пробора — краска не первой свежести
        line(c, [(part, 19), (part, 22)], 18)
        c[20, part + 1] = 19
        for pts in ([(36, 25), (41, 22), (46, 21)], [(31, 32), (34, 27)], [(52, 22), (60, 27)]):
            line(c, pts, 22)
        for pts in ([(30, 44), (30, 56)], [(64, 42), (64, 56)], [(33, 58), (36, 61)]):
            line(c, pts, 20)
        # кончики каре подвёрнуты внутрь
        line(c, [(28, 61), (33, 62)], 19)
        line(c, [(63, 62), (68, 61)], 19)

    def extra(c, P, emotion):
        # очки подняты на лоб
        rows = ['.ffffff.', 'f......f', '.ffffff.']
        put(c, 37, 22, rows, {'f': 26})
        put(c, 51, 22, rows, {'f': 26})
        line(c, [(45, 23), (50, 23)], 26)
        c[23, 38] = 45
        c[23, 52] = 45
        eye_bags(c, P)
        # серьги-капли
        put(c, CX - f.rx - 2, P['ey'] + 9, ['g', 'G'], {'g': 22, 'G': 20})

    return dict(face=f, skin=SKIN_LIGHT, ey=40, age=47, female=True, neck=7, nose='small', shoulders=37, drop=14,
                brow=(20, 1), pupil=20, lash=19, body=body, collar=collar, back=back, hair=hair, extra=extra,
                lips={'m': 26, 'M': 25, 'r': 27, 'R': 28}, blush=28, mouth_y=40 + 14, cuts=[0.08, 0.35, 0.95])


# ---------- массовка ----------

def pacan():
    """Кирюха, 18: капюшон на голове, худой, лопоухий, серая спортивная кофта."""
    f = Face(top=19, cy=40, rx=15, jaw_y=56, jaw_w=11, chin_y=64, chin_w=4, jaw_p=1.4, cheek=1.6)
    HOOD = [40, 41, 42, 43]

    def back(c, P):
        xs, ys = grid()
        # капюшон: арка над головой, бока падают на плечи; внутри тень
        hood = ellipse_mask(CX, f.cy - 3, f.rx + 7, 23) & (ys < f.cy + 6)
        hood |= poly_mask([(CX - f.rx - 7, f.cy + 2), (CX - f.rx - 12, 78), (CX + f.rx + 12, 78), (CX + f.rx + 7, f.cy + 2)])
        paint(c, hood, band(shade_ellipsoid(CX - 8, f.cy - 6, f.rx + 14, 34), [0.2, 0.45, 0.8], HOOD))
        paint(c, ellipse_mask(CX, f.cy + 3, f.rx + 3, 24) & (ys < f.cy + 16), 39)
        paint(c, ellipse_mask(CX + 1, f.cy + 4, f.rx + 2, 23) & (ys < f.cy + 14) & (xs > CX), 38)

    def body(c, P, m):
        paint_cloth(c, m, HOOD)
        line(c, [(48, 74), (48, 95)], 40)
        line(c, [(30, 92), (66, 92)], 40)

    def collar(c, P):
        # шнурки капюшона свисают из-под кромки
        line(c, [(40, 58), (41, 70), (42, 84)], 44)
        line(c, [(56, 58), (55, 70), (54, 84)], 43)
        c[85, 42] = 42
        c[85, 54] = 42

    def hair(c, P, emotion):
        xs, ys = grid()
        # кромка капюшона вокруг лица и чёлка из-под неё
        rim = ellipse_mask(CX, f.cy + 2, f.rx + 5, 25) & ~ellipse_mask(CX, f.cy + 3, f.rx + 3, 24) & (ys < f.cy + 16)
        paint(c, rim, band(shade_ellipsoid(CX - 6, f.cy - 14, f.rx + 6, 22), [0.3, 0.6, 0.85], HOOD))
        fringe = f.mask() & (ys < 25 + 2.5 * np.abs(np.sin(xs * 0.9))) & (ys > 18)
        paint(c, fringe, 19)
        paint(c, fringe & (xs < 44), 20)

    def extra(c, P, emotion):
        # лопоухие: уши торчат из-под капюшона
        ey, S = P['ey'], P['skin']
        for side in (-1, 1):
            ex = CX + side * (f.rx + 3)
            ear = ellipse_mask(ex, ey + 3.5, 3.2, 5.5)
            paint(c, ear, S[2] if side < 0 else S[1])
            line(c, [(int(ex), ey + 1), (int(ex), ey + 6)], S[0])
            c[ey + 1, int(ex + side * 2)] = 28

    return dict(face=f, skin=SKIN_LIGHT, ey=40, age=18, female=False, neck=7, nose='button', shoulders=35, drop=15,
                brow=(20, 1), pupil=2, lash=20, body=body, collar=collar, back=back, hair=hair, extra=extra,
                blush=28, eye_in=1)


def babka():
    """Бабушка на остановке, ~75: цветастый платок, тёмное пальто, морщины, добрые глаза."""
    f = Face(top=20, cy=41, rx=16, jaw_y=57, jaw_w=12, chin_y=64, chin_w=5, jaw_p=1.4, cheek=2.0)
    SCARF = [26, 27, 27, 28]

    def back(c, P):
        m = ellipse_mask(CX, f.cy + 2, f.rx + 6, 27) & (grid()[1] < 76)
        paint(c, m, band(shade_ellipsoid(CX - 6, f.cy - 10, f.rx + 8, 26), [0.3, 0.6, 0.85], [25, 26, 27, 27]))

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [18, 19, 19, 20])
        # пуговицы и воротник пальто
        for y in (84, 91):
            c[y, 47] = 22
        line(c, [(48, 78), (48, 95)], 18)

    def collar(c, P):
        # узел платка под подбородком и концы на пальто
        put(c, 42, 70, ['.RRRRRRRRRR.', 'RrrrryrrrrrR', '.RrrrrrrrrR.', '..RrrRRrrR..', '..Rrr..rrR..',
                        '..Rr....rR..', '...R.....R..'], {'R': 26, 'r': 27, 'y': 22})

    def hair(c, P, emotion):
        xs, ys = grid()
        ey = P['ey']
        # платок: закрывает лоб до бровей и обтягивает щёки до узла
        outer = ellipse_mask(CX, f.cy + 2, f.rx + 5, 26)
        inner = ellipse_mask(CX, f.cy + 6, f.rx - 1.5, 20)
        s = outer & ~(inner & (ys > ey - 9)) & (ys < 72)
        s &= ~((ys > f.chin_y - 2) & (np.abs(xs - CX) < 8))
        paint(c, s, band(shade_ellipsoid(CX - 6, f.cy - 10, f.rx + 6, 24), [0.3, 0.55, 0.85], SCARF))
        # седая прядь из-под платка
        line(c, [(CX - 10, ey - 9), (CX - 4, ey - 10)], 44)
        line(c, [(CX + 3, ey - 10), (CX + 8, ey - 9)], 43)
        # цветы: жёлтые и белые, с зелёным листиком
        for x, y in ((36, 22), (50, 18), (60, 26), (31, 36), (65, 42), (29, 52), (63, 58), (42, 17), (57, 16)):
            if s[y, x]:
                put(c, x - 1, y - 1, ['.y.', 'yoy', '.y.'], {'y': 22, 'o': 28})
                if s[y + 1, x + 2]:
                    c[y + 1, x + 2] = 9
        for x, y in ((44, 24), (33, 45), (62, 34), (54, 21)):
            if s[y, x]:
                put(c, x, y, ['w.', '.w'], {'w': 44})
        # край у лица — кайма
        edge = s & ~ellipse_mask(CX, f.cy + 2, f.rx + 1.8, 23)
        paint(c, s & ellipse_mask(CX, f.cy + 5, f.rx + 1, 21) & ~edge, 25)

    def extra(c, P, emotion):
        eye_bags(c, P)
        # лучики у глаз
        ey = P['ey']
        c[ey + 3, CX - 14] = 13
        c[ey + 3, CX + 13] = 13

    return dict(face=f, skin=SKIN_LIGHT, ey=41, age=75, female=True, neck=7, nose='button', shoulders=38, drop=12,
                brow=(42, 1), pupil=2, lash=13, body=body, collar=collar, back=back, hair=hair, extra=extra,
                lips={'m': 14, 'M': 13, 'r': 14, 'R': 15}, blush=28, mouth_y=41 + 14, forehead=False)


def cashier():
    """Диляра, 23: форма «Семёрочки», тёмный пучок, серёжки-кольца."""
    f = Face(top=19, cy=40, rx=17, jaw_y=56, jaw_w=12, chin_y=64, chin_w=4, jaw_p=1.3, cheek=2.2)
    HAIR = [36, 37, 38, 39]

    def back(c, P):
        paint(c, ellipse_mask(CX, 13, 7.5, 6), 38)
        paint(c, ellipse_mask(CX - 1, 12, 5, 3.5), 39)
        line(c, [(CX - 6, 17), (CX + 6, 17)], 22)  # резинка
        paint(c, ellipse_mask(CX, f.cy, f.rx + 3, 22), 37)

    def body(c, P, m):
        shop_polo(c, m)

    def collar(c, P):
        polo_collar(c, 7, 73)

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 2.5, 22.5)
        u = (xs - CX) / f.rx
        hl = 24 + 5 * u ** 2 + 2 * (u > 0)
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2) & (ys < P['ey'] + 2)
        hair_paint(c, top | sides, HAIR, f)
        for pts in ([(38, 21), (46, 19)], [(33, 28), (37, 23)], [(52, 20), (60, 25)]):
            line(c, pts, 40)
        # выбившаяся прядь у виска
        line(c, [(31, 36), (30, 46), (31, 50)], 37)

    def extra(c, P, emotion):
        ey = P['ey']
        for side, x in ((-1, CX - f.rx - 3), (1, CX + f.rx + 1)):
            put(c, x, ey + 9, ['.g.', 'g.g', '.g.'], {'g': 22 if side < 0 else 21})

    return dict(face=f, skin=SKIN_MID, ey=40, age=23, female=True, neck=7, nose='small', shoulders=36, drop=14,
                brow=(37, 1), pupil=18, lash=37, body=body, collar=collar, back=back, hair=hair, extra=extra,
                lips={'m': 26, 'M': 25, 'r': 28, 'R': 29}, blush=35, mouth_y=40 + 14, cuts=[0.08, 0.35, 0.95],
                eye_in=1)


def guard():
    """Охранник, ~55: чёрная форма с нашивкой «ОХРАНА», густые усы, залысины."""
    f = Face(top=17, cy=38, rx=19, jaw_y=56, jaw_w=16, chin_y=65, chin_w=8, jaw_p=2.2, cheek=2.6)
    HAIR = [39, 40, 41, 42]

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [36, 37, 38, 39])
        # погоны
        paint(c, poly_mask([(20, 77), (33, 74), (34, 76), (21, 80)]), 39)
        paint(c, poly_mask([(63, 74), (76, 77), (75, 80), (62, 76)]), 38)
        # нашивка на груди
        put(c, 55, 82, ['kkkkkkkkkkkkkkkkkkkkkkkkk'] + ['k.......................k'] * 5 + ['kkkkkkkkkkkkkkkkkkkkkkkkk'],
            {'k': 22, '.': 37})
        text(c, 56, 83, 'ОХРАНА', 44)
        # пуговицы
        for y in (82, 90):
            c[y, 48] = 42

    def collar(c, P):
        shirt_collar(c, 11, 74, light=38, dark=37, edge=36)

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 1.5, 22)
        # лысеет: подкова над ушами и на затылке, сверху редкие зачёсанные пряди
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys > 30) & (ys < 43)
        paint(c, sides, 40)
        paint(c, sides & ((xs.astype(int) * 3 + ys.astype(int) * 2) % 5 == 0), 42)
        paint(c, sides & ((xs.astype(int) * 3 + ys.astype(int) * 2) % 5 == 2), 39)
        for pts in ([(33, 29), (33, 38)], [(62, 28), (63, 38)]):
            line(c, pts, 42)
        for pts in ([(40, 21), (47, 19), (53, 20)], [(43, 23), (50, 22)]):
            line(c, pts, 14)
        put(c, 36, 24, ['..hhh', '.h...', 'h....'], {'h': 16})

    def moustache(c, P, emotion):
        ey = P['ey']
        put(c, CX - 7, ey + 12, ['..GGGGGGGGGG..', '.GgggggggggggG', 'GggGGGGGGGGgG.', 'Gg.........gG.', 'G...........G.'],
            {'G': 18, 'g': 41})

    return dict(face=f, skin=SKIN_MID, ey=38, age=55, female=False, neck=11, nose='broad', shoulders=42,
                brow=(19, 2), pupil=18, body=body, collar=collar, hair=hair, moustache=moustache, blush=28,
                mouth_y=38 + 16)


def worker():
    """Андрей, 35: белая каска, синяя спецовка, короткая борода."""
    f = Face(top=17, cy=38, rx=18, jaw_y=56, jaw_w=16, chin_y=64, chin_w=7, jaw_p=2.2, cheek=2.3)

    def body(c, P, m):
        workwear(c, m)

    def collar(c, P):
        work_collar(c)

    def hair(c, P, emotion):
        xs, ys = grid()
        ey = P['ey']
        sides = ellipse_mask(CX, f.cy, f.rx + 1.2, 21) & (np.abs(xs - CX) > f.rx - 3) & (ys < ey + 2) & (ys > ey - 10)
        paint(c, sides, 19)
        helmet(c, f, ey, [42, 43, 44, 45], 41)

    def beard(c, P, emotion):
        xs, ys = grid()
        face = f.mask()
        ey = P['ey']
        b = face & (ys > ey + 11) & ((np.abs(xs - CX) > f.hw(ys) - 3) | (ys > ey + 20))
        b &= ~((ys < ey + 20) & (np.abs(xs - CX) < 6))
        paint(c, b, band(shade_ellipsoid(CX - 3, 56, 18, 10), [0.35, 0.65], [18, 19, 20]))

    def moustache(c, P, emotion):
        ey = P['ey']
        put(c, CX - 5, ey + 13, ['.gggggggg.', 'g........g'], {'g': 19})

    return dict(face=f, skin=SKIN_MID, ey=38, age=35, female=False, neck=10, nose='straight', shoulders=41,
                brow=(18, 2), pupil=2, body=body, collar=collar, hair=hair, beard=beard, moustache=moustache,
                blush=28, mouth_y=38 + 16)


def workerf():
    """Оксана, 42: оранжевая каска, спецовка, серьёзная; русые волосы убраны."""
    f = Face(top=19, cy=40, rx=17, jaw_y=57, jaw_w=13, chin_y=65, chin_w=5, jaw_p=1.6, cheek=2.0)

    def back(c, P):
        # хвост собран на затылке, видно по бокам шеи
        paint(c, ellipse_mask(CX, f.cy + 6, f.rx + 3, 20) & (grid()[1] > 36), 20)

    def body(c, P, m):
        workwear(c, m)

    def collar(c, P):
        work_collar(c)

    def hair(c, P, emotion):
        xs, ys = grid()
        ey = P['ey']
        sides = ellipse_mask(CX, f.cy, f.rx + 2, 22) & (np.abs(xs - CX) > f.rx - 3) & (ys < ey + 4) & (ys > ey - 11)
        paint(c, sides, 21)
        paint(c, sides & (xs > CX), 20)
        helmet(c, f, ey, [27, 28, 29, 29], 26)
        put(c, CX - 4, ey - 17, ['wwwwwwwww'], {'w': 45})  # наклейка-полоса на каске

    def extra(c, P, emotion):
        # серьёзная: складка между бровей всегда
        ey, S = P['ey'], P['skin']
        line(c, [(CX - 1, ey - 5), (CX - 1, ey - 3)], S[1])

    return dict(face=f, skin=SKIN_LIGHT, ey=40, age=42, female=True, neck=7, nose='straight', shoulders=38, drop=13,
                brow=(20, 2), pupil=2, lash=19, body=body, collar=collar, back=back, hair=hair, extra=extra,
                lips={'m': 14, 'M': 13, 'r': 14, 'R': 15}, blush=28, mouth_y=40 + 14, cuts=[0.08, 0.32, 0.93])


def student():
    """Аня, 20: каштановый хвост, большой вязаный свитер."""
    f = Face(top=19, cy=40, rx=16, jaw_y=56, jaw_w=12, chin_y=64, chin_w=4, jaw_p=1.3, cheek=1.8)
    HAIR = [18, 19, 20, 21]

    def back(c, P):
        # хвост перекинут через правое плечо
        paint(c, poly_mask([(60, 30), (68, 34), (70, 56), (66, 80), (61, 84), (62, 64)]), 19)
        line(c, [(66, 40), (67, 64)], 20)
        line(c, [(62, 30), (66, 26)], 22)  # резинка
        paint(c, ellipse_mask(CX, f.cy, f.rx + 3, 22), 18)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [41, 42, 43, 44], cuts=(0.3, 0.55, 0.9))
        # вязка: косы
        for x in range(8, 92, 7):
            for y in range(80, 96, 2):
                if m[y, x]:
                    c[y, x] = 42 if c[y, x] != 41 else 40
                    if m[y + 1, x + 1] if y + 1 < 96 else False:
                        c[y + 1, x + 1] = 43 if c[y + 1, x + 1] != 41 else 42
        # хвост лежит поверх свитера
        paint(c, poly_mask([(61, 70), (66, 72), (65, 82), (61, 86), (60, 78)]), 20)
        line(c, [(62, 74), (62, 84)], 21)

    def collar(c, P):
        # широкое горло свитера
        coll = ellipse_mask(CX, 75, 15, 5) & ~ellipse_mask(CX, 72, 9, 4)
        paint(c, coll, 43)
        paint(c, coll & (grid()[0] > CX + 4), 42)
        for x in range(36, 62, 2):
            if coll[76, x]:
                c[76, x] = 41

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 2.5, 22.5)
        u = (xs - CX) / f.rx
        hl = 25 + 3 * np.abs(u) + 5 * np.clip(-u, 0, 1) ** 1.5
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2) & (ys < P['ey'] + 3)
        hair_paint(c, top | sides, HAIR, f)
        for pts in ([(37, 22), (45, 19)], [(33, 29), (37, 23)], [(51, 20), (58, 24)]):
            line(c, pts, 21)
        line(c, [(33, 33), (32, 47)], 19)  # прядь у лица

    def extra(c, P, emotion):
        ey = P['ey']
        c[ey + 10, CX - f.rx - 1] = 44
        # веснушки
        for x, y in ((38, ey + 7), (40, ey + 8), (56, ey + 7), (58, ey + 8), (39, ey + 9)):
            c[y, x] = 15

    return dict(face=f, skin=SKIN_LIGHT, ey=40, age=20, female=True, neck=7, nose='button', shoulders=38, drop=14,
                brow=(19, 1), pupil=8, lash=19, body=body, collar=collar, back=back, hair=hair, extra=extra,
                lips={'m': 14, 'M': 26, 'r': 28, 'R': 29}, blush=35, mouth_y=40 + 14, cuts=[0.08, 0.35, 0.95],
                eye_in=1)


def vahter():
    """Галина Ивановна, 63: химическая завивка цвета «баклажан», вязаная кофта, очки."""
    f = Face(top=20, cy=41, rx=18, jaw_y=57, jaw_w=15, chin_y=65, chin_w=7, jaw_p=1.8, cheek=2.6)
    HAIR = [25, 26, 27, 27]

    def curls(c, P, mask):
        hair_paint(c, mask, HAIR, f)
        # завитки: мелкие светлые дуги с тенью, реже в тени
        for y in range(12, 60, 4):
            for x in range(20 + (y % 8) // 2 * 3, 78, 5):
                if mask[y, x] and mask[y + 1, x + 1]:
                    put(c, x - 1, y, ['h.', '.s'], {'h': 28 if x < CX + 4 else 27, 's': 25})

    def back(c, P):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 4, f.rx + 6, 23) & (ys < 58)
        # пышный контур из мелких колечек
        for t in np.linspace(np.pi * 0.95, np.pi * 2.05, 16):
            vol |= ellipse_mask(CX + (f.rx + 6) * np.cos(t), f.cy - 4 + 23 * np.sin(t), 3.8, 3.8) & (ys < 58)
        for y in (44, 50, 55):
            vol |= ellipse_mask(CX - f.rx - 5, y, 3.8, 3.5) | ellipse_mask(CX + f.rx + 5, y, 3.8, 3.5)
        curls(c, P, vol)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [18, 19, 20, 20])
        blouse = poly_mask([(40, 71), (56, 71), (54, 84), (48, 96), (42, 84)])
        paint(c, blouse, 44)
        paint(c, blouse & (xs > 48), 43)
        line(c, [(40, 72), (43, 84), (47, 95)], 19)
        line(c, [(56, 72), (53, 84), (49, 95)], 18)
        for x in range(10, 90, 4):
            for y in range(82, 96, 3):
                if m[y, x] and not blouse[y, x]:
                    c[y, x] = 21 if x < CX else 19
        for y in (86, 92):
            c[y, 42] = 23
            c[y, 54] = 22

    def collar(c, P):
        # брошка у ворота
        put(c, 46, 74, ['.g.', 'gGg', '.g.'], {'g': 22, 'G': 27})

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 3, f.rx + 4, 23)
        u = (xs - CX) / f.rx
        hl = 26 + 2 * np.abs(u) + 1.5 * np.sin(xs * 1.6)
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2) & (ys < P['ey'] + 4)
        curls(c, P, top | sides)

    def extra(c, P, emotion):
        ey = P['ey']
        # цепочка для очков
        for x, y in ((CX - f.rx - 1, ey + 3), (CX - f.rx - 1, ey + 7), (CX - f.rx, ey + 11)):
            c[y, x] = 22
        put(c, CX + f.rx - 1, ey + 8, ['g', 'G'], {'g': 22, 'G': 20})

    return dict(face=f, skin=SKIN_LIGHT, ey=41, age=63, female=True, neck=8, nose='button', shoulders=39, drop=13,
                brow=(25, 1), pupil=2, lash=25, body=body, back=back, collar=collar, hair=hair, extra=extra,
                glasses=(37, 'half'), lips={'m': 26, 'M': 25, 'r': 33, 'R': 34}, blush=35, mouth_y=41 + 14,
                forehead=True)


def palych():
    """Палыч, 56, бригадир: седой ёжик с залысинами, густые седые усы, добрый прищур, клетчатая рубашка
    под оранжевым сигнальным жилетом, карандаш за ухом, очки на шнурке."""
    f = Face(top=17, cy=38, rx=19, jaw_y=56, jaw_w=16, chin_y=65, chin_w=8, jaw_p=2.4, cheek=2.8)
    HAIR = [41, 42, 43, 44]

    def body(c, P, m):
        xs, ys = grid()
        # рубашка в зелёно-коричневую клетку
        paint_cloth(c, m, [6, 7, 7, 8])
        for x in range(1, 96, 6):
            paint(c, m & (np.abs(xs - x - 0.5) < 1.0), 19)
        for y in range(76, 96, 6):
            paint(c, m & (np.abs(ys - y - 0.5) < 1.0), 19)
        paint(c, m & (np.abs(xs % 6 - 1.5) < 1.0) & (np.abs(ys % 6 - 4.5) < 1.0), 18)
        # жилет: две вертикальные светоотражающие полосы по груди и одна поперёк
        vest = m & ~poly_mask([(37, 70), (59, 70), (53, 96), (43, 96)])
        paint_cloth(c, vest, [27, 28, 28, 29], cuts=(0.25, 0.55, 0.92))
        for x0 in (32, 64):
            band_v = vest & (np.abs(xs - x0) < 1.6) & (ys > 74)
            paint(c, band_v, 44)
            paint(c, band_v & (xs > x0), 43)
        belt = vest & (np.abs(ys - 90.5) < 1.1)
        paint(c, belt, 44)
        paint(c, belt & (xs > 62), 43)
        line(c, [(38, 71), (44, 96)], 26)
        line(c, [(58, 71), (52, 96)], 26)
        # очки на шнурке висят на груди
        line(c, [(40, 72), (41, 80)], 37)
        line(c, [(56, 72), (55, 80)], 37)
        put(c, 39, 80, ['.ffff..ffff.', 'f....ff....f', 'f.h..ff.h..f', '.ffff..ffff.'], {'f': 37, 'h': 44})

    def collar(c, P):
        put(c, 37, 71, ['aa....', 'aaaa..', '.aaaa.', '..aa..'], {'a': 8})
        put(c, 53, 71, ['....aa', '..aaaa', '.aaaa.', '..aa..'], {'a': 7})

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 1.2, 21.5)
        # ёжик с залысинами: мысок посередине, виски открыты
        hl = 21 + 5 * np.clip(np.abs(u) - 0.25, 0, 1) ** 0.7 + 2 * u ** 2
        top = vol & (ys < hl) & (ys > 15)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys > 27) & (ys < 42)
        h = top | sides
        hair_paint(c, h, HAIR, f)
        for y in range(17, 25, 2):
            for x in range(34 + (y % 4), 62, 3):
                if h[y, x]:
                    c[y, x] = 41
        # карандаш за правым ухом
        ey = P['ey']
        line(c, [(CX + f.rx - 4, ey - 6), (CX + f.rx + 4, ey)], 22)
        line(c, [(CX + f.rx - 4, ey - 5), (CX + f.rx + 3, ey)], 21)
        c[ey + 1, CX + f.rx + 5] = 16
        c[ey + 1, CX + f.rx + 4] = 16
        c[ey - 7, CX + f.rx - 5] = 27

    def moustache(c, P, emotion):
        ey = P['ey']
        put(c, CX - 8, ey + 11, ['...GGGGGGGGGG...', '.GGggggggggggGG.', 'GgggGGGGGGGGgggG', 'Ggg..........ggG',
                                 'Gg............gG'], {'G': 42, 'g': 44})

    def extra(c, P, emotion):
        ey, S = P['ey'], P['skin']
        eyL, eyR = CX - 12, CX + 4
        # гусиные лапки у глаз и мешки
        for dx, side in ((-3, eyL), (10, eyR)):
            for k in range(3):
                c[ey - 1 + k * 2, side + dx] = S[0]
        eye_bags(c, P)

    return dict(face=f, skin=SKIN_MID, ey=38, age=56, female=False, neck=11, nose='broad', shoulders=42,
                brow=(42, 2), pupil=2, body=body, collar=collar, hair=hair, moustache=moustache, extra=extra,
                blush=28, mouth_y=38 + 17, squint=True)


SPECS = {'sosed': sosed, 'gopnik': gopnik, 'admin': admin, 'pacan': pacan, 'babka': babka, 'cashier': cashier,
         'guard': guard, 'worker': worker, 'workerf': workerf, 'student': student, 'vahter': vahter,
         'palych': palych}


def builder(spec_fn):
    P = spec_fn()
    if not P.pop('squint', False):
        return lambda emotion, frame: person(P, emotion, frame)
    # прищур зависит от кадра (в моргании глаза закрыты), а extra получает только эмоцию
    own = P.get('extra')

    def extra(c, P_, e, frame):
        squint(c, P_, e, frame)
        if own:
            own(c, P_, e)
    return lambda emotion, frame: person({**P, 'extra': lambda c, P_, e: extra(c, P_, e, frame)}, emotion, frame)


PEOPLE_STORY = {cid: builder(fn) for cid, fn in SPECS.items()}


def main(ids=None):
    import shutil

    from PIL import Image

    from apollo import RGB
    from pixel import EMOTIONS, FRAMES, H, W, to_image

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    out_dir = os.path.join(root, 'public', 'assets', 'portraits')
    prev_dir = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(prev_dir, exist_ok=True)
    ids = ids or list(PEOPLE_STORY)
    for cid in ids:
        fn = PEOPLE_STORY[cid]
        sheet = Image.new('RGBA', (W * len(FRAMES), H * len(EMOTIONS)), (0, 0, 0, 0))
        for r, emo in enumerate(EMOTIONS):
            for k, fr in enumerate(FRAMES):
                sheet.paste(to_image(fn(emo, fr)), (k * W, r * H))
        sheet.save(os.path.join(out_dir, f'{cid}.png'))
        bg = Image.new('RGBA', sheet.size, RGB[41] + (255,))
        bg.alpha_composite(sheet)
        bg.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST).save(os.path.join(prev_dir, f'{cid}_x4.png'))
        print('ok', cid)
    # сводный лист: строка — лицо, 6 эмоций, под каждой мелко «рот» и «моргание»
    pad = 4
    rh = H + 48 + pad * 2
    all_ = Image.new('RGBA', (W * 6 + pad * 5, rh * len(ids)), RGB[40] + (255,))
    for r, cid in enumerate(ids):
        fn = PEOPLE_STORY[cid]
        for k, emo in enumerate(EMOTIONS):
            x, y = k * (W + pad), r * rh
            tile = Image.new('RGBA', (W, H), RGB[41] + (255,))
            tile.alpha_composite(to_image(fn(emo, 'idle')))
            all_.alpha_composite(tile, (x, y))
            for j, fr in enumerate(('talk', 'blink')):
                small = Image.new('RGBA', (W, H), RGB[41] + (255,))
                small.alpha_composite(to_image(fn(emo, fr)))
                all_.alpha_composite(small.crop((24, 18, 72, 66)), (x + j * 48, y + H + pad // 2))
    all_ = all_.resize((all_.width * 2, all_.height * 2), Image.NEAREST)
    path = os.path.join(prev_dir, 'story_all.png')
    all_.save(path)
    shots = os.path.expanduser('~/Arena-materials/shots/story/faces')
    os.makedirs(shots, exist_ok=True)
    shutil.copy(path, os.path.join(shots, 'story_all.png'))


if __name__ == '__main__':
    main(sys.argv[1:] or None)
