"""Деловые лица для своих дел, вторая волна: директор, банкир, юрист, логист, собственник, финдиректор,
менеджер по продажам, инженер-технолог.

Головы собираются тем же person() из people.py, что и у первого пула. Отличаются профилем лица, кожей, причёской,
бородой, очками и одеждой; одежду и причёски здесь собирают общие заготовки, чтобы восемь лиц не тянули восемь
копий одного кода.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from pixel import band, ellipse_mask, grid, line, paint, poly_mask, put, shade_ellipsoid  # noqa: E402
from people import CX, SKIN_DARK, SKIN_LIGHT, SKIN_MID, Face, builder, paint_cloth, shirt_collar  # noqa: E402

LAP_L = [(39, 72), (42, 84), (48, 96), (42, 96), (32, 86), (29, 77)]
LAP_R = [(57, 72), (54, 84), (48, 96), (54, 96), (64, 86), (67, 77)]


# ---------- одежда ----------

def suit(jacket, shirt=(45, 44), tie=None, pin=None):
    """Пиджак с лацканами, рубашка, галстук по желанию. jacket — рампа из 4 цветов, tie — (основа, тень, узор)."""
    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, jacket)
        sh = poly_mask([(39, 72), (57, 72), (54, 84), (48, 96), (42, 84)])
        paint(c, sh, shirt[0])
        paint(c, sh & (xs > 48), shirt[1])
        if tie:
            t = poly_mask([(45, 76), (51, 76), (50, 80), (52, 96), (44, 96), (46, 80)])
            paint(c, t, tie[0])
            paint(c, t & (xs < 48), tie[1])
            line(c, [(46, 80), (50, 80)], tie[2])
            for y in (85, 91):
                line(c, [(46, y), (50, y - 1)], tie[2])
        paint(c, poly_mask(LAP_L), jacket[3])
        paint(c, poly_mask(LAP_R), jacket[1])
        line(c, [(39, 72), (42, 84), (47, 95)], jacket[0])
        line(c, [(57, 72), (54, 84), (49, 95)], jacket[0])
        if pin:
            put(c, 33, 82, *pin)
    return body


def jacket_blouse(jacket, blouse=(45, 44)):
    """Женский жакет поверх блузки с V-вырезом."""
    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, jacket, cuts=(0.3, 0.6, 0.92))
        b = poly_mask([(38, 70), (58, 70), (56, 82), (48, 96), (40, 82)])
        paint(c, b, blouse[0])
        paint(c, b & (xs > 49), blouse[1])
        line(c, [(38, 71), (41, 82), (47, 95)], jacket[0])
        line(c, [(58, 71), (55, 82), (49, 95)], jacket[0])
        for y in (86, 92):
            c[y, 42] = jacket[3]
    return body


# ---------- причёски ----------

def short_hair(f, ramp, part=None, fall=36, top=25.0, curve=3.0, accents=()):
    """Короткая мужская стрижка: верх по дуге, виски до fall; part — x пробора."""
    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 1.8, 22)
        u = (xs - CX) / f.rx
        hl = top + curve * u ** 2
        if part is not None:
            hl = hl + 1.5 * (xs < part)
        h = (vol & (ys < hl)) | (vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys < fall))
        paint(c, h, band(shade_ellipsoid(CX - 4, f.cy - 11, f.rx + 2, 21), [0.25, 0.55, 0.85], ramp))
        if part is not None:
            line(c, [(part, 17), (part - 1, 25)], ramp[0])
        for pts, col in accents:
            line(c, pts, col)
    return hair


def ring_hair(f, ramp, shine=17):
    """Лысина с венчиком на висках и затылке."""
    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy, f.rx + 1.5, 23)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys > 26) & (ys < 42)
        paint(c, sides, band(shade_ellipsoid(CX - 4, f.cy - 6, f.rx + 2, 22), [0.25, 0.55, 0.85], ramp))
        put(c, 39, 19, ['..hhh', '.hh..', 'h....'], {'h': shine})
    return hair


def bob_hair(f, ramp, fringe=27):
    """Каре до подбородка с ровной чёлкой; затылочная часть — в back."""
    def back(c, P):
        xs, ys = grid()
        m = ellipse_mask(CX, f.cy + 3, f.rx + 5, 26) & (ys < f.chin_y - 1)
        paint(c, m, band(shade_ellipsoid(CX - 6, f.cy - 8, f.rx + 7, 26), [0.5], [ramp[0], ramp[1]]))

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy + 1, f.rx + 3.5, 25)
        u = (xs - CX) / f.rx
        top = vol & (ys < fringe + 1.5 * u ** 2)
        sides = vol & (np.abs(xs - CX) > f.rx - 3) & (ys < f.chin_y - 2)
        paint(c, top | sides, band(shade_ellipsoid(CX - 6, f.cy - 12, f.rx + 3, 24), [0.25, 0.55, 0.85], ramp))
        for x in range(36, 62, 5):
            line(c, [(x, fringe - 4), (x + 1, fringe)], ramp[0])
        line(c, [(40, 20), (48, 18)], ramp[3])
    return back, hair


def tail_hair(f, ramp):
    """Гладко назад и хвост за затылком справа."""
    def back(c, P):
        xs, ys = grid()
        paint(c, ellipse_mask(CX, f.cy, f.rx + 3, 22), ramp[0])
        tail = poly_mask([(CX + 10, 18), (CX + 20, 22), (CX + 25, 46), (CX + 22, 66), (CX + 16, 50)])
        paint(c, tail, band(shade_ellipsoid(CX + 16, 30, 12, 30), [0.5], [ramp[1], ramp[2]]))
        line(c, [(CX + 20, 30), (CX + 22, 56)], ramp[0])

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 2.5, 22.5)
        u = (xs - CX) / f.rx
        hl = 25 + 3 * np.clip(-u, 0, 1) + 5 * np.clip(u - 0.2, 0, 1) ** 1.5
        h = (vol & (ys < hl)) | (vol & (np.abs(xs - CX) > f.rx - 2) & (ys < P['ey'] + 1))
        paint(c, h, band(shade_ellipsoid(CX - 6, f.cy - 12, f.rx + 3, 22), [0.25, 0.5, 0.82], ramp))
        for pts in ([(38, 21), (47, 18)], [(52, 19), (60, 25)]):
            line(c, pts, ramp[3])
        put(c, CX + 11, 21, ['kk', 'kk'], {'k': 27})  # резинка
    return back, hair


def pixie_hair(f, ramp):
    """Короткая женская стрижка с косой чёлкой."""
    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 3, 23)
        u = (xs - CX) / f.rx
        hl = 27 - 3 * u + 3 * u ** 2
        h = (vol & (ys < hl)) | (vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys < P['ey'] + 5))
        paint(c, h, band(shade_ellipsoid(CX - 5, f.cy - 12, f.rx + 3, 22), [0.25, 0.55, 0.85], ramp))
        for pts in ([(36, 27), (46, 22)], [(42, 28), (52, 22)], [(55, 21), (61, 26)]):
            line(c, pts, ramp[3])
        line(c, [(34, 30), (40, 25)], ramp[0])
    return hair


# ---------- лицо: борода и усы ----------

def short_beard(f, ramp):
    def beard(c, P, emotion):
        xs, ys = grid()
        face = f.mask()
        ey = P['ey']
        b = face & (ys > ey + 13) & ((np.abs(xs - CX) > f.hw(ys) - 3) | (ys > ey + 20))
        b &= ~((ys < ey + 20) & (np.abs(xs - CX) < 7))
        paint(c, b, band(shade_ellipsoid(CX - 3, 58, 18, 10), [0.35, 0.65], ramp))
    return beard


def stubble(f, col):
    def beard(c, P, emotion):
        xs, ys = grid()
        face = f.mask()
        ey = P['ey']
        zone = face & (ys > ey + 12) & ((np.abs(xs - CX) > f.hw(ys) - 4) | (ys > ey + 21))
        dots = zone & (((xs + ys) % 3) == 0)
        paint(c, dots, col)
    return beard


def moustache(col, light):
    def m(c, P, emotion):
        put(c, CX - 6, P['ey'] + 12, ['.GGGGGGGGGG.', 'GgggggggggggG'[:12], 'G..........G'], {'G': col, 'g': light})
    return m


def earrings(f, col, shade):
    def extra(c, P, emotion):
        ey = P['ey']
        put(c, CX - f.rx - 2, ey + 9, ['g', 'G'], {'g': col, 'G': shade})
        put(c, CX + f.rx + 1, ey + 9, ['g', 'G'], {'g': col, 'G': shade})
    return extra


# ---------- персонажи ----------

def director():
    """Генеральный директор, ~56: седой пробор, тёмно-синий костюм, бордовый галстук, значок на лацкане."""
    f = Face(top=16, cy=38, rx=19, jaw_y=56, jaw_w=16, chin_y=64, chin_w=7, jaw_p=2.0, cheek=2.2)
    G = [41, 42, 43, 44]
    return dict(face=f, skin=SKIN_LIGHT, ey=38, age=56, female=False, neck=10, nose='straight', shoulders=42,
                brow=(41, 2), body=suit([0, 1, 1, 2], tie=(26, 25, 27), pin=(['gg', 'GG'], {'g': 22, 'G': 21})),
                collar=lambda c, P: shirt_collar(c, 10, 74),
                hair=short_hair(f, G, part=CX - 7, fall=37, top=24.5, accents=[([(45, 19), (51, 17)], 45), ([(54, 18), (59, 21)], 44)]),
                blush=28, mouth_y=38 + 16)


def banker():
    """Банкир, ~45: узкое лицо, чёрные волосы назад, тонкие очки, графитовый костюм, синий галстук."""
    f = Face(top=17, cy=38, rx=17, jaw_y=56, jaw_w=13, chin_y=65, chin_w=5, jaw_p=1.6, cheek=1.8)
    H = [36, 37, 38, 40]
    return dict(face=f, skin=SKIN_MID, ey=38, age=45, female=False, neck=9, nose='hooked', shoulders=40,
                brow=(36, 2), body=suit([37, 38, 39, 40], tie=(3, 2, 1)), collar=lambda c, P: shirt_collar(c, 9, 74),
                hair=short_hair(f, H, fall=35, top=23.5, curve=2.0, accents=[([(40, 19), (50, 17)], 41), ([(52, 18), (58, 22)], 40)]),
                glasses=(36, 'thin'), blush=28, mouth_y=38 + 16)


def lawyer():
    """Юрист, ~38: короткая каштановая борода, светло-серый костюм, голубая рубашка без галстука."""
    f = Face(top=17, cy=38, rx=18, jaw_y=55, jaw_w=15, chin_y=64, chin_w=6, jaw_p=1.8, cheek=2.0)
    H = [18, 19, 20, 20]
    return dict(face=f, skin=SKIN_LIGHT, ey=38, age=38, female=False, neck=9, nose='straight', shoulders=41,
                brow=(18, 2), body=suit([40, 41, 42, 43], shirt=(4, 3)), collar=lambda c, P: shirt_collar(c, 9, 74, 4, 3, 2),
                hair=short_hair(f, H, part=CX + 6, fall=36, top=24.0, accents=[([(40, 20), (46, 18)], 21)]),
                beard=short_beard(f, [18, 19, 20]), moustache=moustache(18, 19), blush=28, mouth_y=38 + 16)


def logist():
    """Логист, ~33: круглое лицо, ёжик, щетина, зелёное поло с логотипом."""
    f = Face(top=18, cy=39, rx=19, jaw_y=56, jaw_w=16, chin_y=64, chin_w=7, jaw_p=2.2, cheek=2.4)
    H = [19, 20, 20, 21]

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [6, 7, 8, 8])
        line(c, [(48, 74), (48, 86)], 6)
        for y in (78, 83):
            c[y, 49] = 45
        put(c, 57, 80, ['yyy', 'y.y', 'yyy'], {'y': 22})

    def collar(c, P):
        put(c, 37, 71, ['gg....', 'gggg..', '.gggg.', '..gg..'], {'g': 8})
        put(c, 53, 71, ['....gg', '..gggg', '.gggg.', '..gg..'], {'g': 7})

    return dict(face=f, skin=SKIN_MID, ey=39, age=33, female=False, neck=10, nose='broad', shoulders=42,
                brow=(19, 2), body=body, collar=collar, hair=short_hair(f, H, fall=35, top=23.0, curve=2.5),
                beard=stubble(f, 13), blush=28, mouth_y=39 + 16)


def owner():
    """Собственник предприятия, ~62: тяжёлое лицо, седые усы, венчик, коричневый костюм без галстука."""
    f = Face(top=15, cy=38, rx=20, jaw_y=57, jaw_w=18, chin_y=65, chin_w=9, jaw_p=2.0, cheek=3.0)
    return dict(face=f, skin=SKIN_DARK, ey=38, age=62, female=False, neck=11, nose='broad', shoulders=43,
                brow=(42, 2), brow_dy=1, body=suit([18, 19, 19, 20], shirt=(45, 44)), collar=lambda c, P: shirt_collar(c, 11, 74),
                hair=ring_hair(f, [40, 41, 42, 43], shine=15), moustache=moustache(42, 43), blush=27, mouth_y=38 + 16)


def cfo():
    """Финансовый директор, ~48: чёрное каре, тонкие очки, тёмно-синий жакет, жемчужные серьги."""
    f = Face(top=19, cy=40, rx=17, jaw_y=57, jaw_w=13, chin_y=65, chin_w=5, jaw_p=1.6, cheek=2.0)
    back, hair = bob_hair(f, [36, 37, 38, 40])
    return dict(face=f, skin=SKIN_LIGHT, ey=40, age=48, female=True, neck=7, nose='small', shoulders=37, drop=14,
                brow=(37, 1), pupil=2, lash=36, body=jacket_blouse([0, 1, 1, 2]), collar=lambda c, P: shirt_collar(c, 7, 74),
                back=back, hair=hair, extra=earrings(f, 45, 43), glasses=(37, 'thin'),
                lips={'m': 27, 'M': 26, 'r': 27, 'R': 28}, blush=35, mouth_y=40 + 14)


def sales():
    """Менеджер по продажам, ~29: каштановый хвост, голубой жакет, белый топ, золотые гвоздики."""
    f = Face(top=19, cy=40, rx=16, jaw_y=56, jaw_w=12, chin_y=65, chin_w=4, jaw_p=1.3, cheek=1.6)
    back, hair = tail_hair(f, [19, 20, 21, 22])
    return dict(face=f, skin=SKIN_MID, ey=40, age=29, female=True, neck=7, nose='small', shoulders=36, drop=14,
                brow=(19, 1), pupil=18, lash=18, body=jacket_blouse([2, 3, 3, 4]), back=back, hair=hair,
                extra=earrings(f, 22, 21), lips={'m': 33, 'M': 26, 'r': 34, 'R': 35}, blush=35, mouth_y=40 + 14,
                cuts=[0.08, 0.35, 0.95])


def engineer():
    """Инженер-технолог, ~37: короткая рыжая стрижка, серая флиска на молнии, пропуск на ленте."""
    f = Face(top=19, cy=40, rx=17, jaw_y=56, jaw_w=13, chin_y=65, chin_w=5, jaw_p=1.5, cheek=1.8)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [39, 40, 41, 41])
        line(c, [(48, 72), (48, 96)], 38)
        put(c, 47, 71, ['ss', 'ss'], {'s': 42})
        # пропуск на ленте
        line(c, [(41, 72), (44, 86)], 27)
        line(c, [(55, 72), (52, 86)], 27)
        put(c, 43, 86, ['wwwww', 'wbbbw', 'wwwww', 'wkkkw'], {'w': 45, 'b': 3, 'k': 41})

    def collar(c, P):
        put(c, 38, 70, ['ff......', 'fff.....'], {'f': 40})
        put(c, 51, 70, ['......ff', '.....fff'], {'f': 39})

    return dict(face=f, skin=SKIN_LIGHT, ey=40, age=37, female=True, neck=7, nose='button', shoulders=37, drop=14,
                brow=(20, 1), pupil=8, lash=19, body=body, collar=collar, hair=pixie_hair(f, [19, 20, 21, 22]),
                lips={'m': 27, 'M': 26, 'r': 27, 'R': 28}, blush=28, mouth_y=40 + 14)


SPECS = {'director': director, 'banker': banker, 'lawyer': lawyer, 'logist': logist, 'owner': owner,
         'cfo': cfo, 'sales': sales, 'engineer': engineer}

BIZ = {cid: builder(fn) for cid, fn in SPECS.items()}
