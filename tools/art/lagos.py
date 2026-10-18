"""Adebayo Adeyemi, 45: dark skin, cropped hair and a neat beard, teal suit and an Ankara pocket square.
Original pixel artwork in the shared Apollo palette; all six emotions use the same face construction.
"""
import numpy as np
from people import CX, Face, builder, paint_cloth, shirt_collar
from pixel import band, ellipse_mask, grid, line, paint, poly_mask, put, shade_ellipsoid


def spec():
    f = Face(top=17, cy=38, rx=19, jaw_y=55, jaw_w=16, chin_y=65, chin_w=8, jaw_p=2.3)

    def body(c, P, m):
        paint_cloth(c, m, [6, 6, 7, 7])
        shirt = poly_mask([(38, 70), (58, 70), (55, 87), (48, 96), (40, 86)])
        paint(c, shirt, 17)
        paint(c, shirt & (grid()[0] > CX), 16)
        paint(c, poly_mask([(38, 71), (42, 84), (48, 96), (40, 96), (29, 82)]), 7)
        paint(c, poly_mask([(58, 71), (54, 84), (48, 96), (56, 96), (67, 82)]), 6)
        line(c, [(38, 72), (41, 83), (46, 93)], 8)
        line(c, [(58, 72), (55, 83), (50, 93)], 7)
        put(c, 59, 80, ['..g..g..', '.gTggTg.', 'gTgTTgTg', 'ggTggTgg', 'dddddddd'], {'g': 22, 'T': 4, 'd': 6})
        for y in (79, 85, 91): c[y, 48] = 20

    def collar(c, P):
        shirt_collar(c, 10, 74, light=17, dark=16, edge=14)

    def hair(c, P, emotion):
        xs, ys = grid()
        cap = ellipse_mask(CX, 34, 20, 20) & ((ys < 24 + 0.011 * (xs - CX) ** 2) | ((np.abs(xs - CX) > 17) & (ys < 38)))
        paint(c, cap, 36)
        paint(c, cap & (xs < CX) & ((xs.astype(int) + 2 * ys.astype(int)) % 5 == 0), 39)
        paint(c, cap & (np.abs(xs - CX) > 18) & (ys > 29), 38)

    def beard(c, P, emotion):
        xs, ys = grid()
        b = f.mask() & (ys > 49) & ((np.abs(xs - CX) > f.hw(ys) - 3) | (ys > 59))
        paint(c, b, band(shade_ellipsoid(42, 57, 20, 12), [0.35, 0.7], [36, 37, 39]))
        paint(c, b & (ys > 60) & ((3 * xs.astype(int) + 5 * ys.astype(int)) % 11 == 0), 38)  # sparse stipple, no diagonal stripes

    def moustache(c, P, emotion):
        put(c, 42, 51, ['..gggggggg..', '.Gg......gG.'], {'g': 37, 'G': 36})

    def extra(c, P, emotion):
        # Understated cheek highlights, no painted red patches on dark skin.
        if emotion in ('happy', 'angry'):
            for x0 in (34, 59):
                for y in range(45, 49):
                    for x in range(x0, x0 + 4):
                        if c[y, x] in (27, 28): c[y, x] = 13

    return dict(face=f, skin=[18, 12, 13, 14], ey=37, age=45, female=False, neck=10,
                nose='broad', shoulders=41, brow=(36, 2), pupil=18, lash=36,
                body=body, collar=collar, hair=hair, beard=beard, moustache=moustache, extra=extra,
                mouth_y=54, cuts=[0.12, 0.48, 0.92], blush=13, forehead=False)


build = builder(spec)
