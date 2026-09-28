"""Общие примитивы для пиксельных портретов: сетка 96x96, маски, заливки, глаза."""
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
                if 0 <= y + t < H and 0 <= x < W:
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


# ---------- общие части лица ----------

BROWS = {
    'neutral': ([(0, 0), (4, -1), (7, 0)], [(0, 0), (3, -1), (7, 0)]),
    'pleased': ([(0, 0), (4, -2), (7, -1)], [(0, -1), (3, -2), (7, 0)]),
    'annoyed': ([(0, -2), (7, 1)], [(0, 1), (7, -2)]),
    'thinking': ([(0, 1), (7, 1)], [(0, -1), (3, -3), (7, -2)]),
    'happy': ([(0, -1), (4, -3), (7, -2)], [(0, -2), (3, -3), (7, -1)]),
    'angry': ([(0, -3), (7, 2)], [(0, 2), (7, -3)]),
}

# рампы тёмное -> светлое; контур берёт цвет на две ступени темнее своего
_RAMPS = [[36, 0, 1, 2, 3, 4, 5], [36, 6, 7, 8, 9, 10, 11], [12, 13, 14, 15, 16, 17], [18, 19, 20, 21, 22, 23],
          [24, 25, 26, 27, 28, 29], [30, 31, 32, 33, 34, 35], [36, 37, 38, 39, 40, 41, 42, 43, 44, 45]]
DARK = {}
for _r in _RAMPS:
    for _i, _c in enumerate(_r):
        DARK.setdefault(_c, _r[max(_i - 2, 0)])
DARK[12] = 24
DARK[18] = 24
DARK[36] = 36


def erode(mask, k=1):
    m = mask.copy()
    for _ in range(k):
        m = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    return m


def shift(mask, dx, dy):
    out = np.zeros_like(mask)
    h, w = mask.shape
    ys = slice(max(dy, 0), h + min(dy, 0))
    xs = slice(max(dx, 0), w + min(dx, 0))
    ys0 = slice(max(-dy, 0), h + min(-dy, 0))
    xs0 = slice(max(-dx, 0), w + min(-dx, 0))
    out[ys, xs] = mask[ys0, xs0]
    return out
