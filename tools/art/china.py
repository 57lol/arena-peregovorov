"""Ли Вэй, 38: яркая рубашка, жилет с карманами, телефон в руке."""
import numpy as np
from people import Face, SKIN_MID, builder
from pixel import band, ellipse_mask, grid, line, paint, poly_mask, put, shade_ellipsoid

# Глаза уже, чем у общего набора: узкий миндаль, верхнее веко без складки, тёмная радужка почти во весь разрез,
# внешний уголок на точку выше внутреннего. Левый глаз; правый зеркалим (кроме взгляда в сторону).
EYES = {
    'open':   ['........', '.LLLLL..', 'LwpppwLL', '..ppw...'],
    'smile':  ['........', '.LLLLLL.', 'LwpppwLL', '.hhhhhh.'],
    'narrow': ['........', '........', 'LLLLLLLL', '.wwppws.'],
    'side':   ['........', '.LLLLL..', 'LwwwppLL', '....pp..'],
    'closed': ['........', '........', 'LLLLLLL.', '..ssss..'],
    'arc':    ['........', '.LLLL...', 'L....LL.', '........'],
    'glare':  ['L.......', 'LLLLLLLL', '.wwppL..', '.ssssss.'],
}
EYE_STATE = {'neutral': 'open', 'pleased': 'smile', 'happy': 'arc', 'thinking': 'side', 'annoyed': 'narrow', 'angry': 'glare'}


def eyes(c, E, eyL, eyR, ey, emotion, frame):
    st = 'closed' if frame == 'blink' else EYE_STATE[emotion]
    put(c, eyL, ey, EYES[st], E)
    put(c, eyR, ey, EYES[st], E, flip=(st != 'side'))


def spec():
    face = Face(top=16, cy=38, rx=20, jaw_y=55, jaw_w=17, chin_y=65, chin_w=8, cheek=2.3)

    def body(c, p, mask):
        xs, ys = grid()
        light = shade_ellipsoid(38, 94, 55, 30)
        paint(c, mask, band(light, [0.3, 0.6, 0.9], [25, 26, 27, 28]))
        # Рубашка в клетку, тёмный рабочий жилет.
        paint(c, mask & ((xs % 9 == 0) | (ys % 9 == 0)), 21)
        for points in ([(29, 73), (38, 71), (42, 96), (18, 96)], [(58, 71), (68, 74), (79, 96), (54, 96)]):
            paint(c, poly_mask(points), 2)
        line(c, [(39, 75), (44, 95)], 4)
        line(c, [(57, 75), (53, 95)], 0)
        put(c, 26, 83, ['aaaaaaaa', 'abbbbbba', 'abbbbbba', 'aaaaaaaa'], {'a': 0, 'b': 3})
        for y in (80, 87, 94):
            c[y, 48] = 45

    def collar(c, p):
        paint(c, poly_mask([(38, 70), (43, 70), (48, 79), (40, 76)]), 28)
        paint(c, poly_mask([(53, 70), (58, 70), (55, 78), (49, 79)]), 26)

    def hair(c, p, emotion):
        xs, ys = grid()
        cap = ellipse_mask(48, 36, 21, 23)
        edge = 24 + 2 * ((xs - 48) / 20) ** 2 + np.clip((xs - 44) / 8, 0, 2)
        mask = cap & ((ys < edge) | ((abs(xs - 48) > 18) & (ys < 39)))
        paint(c, mask, band(shade_ellipsoid(41, 22, 23, 19), [0.25, 0.65], [36, 37, 38]))
        for points in ([(34, 22), (40, 18), (48, 17)], [(41, 22), (50, 19), (57, 20)]):
            line(c, points, 39)

    def extra(c, p, emotion):
        # Телефон и пальцы поверх одежды; лицо остаётся открытым.
        paint(c, poly_mask([(66, 92), (68, 81), (73, 79), (81, 87), (81, 96), (68, 96)]), p['skin'][2])
        paint(c, poly_mask([(65, 68), (77, 66), (82, 87), (69, 90)]), 36)
        paint(c, poly_mask([(67, 70), (75, 69), (79, 85), (71, 87)]), 4)
        line(c, [(69, 73), (74, 72)], 45)
        line(c, [(70, 77), (75, 76)], 22)
        line(c, [(71, 81), (76, 80)], 45)
        line(c, [(67, 84), (71, 82), (74, 84)], p['skin'][3], thick=3)
        line(c, [(78, 86), (81, 87)], p['skin'][1], thick=2)

    return dict(face=face, skin=SKIN_MID, ey=38, age=38, female=False, neck=9,
                nose='small', shoulders=42, brow=(37, 1), brow_dy=1, pupil=37, eyes=eyes,
                body=body, collar=collar, hair=hair, extra=extra, forehead=False)


build = builder(spec)
