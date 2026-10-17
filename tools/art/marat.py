"""Марат Гимадиев, 54, коммерческий директор гофрокомбината: три варианта нового лица на общем person().

Татарское лицо: широкие скулы, крепкая челюсть, тёмные волосы с проседью, брови низко — взгляд оценивающий.
Нейтральный рот с одним приподнятым уголком — лёгкая ирония. Дорогой тёмный костюм.

  v1 — короткая стрижка с сединой на висках, аккуратные усы, тёмно-синий костюм, бордовый галстук
  v2 — залысины, короткая седеющая щетина-борода, очки-полуоправа, графитовый костюм без галстука
  v3 — тёмные волосы зачёсаны назад, чисто выбрит, прищур, почти чёрный костюм, тёмно-синий галстук
  v3y — v3 моложе, ~45: почти без седины, кожа ровнее, лицо чуть уже (выбор капитана, DEFAULT)

Выбор варианта для игры: tools/art/portraits.py rinat --rinat v2 (без флага — DEFAULT, old — прежнее лицо).
Все варианты и превью: tools/art/portraits.py --rinat-variants
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from people import CX, MOUTH_M, SKIN_MID, TALK_M, Face, paint_cloth, person, shirt_collar  # noqa: E402
from pixel import band, ellipse_mask, grid, line, paint, poly_mask, put, shade_ellipsoid, shift  # noqa: E402

# рот: в покое правый уголок чуть выше — усмешка; остальные эмоции общие
IRONIC = {**MOUTH_M,
          'neutral': ['........M', '.MMMMMMM.', '..kkkkk..'],
          'thinking': ['.......MM', '.MMMMMM..', '..kkk....']}
IRONIC_TALK = {**TALK_M, 'neutral': ['.MMMMMMMM', '.MoooooM.', '..MMMMM..']}

# широкое лицо: скулы держат ширину почти до челюсти, челюсть квадратная
FACE = dict(top=17, cy=38, rx=19.5, jaw_y=56, jaw_w=16.5, chin_y=65, chin_w=7, jaw_p=2.3, cheek=3.2)


def hair_paint(c, mask, ramp, f):
    paint(c, mask, band(shade_ellipsoid(CX - 5, f.cy - 12, f.rx + 3, 22), [0.25, 0.55, 0.85], ramp))


def suit(c, m, ramp, lapel_hi, lapel_lo, edge, shirt=(45, 44), tie=None, open_neck=None):
    """Пиджак с лацканами; tie=(светлый, тёмный, узел) или open_neck=цвет кожи в вырезе."""
    xs, ys = grid()
    paint_cloth(c, m, ramp)
    sh = poly_mask([(39, 71), (57, 71), (55, 84), (48, 96), (41, 84)])
    paint(c, sh, shirt[0])
    paint(c, sh & (xs > 48), shirt[1])
    if tie:
        t = poly_mask([(45, 76), (51, 76), (50, 80), (52, 96), (44, 96), (46, 80)])
        paint(c, t, tie[0])
        paint(c, t & (xs > 48), tie[1])
        line(c, [(46, 80), (50, 80)], tie[2])
    if open_neck:
        skin = poly_mask([(43, 73), (53, 73), (51, 80), (48, 85), (45, 80)])
        paint(c, skin, open_neck[0])
        paint(c, skin & (xs > 49), open_neck[1])
        line(c, [(48, 86), (48, 96)], shirt[1])
        c[86, 47] = shirt[0] - 2
        c[92, 47] = shirt[0] - 2
    lap_l = poly_mask([(39, 72), (42, 84), (48, 96), (42, 96), (32, 86), (29, 77)])
    lap_r = poly_mask([(57, 72), (54, 84), (48, 96), (54, 96), (64, 86), (67, 77)])
    paint(c, lap_l, lapel_hi)
    paint(c, lap_r, lapel_lo)
    line(c, [(39, 72), (42, 84), (47, 95)], edge)
    line(c, [(57, 72), (54, 84), (49, 95)], edge)
    line(c, [(31, 80), (34, 82)], edge)  # вырез лацкана
    line(c, [(65, 80), (62, 82)], edge)
    # платок в нагрудном кармане
    line(c, [(57, 85), (63, 85)], edge)


def cheekbones(c, P, f):
    """Высокие широкие скулы: светлый мазок под глазом слева, тень-впадина под скулой справа и слева."""
    ey, S = P['ey'], P['skin']
    face = f.mask()
    paint(c, face & ellipse_mask(CX - f.rx + 6, ey + 6, 3.2, 1.3), S[3])
    paint(c, face & ellipse_mask(CX + f.rx - 6, ey + 6, 2.6, 1.1), S[2])
    c[ey + 10, int(CX + f.rx - 5)] = S[0]
    c[ey + 11, int(CX + f.rx - 5)] = S[0]
    # надбровье тяжёлое, глаза глубже
    line(c, [(CX - 11, ey - 1), (CX - 6, ey - 1)], S[2])
    c[ey, CX - 1] = S[1]


def v1():
    """Короткая стрижка, седые виски, тёмные усы с проседью, тёмно-синий костюм, бордовый галстук."""
    f = Face(**FACE)
    HAIR = [37, 38, 39, 40]
    ey = 39

    def body(c, P, m):
        suit(c, m, [0, 1, 1, 2], 2, 0, 36, tie=(25, 24, 26))
        put(c, 33, 83, ['gg', 'Gg'], {'g': 22, 'G': 20})  # значок завода
        put(c, 58, 83, ['wwwww'], {'w': 44})

    def collar(c, P):
        shirt_collar(c, 11, 74)

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        vol = ellipse_mask(CX, f.cy - 2, f.rx + 2, 24.5)
        # пробор слева, чуть зализано назад
        hl = 25 + 3 * u ** 2 + 1.0 * (u < -0.3)
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys < ey + 1)
        h = top | sides
        hair_paint(c, h, HAIR, f)
        line(c, [(40, 15), (39, 24)], 36)
        for pts in ([(43, 20), (50, 18), (57, 19)], [(33, 23), (36, 18)]):
            line(c, pts, 37)
        for pts in ([(44, 16), (51, 15)], [(58, 17), (61, 20)]):
            line(c, pts, 41)
        # седина на висках и над ушами
        temple = h & (np.abs(xs - CX) > f.rx - 3) & (ys >= 27)
        paint(c, temple & (xs < CX), 42)
        paint(c, temple & (xs > CX), 41)
        for y, x in ((25, 30), (26, 31), (25, 66), (26, 65), (22, 33), (22, 63)):
            if h[y, x]:
                c[y, x] = 41
        # проседь по всей голове — редкие светлые точки
        for y, x in ((14, 46), (15, 53), (17, 38), (18, 49), (19, 57), (20, 42), (21, 52), (16, 60), (22, 36), (23, 47)):
            if h[y, x]:
                c[y, x] = 40 if x > CX else 41

    def moustache(c, P, emotion):
        put(c, CX - 6, ey + 12, ['..GGGGGGGG..', '.GgggggggggG', 'GgG......GgG'], {'G': 37, 'g': 38})
        c[ey + 13, CX - 2] = 41
        c[ey + 13, CX + 3] = 40

    def extra(c, P, emotion):
        cheekbones(c, P, f)

    return dict(face=f, skin=SKIN_MID, ey=ey, age=55, female=False, neck=11, nose='straight', shoulders=42, drop=12,
                brow=(37, 2), brow_dy=1, pupil=18, body=body, collar=collar, hair=hair, moustache=moustache,
                extra=extra, blush=27, mouth_y=ey + 16, mouths=(IRONIC, IRONIC_TALK), cuts=[0.1, 0.32, 0.88])


def v2():
    """Залысины, короткая седеющая щетина-борода, очки-полуоправа, графитовый костюм, рубашка без галстука."""
    f = Face(**{**FACE, 'jaw_w': 16})
    HAIR = [38, 39, 40, 41]
    ey = 39

    def body(c, P, m):
        suit(c, m, [37, 38, 39, 40], 40, 38, 36, shirt=(45, 44), open_neck=(P['skin'][1], P['skin'][0]))
        put(c, 58, 83, ['bbbbb'], {'b': 3})

    def collar(c, P):
        # раскрытый ворот: уголки лежат поверх лацканов
        put(c, 35, 69, ['aaa.....', 'aaaaa...', 'aaaaaa..', '.aaaaab.', '..aaab..', '...ab...', '....b...'], {'a': 45, 'b': 43})
        put(c, 53, 69, ['.....aaa', '...aaaaa', '..aaaaaa', '.baaaaa.', '..baaa..', '...ba...', '...b....'], {'a': 44, 'b': 42})

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        vol = ellipse_mask(CX, f.cy - 1, f.rx + 1.2, 22.5)
        # ёжик с глубокими залысинами: мысок по центру, виски открыты
        hl = 20 + 7 * np.clip(np.abs(u) - 0.18, 0, 1) ** 0.6 + 2 * u ** 2
        top = vol & (ys < hl) & (ys > 15)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys > 26) & (ys < ey + 1)
        h = top | sides
        hair_paint(c, h, HAIR, f)
        for y in range(17, 23, 2):
            for x in range(40 + (y % 4), 58, 3):
                if h[y, x]:
                    c[y, x] = 38
        paint(c, sides & (xs < CX), 42)
        paint(c, sides & (xs > CX), 40)
        # блик на залысинах
        put(c, 33, 23, ['.h', 'h.'], {'h': 16})
        put(c, 61, 23, ['h.', '.h'], {'h': 15})

    def beard(c, P, emotion):
        xs, ys = grid()
        face = f.mask()
        # короткая, плотная по подбородку и челюсти, щёки — щетина
        b = face & (ys > ey + 15) & ((np.abs(xs - CX) > f.hw(ys) - 2.5) | (ys > ey + 21))
        b &= ~((ys < ey + 21) & (np.abs(xs - CX) < 6))
        paint(c, b, band(shade_ellipsoid(CX - 4, 58, 18, 10), [0.4, 0.75], [39, 40, 41]))
        edge = b & ~shift(b, 0, 1)
        paint(c, edge & ((xs + ys) % 2 == 0), 13)
        for x, y in ((39, 60), (55, 58), (46, 63), (51, 62), (36, 57), (42, 62), (58, 56)):
            if b[y, x]:
                c[y, x] = 43

    def moustache(c, P, emotion):
        put(c, CX - 5, ey + 13, ['.gggggggg.', 'G........G'], {'g': 40, 'G': 39})
        c[ey + 13, CX] = 42

    def extra(c, P, emotion):
        cheekbones(c, P, f)

    return dict(face=f, skin=SKIN_MID, ey=ey, age=55, female=False, neck=11, nose='straight', shoulders=42, drop=12,
                brow=(38, 2), brow_dy=1, pupil=18, body=body, collar=collar, hair=hair, beard=beard,
                moustache=moustache, extra=extra, glasses=(36, 'half'), blush=27, mouth_y=ey + 16,
                mouths=(IRONIC, IRONIC_TALK), cuts=[0.1, 0.32, 0.88], forehead=True)


def v3_squint(c, P, emotion, frame):
    """Прищур в покое и в раздумье: верхнее веко на строку ниже — смотрит, прикидывает."""
    if frame == 'blink' or emotion not in ('neutral', 'thinking'):
        return
    ey, S = P['ey'], P['skin']
    eyL, eyR = CX - 12, CX + 4
    for x0 in (eyL, eyR):
        line(c, [(x0 + 1, ey), (x0 + 6, ey)], S[2])
        line(c, [(x0, ey + 1), (x0 + 7, ey + 1)], 12)


def v3():
    """Тёмные волосы с проседью зачёсаны назад, чисто выбрит, прищур, почти чёрный костюм, тёмно-синий галстук."""
    f = Face(**{**FACE, 'jaw_w': 17, 'chin_w': 9, 'jaw_p': 3.0})
    HAIR = [37, 38, 39, 40]
    ey = 39
    frame_of = {}

    def body(c, P, m):
        suit(c, m, [36, 37, 38, 38], 38, 36, 36, tie=(1, 0, 2))
        line(c, [(46, 84), (50, 83)], 2)
        line(c, [(46, 89), (50, 88)], 2)
        put(c, 58, 83, ['wwwww'], {'w': 43})

    def collar(c, P):
        shirt_collar(c, 11, 74)

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        vol = ellipse_mask(CX, f.cy - 3, f.rx + 2.2, 25.5)
        # зачёс назад: лоб открыт, линия волос ровная, лёгкие залысины по углам
        hl = 23 + 2.5 * u ** 2 + 2.5 * np.exp(-((np.abs(u) - 0.6) / 0.15) ** 2)
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys < ey)
        h = top | sides
        hair_paint(c, h, HAIR, f)
        # пряди назад — дугами от лба к макушке, седые нити
        for pts in ([(37, 23), (42, 15), (49, 12)], [(52, 23), (56, 16), (60, 15)], [(31, 27), (34, 20)]):
            line(c, pts, 37)
        for pts in ([(41, 22), (45, 15), (50, 13)], [(58, 23), (61, 18)]):
            line(c, pts, 41)
        line(c, [(47, 22), (51, 16)], 42)
        temple = h & (np.abs(xs - CX) > f.rx - 3) & (ys >= 28)
        paint(c, temple & (xs < CX), 41)
        paint(c, temple & (xs > CX), 40)

    def extra(c, P, emotion):
        cheekbones(c, P, f)
        v3_squint(c, P, emotion, frame_of.get('f', 'idle'))
        # складка-ямка на подбородке
        c[f.chin_y - 2, CX] = P['skin'][0]

    P = dict(face=f, skin=SKIN_MID, ey=ey, age=55, female=False, neck=12, nose='hooked', shoulders=43, drop=11,
             brow=(36, 2), brow_dy=1, pupil=18, body=body, collar=collar, hair=hair, extra=extra,
             blush=27, mouth_y=ey + 16, mouths=(IRONIC, IRONIC_TALK), cuts=[0.1, 0.32, 0.88])
    P['_frame'] = frame_of
    return P


def v3y():
    """v3 моложе, ~45: те же зачёс назад, прищур и чёрный костюм, но волосы почти без седины,
    кожа ровнее, лицо чуть уже, морщин минимум."""
    P = v3()
    f = Face(**{**FACE, 'rx': 19, 'cheek': 2.6, 'jaw_w': 16.5, 'chin_w': 8.5, 'jaw_p': 2.8})
    HAIR = [36, 37, 38, 39]
    ey = P['ey']
    frame_of = P['_frame']

    def hair(c, P, emotion):
        xs, ys = grid()
        u = (xs - CX) / f.rx
        vol = ellipse_mask(CX, f.cy - 3, f.rx + 2.4, 25.8)
        # зачёс назад, линия волос ровная и чуть ниже, без залысин
        hl = 22.5 + 2.2 * u ** 2 + 1.0 * np.exp(-((np.abs(u) - 0.62) / 0.15) ** 2)
        top = vol & (ys < hl)
        sides = vol & (np.abs(xs - CX) > f.rx - 2.5) & (ys < ey)
        h = top | sides
        hair_paint(c, h, HAIR, f)
        # пряди назад — тёмные дуги и блики, одна-две седые нити у виска
        for pts in ([(37, 23), (42, 15), (49, 12)], [(52, 22), (56, 16), (60, 15)], [(31, 27), (34, 20)]):
            line(c, pts, 36)
        for pts in ([(41, 21), (45, 15), (50, 13)], [(58, 22), (61, 18)]):
            line(c, pts, 39)
        line(c, [(47, 21), (51, 16)], 40)
        c[30, 30] = 40
        c[31, 66] = 39

    def extra(c, P, emotion):
        S = P['skin']
        face = f.mask()
        # скулы мягче, чем у v3: только блик и лёгкая тень
        paint(c, face & ellipse_mask(CX - f.rx + 6, ey + 6, 3.0, 1.2), S[3])
        v3_squint(c, P, emotion, frame_of.get('f', 'idle'))

    P.update(face=f, hair=hair, extra=extra, age=44, neck=11, cuts=[0.07, 0.28, 0.86], brow=(36, 2))
    return P


VARIANTS = {'v1': v1, 'v2': v2, 'v3': v3, 'v3y': v3y}
DEFAULT = 'v3y'


def builder(name):
    P = VARIANTS[name]()
    frame_of = P.pop('_frame', None)

    def fn(emotion, frame):
        if frame_of is not None:
            frame_of['f'] = frame
        return person(P, emotion, frame)
    return fn
