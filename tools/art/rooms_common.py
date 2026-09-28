"""Общее для комнат кампании (room_dorm.py, room_bytovka.py): недостающие буквы мелкого шрифта,
ступенчатый запечённый свет, запись текстур и раскладки <место>.gen.ts.

Основа — room3d.py (Tex, Atlas, рампы Apollo); его main() здесь не запускается.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import room3d as R  # noqa: E402
from room3d import T, Tex, darker, lighter  # noqa: E402

ROOT = R.ROOT
OUT = R.OUT
PREV = R.PREV
ROOMS_TS = os.path.join(ROOT, 'src', 'game', 'world3d', 'rooms')

# буквы, которых нет в room3d.FONT (там только то, что понадобилось кабинету)
EXTRA_GLYPHS = {
    'Г': ['###', '#..', '#..', '#..', '#..'],
    'И': ['#..#', '#..#', '#.##', '##.#', '#..#'],
    'Й': ['#..#', '#..#', '#.##', '##.#', '#..#'],
    'У': ['#.#', '#.#', '.##', '..#', '##.'],
    'Х': ['#.#', '#.#', '.#.', '#.#', '#.#'],
    'Ж': ['#.#.#', '#.#.#', '.###.', '#.#.#', '#.#.#'],
    'Ш': ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
    'Ы': ['#...#', '#...#', '###.#', '#.#.#', '###.#'],
    'Ь': ['#..', '#..', '##.', '#.#', '##.'],
    'Ф': ['.#.', '###', '#.#', '###', '.#.'],
    'Ю': ['#.##', '#.#.#', '###.#', '#.#.#', '#.##.'],
    'Щ': ['#.#.#.', '#.#.#.', '#.#.#.', '#.#.#.', '######'],
    ':': ['.', '#', '.', '#', '.'],
    '+': ['...', '.#.', '###', '.#.', '...'],
    '/': ['..#', '..#', '.#.', '#..', '#..'],
    '!': ['#', '#', '#', '.', '#'],
    ',': ['.', '.', '.', '#', '#'],
    '%': ['#.#', '..#', '.#.', '#..', '#.#'],
    '«': ['..', '.#', '#.', '.#', '..'],
    '»': ['..', '#.', '.#', '#.', '..'],
}
# Ю выше вышла кривой — ровная пятиколонная
EXTRA_GLYPHS['Ю'] = ['#..#.', '#.#.#', '###.#', '#.#.#', '#..#.']
for k, v in EXTRA_GLYPHS.items():
    R.FONT.setdefault(k, v)

text_w = R.text_w

# Байер 4×4 — для ступенчатых переходов света (в текстуре, не в кадре)
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 + 1 / 32


def shade_levels(t, level, m=None):
    """Затемнить каждую клетку на level[y, x] ступеней рампы (отрицательное — светлее)."""
    lv = np.asarray(level).astype(int)
    for k in np.unique(lv):
        if k == 0:
            continue
        mm = lv == k
        if m is not None:
            mm &= m
        src = darker(t.a, k) if k > 0 else lighter(t.a, -k)
        t.a[mm] = src[mm]


def falloff(t, cx, cy, rx, ry, steps=2, start=0.55, width=0.5, soft=0.35, m=None):
    """Свет лампы на плоскости: у центра (cx, cy) как есть, дальше ступенями темнее.
    start — докуда светло (в долях радиуса), width — ширина ступени, soft — ширина шахматного перехода."""
    xs, ys = t.grid()
    d = np.sqrt(((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2)
    by = BAYER[(ys.astype(int)) % 4, (xs.astype(int)) % 4]
    lv = np.floor((d - start) / width + 1 + (by - 0.5) * soft * 2)
    lv = np.clip(lv, 0, steps)
    shade_levels(t, lv, m)


def band_shade(t, x0, y0, x1, y1, k=1, soft=True):
    """Тень прямоугольником с шахматной кромкой в одну клетку."""
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    t.shade(x0, y0, x1, y1, k)
    if soft:
        ys, xs = np.mgrid[0:t.h, 0:t.w]
        ring = ((xs == x0 - 1) | (xs == x1 + 1)) & (ys >= y0) & (ys <= y1)
        ring |= ((ys == y0 - 1) | (ys == y1 + 1)) & (xs >= x0) & (xs <= x1)
        t.shade(0, 0, t.w - 1, t.h - 1, k, ring & ((xs + ys) % 2 == 0))


TINT_COLD = {17: 45, 16: 44, 15: 43, 14: 42, 13: 41, 12: 40, 23: 45, 22: 44, 21: 43, 20: 42, 19: 40, 18: 39}


def tint(t, m, table=TINT_COLD, checker=False):
    """Перекрасить клетки маски по таблице (например, отсвет экрана — тёплое в холодное)."""
    xs, ys = t.grid()
    mm = m.copy()
    if checker:
        mm &= ((xs.astype(int) + ys.astype(int)) % 2) == 0
    src = t.a.copy()
    for a, b in table.items():
        t.a[mm & (src == a)] = b


def ellipse_mask(t, cx, cy, rx, ry):
    xs, ys = t.grid()
    return ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 <= 1


def save(t, name, textures):
    t.image().save(os.path.join(OUT, name + '.png'))
    textures[name] = t


def write_all(kind, at, surfaces, place, doc):
    """Атлас в трёх вариантах света, большие поверхности, превью и <kind>.gen.ts."""
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    rects = at.pack()
    tex = {}
    for k in range(3):
        v = Tex(at.size, at.h)
        v.a = darker(at.sheet.a, k)
        save(v, f'{kind}_atlas{k}', tex)
    for name, t in surfaces.items():
        save(t, f'{kind}_{name}', tex)
    R.sheet(tex, os.path.join(PREV, f'room_{kind}.png'))
    with open(os.path.join(ROOMS_TS, f'{kind}.gen.ts'), 'w', encoding='utf-8') as f:
        f.write(f'// Сгенерировано {doc} — не править руками.\n')
        f.write('// Раскладка атласа (x, y, w, h в текселях) и места вещей, по которым запечены тени.\n\n')
        f.write('export const ATLAS = ' + json.dumps({'w': at.size, 'h': at.h, 'rects': rects}, ensure_ascii=False) + ' as const\n\n')
        f.write('export const PLACE = ' + json.dumps(place, ensure_ascii=False) + ' as const\n')
    print('ok', kind, len(rects), 'в атласе', f'{at.size}×{at.h}')


def seats():
    """Места из layout.ts: собеседник, массовка."""
    return R.seats_from_layout()


__all__ = ['R', 'T', 'Tex', 'darker', 'lighter', 'text_w', 'falloff', 'band_shade', 'tint', 'ellipse_mask',
           'shade_levels', 'write_all', 'seats', 'BAYER']
_ = T
