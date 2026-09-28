"""Пул лиц для своих (сгенерированных) дел: разный пол, возраст, сфера.

Лицо собирается из тех же частей, что у Марата и Дарины: череп и челюсть по профилю, шея с тенью от
подбородка, трапеции, уши, нос, морщины по возрасту. Эмоции меняют только брови, глаза, рот и румянец.
Одежда и причёска у каждого своя.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from pixel import (BROWS, DARK, H, T, W, band, draw_eyes, ellipse_mask, erode, grid, line,  # noqa: E402
                   outline, paint, poly_mask, put, shade_ellipsoid, shift)

SKIN_LIGHT = [14, 15, 16, 17]
SKIN_MID = [13, 14, 15, 16]
SKIN_DARK = [12, 13, 14, 15]
CX = 48


class Face:
    """Профиль головы по строкам: купол черепа, скулы, угол челюсти, подбородок."""

    def __init__(self, top=16, cy=38, rx=19, jaw_y=56, jaw_w=15, chin_y=64, chin_w=6, jaw_p=1.5, cheek=1.8):
        self.top, self.cy, self.rx = top, cy, rx
        self.jaw_y, self.jaw_w, self.chin_y, self.chin_w, self.jaw_p, self.cheek = jaw_y, jaw_w, chin_y, chin_w, jaw_p, cheek

    def hw(self, y):
        y = np.asarray(y, float)
        up = self.rx * np.sqrt(np.clip(1 - ((self.cy - y) / (self.cy - self.top)) ** 2, 0, 1))
        t1 = np.clip((y - self.cy) / (self.jaw_y - self.cy), 0, 1)
        mid = self.rx + (self.jaw_w - self.rx) * t1 ** self.cheek
        t2 = np.clip((y - self.jaw_y) / (self.chin_y - self.jaw_y), 0, 1)
        low = self.chin_w + (self.jaw_w - self.chin_w) * (1 - t2 ** self.jaw_p)
        out = np.where(y <= self.cy, up, np.where(y <= self.jaw_y, mid, low))
        return np.where((y < self.top) | (y > self.chin_y + 0.5), -1, out)

    def mask(self, grow=0.0, dy=0.0):
        xs, ys = grid()
        return np.abs(xs - CX) <= self.hw(ys - dy) + grow


def torso(neck_base, nw, sh=40, drop=12):
    """Плечи с трапецией: от шеи вниз и в стороны, а не прямая полка."""
    pts = [(CX - nw - 1, neck_base - 3), (CX - nw - 8, neck_base + 1), (CX - nw - 18, neck_base + 5),
           (CX - sh, neck_base + drop - 3), (CX - sh - 5, neck_base + drop + 3), (CX - sh - 7, 96)]
    right = [(2 * CX - x, y) for x, y in reversed(pts)]
    return poly_mask(pts + right)


def cloth(mask, ramp, cuts=(0.3, 0.62, 0.9)):
    """Заливка одежды светом сверху-слева: ramp из 4 цветов, тёмное -> светлое."""
    jl = shade_ellipsoid(40, 104, 58, 36)
    return np.where(mask, band(jl, list(cuts), ramp), T)


def paint_cloth(c, mask, ramp, cuts=(0.3, 0.62, 0.9)):
    jl = shade_ellipsoid(40, 104, 58, 36)
    paint(c, mask, band(jl, list(cuts), ramp))


NOSES = {
    'straight': (-2, ['h...', 'hs..', 'hs..', 'hs..', 'hhs.', 'hhsS', 'S.SS']),
    'broad':    (-3, ['.h...', '.hs..', '.hs..', '.hhs.', 'hhhsS', 'hhhsS', 'SS.SS']),
    'small':    (-2, ['h..', 'hs.', 'hs.', 'hhS', 'S.S']),
    'button':   (-2, ['....', 'h...', 'hs..', 'hhs.', 'hhsS', 'S.S.']),
    'hooked':   (-2, ['h...', 'hh..', 'hhs.', 'hhs.', 'hhs.', 'hhsS', 'S.SS']),
}

MOUTH_M = {
    'neutral': ['.........', '.MMMMMMM.', '..kkkkk..'],
    'pleased': ['M.......M', '.MMMMMMM.', '..kkkkk..'],
    'annoyed': ['.........', '.MMMMMMM.', 'M..kkk..M'],
    'thinking': ['......MM.', '.MMMMMM..', '..kkk....'],
    'happy': ['M.......M', 'MMtttttMM', '.MoooooM.', '..MMMMM..'],
    'angry': ['MMMMMMMMM', 'MtMtMtMtM', '.MMMMMMM.'],
}
TALK_M = {
    'neutral': ['.MMMMMMM.', '.MoooooM.', '..MMMMM..'],
    'pleased': ['MMMMMMMMM', '.MtttttM.', '..MoooM..'],
    'annoyed': ['.MMMMMMM.', 'MtttttttM', '.MMMMMMM.'],
    'thinking': ['....MMMM.', '.MMMooM..', '..MMMM...'],
    'happy': ['M.......M', 'MMtttttMM', '.MtoooM..', '..MMMMM..'],
    'angry': ['MMMMMMMMM', 'MtttttttM', 'MoooooooM', '.MMMMMMM.'],
}
MOUTH_F = {
    'neutral': ['.mmmmm.', 'MMMMMMM', '.rrRrr.', '..rrr..'],
    'pleased': ['m.....m', 'MMMMMMM', '.rrRrr.', '..rrr..'],
    'annoyed': ['.......', 'MMMMMMM', '.rrrrr.', '.......'],
    'thinking': ['....mm.', '.MMMMM.', '.rrRr..', '.......'],
    'happy': ['m.....m', 'MtttttM', 'MoooooM', '.rrrrr.'],
    'angry': ['.......', 'MMMMMMM', 'M.rrr.M', '.......'],
}
TALK_F = {
    'neutral': ['.mmmmm.', 'MoooooM', '.rrRrr.', '..rrr..'],
    'pleased': ['mmmmmmm', 'MtttttM', '.MoooM.', '..rrr..'],
    'annoyed': ['.mmmmm.', 'MtttttM', 'MoooooM', '.rrrrr.'],
    'thinking': ['...mmm.', '.MMooM.', '.rrRr..', '.......'],
    'happy': ['mmmmmmm', 'MtttttM', 'MoooooM', '.rrrrr.'],
    'angry': ['mmmmmmm', 'MtttttM', 'MoooooM', '.MrrrM.'],
}


def glasses(c, eyL, eyR, ey, color, style='thin', lens=None):
    """Очки поверх глаз: thin — тонкая оправа, thick — толстая, half — только верхняя дужка."""
    if style == 'thick':
        rows = ['FFFFFFFFFF', 'F........F', 'F........F', 'F........F', 'F........F', 'FFFFFFFFFF']
    elif style == 'half':
        rows = ['FFFFFFFFFF', 'F........F', '..........', '..........', '..........', '..........']
    else:
        rows = ['.ffffffff.', 'f........f', 'f........f', 'f........f', '.ffffffff.']
    leg = {'F': color, 'f': color}
    put(c, eyL - 1, ey - 1, rows, leg)
    put(c, eyR - 1, ey - 1, rows, leg)
    line(c, [(eyL + 9, ey), (eyR - 1, ey)], color)
    c[ey, eyL - 2] = color
    c[ey, eyR + 9] = color
    # блик на стекле
    c[ey, eyL] = 45
    c[ey + 1, eyL] = 44
    c[ey, eyR] = 45
    c[ey + 1, eyR] = 44


def person(P, emotion, frame):
    c = np.full((H, W), T, int)
    xs, ys = grid()
    f: Face = P['face']
    S = P['skin']
    ey = P['ey']
    eyL, eyR = CX - 12 + P.get('eye_in', 0), CX + 4 - P.get('eye_in', 0)
    age = P['age']
    nw = P['neck']
    neck_base = f.chin_y + 9

    if 'back' in P:
        P['back'](c, P)

    body = torso(neck_base, nw, P.get('shoulders', 40), P.get('drop', 12))
    P['body'](c, P, body)

    # шея: тень от подбородка повторяет линию челюсти
    neck = poly_mask([(CX - nw, f.jaw_y - 4), (CX + nw, f.jaw_y - 4), (CX + nw + 1, neck_base + 1), (CX, neck_base + 4), (CX - nw - 1, neck_base + 1)])
    face = f.mask()
    paint(c, neck, S[1])
    paint(c, neck & (xs < CX - nw + 4), S[2])
    paint(c, neck & shift(face, 1, 2) & ~face, S[0])
    line(c, [(CX + nw - 2, f.chin_y + 2), (CX + 3, neck_base + 1)], S[0])  # грудино-ключичная мышца
    if not P['female']:
        c[f.chin_y + 4, CX - 1] = S[2]
        c[f.chin_y + 5, CX - 1] = S[2]

    if 'collar' in P:
        P['collar'](c, P)

    # уши
    for side in (-1, 1):
        ex = CX + side * (f.rx - 0.2)
        ear = ellipse_mask(ex + side * 1.5, ey + 3.5, 3.6, 6.0)
        paint(c, ear, S[2] if side < 0 else S[1])
        line(c, [(int(ex + side * 1.5), ey + 1), (int(ex + side * 1.5), ey + 6)], S[0])

    # лицо: объём + челюсть + скулы
    lam = shade_ellipsoid(CX - 3, (f.top + f.chin_y) / 2 - 4, f.rx + 3, (f.chin_y - f.top) / 2 + 2)
    paint(c, face, band(lam, P.get('cuts', [0.08, 0.3, 0.9]), S))
    low = ys > f.cy + 3
    paint(c, face & ~erode(face, 2) & low & (xs > CX + 2), S[1])
    paint(c, face & ~erode(face, 1) & (ys > f.cy + 8) & (xs > CX + 4), S[0])
    paint(c, face & ~erode(face, 1) & low & (xs > CX - 4) & (xs <= CX + 2), S[1])
    paint(c, face & (ys > f.chin_y - 1.5) & (np.abs(xs - CX) < f.chin_w - 1), S[1])
    # подбородок: блик и ямка под губой
    paint(c, face & ellipse_mask(CX - 1, f.chin_y - 3, max(f.chin_w - 2, 2), 1.4), S[2])
    # скулы: блик слева, впадина справа
    paint(c, face & ellipse_mask(CX - f.rx + 8, ey + 6, 2.2, 1.2), S[3])
    line(c, [(CX + f.rx - 6, ey + 8), (CX + f.rx - 7, ey + 12)], S[1])
    # глазницы: тень под бровью со стороны тени, переносица
    line(c, [(eyR + 1, ey - 1), (eyR + 6, ey - 1)], S[1])
    c[ey + 1, CX + 1] = S[1]
    c[ey + 2, CX + 1] = S[1]

    if 'hair' in P:
        P['hair'](c, P, emotion)

    E = {'w': 44, 'p': P.get('pupil', 37), 'L': P.get('lash', 12), 's': S[1], 'h': S[3], 't': 45, 'o': 19,
         'M': P.get('lip_line', 12), 'k': S[1], 'm': 26, 'r': 27, 'R': 28, 'S': S[0]}
    E.update(P.get('lips', {}))
    draw_eyes(c, E, eyL, eyR, ey, emotion, frame)
    if P['female']:
        c[ey, eyL - 1] = E['L']
        c[ey, eyR + 8] = E['L']

    # морщины по возрасту
    if age >= 38:
        k = 3 if age < 50 else 5
        line(c, [(CX - 7, ey + 11), (CX - 8, ey + 10 + k)], S[1])
        line(c, [(CX + 7, ey + 11), (CX + 8, ey + 10 + k)], S[0] if age >= 50 else S[1])
    if age >= 45:
        c[ey + 1, eyL - 2] = S[1]
        c[ey + 2, eyL - 2] = S[1]
        c[ey + 1, eyR + 9] = S[0]
        c[ey + 2, eyR + 9] = S[0]
        if P.get('forehead', True):
            line(c, [(CX - 5, ey - 11), (CX + 4, ey - 11)], S[1])
    if age >= 55:
        line(c, [(CX - 4, ey - 9), (CX + 3, ey - 9)], S[1])
        line(c, [(CX - 9, f.chin_y - 4), (CX - 10, f.chin_y - 1)], S[1])
        line(c, [(CX + 9, f.chin_y - 4), (CX + 10, f.chin_y - 1)], S[0])
    if emotion in ('annoyed', 'angry'):
        line(c, [(CX - 2, ey - 5), (CX - 2, ey - 3)], S[0])
        line(c, [(CX + 1, ey - 5), (CX + 1, ey - 3)], S[0])
    if emotion == 'thinking' and age >= 30:
        line(c, [(CX - 4, ey - 10), (CX + 1, ey - 11)], S[1])

    bl, br = BROWS[emotion]
    bc, bt = P['brow']
    line(c, [(eyL + dx, ey - 4 + dy) for dx, dy in bl], bc, thick=bt)
    line(c, [(eyR + dx, ey - 4 + dy) for dx, dy in br], bc, thick=bt)

    nx, nose = NOSES[P.get('nose', 'straight')]
    put(c, CX + nx, ey + 3, nose, E)

    if emotion == 'happy':
        put(c, eyL - 1, ey + 8, ['rr'], {'r': P.get('blush', 28)})
        put(c, eyR + 7, ey + 8, ['rr'], {'r': P.get('blush', 28)})
    if emotion == 'angry':
        put(c, eyL - 2, ey + 7, ['RRR', '.R.'], {'R': 27})
        put(c, eyR + 7, ey + 7, ['RRR', '.R.'], {'R': 27})

    if 'beard' in P:
        P['beard'](c, P, emotion)

    my = P.get('mouth_y', ey + 15)
    if P['female']:
        put(c, CX - 3, my, (TALK_F if frame == 'talk' else MOUTH_F)[emotion], E)
    else:
        put(c, CX - 4, my, (TALK_M if frame == 'talk' else MOUTH_M)[emotion], E)

    if 'moustache' in P:
        P['moustache'](c, P, emotion)
    if 'glasses' in P:
        glasses(c, eyL, eyR, ey, *P['glasses'])
    if 'extra' in P:
        P['extra'](c, P, emotion)

    return outline(c, {**DARK, **P.get('dark', {})})


def shirt_collar(c, nw, nb, light=45, dark=44, edge=43):
    """Воротник рубашки лежит на основании шеи: два клина от краёв шеи к центру."""
    left = [(CX - nw - 2, nb - 4), (CX - nw, nb - 5), (CX - 1, nb + 1), (CX - 3, nb + 4), (CX - nw - 2, nb)]
    right = [(2 * CX - x - 1, y) for x, y in left]
    paint(c, poly_mask(left), light)
    paint(c, poly_mask(right), dark)
    line(c, [(CX - nw, nb - 5), (CX - 1, nb + 1)], edge)


# ---------- персонажи ----------

def foreman():
    """Прораб, ~50: квадратная челюсть, короткая седеющая борода, ёжик, сигнальный жилет поверх клетки."""
    f = Face(top=17, cy=37, rx=19, jaw_y=55, jaw_w=17, chin_y=64, chin_w=8, jaw_p=2.6, cheek=2.4)
    HAIR = [18, 19, 19, 20]

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [1, 2, 2, 3])  # клетчатая рубашка
        for x in range(0, 96, 5):
            paint(c, m & (np.abs(xs - x - 0.5) < 0.6), 1)
        for y in range(78, 96, 5):
            paint(c, m & (np.abs(ys - y - 0.5) < 0.6), 1)
        vest = m & ~poly_mask([(36, 70), (60, 70), (54, 96), (42, 96)])
        paint_cloth(c, vest, [27, 28, 28, 29], cuts=(0.25, 0.55, 0.92))
        # светоотражающая полоса: выше края стола, чтобы жилет читался в сцене
        for y in (81, 82):
            paint(c, vest & (np.abs(ys - y - 0.5) < 0.6), 44)
        paint(c, vest & (np.abs(ys - 82.5) < 0.6), 43)
        paint(c, vest & (np.abs(ys - 81.5) < 0.6) & (xs > 62), 43)
        line(c, [(37, 71), (43, 96)], 26)
        line(c, [(59, 71), (53, 96)], 26)
        # ручка в кармане жилета
        put(c, 64, 76, ['b', 'b', 'B'], {'b': 2, 'B': 1})

    def collar(c, P):
        put(c, 37, 71, ['aa....', 'aaaa..', '.aaaa.', '..aa..'], {'a': 3})
        put(c, 53, 71, ['....aa', '..aaaa', '.aaaa.', '..aa..'], {'a': 2})

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 1.2, 21.5)
        hl = 23.5 + 2.5 * ((xs - CX) / f.rx) ** 2
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2) & (ys < 36)
        h = top | sides
        paint(c, h, band(shade_ellipsoid(CX - 4, f.cy - 10, f.rx + 2, 22), [0.25, 0.55, 0.85], HAIR))
        # ёжик: точки темнее
        for y in range(18, 24, 2):
            for x in range(34 + (y % 4), 62, 4):
                if h[y, x]:
                    c[y, x] = 18

    def beard(c, P, emotion):
        xs, ys = grid()
        face = f.mask()
        ey = P['ey']
        b = face & (ys > ey + 13) & ((np.abs(xs - CX) > f.hw(ys) - 3) | (ys > ey + 19))
        b &= ~((ys < ey + 20) & (np.abs(xs - CX) < 6))
        paint(c, b, band(shade_ellipsoid(CX - 3, 56, 20, 12), [0.3, 0.6], [18, 19, 20]))
        paint(c, b & (ys > f.chin_y - 1.5), 18)
        # щетина на скулах
        for x, y in ((31, ey + 11), (33, ey + 12), (63, ey + 11), (61, ey + 12), (32, ey + 13), (62, ey + 13)):
            if face[y, x]:
                c[y, x] = 19
        # седина пятнами
        for x, y in ((40, 58), (52, 60), (45, 62), (57, 56), (38, 55)):
            if b[y, x]:
                c[y, x] = 20

    def moustache(c, P, emotion):
        ey = P['ey']
        put(c, CX - 6, ey + 12, ['..GGGGGGGG..', '.GgggggggggG', 'Gg........gG'], {'G': 18, 'g': 20})

    return dict(face=f, skin=SKIN_MID, ey=37, age=50, female=False, neck=10, nose='broad', shoulders=42,
                brow=(18, 2), body=body, collar=collar, hair=hair, beard=beard, moustache=moustache, blush=28,
                mouth_y=37 + 16, forehead=True)


def dev():
    """IT, ~28: узкое лицо, рыжие взъерошенные волосы, короткая рыжая борода, фиолетовое худи."""
    f = Face(top=17, cy=38, rx=17, jaw_y=56, jaw_w=13, chin_y=65, chin_w=5, jaw_p=1.6, cheek=1.6)
    HAIR = [20, 21, 22, 23]

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [30, 31, 32, 32])
        # шнурки и карман-кенгуру
        line(c, [(43, 76), (42, 88)], 45)
        line(c, [(53, 76), (54, 88)], 44)
        c[89, 42] = 43
        c[89, 54] = 43
        line(c, [(30, 92), (66, 92)], 30)
        # принт на груди
        put(c, 58, 82, ['.yy.', 'y..y', '.yy.'], {'y': 22})

    def collar(c, P):
        # капюшон лежит вокруг шеи
        hood = ellipse_mask(CX, 76, 18, 7) & ~ellipse_mask(CX, 73, 11, 5)
        paint_cloth(c, hood, [31, 32, 33, 33], cuts=(0.3, 0.55, 0.85))
        line(c, [(38, 76), (58, 76)], 30)

    def back(c, P):
        xs, ys = grid()
        m = ellipse_mask(CX, f.cy - 5, f.rx + 4, 20)
        paint(c, m, 20)

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX + 1, f.cy - 5, f.rx + 3.5, 18.5)
        u = (xs - CX) / f.rx
        # чёлка набок, пряди зубцами
        hl = 25 + 2.5 * np.abs(u) + 2.0 * np.sin(xs * 1.4) - 3 * (u > 0.2)
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys < 38)
        h = top | sides
        paint(c, h, band(shade_ellipsoid(CX - 5, f.cy - 12, f.rx + 3, 20), [0.25, 0.55, 0.85], HAIR))
        for pts in ([(38, 16), (45, 14)], [(49, 14), (55, 16)], [(34, 22), (39, 18)], [(58, 20), (62, 24)]):
            line(c, pts, 23)
        for pts in ([(42, 21), (46, 26)], [(50, 20), (53, 25)], [(36, 24), (37, 28)]):
            line(c, pts, 20)
        # вихры над макушкой
        put(c, 44, 13, ['.hh..h', 'hhhhhh'], {'h': 21})

    def beard(c, P, emotion):
        xs, ys = grid()
        face = f.mask()
        b = face & (ys > P['ey'] + 13) & ((np.abs(xs - CX) > f.hw(ys) - 3) | (ys > P['ey'] + 20))
        b &= ~((ys < P['ey'] + 20) & (np.abs(xs - CX) < 7))
        paint(c, b, band(shade_ellipsoid(CX - 3, 58, 18, 10), [0.35, 0.65], [20, 21, 22]))

    def moustache(c, P, emotion):
        ey = P['ey']
        put(c, CX - 5, ey + 13, ['.gggggggg.', 'g........g'], {'g': 21})

    return dict(face=f, skin=SKIN_LIGHT, ey=38, age=28, female=False, neck=8, nose='small', shoulders=38, drop=14,
                brow=(20, 1), pupil=2, lash=19, cuts=[0.08, 0.35, 0.95], body=body, collar=collar, back=back, hair=hair, beard=beard,
                moustache=moustache, blush=35, eye_in=1)


def official():
    """Госзаказчик, ~60: круглое тяжёлое лицо, лысина с седым венчиком, очки, серый костюм, значок-флажок."""
    f = Face(top=15, cy=38, rx=20, jaw_y=57, jaw_w=18, chin_y=65, chin_w=9, jaw_p=2.0, cheek=3.0)
    HAIR = [40, 41, 42, 43]

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [37, 38, 39, 40])
        shirt = poly_mask([(39, 72), (57, 72), (54, 84), (48, 96), (42, 84)])
        paint(c, shirt, 45)
        paint(c, shirt & (xs > 48), 44)
        tie = poly_mask([(45, 76), (51, 76), (50, 80), (52, 96), (44, 96), (46, 80)])
        paint(c, tie, 2)
        paint(c, tie & (xs < 48), 3)
        line(c, [(46, 80), (50, 80)], 1)
        for y in (84, 89, 94):
            line(c, [(46, y), (50, y - 1)], 1)
        lap_l = poly_mask([(39, 72), (42, 84), (48, 96), (42, 96), (32, 86), (29, 77)])
        lap_r = poly_mask([(57, 72), (54, 84), (48, 96), (54, 96), (64, 86), (67, 77)])
        paint(c, lap_l, 40)
        paint(c, lap_r, 38)
        line(c, [(39, 72), (42, 84), (47, 95)], 37)
        line(c, [(57, 72), (54, 84), (49, 95)], 37)
        # флажок-триколор на лацкане
        put(c, 33, 82, ['www', 'bbb', 'rrr'], {'w': 45, 'b': 2, 'r': 27})

    def collar(c, P):
        shirt_collar(c, 11, 74)

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy, f.rx + 1.5, 23)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys > 27) & (ys < 43)
        paint(c, sides, band(shade_ellipsoid(CX - 4, f.cy - 6, f.rx + 2, 22), [0.25, 0.55, 0.85], HAIR))
        # блик на лысине
        put(c, 38, 19, ['..hhhh', '.hh...', 'h.....'], {'h': 17})
        line(c, [(45, 29), (52, 29)], 15)

    return dict(face=f, skin=SKIN_LIGHT, ey=38, age=60, female=False, neck=11, nose='button', shoulders=42,
                brow=(42, 2), body=body, collar=collar, hair=hair, glasses=(37, 'thin'), blush=28, lips={'k': 14},
                pupil=1)


def hr():
    """HR, ~42: овальное лицо, светлые волосы в пучке, белая блузка, розовый кардиган, серьги, бусы."""
    f = Face(top=19, cy=40, rx=17, jaw_y=57, jaw_w=12, chin_y=65, chin_w=4, jaw_p=1.4, cheek=1.8)
    HAIR = [21, 22, 23, 23]

    def back(c, P):
        # пучок на затылке и объём
        paint(c, ellipse_mask(CX + 3, 14, 7.5, 6), 22)
        paint(c, ellipse_mask(CX + 1, 13, 5, 3.5), 23)
        paint(c, ellipse_mask(CX + 3, 16, 7.5, 2), 21)
        paint(c, ellipse_mask(CX, f.cy, f.rx + 3, 22), 21)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [31, 32, 33, 33], cuts=(0.3, 0.6, 0.92))
        blouse = poly_mask([(38, 70), (58, 70), (56, 82), (48, 96), (40, 82)])
        paint(c, blouse, 45)
        paint(c, blouse & (xs > 49), 44)
        line(c, [(38, 71), (41, 82), (47, 95)], 32)
        line(c, [(58, 71), (55, 82), (49, 95)], 32)
        # пуговицы кардигана
        for y in (86, 92):
            c[y, 42] = 44
            c[y, 54] = 43

    def collar(c, P):
        shirt_collar(c, 7, 74)
        # бусы
        for x, y in ((42, 75), (44, 77), (46, 78), (48, 78), (50, 78), (52, 77), (54, 75)):
            c[y, x] = 44

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 2.5, 22.5)
        u = (xs - CX) / f.rx
        # гладко назад, пробор слева, волна чёлки направо
        hl = 25 + 4 * np.clip(-u - 0.1, 0, 1) + 7 * np.clip(u - 0.1, 0, 1) ** 1.5
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2) & (ys < P['ey'] + 2)
        h = top | sides
        paint(c, h, band(shade_ellipsoid(CX - 6, f.cy - 12, f.rx + 3, 22), [0.25, 0.5, 0.82], HAIR))
        for pts in ([(38, 21), (46, 19)], [(33, 28), (37, 23)], [(52, 21), (60, 27)]):
            line(c, pts, 23)
        for pts in ([(44, 24), (52, 22)], [(55, 26), (62, 32)], [(31, 34), (32, 40)]):
            line(c, pts, 21)

    def extra(c, P, emotion):
        ey = P['ey']
        # серьги-гвоздики
        put(c, CX - f.rx - 2, ey + 9, ['g', 'G'], {'g': 23, 'G': 21})
        put(c, CX + f.rx + 1, ey + 9, ['g', 'G'], {'g': 22, 'G': 20})

    return dict(face=f, skin=SKIN_LIGHT, ey=40, age=42, female=True, neck=7, nose='small', shoulders=36, drop=14,
                brow=(20, 1), pupil=2, lash=19, body=body, collar=collar, back=back, hair=hair, extra=extra,
                lips={'m': 33, 'M': 26, 'r': 34, 'R': 35}, blush=35, mouth_y=40 + 14, cuts=[0.08, 0.35, 0.95])


def realtor():
    """Аренда и недвижимость, ~34: лицо сердечком, длинные чёрные волосы, красный жакет, золотая цепочка."""
    f = Face(top=19, cy=40, rx=17, jaw_y=56, jaw_w=11, chin_y=65, chin_w=3, jaw_p=1.1, cheek=1.5)
    HAIR = [37, 38, 39, 40]

    def back(c, P):
        xs, ys = grid()
        m = ellipse_mask(CX, f.cy + 4, f.rx + 6, 30) & (ys < 88)
        m &= ~((ys > f.chin_y - 4) & (np.abs(xs - CX) < 9))
        paint(c, m, band(shade_ellipsoid(CX - 6, f.cy - 8, f.rx + 9, 30), [0.45], [37, 38]))

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [25, 26, 27, 27])
        top = poly_mask([(39, 72), (57, 72), (54, 86), (48, 96), (42, 86)])
        paint(c, top, 38)
        line(c, [(39, 72), (42, 86), (47, 95)], 25)
        line(c, [(57, 72), (54, 86), (49, 95)], 25)
        lap_l = poly_mask([(39, 72), (42, 86), (45, 96), (40, 96), (33, 86), (31, 78)])
        paint(c, lap_l, 28)

    def collar(c, P):
        # цепочка с кулоном
        for x, y in ((42, 74), (43, 76), (45, 78), (47, 79), (49, 79), (51, 78), (53, 76), (54, 74)):
            c[y, x] = 22
        put(c, 47, 80, ['gg', 'Gg'], {'g': 23, 'G': 21})

    def hair(c, P, emotion):
        xs, ys = grid()
        part = CX - 5
        vol = ellipse_mask(CX, f.cy, f.rx + 3, 24)
        left = np.clip((part - xs) / (part - (CX - f.rx)), 0, 1.3)
        right = np.clip((xs - part) / (CX + f.rx - part), 0, 1.3)
        hl = 24 + 4 * left + 9 * right ** 1.4
        top = vol & (ys < hl)
        cur_l = vol & (xs < CX - f.rx + 3) & (ys < 70)
        cur_r = vol & (xs > CX + f.rx - 4) & (ys < 70)
        h = top | cur_l | cur_r
        paint(c, h, band(shade_ellipsoid(CX - 6, f.cy - 12, f.rx + 3, 24), [0.25, 0.55, 0.85], HAIR))
        # пряди ниже плеч по бокам лица
        paint(c, poly_mask([(28, 44), (33, 46), (34, 70), (30, 84), (25, 80)]), 38)
        paint(c, poly_mask([(63, 44), (68, 46), (71, 80), (66, 84), (62, 70)]), 37)
        for pts in ([(part - 1, 19), (38, 22), (33, 30)], [(29, 50), (29, 66)], [(part + 2, 20), (57, 24)]):
            line(c, pts, 41)
        line(c, [(66, 52), (68, 72)], 39)
        for pts in ([(40, 21), (45, 20)], [(31, 34), (30, 44)], [(27, 60), (27, 72)]):
            line(c, pts, 40)

    def extra(c, P, emotion):
        ey = P['ey']
        put(c, CX - f.rx - 2, ey + 9, ['g', 'g', 'G'], {'g': 22, 'G': 21})

    return dict(face=f, skin=SKIN_MID, ey=40, age=34, female=True, neck=7, nose='small', shoulders=37, drop=14,
                brow=(37, 1), pupil=18, lash=37, body=body, back=back, collar=collar, hair=hair, extra=extra,
                lips={'m': 27, 'M': 26, 'r': 27, 'R': 28}, mouth_y=40 + 14, dark={37: 36, 38: 36})


def buyer():
    """Ритейл и закупки, ~52: круглое лицо, тёмная кожа, короткая стрижка с проседью, красные очки,
    бирюзовый жакет и шарф."""
    f = Face(top=19, cy=40, rx=18, jaw_y=57, jaw_w=14, chin_y=65, chin_w=6, jaw_p=1.8, cheek=2.2)
    HAIR = [36, 38, 39, 40]

    def back(c, P):
        paint(c, ellipse_mask(CX, f.cy - 1, f.rx + 4.5, 24) & ellipse_mask(CX, 36, 40, 15), 38)

    def body(c, P, m):
        xs, ys = grid()
        paint_cloth(c, m, [1, 2, 3, 3])
        paint(c, m & (np.abs(xs - CX) < 7), 38)

    def collar(c, P):
        xs, ys = grid()
        # шарф: узел и концы, золотой с узором
        scarf = poly_mask([(37, 70), (59, 70), (60, 78), (54, 82), (56, 96), (46, 96), (44, 82), (36, 78)])
        paint(c, scarf, 22)
        paint(c, scarf & (xs > 52), 21)
        for x, y in ((40, 73), (44, 76), (50, 73), (55, 76), (48, 86), (52, 91), (49, 94)):
            if scarf[y, x]:
                c[y, x] = 27
        line(c, [(44, 82), (54, 82)], 20)

    def hair(c, P, emotion):
        xs, ys = grid()
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 3, 23)
        u = (xs - CX) / f.rx
        # короткая стрижка, чёлка набок; уши открыты
        hl = 26 - 2 * u + 4 * u ** 2
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys < P['ey'] + 7 - 2 * (xs < CX))
        h = top | sides
        paint(c, h, band(shade_ellipsoid(CX - 5, f.cy - 12, f.rx + 3, 22), [0.25, 0.55, 0.85], HAIR))
        # седая прядь
        for pts in ([(38, 21), (44, 19), (50, 19)], [(35, 25), (39, 22)], [(52, 20), (58, 22)]):
            line(c, pts, 43)
        line(c, [(40, 23), (47, 21)], 44)

    def extra(c, P, emotion):
        ey = P['ey']
        # цепочка для очков
        for x, y in ((CX - f.rx - 1, ey + 2), (CX - f.rx - 2, ey + 6), (CX - f.rx - 1, ey + 10)):
            c[y, x] = 22

    return dict(face=f, skin=SKIN_DARK, ey=40, age=52, female=True, neck=8, nose='button', shoulders=39, drop=13,
                brow=(36, 1), lash=36, body=body, back=back, collar=collar, hair=hair, extra=extra,
                glasses=(27, 'thick'), lips={'m': 26, 'M': 25, 'r': 26, 'R': 27}, blush=27, mouth_y=40 + 14, cuts=[0.05, 0.2, 0.9],
                forehead=False)


SPECS = {'foreman': foreman, 'dev': dev, 'official': official, 'hr': hr, 'realtor': realtor, 'buyer': buyer}


def builder(spec_fn):
    P = spec_fn()
    return lambda emotion, frame: person(P, emotion, frame)


PEOPLE = {cid: builder(fn) for cid, fn in SPECS.items()}
