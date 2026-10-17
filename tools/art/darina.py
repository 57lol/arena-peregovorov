"""Дарина Лукманова, 27, инженер-робототехник («Оффер для робототехника»): три варианта лица на общем person().

Общее у всех: молодое лицо, глаза и тени кожи как у остальных портретов, маленький нос, лёгкая улыбка в покое.
Разное — причёска и одежда:

  v1 — тёмное каре с косым пробором, белая водолазка, зелёный пиджак, пропуск на шнурке
  v2 — каштановый высокий хвост, пряди у лица, голубая рубашка поверх белой футболки, бейдж на кармане
  v3 — тёмный небрежный пучок с прядями, тонкие очки, беспроводной наушник, графитовая куртка

Выбор для игры: tools/art/portraits.py olga --olga v1 (без флага — вариант по умолчанию DEFAULT).
Все варианты и сравнение: tools/art/portraits.py --olga-variants
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from people import CX, SKIN_LIGHT, Face, paint_cloth, person  # noqa: E402
from pixel import band, ellipse_mask, grid, line, paint, poly_mask, put, shade_ellipsoid  # noqa: E402

DEFAULT = 'v2'

FACE = dict(top=19, cy=40, rx=16.5, jaw_y=56, jaw_w=12, chin_y=64, chin_w=4, jaw_p=1.3, cheek=1.8)
EY = 40

# рот: в покое уголки чуть вверх — лёгкая улыбка
MOUTH = {
    'neutral': ['M.....M', '.MmmmM.', '..rRr..'],
    'pleased': ['M.....M', '.MtttM.', '..rRr..'],
    'happy':   ['M.....M', 'MtttttM', '.MoooM.', '..rrr..'],
    'thinking': ['.....M.', '.MmmM..', '..rr...'],
    'annoyed': ['.......', '.MMMMM.', 'M.rrr.M'],
    'angry':   ['.MMMMM.', 'MtttttM', 'M.rrr.M'],
}
TALK = {
    'neutral': ['M.....M', '.MoooM.', '..rRr..'],
    'pleased': ['M.....M', '.MtttM.', '.MoooM.', '..rr...'],
    'happy':   ['M.....M', 'MtttttM', 'MoooooM', '.rrrrr.'],
    'thinking': ['.....M.', '.MooM..', '..rr...'],
    'annoyed': ['.......', '.MtttM.', 'M.ooo.M', '..rrr..'],
    'angry':   ['.mmmmm.', 'MtttttM', 'MoooooM', '.MrrrM.'],
}


def hair_paint(c, mask, ramp, f, cuts=(0.22, 0.52, 0.82)):
    paint(c, mask, band(shade_ellipsoid(CX - 6, f.cy - 12, f.rx + 4, 24), list(cuts), ramp))


def base(f, hair_ramp, iris):
    """Общие параметры лица в манере остальных портретов (как student/hr): стандартные глаз 8x4 и тени кожи,
    свои только рот с лёгкой улыбкой и цвет глаз; варианты дописывают одежду и причёску."""
    return dict(face=f, skin=SKIN_LIGHT, ey=EY, age=27, female=True, neck=7, nose='small', shoulders=38, drop=14,
                brow=(hair_ramp[0], 1), pupil=iris, lash=hair_ramp[0], mouths=(MOUTH, TALK), mouth_y=EY + 14,
                lips={'m': 14, 'M': 26, 'r': 27, 'R': 28, 'o': 25},
                blush=35, cuts=[0.08, 0.35, 0.95], eye_in=1, forehead=False)


def lanyard(c, x0=41, x1=55, y=76, color=22, badge_y=86):
    line(c, [(x0, y), (44, badge_y - 4), (46, badge_y)], color)
    line(c, [(x1, y), (52, badge_y - 4), (50, badge_y)], color)
    put(c, 44, badge_y, ['111111', '1aa441', '1aa331', '144441', '111111'], {'1': 43, '4': 45, '3': 2, 'a': 3})


# ---------- v1: каре ----------

def bob_mask(f, hw0=3.2, flare=1.6, end=63):
    """Силуэт каре: купол и ровные пряди до челюсти, книзу чуть расходятся, концы закруглены внутрь."""
    xs, ys = grid()
    dome = ellipse_mask(CX, f.cy - 1, f.rx + hw0, 24)
    t = np.clip((ys - f.cy) / (end - f.cy), 0, 1)
    hw = f.rx + hw0 + flare * t - np.clip(ys - (end - 3), 0, 3) * 0.8
    ax = np.abs(xs - CX)
    bottom = end - 2.5 * np.clip((ax - (f.rx - 1)) / 5, 0, 1) ** 2
    sides = (ax <= hw) & (ys >= f.cy - 8) & (ys <= bottom)
    return dome | sides


def v1():
    f = Face(**FACE)
    HAIR = [24, 18, 18, 19]
    P = base(f, HAIR, 20)
    part = CX + 5
    sil = bob_mask(f)

    def back(c, P):
        paint(c, sil, 24)

    def body(c, P, m):
        xs, ys = grid()
        # пиджак цвета кэмел поверх светлой водолазки
        paint_cloth(c, m, [6, 7, 7, 8], cuts=(0.3, 0.6, 0.92))
        inner = poly_mask([(39, 70), (57, 70), (55, 84), (52, 96), (44, 96), (41, 84)])
        paint_cloth(c, inner, [44, 45, 45, 45])
        lap_l = poly_mask([(38, 71), (41, 84), (44, 96), (39, 96), (31, 86), (29, 78)])
        lap_r = poly_mask([(58, 71), (55, 84), (52, 96), (57, 96), (65, 86), (67, 78)])
        paint(c, lap_l, 8)
        paint(c, lap_r, 6)
        line(c, [(38, 71), (41, 84), (44, 95)], 6)
        line(c, [(58, 71), (55, 84), (52, 95)], 36)
        lanyard(c, color=27)

    def collar(c, P):
        xs, _ = grid()
        coll = poly_mask([(41, 67), (55, 67), (56, 76), (48, 78), (40, 76)])
        paint(c, coll, 45)
        paint(c, coll & (xs > CX + 2), 44)
        line(c, [(41, 71), (55, 71)], 44)
        line(c, [(40, 76), (48, 78), (56, 76)], 43)

    def hair(c, P, emotion):
        xs, ys = grid()
        left = np.clip((part - xs) / (part - (CX - f.rx)), 0, 1.4)
        right = np.clip((xs - part) / (CX + f.rx - part), 0, 1.4)
        # косой пробор справа: чёлка волной уходит налево к виску
        hl = 22.5 + 9.5 * left ** 1.4 + 5 * right ** 1.5
        k = np.where(ys < EY, 3.5, np.where(ys < f.jaw_y, 2.5, 1.5))
        cover = (ys < hl) | (np.abs(xs - CX) > f.hw(ys) - k)
        cover &= ~((ys > f.jaw_y) & (np.abs(xs - CX) < 9))
        h = sil & cover
        hair_paint(c, h, HAIR, f, cuts=(0.3, 0.7, 0.93))
        # концы подкручены внутрь — нижний край темнее
        tips = h & ~np.roll(h, -2, 0)
        paint(c, tips & (ys > 55), 24)
        # блик-ободок по куполу
        rr = np.hypot((xs - CX + 3) / 1.0, (ys - f.cy + 1) / 1.1)
        paint(c, h & (np.abs(rr - 19) < 0.7) & (ys < 26) & (xs < part + 2), 20)
        # пряди: от пробора налево вниз и по бокам
        for pts in ([(part - 1, 19), (44, 21), (38, 25), (34, 31)], [(part - 3, 21), (42, 25), (36, 32)],
                    [(31, 36), (30, 46), (31, 56)], [(64, 36), (65, 46), (64, 56)]):
            line(c, pts, 19)
        for pts in ([(part + 1, 19), (58, 23), (62, 30)], [(33, 40), (33, 52)]):
            line(c, pts, 20)
        line(c, [(part, 17), (part, 20)], 24)

    P.update(back=back, body=body, collar=collar, hair=hair, dark={24: 36, 18: 24, 37: 36})
    return P


# ---------- v2: высокий хвост ----------

def gathered(f, hl, ear_y, grow=2.5):
    """Собранные волосы: объём на макушке, линия роста по hl(x), по бокам прикрывают верх ушей."""
    xs, ys = grid()
    vol = ellipse_mask(CX, f.cy - 1, f.rx + grow, 22.5)
    top = vol & (ys < hl)
    sides = vol & (np.abs(xs - CX) > f.hw(ys) - 2) & (ys < ear_y)
    return top | sides


def strand(c, pts, color, thick_to=None):
    """Прядь у лица: линия, в верхней части в два пикселя."""
    line(c, pts, color)
    if thick_to is not None:
        line(c, [(x + 1, y) for x, y in pts[:thick_to]], color)


def v2():
    f = Face(**FACE)
    HAIR = [18, 19, 20, 20]
    P = base(f, HAIR, 8)

    def back(c, P):
        xs, ys = grid()
        # хвост: собран высоко на затылке, виден справа за головой и падает на плечо
        tail = poly_mask([(57, 16), (63, 15), (69, 20), (73, 32), (73, 46), (70, 58), (66, 66), (63, 70), (64, 58),
                          (66, 44), (64, 30), (60, 22)])
        paint(c, tail, band(shade_ellipsoid(60, 24, 16, 34), [0.35, 0.65], [18, 19, 20]))
        for pts in ([(64, 18), (69, 28), (70, 42), (68, 54)], [(62, 24), (65, 36), (65, 48)]):
            line(c, pts, 20)
        line(c, [(71, 34), (71, 48), (68, 60)], 18)
        paint(c, ellipse_mask(CX, f.cy - 1, f.rx + 2.5, 22.5), 18)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [1, 2, 3, 3], cuts=(0.3, 0.6, 0.9))
        # белая футболка в вырезе рубашки
        tee = poly_mask([(39, 70), (57, 70), (54, 84), (48, 90), (42, 84)])
        paint(c, tee, 45)
        paint(c, tee & (xs > CX + 1), 44)
        line(c, [(39, 71), (42, 84), (47, 96)], 1)
        line(c, [(57, 71), (54, 84), (49, 96)], 0)
        # нагрудный карман с бейджем
        line(c, [(58, 84), (65, 84)], 1)
        line(c, [(65, 84), (65, 92)], 1)
        put(c, 59, 82, ['11111', '1aa41', '14441', '11111'], {'1': 43, '4': 45, 'a': 27})
        line(c, [(31, 84), (37, 84)], 2)
        # конец хвоста лежит на плече
        paint(c, poly_mask([(63, 68), (67, 66), (69, 72), (66, 78), (63, 75)]), 19)
        line(c, [(65, 69), (66, 75)], 20)

    def collar(c, P):
        # воротник рубашки раскрыт, лежит поверх плеч
        put(c, 34, 68, ['aaa.....', 'aaaaa...', 'aaaaaa..', '.aaaaab.', '..aaab..', '...ab...'], {'a': 4, 'b': 3})
        put(c, 54, 68, ['.....aaa', '...aaaaa', '..aaaaaa', '.baaaaa.', '..baaa..', '...ba...'], {'a': 3, 'b': 2})
        # тонкая цепочка с кулоном
        for x, y in ((43, 72), (44, 74), (46, 75), (48, 76), (50, 75), (52, 74), (53, 72)):
            c[y, x] = 22
        c[77, 48] = 23

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        # гладко назад, мягкий мысок по центру, виски прикрыты
        hl = 23.5 + 4.5 * u ** 2 - 1.2 * np.exp(-(u / 0.15) ** 2)
        h = gathered(f, hl, EY + 2)
        hair_paint(c, h, HAIR, f, cuts=(0.28, 0.62, 0.9))
        # гладкие пряди, стянутые назад к хвосту
        for pts in ([(36, 24), (42, 18), (52, 15), (58, 15)], [(33, 30), (38, 21), (46, 17)], [(50, 21), (57, 18), (61, 19)]):
            line(c, pts, 20)
        for pts in ([(40, 22), (48, 18)], [(56, 22), (62, 25)]):
            line(c, pts, 18)
        # резинка
        put(c, 58, 14, ['kk', 'kK'], {'k': 26, 'K': 25})
        # выпущенные пряди у лица
        strand(c, [(35, 24), (32, 30), (31, 38), (32, 46), (31, 53)], 19)
        strand(c, [(61, 24), (64, 30), (64, 38), (63, 45)], 18)

    def extra(c, P, emotion):
        put(c, int(CX - f.rx - 2), EY + 9, ['g', 'g'], {'g': 23})
        put(c, int(CX + f.rx + 1), EY + 9, ['g', 'g'], {'g': 22})

    P.update(back=back, body=body, collar=collar, hair=hair, extra=extra, brow=(18, 1), lash=24)
    return P


# ---------- v3: пучок, очки, наушник ----------

def v3():
    f = Face(**FACE)
    HAIR = [24, 18, 19, 19]
    P = base(f, HAIR, 20)

    def back(c, P):
        xs, ys = grid()
        # небрежный пучок на макушке, пряди торчат
        bun = ellipse_mask(CX + 1, 13, 9, 6.5)
        paint(c, bun, band(shade_ellipsoid(CX - 3, 9, 11, 9), [0.35, 0.7], [24, 18, 19]))
        for pts in ([(CX - 5, 13), (CX, 9), (CX + 6, 10)], [(CX - 2, 16), (CX + 4, 13), (CX + 8, 15)]):
            line(c, pts, 19)
        line(c, [(CX - 4, 17), (CX + 6, 17)], 24)
        paint(c, ellipse_mask(CX, f.cy - 1, f.rx + 2.5, 22.5), 24)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [37, 38, 39, 39], cuts=(0.3, 0.6, 0.9))
        tee = poly_mask([(40, 71), (56, 71), (54, 80), (48, 83), (42, 80)])
        paint(c, tee, 45)
        paint(c, tee & (xs > CX + 1), 44)
        # молния и планка
        line(c, [(41, 76), (44, 96)], 36)
        line(c, [(55, 76), (52, 96)], 36)
        c[90, 44] = 42
        # нашивка с логотипом
        put(c, 59, 84, ['yyyy', 'ybby', 'yyyy'], {'y': 22, 'b': 2})
        lanyard(c, 42, 54, 80, color=27, badge_y=87)

    def collar(c, P):
        xs, _ = grid()
        ring = ellipse_mask(CX, 73, 13, 4) & ~ellipse_mask(CX, 71, 8, 3)
        paint(c, ring, 39)
        paint(c, ring & (xs > CX + 3), 38)

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        # собраны наверх, мягкая линия роста, у висков выбиваются пряди
        hl = 24 + 4 * u ** 2 - 1.5 * np.exp(-((u + 0.25) / 0.25) ** 2)
        h = gathered(f, hl, EY + 1)
        hair_paint(c, h, HAIR, f, cuts=(0.3, 0.68, 0.92))
        for pts in ([(36, 23), (42, 18), (48, 17)], [(52, 18), (58, 21)], [(33, 28), (36, 22)]):
            line(c, pts, 19)
        line(c, [(43, 21), (48, 19)], 18)
        # пряди у лица — тонкие, волной
        strand(c, [(35, 25), (32, 31), (33, 38), (31, 46), (32, 54)], 18)
        strand(c, [(61, 25), (64, 31), (63, 38), (65, 45), (64, 50)], 24)

    def extra(c, P, emotion):
        # беспроводной наушник в правом ухе
        put(c, int(CX + f.rx), EY + 3, ['ww', 'wW', '.W', '.W'], {'w': 45, 'W': 43})

    P.update(back=back, body=body, collar=collar, hair=hair, extra=extra, brow=(24, 1), glasses=(37, 'thin'), lash=24)
    return P


VARIANTS = {'v1': v1, 'v2': v2, 'v3': v3}


def builder(name):
    P = VARIANTS[name]()
    return lambda emotion, frame: person(P, emotion, frame)
