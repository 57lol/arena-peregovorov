"""Титул: вечер на Каме, за набережной — ОЭЗ «Алабуга». Панорама 512×216 в палитре Apollo.

Слои: закатное небо с дизерингом, дальний берег, силуэты заводов с окнами, набережная с фонарями
и остановкой, Кама с отражением заката. Всё, что двигается (автобус, машины, пар, окна, рябь, птицы),
рисует интерфейс поверх — координаты он берёт из src/game/title.gen.ts, который пишет этот же скрипт.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/title.py
Пишет public/assets/title/kama.png, src/game/title.gen.ts и превью tools/art/out/title_x3.png.
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from font import GLYPHS  # noqa: E402
from room3d import Tex, darker, lighter  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W, H = 512, 216
rng = np.random.default_rng(2909)

HZ = 120          # линия горизонта: низ силуэтов
ROAD0, ROAD1 = 130, 143   # проезжая часть
WALK1 = 149       # тротуар до
RAIL = 151        # перила набережной
WATER0 = 160      # начало воды
SUN = (372, 112, 12)

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0

t = Tex(W, H, 30)
ys, xs = np.mgrid[0:H, 0:W]
bay = BAYER[ys % 4, xs % 4]


# ---------------------------------------------------------------------------------------------------
# 1. небо: полосы сверху вниз, у солнца тёплые полосы поднимаются выше
def sun_lift(x):
    return 14 * math.exp(-((x - SUN[0]) / 120) ** 2)


BANDS = [(30, 0), (31, 30), (32, 56), (28, 84), (29, 100), (23, 114)]   # цвет, с какой высоты начинается
lift = np.array([sun_lift(x) for x in range(W)])
sky = np.full((H, W), 30)
for c, y0 in BANDS[1:]:
    edge = y0 - lift[None, :]
    # переход 6 точек: чем ближе к границе, тем реже точки нового цвета
    p = np.clip((ys - edge + 6) / 7.0, 0, 1)
    sky = np.where(p > bay, c, sky)
t.a[:HZ + 2] = sky[:HZ + 2]

# ореол солнца и диск
sx, sy, sr = SUN
d = np.hypot(xs - sx, (ys - sy) * 1.15)
t.a[(d < sr + 16) & (bay < np.clip((sr + 16 - d) / 16, 0, 1) * 0.55) & (ys < HZ)] = 23
t.a[(d < sr + 3) & (ys < HZ)] = 23
t.a[(np.hypot(xs - sx, ys - sy) < sr) & (ys < HZ)] = 17
t.a[(np.hypot(xs - sx, ys - sy) < sr - 3) & (ys < HZ)] = 45

# длинные облака: тёмное тело, нижний край подсвечен закатом
for cx, cy, ln, body, rim in ((96, 46, 70, 31, 32), (150, 62, 50, 32, 28), (300, 38, 56, 31, 32),
                              (430, 70, 64, 32, 29), (250, 84, 40, 28, 29)):
    for k in range(3):
        w0 = ln - k * 14 - int(rng.integers(0, 8))
        x0 = cx - w0 // 2 + int(rng.integers(-6, 7))
        y = cy + k
        t.rect(x0, y, x0 + w0, y, body)
    t.rect(cx - ln // 2 + 10, cy + 3, cx + ln // 2 - 18, cy + 3, rim)
    t.rect(cx - ln // 2 + 20, cy - 1, cx - ln // 2 + 36, cy - 1, body)

# звёзды в верхней полосе (часть мигает — это интерфейс)
for _ in range(40):
    x, y = int(rng.integers(0, W)), int(rng.integers(2, 34))
    if t.a[y, x] == 30:
        t.px(x, y, 42 if rng.random() < 0.7 else 44)

# ---------------------------------------------------------------------------------------------------
# 2. дальний берег: пологие холмы в дымке
for x in range(W):
    h = 108 + 3 * math.sin(x / 37) + 2 * math.sin(x / 13 + 1) + 2.5 * math.sin(x / 71 + 2)
    t.rect(x, round(h), x, HZ, 32)
    if (x + round(h)) % 3 == 0:
        t.px(x, round(h), 33)


# ---------------------------------------------------------------------------------------------------
# 3. ОЭЗ: силуэты с контровым светом справа и окнами
SIL, SIL2, RIM = 30, 0, 31
windows = []      # [x, y, w] — окна, которые интерфейс зажигает и гасит
chimneys = []     # [x, y] — откуда идёт пар
beacons = []      # [x, y] — красные огни на трубах и кране


def block(x0, y0, x1, y1=HZ, c=SIL, rim=RIM, wins=None):
    t.rect(x0, y0, x1, y1, c)
    t.rect(x1, y0, x1, y1, rim)
    t.rect(x0, y0, x1, y0, rim)
    if wins:
        step_x, step_y, ww = wins
        for y in range(y0 + 3, y1 - 2, step_y):
            for x in range(x0 + 2, x1 - ww - 1, step_x):
                t.rect(x, y, x + ww - 1, y, 1)
                windows.append([x, y, ww])


def sawtooth(x0, x1, y, step=6, c=SIL):
    for x in range(x0, x1 - step + 1, step):
        for i in range(step):
            t.rect(x + i, y - (i * 4) // step, x + i, y, c)
        t.px(x + step - 1, y - 3, 22)      # стекло фонаря ловит закат
        t.px(x + step - 1, y - 2, 21)


def chimney(x, top, w=3, stripes=True):
    t.rect(x, top, x + w - 1, HZ, SIL2)
    t.rect(x + w - 1, top, x + w - 1, HZ, RIM)
    if stripes:
        for y in range(top + 2, top + 16, 6):
            t.rect(x, y, x + w - 1, y + 1, 26)
    chimneys.append([x + w // 2, top - 1])
    beacons.append([x + w // 2, top])


# «Водогрей»: длинный цех с шедами, две трубы
chimney(58, 44)
chimney(70, 52)
block(12, 100, 148, wins=(5, 5, 2))
sawtooth(12, 148, 99)
block(24, 88, 52, wins=(4, 4, 2))                 # АБК
# кран над новым цехом
CX = 300
t.rect(CX, 52, CX + 2, HZ, SIL2)
for y in range(54, HZ, 4):
    t.px(CX + 1, y, RIM)
t.rect(262, 50, 348, 51, SIL2)                      # стрела
t.rect(334, 46, 340, 49, SIL2)                      # противовес
t.rect(CX - 2, 44, CX + 4, 49, SIL2)                # кабина
t.rect(CX - 1, 46, CX + 3, 47, 22)
t.line([(CX + 1, 44), (266, 50)], SIL2)            # ванты
t.line([(CX + 1, 44), (346, 50)], SIL2)
t.rect(270, 52, 270, 80, 37)                        # трос
t.rect(268, 80, 272, 82, 38)
beacons.append([262, 49])
beacons.append([CX + 1, 43])
# бизнес-центр с вывеской «АЛАБУГА» на крыше
block(156, 90, 236, wins=(6, 5, 3))
block(176, 58, 214, wins=(4, 4, 2))                 # башня
SIGN = 'АЛАБУГА'


def big_text(x, y, s, c, k=2, gap=1):
    for ch in s:
        g = GLYPHS[ch]
        for dy, row in enumerate(g):
            for dx, v in enumerate(row):
                if v == '#':
                    t.rect(x + dx * k, y + dy * k, x + dx * k + k - 1, y + dy * k + k - 1, c)
        x += (len(g[0]) + gap) * k


def text_w(s, k=2, gap=1):
    return sum((len(GLYPHS[ch][0]) + gap) * k for ch in s) - gap * k


sw = text_w(SIGN)
sgx = 195 - sw // 2
t.rect(sgx - 2, 55, sgx + sw + 1, 57, SIL2)          # рама вывески
for x in range(sgx, sgx + sw, 6):
    t.rect(x, 53, x, 57, SIL2)
big_text(sgx, 42, SIGN, 36)                          # буквы погашены — зажигает интерфейс
SIGN_BOX = [sgx, 42, sw, 10]
# новый цех: светлая крыша, ворота
block(246, 96, 352, wins=(8, 6, 4))
t.rect(246, 96, 352, 96, 32)
# газгольдеры и трубопровод справа (за солнцем — низкие, чтобы диск было видно)
for cx0, r in ((402, 9), (424, 7)):
    for y in range(HZ - 2 * r, HZ + 1):
        half = int(math.sqrt(max(0, r * r - (y - (HZ - r)) ** 2)))
        t.rect(cx0 - half, y, cx0 + half, y, SIL)
        t.px(cx0 + half, y, RIM)
chimney(446, 36)
block(438, 102, 506, wins=(5, 5, 2))
block(470, 84, 490, wins=(4, 4, 2))
t.rect(380, 110, 506, 111, SIL2)                    # эстакада труб
for x in range(384, 506, 10):
    t.rect(x, 111, x, HZ, SIL2)

# ---------------------------------------------------------------------------------------------------
# 4. лесополоса перед заводами
for x in range(W):
    h = HZ - 3 - (2 if (x // 5) % 3 == 0 else 0) - (3 if math.sin(x / 9) > 0.7 else 0) - int(rng.integers(0, 2))
    t.rect(x, h, x, 124, 6)
    if rng.random() < 0.3:
        t.px(x, h, 7)
t.noise(0, 118, W - 1, 124, 7, 0.08, on=6)

# ---------------------------------------------------------------------------------------------------
# 5. набережная: дальний тротуар с остановкой и фонарями, дорога, ближний тротуар, перила
FAR0 = 125                                            # дальний тротуар 125..128, по нему идёт новенький
t.rect(0, FAR0, W - 1, ROAD0 - 2, 40)
for x in range(0, W, 8):
    t.rect(x, FAR0, x, ROAD0 - 2, 39)
t.rect(0, ROAD0 - 1, W - 1, ROAD0 - 1, 41)          # дальний бордюр
t.rect(0, ROAD0, W - 1, ROAD1, 39)
t.noise(0, ROAD0, W - 1, ROAD1, 38, 0.05)
for x in range(0, W, 12):
    t.rect(x, 137, x + 5, 137, 41)                    # разметка
t.rect(0, ROAD1 + 1, W - 1, ROAD1 + 1, 41)          # ближний бордюр
t.rect(0, ROAD1 + 2, W - 1, WALK1, 40)
for x in range(0, W, 8):
    t.rect(x, ROAD1 + 2, x, WALK1, 39)
t.rect(0, WALK1, W - 1, WALK1, 39)

LAMPS = list(range(28, W, 72))
lamps = []
for lx in LAMPS:
    t.rect(lx, 102, lx, ROAD0 - 2, 38)
    t.rect(lx, 102, lx + 5, 102, 38)
    t.rect(lx + 4, 103, lx + 6, 103, 44)            # плафон
    lamps.append([lx + 5, 104])

# остановка «Набережная»: навес, световой короб с рекламой, лавка, знак «А»
STOP = 236
t.rect(STOP, 101, STOP + 38, 103, 38)                # крыша
t.rect(STOP, 101, STOP + 38, 101, 41)
t.rect(STOP + 1, 104, STOP + 1, ROAD0 - 2, 38)      # стойки
t.rect(STOP + 37, 104, STOP + 37, ROAD0 - 2, 38)
t.rect(STOP + 2, 104, STOP + 36, 124, 1)            # задняя стенка — стекло
t.checker(STOP + 2, 104, STOP + 36, 124, 0)
t.rect(STOP + 4, 106, STOP + 17, 117, 17)           # короб: светится
t.rect(STOP + 5, 107, STOP + 16, 111, 4)
t.rect(STOP + 6, 112, STOP + 15, 116, 23)
t.rect(STOP + 8, 108, STOP + 12, 110, 45)           # рекламка: облако и солнце
t.rect(STOP + 13, 113, STOP + 14, 115, 27)
t.rect(STOP + 21, 119, STOP + 34, 120, 21)          # лавка
t.rect(STOP + 22, 121, STOP + 22, 124, 38)
t.rect(STOP + 33, 121, STOP + 33, 124, 38)
SIGN_X = STOP + 44
t.rect(SIGN_X, 98, SIGN_X, ROAD0 - 2, 41)
t.rect(SIGN_X - 3, 92, SIGN_X + 3, 98, 45)
for dx, dy in ((0, 0), (-1, 1), (1, 1), (-1, 2), (0, 2), (1, 2), (-1, 3), (1, 3), (-1, 4), (1, 4)):
    t.px(SIGN_X + dx, 93 + dy, 2)

# перила набережной и гранит
t.rect(0, RAIL, W - 1, RAIL, 42)
t.rect(0, RAIL + 1, W - 1, RAIL + 1, 40)
for x in range(0, W, 6):
    t.rect(x, RAIL + 2, x, RAIL + 5, 40)
t.rect(0, RAIL + 6, W - 1, WATER0 - 1, 38)
for x in range(0, W, 10):
    t.rect(x, RAIL + 6, x, WATER0 - 1, 37)
t.rect(0, RAIL + 8, W - 1, RAIL + 8, 37)
# между стойками перил просвечивает гранит набережной
for x in range(W):
    for y in range(RAIL + 2, RAIL + 6):
        if x % 6:
            t.px(x, y, 39 if y < RAIL + 4 else 38)


# ---------------------------------------------------------------------------------------------------
# 6. Кама: отражение неба рваными полосами, дорожка от солнца
def sky_at(x, y):
    return sky[max(0, min(HZ - 1, y)), x]


for y in range(WATER0, H):
    k = (y - WATER0) / (H - WATER0)
    src = int(HZ - 2 - (y - WATER0) * 1.25)          # отражение: чем ближе к нам, тем выше по небу
    for x in range(W):
        c = sky_at(x, src)
        c = darker(c, 1) if c not in (30, 0) else 0
        t.a[y, x] = c
    # рябь: через строку сдвиг и тёмные штрихи
    if y % 2 == 1:
        for x in range(int(rng.integers(0, 9)), W, int(rng.integers(7, 13))):
            t.rect(x, y, x + int(rng.integers(2, 6)), y, 0 if k > 0.3 else 30)
t.rect(0, WATER0, W - 1, WATER0, 37)               # тень под гранитом
# дорожка от солнца: штрихи шире к нам, через строку
for y in range(WATER0 + 1, H, 2):
    k = (y - WATER0) / (H - WATER0)
    wd = int(4 + k * 16)
    x = SUN[0] - wd
    while x < SUN[0] + wd:
        ln = int(rng.integers(2, 5 + int(k * 4)))
        if rng.random() < 0.75 - 0.35 * abs(x - SUN[0]) / wd:
            t.rect(x, y, min(x + ln, SUN[0] + wd), y, 23 if k < 0.35 else (22 if k < 0.7 else 29))
        x += ln + int(rng.integers(1, 3))


# ---------------------------------------------------------------------------------------------------
def main():
    out = os.path.join(ROOT, 'public', 'assets', 'title')
    prev = os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(out, exist_ok=True)
    os.makedirs(prev, exist_ok=True)
    im = t.image()
    im.save(os.path.join(out, 'kama.png'))
    from PIL import Image
    im.resize((W * 3, H * 3), Image.NEAREST).save(os.path.join(prev, 'title_x3.png'))
    gen = os.path.join(ROOT, 'src', 'game', 'title.gen.ts')
    # окна, которые потом закрыли деревья или соседний корпус, не зажигаем
    vis = [w for w in windows if all(t.a[w[1], w[0] + i] == 1 for i in range(w[2]))]
    body = {
        'w': W, 'h': H, 'horizon': HZ, 'road': [ROAD0, ROAD1], 'water': WATER0, 'sun': list(SUN),
        'stop': STOP, 'walk': ROAD0 - 2, 'stopSign': SIGN_X, 'lamps': lamps, 'windows': vis, 'chimneys': chimneys,
        'beacons': beacons, 'sign': SIGN_BOX,
    }
    with open(gen, 'w', encoding='utf-8') as f:
        f.write('// Сгенерировано tools/art/title.py — не править руками.\n')
        f.write('// Панорама титула: где окна, трубы, фонари, остановка — то, что оживляет интерфейс.\n\n')
        f.write('export const TITLE = ' + json.dumps(body, ensure_ascii=False, separators=(',', ':')) + ' as const\n')
    print('ok title', len(vis), 'окон')


if __name__ == '__main__':
    main()
