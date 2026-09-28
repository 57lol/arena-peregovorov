"""Комнаты кампании «Новенький»: остановка у ларька (street) и магазин «Семёрочка» (shop).

Приёмы те же, что в room3d.py: палитра Apollo, свет запечён, мелочь — атлас в трёх вариантах освещённости,
большие поверхности — свои текстуры. Улица — не комната: вместо стен задники в 12–14 м, на которых вид
нарисован «лучами» из глаз игрока (камера только вращается, поэтому перспектива на задниках верная),
туман — ступенями палитры по расстоянию.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/rooms_a.py [street] [shop]
Пишет public/assets/world/<kind>_*.png, src/game/world3d/rooms/<kind>.gen.ts и превью в tools/art/out/.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import room3d as R  # noqa: E402
from apollo import RGB  # noqa: E402
from room3d import T, Atlas, Tex, darker, lighter, text_w, wood  # noqa: E402

ROOT = R.ROOT
OUT = R.OUT
PREV = R.PREV
GEN_DIR = os.path.join(ROOT, 'src', 'game', 'world3d', 'rooms')
TABLE = R.TABLE
rng = np.random.default_rng(2609)

# --- глаза игрока из layout.ts ---------------------------------------------------------------------------
_src = open(os.path.join(ROOT, 'src', 'game', 'world3d', 'layout.ts'), encoding='utf-8').read()
_e = re.search(r'export const EYE = \{ x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+) \}', _src)
EYE = np.array([float(_e.group(1)), float(_e.group(2)), float(_e.group(3))])

# --- недостающие буквы для мелкого шрифта (room3d.FONT знает не весь алфавит) -----------------------------
R.FONT.update({
    'Г': ['###', '#..', '#..', '#..', '#..'],
    'Ж': ['#.#.#', '#.#.#', '.###.', '#.#.#', '#.#.#'],
    'И': ['#..#', '#..#', '#.##', '##.#', '#..#'],
    'Й': ['#.##', '#..#', '#.##', '##.#', '#..#'],
    'У': ['#.#', '#.#', '.##', '..#', '##.'],
    'Ф': ['.#.', '###', '#.#', '###', '.#.'],
    'Х': ['#.#', '#.#', '.#.', '#.#', '#.#'],
    'Ш': ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
    'Щ': ['#.#.#.', '#.#.#.', '#.#.#.', '#.#.#.', '######'],
    'Ы': ['#...#', '#...#', '##..#', '#.#.#', '##..#'],
    'Ь': ['#..', '#..', '##.', '#.#', '##.'],
    'Ю': ['#.##.', '#.#.#', '###.#', '#.#.#', '#.##.'],
    ':': ['.', '#', '.', '#', '.'],
    ',': ['.', '.', '.', '#', '#'],
    '+': ['...', '.#.', '###', '.#.', '...'],
    '%': ['#.#', '..#', '.#.', '#..', '#.#'],
    '₽': ['##.', '#.#', '##.', '###', '#..'],
    '«': ['..', '.#', '#.', '.#', '..'],
    '»': ['..', '#.', '.#', '#.', '..'],
    '!': ['#', '#', '#', '.', '#'],
    '?': ['##.', '..#', '.#.', '...', '.#.'],
    '/': ['..#', '..#', '.#.', '#..', '#..'],
    '·': ['.', '.', '#', '.', '.'],
    '*': ['#.#', '.#.', '#.#', '...', '...'],
})


def bold_text(t, x, y, s, c, k=1):
    """Жирный текст: та же строка со сдвигом на точку вправо."""
    t.text(x, y, s, c, k)
    t.text(x + k, y, s, c, k)


def center_text(t, cx, y, s, c, k=1, bold=False):
    x = int(cx - text_w(s, k) / 2)
    if bold:
        bold_text(t, x, y, s, c, k)
    else:
        t.text(x, y, s, c, k)


# --- смешивание цветов с палитрой: туман и тёплый свет ------------------------------------------------------
PAL = np.array(RGB, float) / 255


def nearest(c, allow=None):
    """Ближайший цвет Apollo — та же мера, что в post.ts."""
    p = PAL if allow is None else PAL[allow]
    r = (c[..., None, 0] + p[:, 0]) / 2
    d = c[..., None, :] - p
    dd = (2 + r) * d[..., 0] ** 2 + 4 * d[..., 1] ** 2 + (3 - r) * d[..., 2] ** 2
    i = dd.argmin(-1)
    return i if allow is None else np.array(allow)[i]


def lut_mix(target, f, allow=None):
    """LUT: каждый цвет палитры, подмешанный к target на долю f, снова в палитру. Индекс -1 остаётся -1."""
    t = PAL[target] if isinstance(target, (int, np.integer)) else np.asarray(target, float) / 255
    return np.append(nearest(PAL * (1 - f) + t * f, allow), T)


FOG_C = 44
FOG_LEVELS = [0.0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92]
# в тумане цвета сводим только к спокойным (серые, голубые, бежевые) — без неожиданной зелени и сиреневого
FOG_ALLOW = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27, 28, 29,
             36, 37, 38, 39, 40, 41, 42, 43, 44, 45]
FOG_LUT = np.stack([lut_mix(FOG_C, f, FOG_ALLOW) for f in FOG_LEVELS])
# тёплый свет фонаря — вручную: серое уходит в бежевое, коричневое светлеет, зелень светлеет; синее не трогаем
_W = list(range(46))
for _a, _b in ((36, 12), (37, 12), (38, 13), (39, 13), (40, 13), (41, 14), (42, 15), (43, 16), (44, 17), (45, 17),
               (6, 7), (7, 8), (8, 9), (9, 10), (10, 11), (12, 13), (13, 14), (14, 15), (15, 16), (16, 17),
               (18, 19), (19, 20), (20, 21), (21, 22), (22, 23), (25, 26), (26, 27), (27, 28), (28, 29)):
    _W[_a] = _b
_W = np.array(_W + [T])
WARM_LUT = [None, _W, _W[np.append(_W[:46], 46 - 47)]]
BAYER2 = np.array([[0.0, 0.5], [0.75, 0.25]])
BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16 + 1 / 32


def fog_level(d, d0=34.0):
    """Доля тумана по расстоянию, м."""
    return 1 - np.exp(-np.maximum(d, 0) / d0)


def apply_fog(a, f, ys=None, xs=None, dither=True):
    """a — индексы, f — доля тумана (0..1). Ступени палитры с мелкой шахматкой на стыках."""
    n = len(FOG_LEVELS) - 1
    lv = np.interp(f, FOG_LEVELS, np.arange(n + 1))
    if dither:
        if ys is None:
            ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        lv = lv + (BAYER2[ys % 2, xs % 2] - 0.375) * 0.5
    lv = np.clip(np.round(lv), 0, n).astype(int)
    return FOG_LUT[lv, a]


def warm(a, m, k=1):
    """Тёплый свет фонаря/окна: цвета внутри маски m — к жёлтому на k ступеней."""
    a[m] = WARM_LUT[k][a[m]]


# ======================================================================================================
# УЛИЦА: остановка «Молодёжная», ларёк «ШАУРМА 24», 7:35, туман
# ======================================================================================================

S_PLACE = {
    # ларёк: x0, x1, z фасада, глубина, высота
    'kiosk': [-3.7, -0.1, -3.8, 1.9, 2.0],
    # окошко на фасаде: x0, x1, y0, y1
    'kwin': [-1.62, -0.62, 0.9, 1.56],
    # часы на ларьке над окошком: x, y, z (центр), r
    'clock': [-0.92, 1.81, -3.8 + 0.018, 0.138],
    # вывеска на крыше: x0, x1, y0, y1
    'sign': [-3.62, -0.18, 2.0, 2.4],
    # фонари: основание x, z; голова x, y, z; радиус светового пятна на земле
    'lamps': [[-3.65, -2.45, -3.05, 4.1, -2.45, 2.0], [5.25, -0.2, 5.85, 4.3, -0.2, 2.1], [5.25, -10.6, 5.85, 4.3, -10.6, 2.2]],
    # павильон остановки: x задней стенки, x передней кромки, z ближнего и дальнего края, высота
    'pavilion': [4.0, 5.1, -1.9, -4.7, 2.4],
    # столб с табличкой остановки
    'stop_pole': [4.55, -5.15],
    'bin': [2.72, -1.55],
    'dog': [-2.75, -2.75],
    'birches': [[-5.7, -0.9, 0], [-7.0, 1.7, 1], [-4.1, 3.6, 0], [3.3, 3.2, 1]],
    'pigeons': [[2.35, 0.95], [2.62, 1.25], [2.2, 1.45]],
    # дорога вдоль z: x бордюра, x0, x1 проезжей части, полосы для машин
    'road': [5.4, 5.6, 11.6, 7.1, 10.1],
    # на столе
    'shawarma': [1.05, -0.33, 0.35],
    'cup': [-1.08, -0.22],
    'seeds': [1.33, 0.06, -0.4],
    # задники: z дальнего, x боковых, z ближнего, высота; небо — потолок на этой высоте
    'walls': [-14.0, 13.0, 12.0, 16.0],
    # туман кольцом: x, z стенок кольца, высота
    'fogring': [9.5, -11.0, 9.0, 4.5],
}

SW = 0.05  # м на тексель у задников
SG = 0.025  # м на тексель у ближней земли
SGF = 0.05  # у дальней земли


# --- шумы по миру: случайные «плитки», которые берём по координатам -----------------------------------
NOISE = {s: rng.random((512, 512)) for s in (0.025, 0.1, 0.4, 1.6)}


def noise(X, Z, s):
    n = NOISE[s]
    return n[np.floor(Z / s).astype(int) % 512, np.floor(X / s).astype(int) % 512]


def snoise(X, Z, s):
    """Плавный шум: билинейно между узлами сетки — пятна округлые, а не квадратами."""
    n = NOISE[s]
    fx, fz = X / s, Z / s
    x0, z0 = np.floor(fx).astype(int), np.floor(fz).astype(int)
    tx, tz = fx - x0, fz - z0
    tx, tz = tx * tx * (3 - 2 * tx), tz * tz * (3 - 2 * tz)
    g = lambda i, j: n[(z0 + j) % 512, (x0 + i) % 512]  # noqa: E731
    return (g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - tz) + (g(0, 1) * (1 - tx) + g(1, 1) * tx) * tz


def seg_dist(X, Z, a, b):
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    t = np.clip(((X - ax) * dx + (Z - az) * dz) / (dx * dx + dz * dz), 0, 1)
    return np.hypot(X - ax - t * dx, Z - az - t * dz)


PUDDLES = [(-3.45, -0.75, 0.55, 0.3, 0.3), (3.05, -3.0, 0.7, 0.35, -0.2), (0.6, 1.95, 0.45, 0.25, 0.5),
           (-1.9, -4.9, 0.8, 0.35, 0.1), (8.0, -3.0, 1.2, 0.45, 0.0), (6.3, -9.0, 1.0, 0.35, 0.0),
           (9.5, 2.5, 1.4, 0.5, 0.0), (4.4, 2.0, 0.6, 0.3, 0.0)]


def ground(X, Z, fine=True):
    """Земля по мировым координатам: индексы Apollo без тумана и без света."""
    P = S_PLACE
    n1 = noise(X, Z, 0.025)
    n2 = snoise(X, Z, 0.1)
    n3 = snoise(X, Z, 0.4) * 0.7 + snoise(X, Z, 0.1) * 0.3
    n4 = snoise(X, Z, 1.6)
    # трава: к концу сентября тусклая, пятнами
    a = np.where(n3 < 0.36, 7, 8)
    a = np.where((n3 > 0.66) & (n4 > 0.45), 9, a)
    a = np.where((n4 > 0.72) & (n3 > 0.7), 10, a)
    # тропинки: от стола к общаге за спиной и наискосок во двор
    path = (seg_dist(X, Z, (0.3, 1.2), (1.4, 12.5)) < 0.55 + 0.2 * n3) | \
           (seg_dist(X, Z, (-4.8, -2.4), (-14, 9)) < 0.6 + 0.25 * n3) | \
           (seg_dist(X, Z, (-4.8, -5.8), (-12, -16)) < 0.55 + 0.2 * n3)
    dirt = np.where(n3 < 0.35, 12, 13)
    dirt = np.where((n2 > 0.82) & (n3 > 0.35), 14, dirt)
    dirt = np.where((n1 > 0.975) & fine, 14, dirt)
    a = np.where(path, dirt, a)
    # вытоптанная земля под столом, неровные края с пучками травы
    edge = 0.25 * (n3 - 0.5) + 0.12 * (n2 - 0.5)
    tbl = (np.abs(X) < 2.75 + edge) & (Z > -1.95 + edge) & (Z < 1.65 + edge)
    a = np.where(tbl, dirt, a)
    a = np.where(tbl & (n2 > 0.84) & (np.abs(X) > 2.2), 7, a)
    # площадка у ларька и остановки: старый асфальт с заплатками
    plaza = ((X > -4.95 + edge) & (X < 5.4) & (Z > -6.4) & (Z < -1.75 + edge)) | ((X > 3.45 + edge) & (X < 5.4))
    asph = np.where(n3 < 0.3, 39, 40)
    asph = np.where(n3 > 0.78, 41, asph)
    asph = np.where((n1 > 0.985) & fine, 41, asph)
    a = np.where(plaza, asph, a)
    # дорога, бордюры, тротуар напротив
    cx, x0, x1 = P['road'][:3]
    road = (X >= x0) & (X < x1)
    ra = np.where(n3 < 0.25, 38, 39)
    ra = np.where(n3 > 0.8, 40, ra)
    # колея: две тёмные полосы на каждой полосе движения
    for lane in (P['road'][3], P['road'][4]):
        for off in (-0.75, 0.75):
            ra = np.where(np.abs(X - lane - off) < 0.22, np.where(n2 < 0.6, 38, 39), ra)
    # разметка: прерывистая по оси, стёртая
    mid = (x0 + x1) / 2
    dash = (np.abs(X - mid) < 0.06) & ((Z % 9.0) < 3.0) & (n2 > 0.25)
    ra = np.where(dash, 43, ra)
    # зебра у остановки
    zeb = (Z > -8.2) & (Z < -6.2) & (((X - x0) % 1.0) < 0.5) & (n1 > 0.2)
    ra = np.where(zeb, 44, ra)
    a = np.where(road, ra, a)
    curb = ((X >= cx) & (X < x0)) | ((X >= x1) & (X < x1 + 0.2))
    cb = np.where((Z % 1.0) < 0.04, 42, 43)
    cb = np.where(n2 > 0.8, 44, cb)
    a = np.where(curb, cb, a)
    walk = (X >= x1 + 0.2) & (X < x1 + 2.2)
    a = np.where(walk, asph, a)
    # люк на площадке
    r = np.hypot(X - 1.55, Z - (-3.35))
    a = np.where(r < 0.33, np.where((r > 0.27) | ((np.floor((X - 1.55) / 0.08) + np.floor(Z / 0.08)) % 2 == 0), 39, 40), a)
    # лужи: отражают бледное небо, тёмный мокрый ободок
    for (px, pz, rx, rz, ang) in PUDDLES:
        c, s_ = np.cos(ang), np.sin(ang)
        u = ((X - px) * c + (Z - pz) * s_) / rx
        v = (-(X - px) * s_ + (Z - pz) * c) / rz
        q = u * u + v * v + 0.35 * (n3 - 0.5)
        a = np.where(q < 1.25, np.where(a >= 36, 38, darker(a)), a)
        a = np.where(q < 1.0, np.where(v < -0.2, 43, 42), a)
        a = np.where((q < 1.0) & (np.abs(v + 0.05) < 0.08) & (n2 > 0.5), 44, a)
    # опавшие листья: на траве гуще, к бордюрам ветер сносит кучками
    grass = np.isin(a, [7, 8, 9, 10, 11])
    lv = np.where(grass, (n1 > 0.975) | ((n1 > 0.9) & (n3 > 0.72)), (n1 > 0.99) & (n3 > 0.5))
    lvs = lv | (road & (np.abs(X - x0) < 0.3) & (n1 > 0.8))
    leaf = np.where(n2 > 0.66, 23, np.where(n2 > 0.3, 22, np.where(n2 > 0.12, 21, 29)))
    a = np.where(lvs, leaf, a)
    return a


def ground_tex(x0, x1, z0, z1, s, fine=True, fog=True):
    """Земля кусок [x0, x1] × [z0, z1]: строка 0 — дальний край (z0), как пол в room3d."""
    w, h = round((x1 - x0) / s), round((z1 - z0) / s)
    xs = x0 + (np.arange(w) + 0.5) * s
    zs = z0 + (np.arange(h) + 0.5) * s
    X, Z = np.meshgrid(xs, zs)
    t = Tex(w, h, 0)
    t.a = ground(X, Z, fine)
    P = S_PLACE
    # контактные тени: стол, лавки, ларёк, павильон, урна, стволы
    L = TABLE['halfLen']
    sh = np.zeros_like(X, bool)
    sh |= (np.abs(X) < L + 0.08) & (Z > TABLE['far'] - 0.08) & (Z < TABLE['near'] + 0.1)
    sh |= (np.abs(X) < 1.72) & (Z > -1.28) & (Z < -0.78)  # дальняя лавка
    sh |= (np.abs(X) < 1.72) & (Z > 0.7) & (Z < 1.12)  # наша лавка
    sh |= (np.abs(np.abs(X) - 1.88) < 0.22) & (Z > -0.85) & (Z < 0.25)  # торцы
    kx0, kx1, kz, kd, _ = P['kiosk']
    sh |= (X > kx0 - 0.12) & (X < kx1 + 0.12) & (Z > kz - kd - 0.1) & (Z < kz + 0.14)
    px0, px1, pz0, pz1, _ = P['pavilion']
    sh |= (X > px0 - 0.1) & (X < px1 + 0.12) & (Z > pz1 - 0.1) & (Z < pz0 + 0.1)
    bx, bz = P['bin']
    sh |= np.hypot(X - bx, Z - bz) < 0.34
    for (lx, lz, *_r) in P['lamps']:
        sh |= np.hypot(X - lx, Z - lz) < 0.16
    for (tx, tz, _v) in P['birches']:
        sh |= np.hypot((X - tx) / 1.0, (Z - tz) / 0.6) < 0.35
    t.a[sh] = darker(t.a[sh])
    deep = (np.abs(X) < L - 0.1) & (Z > TABLE['far'] + 0.08) & (Z < TABLE['near'] - 0.1)
    deep |= (X > kx0 - 0.02) & (X < kx1 + 0.02) & (Z > kz - 0.02) & (Z < kz + 0.05)
    t.a[deep] = darker(t.a[deep])
    # свет: пятна фонарей (две ступени, шахматка на краю) и окошко ларька
    ys, xs_ = np.mgrid[0:h, 0:w]
    for (lx, lz, hx, hy, hz, r) in P['lamps']:
        d = np.hypot(X - hx, Z - hz) / r + 0.12 * (BAYER2[ys % 2, xs_ % 2] - 0.4)
        m1 = d < 1.0
        t.a[m1] = lighter(t.a[m1])
        warm(t.a, (d < 0.45) & ((ys + xs_) % 2 == 0), 1)
    wx0, wx1 = P['kwin'][:2]
    spill = (Z > kz) & (Z < kz + 1.5) & (X > wx0 - 0.4 * (Z - kz)) & (X < wx1 + 0.4 * (Z - kz))
    spill &= (BAYER2[ys % 2, xs_ % 2] < 0.7 - (Z - kz) * 0.35)
    warm(t.a, spill, 1)
    if fog:
        d = np.hypot(X - EYE[0], Z - EYE[2])
        t.a = apply_fog(t.a, fog_level(d), ys, xs_)
    return t, X, Z


# --- трещины и заплатки на ближнем асфальте -------------------------------------------------------------

def cracks(t, x0, z0, s):
    M = lambda x, z: ((x - x0) / s, (z - z0) / s)  # noqa: E731
    r2 = np.random.default_rng(11)
    for _ in range(26):
        x = r2.uniform(-4.8, 5.3)
        z = r2.uniform(-6.2, -1.9)
        pts = [M(x, z)]
        a = r2.uniform(0, 2 * np.pi)
        for _k in range(int(r2.integers(3, 7))):
            a += r2.normal(0, 0.6)
            x += np.cos(a) * r2.uniform(0.1, 0.35)
            z += np.sin(a) * r2.uniform(0.1, 0.35)
            pts.append(M(x, z))
        for (px, py), (qx, qy) in zip(pts, pts[1:]):
            n = int(max(abs(qx - px), abs(qy - py), 1))
            for i in range(n + 1):
                xx, yy = int(round(px + (qx - px) * i / n)), int(round(py + (qy - py) * i / n))
                if 0 <= xx < t.w and 0 <= yy < t.h and t.a[yy, xx] in (39, 40, 41, 42):
                    t.a[yy, xx] = 38


# --- задники: «лучи» из глаз ---------------------------------------------------------------------------

# дома: x0, x1, z0, z1, высота, стиль
BUILDINGS = [
    (16.0, 28.0, -17.0, 8.0, 15.4, 'panel', 1),  # через дорогу
    (16.0, 28.0, 15.0, 42.0, 15.4, 'panel', 2),  # через дорогу за спиной
    (-30.0, -18.0, -21.0, 14.0, 15.4, 'panel', 3),  # двор слева
    (-36.0, -3.0, -46.0, -32.0, 15.4, 'panel', 4),  # за ларьком
    (-26.0, 8.0, 22.0, 34.0, 15.4, 'dorm', 5),  # общага за спиной
    (-17.6, -14.6, -13.5, -3.0, 2.4, 'garage', 6),  # гаражи
    (-17.6, -14.6, 1.5, 9.0, 2.4, 'garage', 7),
    (20.0, 26.0, -40.0, -27.0, 6.5, 'shop', 8),  # магазинчик за пустырём
]
# забор из плит вдоль пустыря за дорогой
FENCE = (14.2, -60.0, -18.5, 2.3)


def panel_facade(u, y, style, seed, n_):
    """Фасад панельного дома по координатам на стене (u — вдоль, м; y — высота). -> индексы."""
    a = np.full(u.shape, 43 if style != 'dorm' else 16)
    if style == 'dorm':
        a = np.where(noise(u, y, 0.4) > 0.7, 15, a)
    mod = 3.2  # шаг панелей
    fl = 2.8
    y0 = 0.9  # цоколь
    fi = np.floor((y - y0) / fl)
    fy = (y - y0) - fi * fl
    mi = np.floor(u / mod)
    mu = u - mi * mod
    body = (y > y0) & (fi < 5)
    # швы панелей
    a = np.where(body & ((fy < 0.06) | (mu < 0.05)), 42, a)
    # окна
    win = body & (mu > 0.9) & (mu < 2.35) & (fy > 0.85) & (fy < 2.3)
    h = noise(mi * 0.37 + seed * 3.1, fi * 0.41 + seed, 0.1)  # у каждого окна своё
    wc = np.where(fy > 1.6, 41, 40)
    lit = h > 0.9
    wc = np.where(lit, np.where(h > 0.975, 5, np.where(h > 0.95, 17, 23)), wc)
    wc = np.where(lit & (np.abs(mu - 1.62) < 0.05), darker(wc), wc)  # переплёт
    wc = np.where(~lit & (np.abs(mu - 1.62) < 0.04), 42, wc)
    wc = np.where(~lit & (h < 0.3) & (fy > 1.2), 15, wc)  # шторы
    a = np.where(win, wc, a)
    # балконы через секцию: плита и решётка, на некоторых бельё
    bal = body & (fi >= 1) & ((mi % 3) == 1) & (mu > 0.55) & (mu < 2.7) & (fy < 0.95) & (fy > -0.05)
    bc = np.where(fy < 0.12, 42, np.where((np.floor(mu / 0.12) % 2) == 0, 41, 42))
    bc = np.where((h > 0.6) & (fy > 0.45) & (fy < 0.9) & (np.floor(mu / 0.35) % 2 == 0), np.where(h > 0.8, 27, 44), bc)
    a = np.where(bal, bc, a)
    # цоколь и подъезды
    a = np.where(y <= y0, 41, a)
    door = (y < 2.2) & ((mi % 6) == 2) & (mu > 1.0) & (mu < 2.2)
    a = np.where(door, np.where(y < 0.9, 20, 20), a)
    a = np.where(door & (y > 1.9), 23, a)  # лампочка над подъездом
    canopy = (y > 2.2) & (y < 2.45) & ((mi % 6) == 2) & (mu > 0.7) & (mu < 2.5)
    a = np.where(canopy, 41, a)
    # парапет
    top = 0.9 + 5 * fl
    a = np.where((y > top - 0.15), 42, a)
    return a


def garage_facade(u, y, seed):
    a = np.full(u.shape, 41)
    mi = np.floor(u / 3.0)
    mu = u - mi * 3.0
    h = noise(mi * 0.37 + seed, seed * 0.3, 0.1)
    col = np.where(h > 0.66, 20, np.where(h > 0.33, 2, 40))
    doorm = (mu > 0.3) & (mu < 2.7) & (y < 2.0)
    a = np.where(doorm, col, a)
    a = np.where(doorm & (np.abs(mu - 1.5) < 0.03), darker(col), a)
    a = np.where(doorm & (noise(u, y, 0.1) > 0.8), 21, a)  # ржавчина
    a = np.where(y > 2.2, 39, a)
    return a


def shop_facade(u, y):
    a = np.full(u.shape, 44)
    a = np.where((y > 4.3) & (y < 5.3), 8, a)  # зелёная вывеска «Семёрочки» — такая же сеть
    a = np.where((y > 4.3) & (y < 5.3) & (np.abs(u - 3.0) < 1.8) & (noise(u, y, 0.1) > 0.3), 23, a)
    a = np.where((y > 0.3) & (y < 3.4) & ((u % 2.0) > 0.25), 23, a)  # витрины светятся
    return a


def fence_color(u, y):
    a = np.full(u.shape, 43)
    a = np.where((u % 2.0) < 0.12, 42, a)
    dia = (np.abs(((u % 0.5) - 0.25)) + np.abs(((y % 0.5) - 0.25)) < 0.12) & (y > 0.4) & (y < 1.9)
    a = np.where(dia, 42, a)
    return a


def birch_sprite(s, seed, w_m=3.2, h_m=8.0, color='yellow'):
    """Берёза в осенней листве. s — м на тексель. Ствол по центру снизу."""
    r2 = np.random.default_rng(seed)
    w, h = round(w_m / s), round(h_m / s)
    t = Tex(w, h, T)
    cx = w / 2
    tw = max(2, round(0.24 / s))
    lean = r2.uniform(-0.06, 0.06)
    top = int(h * 0.12)
    for y in range(top, h):
        k = (h - y) / h
        x = cx + lean * (h - y)
        ww = max(1, int(tw * (0.45 + 0.55 * (1 - k))))
        t.rect(x - ww / 2, y, x + ww / 2 - 1 + 0.5, y, 45)
        t.px(x + ww / 2 - 1, y, 44)
        if r2.random() < 0.18 and ww > 1:
            t.rect(x - ww / 2, y, x - ww / 2 + r2.integers(1, max(2, ww)), y, 37)
    base = max(3, round(0.55 / s))  # у земли кора тёмная, с продольными трещинами
    for y in range(h - base, h):
        x = cx + lean * (h - y)
        ww = max(1, int(tw * (0.45 + 0.55 * (1 - (h - y) / h))))
        if y > h - base * 0.6 or (y + int(x)) % 3 == 0:
            t.rect(x - ww / 2, y, x + ww / 2 - 1 + 0.5, y, 40)
            t.px(x - ww / 2 + 1 + (y // 2) % max(1, ww - 1), y, 37)
    # ветви
    branches = []
    for _ in range(int(r2.integers(7, 11))):
        y = r2.uniform(top + 2, h * 0.62)
        x = cx + lean * (h - y)
        d = r2.choice([-1, 1])
        L = r2.uniform(0.18, 0.42) * w
        ex, ey = x + d * L, y - r2.uniform(0.05, 0.2) * h
        t.line([(x, y), ((x + ex) / 2, (y + ey) / 2 - 1), (ex, ey)], 41)
        branches.append((ex, ey))
    # листва: гроздья эллипсов, между ними просветы
    pal = {'yellow': (21, 22, 23, 29), 'late': (20, 21, 22, 23), 'green': (8, 9, 10, 22)}[color]
    xs, ys = t.grid()
    blobs = [(bx + r2.normal(0, 2), by + r2.normal(0, 3)) for (bx, by) in branches for _ in range(3)]
    blobs += [(cx + r2.normal(0, w * 0.18), r2.uniform(top, h * 0.55)) for _ in range(14)]
    rr = max(1.5, 0.45 / s)
    for bx, by in sorted(blobs, key=lambda p: p[1]):
        rx, ry = rr * r2.uniform(0.9, 1.6), rr * r2.uniform(0.8, 1.2)
        m = ((xs - bx) / rx) ** 2 + ((ys - by) / ry) ** 2 <= 1
        hole = r2.random(m.shape) < 0.08
        t.mask(m & ~hole, pal[1])
        t.mask(m & ~hole & (ys < by - ry * 0.3), pal[2])
        t.mask(m & ~hole & (xs > bx + rx * 0.3) & (ys > by), pal[0])
        t.mask(m & (r2.random(m.shape) < 0.05), pal[3])
    # свисающие плети с листьями
    for _ in range(int(w * 0.25)):
        x = cx + r2.normal(0, w * 0.22)
        y0 = r2.uniform(top, h * 0.5)
        for k in range(int(r2.integers(3, max(4, int(0.9 / s))))):
            if r2.random() < 0.6:
                t.px(x + r2.normal(0, 0.4), y0 + k, pal[r2.integers(0, 3)])
    return t


def lamp_far_sprite(s):
    """Фонарь вдоль дороги, для задников: столб, голова и тёплый конус в тумане."""
    w, h = round(3.0 / s), round(5.0 / s)
    t = Tex(w, h, T)
    px_ = round(0.6 / s)
    for y in range(h):
        k = y / h
        if y > round(0.7 / s):
            half = (y - 0.7 / s) * 0.36
            for x in range(int(px_ + 0.6 / s - half), int(px_ + 0.6 / s + half) + 1):
                if (x + y) % 3 == 0 and k > 0.18:
                    t.px(x, y, 17)
    t.rect(px_, round(0.6 / s), px_, h - 1, 42)
    t.rect(px_, round(0.6 / s), px_ + round(0.6 / s), round(0.6 / s), 42)
    t.rect(px_ + round(0.45 / s), round(0.6 / s) + 1, px_ + round(0.75 / s), round(0.6 / s) + 1, 23)
    return t


def far_panorama():
    """Горизонт по азимуту и высоте (0.1°): лесополоса, корпуса и трубы ОЭЗ, пар, факел, краны."""
    AZ0, EL0, K = -180.0, 14.0, 10  # верхняя строка — 14° над горизонтом, 10 точек на градус
    W, H = 3600, 160
    t = Tex(W, H, T)
    C = lambda az: (az - AZ0) * K  # noqa: E731
    Rw = lambda el: (EL0 - el) * K  # noqa: E731
    r2 = np.random.default_rng(5)
    # лесополоса по всему кругу
    for az in np.arange(-180, 180, 0.1):
        hh = 0.35 + 0.25 * np.sin(az * 0.7) + 0.2 * r2.random()
        t.rect(C(az), Rw(hh), C(az) + 1, Rw(-0.6), 43)
    # ОЭЗ: справа впереди, от −9° до −40°
    sheds = [(-40, -31, 1.1), (-33, -27, 1.7), (-27.5, -21, 0.9), (-22, -17.5, 2.3), (-18, -12, 1.2), (-12.5, -9, 1.5)]
    for a0, a1, hh in sheds:
        t.rect(C(a0), Rw(hh), C(a1), Rw(-0.6), 43)
        t.rect(C(a0), Rw(hh), C(a1), Rw(hh) + 1, 42)
    # корпус с пилообразной крышей
    for az in np.arange(-31, -26, 0.8):
        t.poly([(C(az), Rw(1.7)), (C(az + 0.8), Rw(1.7)), (C(az + 0.8), Rw(2.3))], 43)
    # трубы с полосами
    stacks = [(-15.2, 6.2), (-14.3, 5.2), (-24.6, 4.6), (-35.5, 3.6)]
    for az, hh in stacks:
        x = C(az)
        t.rect(x - 1, Rw(hh), x + 1, Rw(0), 42)
        for k in (0.9, 0.75):
            t.rect(x - 1, Rw(hh * k), x + 1, Rw(hh * k) + 2, 15)
    # краны на стройке нового цеха
    for az, hh in ((-19.5, 4.2), (-10.5, 3.4)):
        x = C(az)
        t.rect(x, Rw(hh), x, Rw(0.5), 42)
        t.rect(x - 14, Rw(hh), x + 26, Rw(hh), 42)
        t.line([(x, Rw(hh + 0.6)), (x - 14, Rw(hh))], 43)
        t.line([(x, Rw(hh + 0.6)), (x + 26, Rw(hh))], 43)
    # факел
    x = C(-29.5)
    t.rect(x, Rw(2.8), x, Rw(1.7), 42)
    t.ellipse(x + 0.5, Rw(3.1), 1.6, 3, 29)
    t.ellipse(x + 0.5, Rw(3.0), 0.8, 1.6, 23)
    # ЛЭП
    for az in (-44, -38, -8, -2):
        x = C(az)
        t.poly([(x - 3, Rw(0)), (x + 3, Rw(0)), (x, Rw(2.6))], T)
        t.line([(x - 3, Rw(0)), (x, Rw(2.6)), (x + 3, Rw(0))], 43)
        t.rect(x - 5, Rw(2.2), x + 5, Rw(2.2), 43)
    for a0, a1 in ((-44, -38), (-38, -8), (-8, -2)):
        for k in range(int(C(a0)), int(C(a1))):
            f = (k - C(a0)) / (C(a1) - C(a0))
            t.px(k, Rw(2.2) + 4 * f * (1 - f) * 3, 43)
    return t, (AZ0, EL0, K)


def sky_color(az, el):
    """Небо ступенями: бледный рассвет, к горизонту светлее, у солнца тёплый ореол."""
    a = np.full(az.shape, 44)
    a = np.where(el < 6, 45, a)
    a = np.where((el < 8) & (el >= 6) & ((np.floor(az * 5) + np.floor(el * 5)) % 2 == 0), 45, a)
    # солнце в тумане справа над ОЭЗ: бледный диск и тёплая дымка вокруг
    d = np.hypot((az + 23.0) * 0.9, el - 6.5)
    chk = (np.floor(az * 5) + np.floor(el * 5)) % 2 == 0
    a = np.where((d < 7.5) & chk & (a == 44), 17, a)
    a = np.where((d < 5.0) & (a == 44), 17, a)
    a = np.where((d < 3.2) & chk, 17, a)
    a = np.where(d < 3.2, np.where(a == 45, 17, a), a)
    a = np.where(d < 1.2, 45, a)
    return a


def ray_wall(pts):
    """pts: (h, w, 3) — точки на плоскости задника. -> индексы Apollo."""
    E = EYE
    D = pts - E
    dist_wall = np.linalg.norm(D, axis=-1)
    D = D / dist_wall[..., None]
    Dx, Dy, Dz = D[..., 0], D[..., 1], D[..., 2]
    hor = np.hypot(Dx, Dz)
    az = np.degrees(np.arctan2(-Dx, -Dz))
    el = np.degrees(np.arctan2(Dy, hor))
    out = sky_color(az, el)
    best = np.full(out.shape, np.inf)
    fogf = np.ones(out.shape) * 0.0
    # горизонт: панорама ОЭЗ
    pano, (AZ0, EL0, K) = PANO
    c = np.clip(((az - AZ0) * K).astype(int), 0, pano.w - 1)
    r = ((EL0 - el) * K).astype(int)
    ok = (r >= 0) & (r < pano.h)
    pv = np.where(ok, pano.a[np.clip(r, 0, pano.h - 1), c], T)
    out = np.where(pv != T, pv, out)
    # земля за задником
    with np.errstate(divide='ignore', invalid='ignore'):
        tg = np.where(Dy < -1e-4, -E[1] / Dy, np.inf)
    gx, gz = E[0] + Dx * tg, E[2] + Dz * tg
    gx = np.where(np.isfinite(gx), gx, 0)
    gz = np.where(np.isfinite(gz), gz, 0)
    gcol = ground(gx, gz, fine=False)
    # пятна дальних фонарей на дороге
    for lz in (-21.0, -31.4, -41.8, -52.2):
        m = np.hypot(gx - 5.85, gz - lz) < 2.2
        gcol = np.where(m, WARM_LUT[1][gcol], gcol)
    hit = np.isfinite(tg) & (tg > dist_wall * 0.98)
    out = np.where(hit, gcol, out)
    best = np.where(hit, tg, best)
    # дома
    for (x0, x1, z0, z1, hh, style, seed) in BUILDINGS:
        with np.errstate(divide='ignore', invalid='ignore'):
            tx1, tx2 = (x0 - E[0]) / Dx, (x1 - E[0]) / Dx
            ty1, ty2 = (0 - E[1]) / Dy, (hh - E[1]) / Dy
            tz1, tz2 = (z0 - E[2]) / Dz, (z1 - E[2]) / Dz
        tmin = np.maximum.reduce([np.minimum(tx1, tx2), np.minimum(ty1, ty2), np.minimum(tz1, tz2)])
        tmax = np.minimum.reduce([np.maximum(tx1, tx2), np.maximum(ty1, ty2), np.maximum(tz1, tz2)])
        h_ = (tmax >= tmin) & (tmin > 0) & (tmin < best)
        if not h_.any():
            continue
        px, py, pz = E[0] + Dx * tmin, E[1] + Dy * tmin, E[2] + Dz * tmin
        on_x = np.isclose(tmin, np.minimum(tx1, tx2))
        u = np.where(on_x, pz, px)
        if style in ('panel', 'dorm'):
            col = panel_facade(u, py, style, seed, None)
            col = np.where(on_x & ((np.abs(pz - z0) < 0.02) | (np.abs(pz - z1) < 0.02)), 42, col)
            # торцы: без окон, чуть темнее
            side = np.where(on_x, (x1 - x0) < (z1 - z0), (x1 - x0) > (z1 - z0))
            col = np.where(side == False, np.where(noise(u, py, 0.4) > 0.8, 42, 43), col)  # noqa: E712
        elif style == 'garage':
            col = garage_facade(u, py, seed)
        else:
            col = shop_facade(u - x0, py)
        roof = np.isclose(tmin, np.minimum(ty1, ty2))
        col = np.where(roof, 41, col)
        out = np.where(h_, col, out)
        best = np.where(h_, tmin, best)
    # забор вдоль пустыря
    fx, fz0, fz1, fh = FENCE
    with np.errstate(divide='ignore', invalid='ignore'):
        tf = (fx - E[0]) / Dx
    fzp = E[2] + Dz * tf
    fyp = E[1] + Dy * tf
    hf = (tf > 0) & (tf < best) & (fzp > fz0) & (fzp < fz1) & (fyp > 0) & (fyp < fh)
    out = np.where(hf, fence_color(fzp, fyp), out)
    best = np.where(hf, tf, best)
    # деревья и дальние фонари — плоскости лицом к глазам
    for (bx, bz, spr, sw_) in BILLBOARDS:
        n = np.array([bx - E[0], bz - E[2]])
        dist = np.hypot(*n)
        n = n / dist
        with np.errstate(divide='ignore', invalid='ignore'):
            tb = dist / (Dx * n[0] + Dz * n[1])
        qx, qz, qy = E[0] + Dx * tb - bx, E[2] + Dz * tb - bz, E[1] + Dy * tb
        lat = qx * (-n[1]) + qz * n[0]
        col_ = np.round(spr.w / 2 + lat / sw_).astype(int)
        row_ = np.round(spr.h - 1 - qy / sw_).astype(int)
        ok = (tb > 0) & (tb < best) & (col_ >= 0) & (col_ < spr.w) & (row_ >= 0) & (row_ < spr.h)
        v = np.where(ok, spr.a[np.clip(row_, 0, spr.h - 1), np.clip(col_, 0, spr.w - 1)], T)
        m = ok & (v != T)
        out = np.where(m, v, out)
        best = np.where(m, tb, best)
    # туман по расстоянию (небо и горизонт уже «туманные» — их не трогаем)
    fogf = np.where(np.isfinite(best), fog_level(best), 0)
    fogged = apply_fog(out, fogf, dither=False)
    out = np.where(np.isfinite(best), fogged, out)
    return out


def make_billboards():
    bb = []
    r2 = np.random.default_rng(3)
    spr = [birch_sprite(0.1, 100 + i, 2.6, 6.0 + (i % 3) * 0.8, color=('yellow', 'late', 'yellow', 'green')[i % 4]) for i in range(6)]
    lamp = lamp_far_sprite(0.1)
    # фонари вдоль дороги, уходящие в туман
    for lz in (-21.0, -31.4, -41.8, -52.2, -62.6):
        bb.append((5.25 + 0.3, lz, lamp, 0.1))
    trees = []
    for z in np.arange(-16, -70, -6.5):  # наша сторона дороги
        trees.append((4.2 + r2.uniform(-0.3, 0.3), z + r2.uniform(-1, 1)))
    for z in np.arange(-15, 14, 5.5):  # тротуар напротив
        trees.append((14.4 + r2.uniform(-0.2, 0.4), z + r2.uniform(-1, 1)))
    for _ in range(8):  # двор слева
        trees.append((r2.uniform(-17.5, -13.6), r2.uniform(-24, 16)))
    for _ in range(6):  # за ларьком
        trees.append((r2.uniform(-24, -1), r2.uniform(-30, -15)))
    for _ in range(9):  # за спиной
        trees.append((r2.uniform(-18, 12), r2.uniform(13, 21)))
    for (x, z) in trees:
        bb.append((x, z, spr[int(r2.integers(0, len(spr)))], 0.1))
    # дальние — первыми (перебиваются ближними)
    bb.sort(key=lambda b: -np.hypot(b[0] - EYE[0], b[1] - EYE[2]))
    return bb


def street_walls():
    zb, xs_, zf, H = S_PLACE['walls']
    n_h = round(H / SW)
    walls = {}

    def plane(p0, right, width):
        n_w = round(width / SW)
        i = (np.arange(n_w) + 0.5) * SW
        j = H - (np.arange(n_h) + 0.5) * SW
        I, J = np.meshgrid(i, j)
        pts = np.asarray(p0)[None, None, :] + I[..., None] * np.asarray(right)[None, None, :]
        pts[..., 1] = J
        return pts

    # как стены в room.ts: столбец 0 — левый край, если смотреть изнутри
    walls['back'] = plane([-xs_, 0, zb], [1, 0, 0], 2 * xs_)
    walls['left'] = plane([-xs_, 0, zf], [0, 0, -1], zf - zb)
    walls['right'] = plane([xs_, 0, zb], [0, 0, 1], zf - zb)
    walls['front'] = plane([xs_, 0, zf], [-1, 0, 0], 2 * xs_)
    out = {}
    for k, pts in walls.items():
        t = Tex(pts.shape[1], pts.shape[0], 0)
        t.a = ray_wall(pts)
        out[k] = t
        print('  задник', k, t.w, 'x', t.h)
    return out


def steam_spots():
    """Где на задниках трубы ОЭЗ (для живого пара): точка на дальней стене."""
    zb, xs_, _, _ = S_PLACE['walls']
    out = []
    for az, hh in ((-15.2, 6.2), (-24.6, 4.6), (-35.5, 3.6)):
        a = np.radians(az)
        d = np.array([-np.sin(a), 0, -np.cos(a)])
        t = (zb + 0.05 - EYE[2]) / d[2]
        x = EYE[0] + d[0] * t
        y = EYE[1] + np.tan(np.radians(hh)) * t
        k = t  # масштаб: 1° на этой дистанции
        out.append([round(float(x), 3), round(float(y), 3), round(float(zb + 0.08), 3), round(float(k * np.radians(1)), 3)])
    return out


# --- стол: доски, крашенные зелёным, облупились ------------------------------------------------------

def street_table():
    """Дворовый стол: пять досок в старой зелёной краске. Краска облупилась до серого дерева, кое-где
    видна прошлая коричневая. Вырезано ножом, подпалины, шелуха от семечек, пара берёзовых листьев."""
    L, F, N = TABLE['halfLen'], TABLE['far'], TABLE['near']
    w = 256
    s = 2 * L / w
    h = round((N - F) / s)
    X = lambda x: (x + L) / s  # noqa: E731
    Zt = lambda z: (z - F) / s  # noqa: E731
    t = Tex(w, h, 7)
    r2 = np.random.default_rng(21)
    planks = 5
    ph = h / planks
    xs, ys = t.grid()
    for p in range(planks):
        y0, y1 = int(round(p * ph)), int(round((p + 1) * ph)) - 1
        # мазки кисти вдоль доски — короткие, спокойные
        for y in range(y0 + 1, y1):
            x = -int(r2.integers(0, 20))
            while x < w:
                n = int(r2.integers(3, 16))
                if r2.random() < 0.28:
                    t.rect(x, y, x + n, y, 6 if r2.random() < 0.6 else 8)
                x += n + int(r2.integers(6, 30))
        # трещины вдоль волокон
        for _ in range(int(r2.integers(2, 5))):
            y = int(r2.integers(y0 + 2, y1 - 1))
            x = int(r2.integers(0, w - 40))
            n = int(r2.integers(15, 60))
            t.rect(x, y, x + n, y, 6)
            t.rect(x + 2, y + 1, x + n - 4, y + 1, 8)
        t.rect(0, y0, w - 1, y0, 8)  # кромка доски ловит свет
        t.rect(0, y1 - 1, w - 1, y1 - 1, 6)
        if p < planks - 1:
            t.rect(0, y1, w - 1, y1, 37)  # щель между досками
        # облупилось: сколы до серого дерева, по краю скола — тёмная кромка краски
        for _ in range(int(r2.integers(10, 16))):
            cx, cy = r2.uniform(0, w), r2.uniform(y0 + 1, y1 - 1)
            if r2.random() < 0.5:
                cy = r2.choice([y0 + 1.5, y1 - 1.5])  # чаще — у кромки
            rx, ry = r2.uniform(1.5, 5), r2.uniform(0.8, 1.6)
            m = np.zeros_like(xs, bool)
            for _k in range(3):  # скол — несколько пятнышек рядом, край рваный
                ox, oy = r2.normal(0, rx * 0.6), r2.normal(0, ry * 0.5)
                m |= ((xs - cx - ox) / (rx * r2.uniform(0.5, 1))) ** 2 + ((ys - cy - oy) / (ry * r2.uniform(0.6, 1))) ** 2 <= 1
            m &= (ys >= y0 + 1) & (ys <= y1 - 1)
            ring = ((xs - cx) / (rx + 1)) ** 2 + ((ys - cy) / (ry + 0.7)) ** 2 <= 1
            ring &= (ys >= y0 + 1) & (ys <= y1 - 1) & ~m
            t.mask(ring, 7)
            t.mask(m, 42 if r2.random() < 0.7 else 20)
            t.mask(m & (ys > cy), 41)
    # вырезано ножом
    t.text(X(-1.22), Zt(0.03), 'ДИМА', 6)
    t.text(X(-1.2), Zt(0.03) + 7, '+ОЛЯ', 6)
    t.text(X(0.95), Zt(-0.8), '2019', 6)
    t.text(X(-0.32), Zt(-0.86), 'Ы', 6)
    # подпалины от окурков
    for (x, z) in ((-0.8, 0.16), (1.36, -0.62), (-1.38, -0.55), (0.72, 0.2), (-0.58, -0.63)):
        t.ellipse(X(x), Zt(z), 2.2, 1.5, 20)
        t.ellipse(X(x), Zt(z), 1.2, 0.8, 37)
    # шелуха от семечек у правого края: чёрные с серой кромкой
    for _ in range(80):
        x, z = r2.normal(1.2, 0.13), r2.normal(-0.1, 0.1)
        if abs(x) < L - 0.02 and F + 0.02 < z < N - 0.02:
            xx, zz = X(x), Zt(z)
            t.px(xx, zz, 37)
            t.px(xx + 1, zz, 40 if r2.random() < 0.5 else 38)
    # берёзовые листья, прилипшие к мокрой доске
    for (x, z, c) in ((-1.37, 0.12, 22), (-0.64, -0.73, 23), (1.46, 0.22, 21), (-0.95, -0.6, 22)):
        xx, zz = X(x), Zt(z)
        t.ellipse(xx, zz, 3.0, 1.8, c)
        t.px(xx - 1, zz - 1, lighter(c))
        t.line([(xx - 3, zz), (xx + 2, zz)], darker(c))
        t.px(xx - 4, zz + 1, 20)
    # мокрые тёмные пятна после ночной сырости
    for _ in range(26):
        x, z = r2.uniform(-L, L), r2.uniform(F, N)
        t.shade_ellipse(X(x), Zt(z), r2.uniform(2, 5), r2.uniform(1, 2), 1)
    # крышка от лимонада
    t.ellipse(X(-1.02), Zt(0.19), 1.6, 1.3, 27)
    t.px(X(-1.02), Zt(0.19), 28)
    # тёплый край от фонаря слева
    d = (xs - X(-2.2)) / (w * 0.2) + 0.2 * (BAYER2[ys.astype(int) % 2, xs.astype(int) % 2] - 0.4)
    wmask = d < 1.0
    t.a[wmask] = WARM_LUT[1][t.a[wmask]]
    # тени предметов
    P = S_PLACE
    for (x, z, rx, rz) in ((P['shawarma'][0] + 0.01, P['shawarma'][1] + 0.01, 0.13, 0.07), (P['cup'][0] + 0.01, P['cup'][1] + 0.01, 0.05, 0.05),
                           (P['seeds'][0], P['seeds'][1] + 0.01, 0.07, 0.09)):
        t.shade_ellipse(X(x), Zt(z), rx / s, rz / s, 1)
    return t


# --- атлас мелочи улицы ------------------------------------------------------------------------------------

def kiosk_front():
    """Фасад ларька 3.6 × 2.15 м по 2.5 см: синие сэндвич-панели, окошко с продавщицей, меню-лайтбокс, наклейки."""
    kx0, kx1, kz, kd, kh = S_PLACE['kiosk']
    s = 0.025
    w, h = round((kx1 - kx0) / s), round(kh / s)
    X = lambda x: (x - kx0) / s  # noqa: E731
    Y = lambda y: (kh - y) / s  # noqa: E731
    t = Tex(w, h, 3)
    for x in range(0, w, 6):  # рёбра профлиста
        t.rect(x, 0, x, h - 1, 2)
        t.rect(x + 1, 0, x + 1, h - 1, 4)
    t.noise(0, 0, w - 1, h - 1, 2, 0.02)
    t.rect(0, 0, w - 1, 2, 44)  # белый карниз
    t.rect(0, 3, w - 1, 3, 42)
    t.rect(0, h - 8, w - 1, h - 1, 39)  # цоколь
    t.rect(0, h - 8, w - 1, h - 8, 41)
    t.blotch(0, h - 14, w - 1, h - 8, 40, 2, 0.25, on=[2, 3, 4])  # брызги грязи снизу
    t.noise(0, h - 20, w - 1, h - 9, 41, 0.05, on=[2, 3, 4])
    for x in (0, w - 1):
        t.rect(x, 0, x, h - 1, 44)
    # окошко
    wx0, wx1, wy0, wy1 = S_PLACE['kwin']
    a0, a1, b0, b1 = int(X(wx0)), int(X(wx1)), int(Y(wy1)), int(Y(wy0))
    t.rect(a0 - 2, b0 - 2, a1 + 2, b1 + 2, 45)  # рама
    t.rect(a0 - 2, b1 + 1, a1 + 2, b1 + 2, 43)
    # внутри: тёплый свет, полки, вертел с шаурмой, продавщица
    t.rect(a0, b0, a1, b1, 17)
    t.rect(a0, b0, a1, b0 + 1, 45)  # лампа-трубка под потолком
    t.rect(a0, b0 + 2, a1, b0 + 2, 23)
    t.rect(a0, b0 + 9, a1, b0 + 9, 16)  # полка
    for i, c in enumerate((27, 22, 3, 9, 27, 45, 22, 28, 3, 45, 27)):
        x = a0 + 2 + i * 3
        if x < a1 - 1:
            t.rect(x, b0 + 5, x + 1, b0 + 8, c)
            t.px(x, b0 + 5, lighter(c))
    t.rect(a0, b0 + 16, a1, b0 + 16, 16)
    for i in range(6):
        x = a0 + 3 + i * 6
        if x < a1 - 3:
            t.rect(x, b0 + 12, x + 3, b0 + 15, (21, 44, 22, 27, 21, 44)[i])
    # вертел с шаурмой и раскалённый нагреватель
    vx = a0 + 6
    t.rect(vx, b0 + 11, vx, b1 - 1, 43)
    t.poly([(vx - 4, b0 + 12), (vx + 4, b0 + 12), (vx + 3, b1 - 4), (vx - 3, b1 - 4)], 20)
    t.rect(vx - 2, b0 + 12, vx - 2, b1 - 4, 21)
    t.rect(vx + 2, b0 + 13, vx + 3, b1 - 5, 19)
    for y in range(b0 + 13, b1 - 4, 3):
        t.rect(vx - 3, y, vx + 2, y, 14)
    t.rect(vx - 6, b0 + 11, vx - 5, b1 - 3, 28)
    t.rect(vx - 6, b0 + 13, vx - 6, b1 - 5, 29)
    t.rect(vx - 7, b0 + 10, vx - 4, b0 + 10, 41)
    # продавщица крупно: косынка, круглое лицо, румянец, синяя кофта и белый фартук; облокотилась на прилавок
    sx = int((a0 + a1) / 2) + 5
    t.poly([(sx - 11, b1 - 1), (sx - 8, b0 + 17), (sx + 8, b0 + 17), (sx + 11, b1 - 1)], 2)  # кофта
    t.rect(sx - 8, b0 + 17, sx - 6, b1 - 1, 3)
    t.poly([(sx - 5, b1 - 1), (sx - 4, b0 + 19), (sx + 4, b0 + 19), (sx + 5, b1 - 1)], 45)  # фартук
    t.rect(sx - 4, b0 + 19, sx + 4, b0 + 19, 44)
    t.rect(sx - 2, b0 + 15, sx + 2, b0 + 17, 14)  # шея
    t.ellipse(sx, b0 + 11, 4.6, 5.2, 15)  # лицо
    t.rect(sx + 3, b0 + 8, sx + 4, b0 + 14, 14)
    t.rect(sx - 5, b0 + 4, sx + 5, b0 + 7, 27)  # косынка красная в горошек
    t.rect(sx - 5, b0 + 7, sx - 4, b0 + 11, 27)
    t.rect(sx + 4, b0 + 7, sx + 5, b0 + 11, 27)
    t.px(sx - 2, b0 + 5, 45)
    t.px(sx + 2, b0 + 6, 45)
    t.px(sx + 4, b0 + 9, 45)
    t.rect(sx - 3, b0 + 10, sx - 2, b0 + 10, 37)  # глаза
    t.rect(sx + 1, b0 + 10, sx + 2, b0 + 10, 37)
    t.px(sx - 3, b0 + 12, 28)
    t.px(sx + 2, b0 + 12, 28)
    t.rect(sx - 1, b0 + 14, sx + 1, b0 + 14, 13)  # рот
    t.rect(sx - 12, b1 - 3, sx + 12, b1 - 1, 2)  # руки на прилавке
    t.rect(sx - 4, b1 - 3, sx + 4, b1 - 2, 15)
    # стекло: блики и наклейки
    for k in range(3):
        x = a0 + 12 + k * 11
        t.line([(x, b1), (x + 7, b0 + 3)], 45)
    t.rect(a0 + 1, b1 - 5, a0 + 12, b1 - 1, 45)
    t.text(a0 + 2, b1 - 5, '24', 27)
    t.rect(a1 - 13, b0 + 3, a1 - 1, b0 + 9, 45)  # «оплата картой»
    t.rect(a1 - 11, b0 + 4, a1 - 5, b0 + 7, 2)
    t.rect(a1 - 11, b0 + 5, a1 - 5, b0 + 5, 22)
    # лючок-окошко внизу
    t.frame(sx - 10, b1 - 9, sx + 10, b1, 44)
    # меню-лайтбокс слева
    mx0, mx1, my0, my1 = int(X(-3.5)), int(X(-1.86)), int(Y(1.98)), int(Y(1.02))
    t.rect(mx0 - 1, my0 - 1, mx1 + 1, my1 + 1, 37)
    t.rect(mx0, my0, mx1, my1, 45)
    t.rect(mx0, my0, mx1, my0 + 7, 27)
    center_text(t, (mx0 + mx1) / 2, my0 + 1, 'МЕНЮ', 45)
    items = [('ШАУРМА', '230'), ('БОЛЬШАЯ', '290'), ('ХОТ-ДОГ', '120'), ('БЕЛЯШ', '60'), ('ЧАЙ', '40'), ('КОФЕ', '80')]
    for i, (name, price) in enumerate(items):
        y = my0 + 10 + i * 7
        ic = (21, 20, 28, 14, 26, 13)[i]
        t.rect(mx0 + 2, y, mx0 + 6, y + 4, ic)
        t.rect(mx0 + 3, y + 1, mx0 + 5, y + 1, lighter(ic, 2))
        t.text(mx0 + 9, y, name, 37)
        t.text(mx1 - 1 - text_w(price), y, price, 27)
    # наклейки и объявления на панелях
    t.rect(X(-0.52), Y(1.55), X(-0.18), Y(1.12), 45)  # «куплю авто»
    t.text(X(-0.5), Y(1.53), 'КУПЛЮ', 37)
    t.text(X(-0.5), Y(1.53) + 6, 'АВТО', 27)
    for k in range(4):
        t.rect(X(-0.5) + k * 3, Y(1.2), X(-0.5) + k * 3 + 1, Y(1.12), 43)
    t.rect(X(-3.62), Y(0.85), X(-3.2), Y(0.5), 45)  # «сдам комнату» с отрывными
    t.text(X(-3.6), Y(0.83), 'СДАМ', 2)
    for k in range(5):
        t.rect(X(-3.6) + k * 3, Y(0.62), X(-3.6) + k * 3 + 1, Y(0.5), 43 if k % 2 else 44)
    t.rect(X(-3.6) + 6, Y(0.62), X(-3.6) + 7, Y(0.5), 3)  # оторванный
    # граффити-закорючка
    t.line([(X(-2.9), Y(0.55)), (X(-2.8), Y(0.7)), (X(-2.7), Y(0.52)), (X(-2.55), Y(0.68)), (X(-2.4), Y(0.56))], 33)
    t.line([(X(-2.9), Y(0.56)), (X(-2.8), Y(0.71)), (X(-2.7), Y(0.53)), (X(-2.55), Y(0.69)), (X(-2.4), Y(0.57))], 33)
    # тёплый свет фонаря на левой части, свет из окна на раме
    xs, ys = t.grid()
    lx = S_PLACE['lamps'][0][2]
    d = np.hypot((xs - X(lx)) / (1.5 / s), (ys - Y(0.9)) / (2.2 / s)) + 0.1 * (BAYER2[ys.astype(int) % 2, xs.astype(int) % 2] - 0.4)
    m = (d < 1) & ~((xs >= mx0) & (xs <= mx1) & (ys >= my0) & (ys <= my1))
    t.a[m] = WARM_LUT[1][t.a[m]]
    return t


def kiosk_window_dim(front):
    """Та же картинка окошка, когда трубка мигнула и погасла."""
    wx0, wx1, wy0, wy1 = S_PLACE['kwin']
    kx0, _, _, _, kh = S_PLACE['kiosk']
    s = 0.025
    a0, a1 = int((wx0 - kx0) / s), int((wx1 - kx0) / s)
    b0, b1 = int((kh - wy1) / s), int((kh - wy0) / s)
    t = Tex(a1 - a0 + 1, b1 - b0 + 1)
    t.a = darker(front.a[b0:b1 + 1, a0:a1 + 1].copy(), 2)
    t.a[0:2, :] = 41  # трубка погасла
    return t, (a0, b0)


def street_atlas():
    at = Atlas(512, 512)
    R.common_items(at)
    for c in (2, 3, 7, 8, 26, 23, 29, 41):
        at.add(f'c{c}', R.solid(c))
    at.add('clock', R.clock_face(True))
    at.add('clock_rim', Tex(8, 4, 44))
    front = kiosk_front()
    at.add('kiosk', front)
    dim, _ = kiosk_window_dim(front)
    at.add('kwin_dim', dim)
    t = Tex(32, 40, 3)  # бок ларька
    for x in range(0, 32, 6):
        t.rect(x, 0, x, 39, 2)
        t.rect(x + 1, 0, x + 1, 39, 4)
    t.rect(0, 0, 31, 1, 44)
    t.rect(0, 36, 31, 39, 39)
    at.add('kiosk_side', t)
    # вывеска «ШАУРМА 24»: светится
    kx0 = S_PLACE['kiosk'][0]
    sx0, sx1, sy0, sy1 = S_PLACE['sign']
    s = 0.025
    w, h = round((sx1 - sx0) / s), round((sy1 - sy0) / s)
    t = Tex(w, h, 23)
    t.frame(0, 0, w - 1, h - 1, 37)
    t.rect(1, 1, w - 2, 1, 45)
    t.rect(1, h - 2, w - 2, h - 2, 22)
    txt = 'ШАУРМА'
    # надпись — в просвет между головами собеседника и соседа слева; буквы вдвое, с просветом в две точки
    cx = ((-1.3) - sx0) / s
    x = int(cx - (text_w(txt, 2) + 2 * (len(txt) - 1)) / 2)
    for ch in txt:
        t.text(x, 3, ch, 27, 2)
        t.text(x, 3 + 10, ch, 26, 1) if False else None
        x += (len(R.FONT[ch][0]) + 1) * 2 + 2
    t.rect(int(cx - 30), h - 3, int(cx + 30), h - 3, 22)
    # «24» в красном круге слева
    t.ellipse(int((-3.25 - sx0) / s), h / 2, 6.5, 6.5, 27)
    t.text(int((-3.25 - sx0) / s) - 3, int(h / 2) - 2, '24', 45)
    # шаурма-картинка справа
    px_ = int((-0.36 - sx0) / s)
    t.poly([(px_ - 5, 12), (px_ + 5, 12), (px_ + 3, 3), (px_ - 3, 3)], 16)
    t.rect(px_ - 3, 3, px_ + 3, 5, 9)
    t.rect(px_ - 2, 4, px_ + 2, 4, 27)
    t.rect(px_ - 5, 10, px_ + 5, 12, 45)
    _ = kx0
    at.add('sign', t)
    # полосатый навес над меню нет — прилавок под окошком
    t = Tex(16, 6, 43)
    t.rect(0, 0, 15, 0, 45)
    t.rect(0, 5, 15, 5, 41)
    at.add('shelf', t)
    t = Tex(8, 12, 44)  # салфетница
    t.rect(1, 0, 6, 3, 45)
    t.rect(0, 4, 7, 11, 42)
    t.rect(1, 5, 6, 5, 43)
    at.add('napkins', t)
    t = Tex(8, 16, 27)  # кетчуп
    t.rect(0, 0, 7, 3, 45)
    t.rect(2, 6, 3, 13, 28)
    t.rect(1, 8, 6, 10, 45)
    at.add('ketchup', t)
    t = Tex(8, 16, 22)  # горчица
    t.rect(0, 0, 7, 3, 27)
    t.rect(2, 6, 3, 13, 23)
    at.add('mustard', t)
    # лавки и доски стола: зелёная краска
    t = Tex(32, 8, 8)
    t.rect(0, 0, 31, 0, 9)
    t.rect(0, 7, 31, 7, 6)
    for (x, y, n) in ((3, 3, 8), (15, 2, 5), (22, 5, 7)):
        t.rect(x, y, x + n, y, 7)
    t.rect(10, 4, 13, 5, 20)
    t.rect(26, 1, 28, 2, 20)
    at.add('plank', t)
    t = Tex(32, 4, 7)
    t.rect(0, 0, 31, 0, 9)
    t.rect(0, 3, 31, 3, 6)
    t.rect(6, 1, 9, 2, 20)
    at.add('plank_edge', t)
    t = Tex(8, 8, 42)  # бетон
    t.noise(0, 0, 7, 7, 41, 0.2)
    t.noise(0, 0, 7, 7, 43, 0.1)
    at.add('concrete', t)
    t = Tex(8, 8, 40)  # крашеный металл ножек
    t.rect(0, 0, 7, 1, 41)
    t.noise(0, 0, 7, 7, 20, 0.08)
    at.add('metal', t)
    # ящик из-под бутылок — сиденье в торце
    t = Tex(16, 12, 3)
    t.frame(0, 0, 15, 11, 2)
    for x in range(2, 15, 3):
        t.rect(x, 2, x + 1, 8, 1)
    t.rect(4, 9, 11, 9, 4)
    at.add('crate', t)
    t = Tex(16, 16, 3)
    for k in range(0, 16, 4):
        t.rect(k, 0, k, 15, 2)
        t.rect(0, k, 15, k, 2)
    at.add('crate_top', t)
    t = Tex(24, 16, 15)  # картонка на ящике
    t.noise(0, 0, 23, 15, 14, 0.1)
    t.rect(0, 7, 23, 7, 14)
    at.add('cardboard', t)
    # павильон: стекло (вырезы — прозрачно), лайтбокс с рекламой, табличка, крыша
    t = Tex(36, 84, T)
    t.frame(0, 0, 35, 83, 40)
    for (x0, y0) in ((6, 80), (20, 80), (28, 60)):
        t.line([(x0, y0), (x0 + 6, y0 - 60)], 44)
    t.line([(9, 80), (15, 56)], 44)
    t.rect(1, 46, 34, 47, 40)  # поручень посередине
    t.rect(1, 46, 34, 46, 42)
    t.rect(1, 70, 34, 82, 42)  # грязь снизу на стекле
    t.checker(1, 64, 34, 69, 42)
    t.rect(4, 30, 15, 44, 45)  # объявление
    t.text(5, 31, 'СДАМ', 37)
    for k in range(4):
        t.rect(5 + k * 3, 38, 6 + k * 3, 44, 44)
    t.rect(20, 36, 31, 46, 23)
    t.text(21, 37, 'ЧАЙ', 37)
    at.add('pav_glass', t)
    t = Tex(40, 76, 45)  # реклама «Водогрея» — светится
    t.frame(0, 0, 39, 75, 40)
    t.rect(2, 2, 37, 73, 4)
    t.rect(2, 2, 37, 15, 2)
    center_text(t, 20, 4, 'ВОДОГРЕЙ', 45)
    center_text(t, 20, 10, 'ИЩЕТ ТЕБЯ', 23)
    t.rect(9, 20, 30, 50, 45)  # водонагреватель
    t.frame(9, 20, 30, 50, 43)
    t.ellipse(19.5, 29, 5, 5, 42)
    t.ellipse(19.5, 29, 3, 3, 27)
    t.rect(14, 40, 25, 41, 43)
    t.rect(16, 51, 17, 55, 42)
    t.rect(22, 51, 23, 55, 42)
    t.rect(2, 58, 37, 73, 22)
    center_text(t, 20, 60, 'ОПЕРАТОР', 37)
    center_text(t, 20, 66, 'ОТ 85 000', 27)
    at.add('pav_ad', t)
    t = Tex(40, 6, 2)  # кромка крыши с названием
    t.rect(0, 0, 39, 0, 3)
    t.rect(0, 5, 39, 5, 1)
    at.add('pav_fascia', t)
    t = Tex(120, 8, 2)
    t.rect(0, 0, 119, 0, 3)
    t.rect(0, 7, 119, 7, 1)
    center_text(t, 60, 1, 'МОЛОДЁЖНАЯ', 45)
    at.add('pav_name', t)
    t = Tex(8, 8, 43)
    t.rect(0, 0, 7, 0, 44)
    at.add('pav_roof', t)
    t = Tex(8, 8, 2)
    t.rect(0, 0, 1, 7, 3)
    at.add('pav_post', t)
    t = Tex(24, 6, 20)  # доски лавки в павильоне
    t.rect(0, 0, 23, 0, 21)
    t.rect(0, 5, 23, 5, 19)
    at.add('slat', t)
    # табличка остановки и расписание
    t = Tex(20, 20, 45)
    t.frame(0, 0, 19, 19, 40)
    t.rect(2, 2, 17, 17, 2)
    t.text(8, 3, 'А', 45)
    t.rect(4, 10, 15, 14, 45)  # автобусик
    t.rect(5, 11, 14, 12, 2)
    t.px(6, 15, 37)
    t.px(13, 15, 37)
    at.add('stop_sign', t)
    t = Tex(40, 48, 45)
    t.frame(0, 0, 39, 47, 40)
    t.rect(1, 1, 38, 7, 2)
    center_text(t, 20, 2, 'РАСПИСАНИЕ', 45)
    rows = [('7', '·', 'СЛУЖЕБНЫЙ'), ('', '', 'ОЭЗ 7:52'), ('12', '', '6:40 7:10'), ('', '', '7:40 8:10'), ('24', '', '6:55 7:45')]
    y = 10
    for (num, _d, txt) in rows:
        if num:
            t.rect(2, y - 1, 9, y + 5, 27 if num == '7' else 2)
            t.text(3, y, num, 45)
        t.text(12, y, txt, 37 if num != '7' and txt != 'ОЭЗ 7:52' else 27)
        y += 7
    t.rect(2, 44, 37, 44, 43)
    at.add('timetable', t)
    # фонарь: столб, консоль, голова со светящимся низом, конус нарисуем мешем
    t = Tex(8, 16, 42)
    t.rect(0, 0, 1, 15, 43)
    t.rect(6, 0, 7, 15, 41)
    t.noise(0, 0, 7, 15, 40, 0.06)
    at.add('pole', t)
    t = Tex(16, 8, 41)
    t.rect(0, 0, 15, 1, 42)
    t.rect(2, 5, 13, 7, 23)
    t.rect(4, 6, 11, 6, 45)
    at.add('lamp_head', t)
    t = Tex(8, 8, 23)
    t.rect(1, 1, 6, 6, 45)
    at.add('lamp_glow', t)
    # урна бетонная, мусор
    t = Tex(24, 16, 42)
    t.noise(0, 0, 23, 15, 41, 0.15)
    t.rect(0, 0, 23, 1, 43)
    t.rect(0, 3, 23, 3, 41)
    t.rect(0, 14, 23, 15, 40)
    at.add('urn', t)
    t = Tex(8, 8, 37)
    t.px(2, 2, 45)
    t.px(5, 4, 27)
    at.add('urn_top', t)
    t = Tex(12, 10, T)  # стаканчик и бумажка торчат
    t.rect(1, 2, 5, 9, 45)
    t.rect(1, 2, 5, 3, 27)
    t.poly([(6, 9), (11, 5), (9, 2), (7, 6)], 44)
    at.add('trash', t)
    # собака лежит у фонаря
    t = Tex(32, 16, T)
    t.ellipse(15, 11, 11, 4.2, 14)
    t.ellipse(15, 12.5, 9, 2.5, 13)
    t.ellipse(25, 7, 4.2, 3.6, 14)  # голова
    t.poly([(22, 4), (24, 1), (25, 5)], 13)  # ухо
    t.poly([(26, 4), (28, 1), (28, 5)], 13)
    t.rect(28, 8, 30, 9, 15)  # морда
    t.px(30, 8, 37)
    t.px(26, 6, 37)
    t.ellipse(22, 11, 3, 2.5, 17)  # светлая грудь
    t.rect(3, 12, 7, 13, 13)  # хвост
    t.rect(20, 14, 29, 15, 13)  # лапы
    t.rect(26, 14, 29, 14, 15)
    at.add('dog', t)
    # голуби
    for i, c in enumerate((42, 41, 43)):
        t = Tex(10, 7, T)
        t.ellipse(5, 4, 3.5, 2.3, c)
        t.ellipse(8, 2, 1.6, 1.6, c)
        t.px(9, 2, 37)
        t.px(9, 3, 22)
        t.rect(2, 3, 5, 4, darker(c))
        t.rect(1, 3, 2, 3, 40)
        t.px(8, 3, 9 if i == 0 else 33)
        t.rect(4, 6, 4, 6, 28)
        t.rect(6, 6, 6, 6, 28)
        at.add(f'pigeon{i}', t)
    # берёзы рядом
    at.add('birch0', birch_sprite(0.04, 7, 2.6, 6.8, 'yellow'))
    at.add('birch1', birch_sprite(0.04, 8, 2.6, 6.8, 'late'))
    # на столе: шаурма в бумаге, стаканчик чая, семечки
    t = Tex(24, 8, 45)
    t.rect(0, 0, 23, 7, 45)
    t.rect(0, 0, 5, 7, 16)  # лаваш выглядывает
    t.rect(1, 1, 4, 2, 17)
    t.px(2, 3, 9)
    t.px(3, 4, 27)
    t.rect(6, 0, 6, 7, 43)
    t.rect(12, 2, 20, 2, 43)
    t.rect(0, 7, 23, 7, 43)
    at.add('shawarma', t)
    t = Tex(8, 8, 16)
    t.rect(1, 1, 6, 6, 17)
    t.rect(2, 2, 5, 5, 14)
    t.px(3, 3, 9)
    t.px(4, 4, 27)
    t.px(2, 4, 23)
    at.add('shawarma_end', t)
    t = Tex(16, 24, 45)  # рулет в бумаге: сверху выглядывает лаваш
    t.rect(0, 0, 15, 5, 16)
    t.rect(0, 0, 15, 0, 17)
    t.px(3, 2, 15)
    t.px(9, 3, 15)
    t.rect(0, 6, 15, 6, 43)
    t.line([(0, 9), (15, 13)], 44)
    t.line([(0, 16), (15, 20)], 44)
    t.rect(10, 7, 10, 23, 43)
    at.add('shawarma_roll', t)
    t = Tex(12, 14, 45)  # бумажный стаканчик
    t.rect(0, 0, 11, 1, 44)
    t.rect(0, 5, 11, 9, 27)
    t.text(3, 5, 'Ч', 45)
    t.rect(9, 0, 9, 13, 43)
    t.rect(0, 13, 11, 13, 43)
    at.add('cup', t)
    t = Tex(8, 8, 20)
    t.rect(1, 1, 6, 6, 19)
    t.rect(5, 0, 5, 3, 45)  # ниточка от пакетика
    at.add('cup_top', t)
    t = Tex(12, 16, 26)  # пачка семечек
    t.rect(0, 0, 11, 2, 22)
    t.ellipse(6, 8, 3.5, 3.5, 22)
    t.ellipse(6, 8, 1.5, 1.5, 37)
    t.rect(1, 13, 10, 14, 45)
    at.add('seeds', t)
    # машина для фар: спереди, сзади, сбоку
    t = Tex(96, 32, T)  # сбоку, 4.4 м
    t.poly([(4, 26), (4, 18), (22, 16), (32, 8), (62, 8), (74, 16), (92, 18), (93, 26)], 40)
    t.poly([(30, 15), (35, 10), (47, 10), (47, 15)], 39)
    t.poly([(50, 15), (50, 10), (61, 10), (68, 15)], 39)
    t.rect(4, 22, 93, 22, 41)
    t.ellipse(20, 26, 5, 5, 37)
    t.ellipse(76, 26, 5, 5, 37)
    t.ellipse(20, 26, 2, 2, 41)
    t.ellipse(76, 26, 2, 2, 41)
    t.rect(90, 18, 93, 20, 45)  # фара
    t.rect(4, 18, 5, 20, 27)
    for k in range(6):  # луч в тумане
        t.checker(94, 17 - k, 95, 20 + k, 17)
    at.add('car_side', t)
    t = Tex(48, 32, T)  # спереди
    t.poly([(6, 28), (6, 16), (12, 8), (36, 8), (42, 16), (42, 28)], 40)
    t.rect(13, 10, 35, 15, 39)
    t.rect(7, 18, 13, 21, 45)
    t.rect(35, 18, 41, 21, 45)
    for (cx_) in (10, 38):
        t.ellipse(cx_, 19.5, 7, 5, 23) if False else None
    t.checker(2, 15, 17, 24, 17)
    t.checker(31, 15, 46, 24, 17)
    t.rect(7, 18, 13, 21, 45)
    t.rect(35, 18, 41, 21, 45)
    t.rect(17, 19, 31, 21, 39)
    t.rect(6, 27, 11, 29, 37)
    t.rect(37, 27, 42, 29, 37)
    at.add('car_front', t)
    t = Tex(48, 32, T)  # сзади
    t.poly([(6, 28), (6, 16), (12, 8), (36, 8), (42, 16), (42, 28)], 40)
    t.rect(13, 10, 35, 15, 39)
    t.rect(7, 18, 12, 21, 27)
    t.rect(36, 18, 41, 21, 27)
    t.checker(4, 16, 14, 23, 28)
    t.checker(34, 16, 44, 23, 28)
    t.rect(7, 18, 12, 21, 27)
    t.rect(36, 18, 41, 21, 27)
    t.rect(19, 22, 29, 24, 45)
    t.rect(6, 27, 11, 29, 37)
    t.rect(37, 27, 42, 29, 37)
    at.add('car_back', t)
    return at


def fog_tex():
    """Полосы тумана с мягкой альфой (альфу берём из текстуры в прозрачном материале)."""
    w, h = 256, 64
    r2 = np.random.default_rng(9)
    a = np.zeros((h, w))
    ys, xs = np.mgrid[0:h, 0:w]
    for _ in range(26):
        cx, cy = r2.uniform(0, w), r2.uniform(h * 0.35, h * 0.95)
        rx, ry = r2.uniform(20, 60), r2.uniform(4, 12)
        for dx in (-w, 0, w):
            a += 0.6 * np.exp(-(((xs - cx - dx) / rx) ** 2 + ((ys - cy) / ry) ** 2))
    a *= np.clip((ys / h) * 1.6, 0, 1)
    a = np.clip(a, 0, 1)
    # ступени альфы: 0, 1/4, 2/4 — палитровый проход сам разложит в дизеринг
    q = np.floor(a * 3.2) / 3.2 * 0.62
    rgb = np.array(RGB[45], np.uint8)
    im = np.dstack([np.broadcast_to(rgb, (h, w, 3)), (q * 255).astype(np.uint8)])
    return Image.fromarray(im, 'RGBA')


def write_gen(kind, at, place):
    path = os.path.join(GEN_DIR, f'{kind}.gen.ts')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('// Сгенерировано tools/art/rooms_a.py — не править руками.\n')
        f.write('// Раскладка атласа (x, y, w, h в текселях) и места вещей, по которым запечены тени и свет.\n\n')
        f.write('export const ATLAS = ' + json.dumps({'w': at.size, 'h': at.h, 'rects': at.rects}, ensure_ascii=False) + ' as const\n\n')
        f.write('export const PLACE = ' + json.dumps(place, ensure_ascii=False) + ' as const\n')


def save(t, name, textures):
    t.image().save(os.path.join(OUT, name + '.png'))
    textures[name] = t


PANO = None
BILLBOARDS = []


def build_street():
    global PANO, BILLBOARDS
    tex = {}
    at = street_atlas()
    at.pack()
    for k in range(3):
        v = Tex(at.size, at.h)
        v.a = darker(at.sheet.a, k)
        save(v, f'street_atlas{k}', tex)
    print('  атлас', len(at.rects))
    save(street_table(), 'street_table', tex)
    g, _, _ = ground_tex(-6.0, 6.0, -6.4, 3.6, SG)
    x0, z0 = -6.0, -6.4
    cracks(g, x0, z0, SG)
    save(g, 'street_ground', tex)
    zb, xs_, zf, H = S_PLACE['walls']
    gf, _, _ = ground_tex(-xs_, xs_, zb, zf, SGF, fine=False)
    save(gf, 'street_ground_far', tex)
    PANO = far_panorama()
    BILLBOARDS = make_billboards()
    for side, t in street_walls().items():
        save(t, f'street_wall_{side}', tex)
    fog_tex().save(os.path.join(OUT, 'street_fog.png'))
    place = dict(S_PLACE)
    place['chimneys'] = steam_spots()
    place['kwin_px'] = kiosk_window_dim(kiosk_front())[1]
    write_gen('street', at, place)
    R.sheet({k: v for k, v in tex.items() if 'wall' not in k and 'far' not in k}, os.path.join(PREV, 'rooms_street.png'), scale=2, maxw=2200)
    R.sheet({k: v for k, v in tex.items() if 'wall' in k}, os.path.join(PREV, 'rooms_street_walls.png'), scale=1, maxw=1100)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    kinds = sys.argv[1:] or ['street', 'shop']
    if 'street' in kinds:
        print('street')
        build_street()
    if 'shop' in kinds and 'build_shop' in globals():
        print('shop')
        globals()['build_shop']()
