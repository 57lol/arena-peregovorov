"""Ли Вэй, 38, магазин датчиков в Иу: аккуратная стрижка с пробором, рубашка цвета морской волны,
тёмно-зелёный стёганый жилет с карманами. Говорит по видеосвязи, руки вне кадра."""
import numpy as np
from people import CX, MOUTH_M, Face, SKIN_MID, builder, paint_cloth, shirt_collar
from pixel import band, ellipse_mask, grid, line, paint, poly_mask, put, shade_ellipsoid

# Глаза уже, чем у общего набора: миндаль без складки века, тёмная радужка почти во весь разрез, блик.
# Левый глаз; правый зеркалим (кроме взгляда в сторону).
EYES = {
    'open':   ['........', '.LLLLLL.', 'LwtppwLL', '.swpppw.'],
    'smile':  ['........', '.LLLLLL.', 'LwtppwLL', '.hhhhhh.'],
    'narrow': ['........', '........', 'LLLLLLLL', '.wtppws.'],
    'side':   ['........', '.LLLLLL.', 'LwwwtppL', '.swwwpp.'],
    'closed': ['........', '........', 'LLLLLLL.', '..ssss..'],
    'arc':    ['........', '.LLLLL..', 'L.....L.', '........'],
    'glare':  ['L.......', '.LLLLLLL', '.wtppwL.', '..ssss..'],
}
EYE_STATE = {'neutral': 'open', 'pleased': 'smile', 'happy': 'arc', 'thinking': 'side', 'annoyed': 'narrow', 'angry': 'glare'}


def eyes(c, E, eyL, eyR, ey, emotion, frame):
    st = 'closed' if frame == 'blink' else EYE_STATE[emotion]
    put(c, eyL, ey, EYES[st], E)
    put(c, eyR, ey, EYES[st], E, flip=(st != 'side'))


# Рот: в покое лёгкая улыбка, в кадре talk рот заметно открыт.
MOUTHS = {
    **MOUTH_M,
    'neutral': ['.........', '.M.....M.', '..MMMMM..', '...kkk...'],
    'pleased': ['M.......M', '.MtttttM.', '..MMMMM..'],
    'happy':   ['M.......M', 'MMtttttMM', '.MMMMMMM.'],
    'annoyed': ['.........', '.MMMMMMM.', 'M.......M'],
    'angry':   ['.........', 'MMMMMMMMM', 'M.kkkkk.M'],
}
TALKS = {
    'neutral': ['.M.....M.', '.MMMMMMM.', '.MoooooM.', '..MMMMM..'],
    'pleased': ['M.......M', 'MMtttttMM', 'MoooooooM', '.MoooooM.', '..MMMMM..'],
    'happy':   ['M.......M', 'MMtttttMM', 'MoooooooM', '.MoooooM.', '..MMMMM..'],
    'thinking': ['.....MMM.', '..MMMooM.', '..MoooM..', '...MMM...'],
    'annoyed': ['.........', '.MMMMMMM.', 'MtttttttM', '.MMMMMMM.'],
    'angry':   ['.MMMMMMM.', 'MtttttttM', 'MoooooooM', '.MMMMMMM.'],
}


def spec():
    f = Face(top=17, cy=38, rx=18, jaw_y=55, jaw_w=14, chin_y=64, chin_w=6, jaw_p=1.7, cheek=2.0)
    HAIR = [36, 37, 38, 39]
    VEST = [6, 7, 7, 7]

    def body(c, P, m):
        xs, ys = grid()
        # рубашка цвета морской волны
        paint_cloth(c, m, [2, 3, 3, 4])
        # стёганый жилет: проймы открывают рукава рубашки, спереди вырез
        vest = m & poly_mask([(10, 96), (20, 82), (30, 77), (38, 72), (48, 88), (58, 72), (66, 77), (76, 82), (86, 96)])
        paint_cloth(c, vest, VEST, cuts=(0.25, 0.55, 0.9))
        for y in range(80, 96, 5):
            paint(c, vest & (np.abs(ys - y - 0.5) < 0.6), 6)
        # молния и кант выреза
        line(c, [(38, 72), (47, 88), (47, 95)], 6)
        line(c, [(58, 72), (49, 88), (49, 95)], 6)
        line(c, [(48, 89), (48, 95)], 42)
        # карманы с клапанами
        put(c, 29, 86, ['aaaaaa', 'bbbbbb'], {'a': 6, 'b': 8})
        put(c, 61, 86, ['aaaaaa', 'bbbbbb'], {'a': 6, 'b': 7})
        # пуговицы рубашки
        for y in (79, 84):
            c[y, 48] = 45

    def collar(c, P):
        shirt_collar(c, 9, 73, light=5, dark=4, edge=2)

    def hair(c, P, emotion):
        xs, ys = grid()
        part = CX - 7
        # аккуратная короткая стрижка: виски коротко, сверху объём, от пробора слева зачёс вправо-вверх
        vol = ellipse_mask(CX + 1, f.cy - 6, f.rx + 2, 21, p=2.5)
        hl = np.interp(xs, [27, 31, 35, part - 1, part + 1, 46, 54, 61, 65, 69],
                       [33, 28, 25.5, 24.5, 24, 23.5, 23.5, 25, 28, 33])
        top = vol & (ys < hl)
        sides = ellipse_mask(CX, f.cy, f.rx + 1, 22) & (np.abs(xs - CX) > f.rx - 2) & (ys < P['ey'] - 1)
        h = top | sides
        sh = shade_ellipsoid(CX - 8, f.cy - 16, f.rx + 4, 22)
        paint(c, h, 37)
        paint(c, h & (sh < 0.3), 36)
        paint(c, top & (sh > 0.75), 38)
        # виски коротко — с проседью кожи, светлее
        paint(c, sides & (ys > 27) & (np.abs(xs - CX) > f.rx - 1), 39)
        # блик-прядь: дуга от пробора по объёму вправо
        d = np.abs(ys - (16.5 + 0.035 * (xs - 47) ** 2))
        paint(c, top & (d < 1.6) & (xs > part + 1) & (xs < 60), 39)
        paint(c, top & (d < 0.7) & (xs > part + 3) & (xs < 54), 40)
        paint(c, top & (d < 0.6) & (xs > 44) & (xs < 49), 41)
        # вторая прядь ниже, у края чёлки
        d2 = np.abs(ys - (21 + 0.03 * (xs - 50) ** 2))
        paint(c, top & (d2 < 0.7) & (xs > part + 3) & (xs < 59), 39)
        # слева от пробора — короче, прядь вниз к виску
        d3 = np.abs(ys - (18 + 0.9 * (part - 2 - xs)))
        paint(c, top & (d3 < 0.8) & (xs < part - 1) & (xs > 31), 39)
        # пробор
        line(c, [(part, 13), (part, 18), (part - 1, 23)], 36)

    return dict(face=f, skin=SKIN_MID, ey=38, age=38, female=False, neck=8,
                nose='small', shoulders=40, brow=(36, 2), brow_dy=0, pupil=18, lash=36, eyes=eyes,
                body=body, collar=collar, hair=hair, forehead=False, mouths=(MOUTHS, TALKS),
                cuts=[0.08, 0.3, 0.88], blush=28, dark={38: 36, 39: 37})


build = builder(spec)
