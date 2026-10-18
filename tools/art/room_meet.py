"""Переговорная «Кама» в административном корпусе ОЭЗ «Алабуга» (src/game/world3d/rooms/meet.ts): 10:00, октябрь.

Светлая современная переговорная по мотивам офисов Сбера, Совкомбанка, Авито и Яндекса (референсы —
~/Arena-materials/final/liwei-room/refs): белые стены, светлый дуб, серый ковролин плиткой, длинный стол на
двенадцать мест, серые кресла на колёсах. На левой торцевой стене — панель из дубовых реек и большой экран
видеосвязи (его картинку рисует браузер, call.ts), под ним низкая тумба. Дальняя стена — окна в пол на промзону
и Каму, справа в ней дверь. На правой стене стеклянная маркерная доска с заметками к звонку и войлочные панели.
Стены, пол, потолок, столешница и вид из окна — уникальные текстуры, мелочь — атлас в трёх вариантах света.

Запуск: ~/Arena-materials/.venv/bin/python tools/art/room_meet.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rooms_common import (R, T, Tex, band_shade, ellipse_mask, falloff, shade_levels, text_w,  # noqa: E402
                          write_all, BAYER)
from room3d import HGT, S, TABLE, Atlas, solid, wood  # noqa: E402

rng = R.rng
R.FONT.setdefault('?', ['##.', '..#', '.#.', '...', '.#.'])

# Комната своя, больше обычной переговорной: стол на 4,6 м, экран на торцевой стене слева от игрока.
X0, X1, Z0, Z1 = -3.75, 2.95, -2.15, 1.75
TX0, TX1 = -2.75, 1.85
FAR, NEAR, TY = TABLE['far'], TABLE['near'], TABLE['y']
TZ = (FAR + NEAR) / 2

PLACE = {
    'room': [X0, X1, Z0, Z1, HGT],
    'table': [TX0, TX1],
    # экран на левой стене: центр по z, центр по y, ширина, высота (сама картинка; рамка шире на bezel)
    'screen': [TZ, 1.52, 2.5, 1.4],
    'bezel': 0.045,
    'slats': [-1.78, 1.16],  # z0 z1 панели из реек за экраном, от пола до потолка
    'console': [-1.45, 0.83, 0.46, 0.42],  # z0 z1 высота глубина — тумба под экраном
    'sign': [1.24, 1.66, 1.42, 1.66],  # z0 z1 y0 y1 — табличка «Кама» на белой стене левее панели
    # окна в пол в дальней стене: x0 x1 y0 y1, импосты
    'window': [X0, 1.05, 0.48, 2.78],
    'mullions': [-2.55, -1.35, -0.15],
    'door': [1.62, 2.52, 2.2],  # x0 x1 h — дверь в дальней стене справа
    'plate': [2.74, 1.5],  # x y таблички у двери
    # правая стена: стеклянная маркерная доска z0 z1 y0 y1, войлочные панели
    'board': [-1.25, 0.55, 0.95, 2.0],
    'felt': [0.85, 1.55, 0.6, 2.3],
    # потолок: дубовый «остров» над столом x0 x1 z0 z1 и два линейных светильника под ним
    'raft': [-2.55, 1.65, -1.12, 0.5, 2.8],
    'leds': [-0.62, 0.0],
    'ledY': 2.42,
    'downlights': [[-3.2, -1.7], [-3.2, 1.2], [2.4, -1.6], [2.4, 1.2], [-0.5, 1.3], [-0.5, -1.75]],
    'cassette': [0.6, 1.25],
    'clock': [2.35, -0.35],  # y и z часов над доской на правой стене
    # стулья: дальний ряд смотрит на игрока, ближний — к столу; в торце у двери ещё один
    'farX': [-2.38, -1.42, -0.48, 0.46, 1.4],
    'farZ': -1.24,
    'nearX': [-2.35, 1.1],  # место рядом с игроком свободно: кресло откатили
    'nearZ': 0.78,
    'endChair': [2.3, TZ],
    # коллеги-массовка на местах дальнего ряда (индексы farX)
    'crew': [0, 3],
    # растения: большое в углу у окна, у двери, у передней стены, на тумбе
    'bigplant': [-3.32, -1.82],
    'doorplant': [2.68, -1.78],
    'frontplant': [-3.38, 1.42],
    'cplant': [-0.05],
    # на столе: спикерфон, люк с розетками, вода и стаканы, блокноты коллег
    'speaker': [-1.65, TZ],
    'hatch': [[-0.95, TZ], [0.95, TZ]],
    'bottles': [[-2.2, -0.62], [-0.65, -0.12], [1.15, -0.55]],
    'glasses': [[-2.05, -0.55], [-2.32, -0.48], [0.62, -0.62], [-0.48, -0.05]],
    'pads': [[-2.38, -0.66, 0.2], [0.46, -0.68, -0.15]],
    'colleagueLaptop': [-2.36, -0.58, 0.35],
}
# Вид из окна: дальний план (промзона, Кама, дальний берег, небо), облака и ближний (берёзы, парковка внизу)
VIEW = {
    'far': [-17.0, 7.0, -4.0, 8.6, -11.5],
    'clouds': [-17.0, 7.0, 4.8, 8.4, -11.4],
    'near': [-7.0, 2.4, -1.6, 4.2, -4.4],
}


# ======================================================================================================
# Атлас
# ======================================================================================================

def leafy(t, cx, cy, n, spread, cols, rx=3.0, ry=1.6, rot=0.9):
    """Куст листьев эллипсами: cols — (тень, основной, блик)."""
    xs, ys = t.grid()
    pts = [(float(rng.normal(cx, spread[0])), float(rng.normal(cy, spread[1]))) for _ in range(n)]
    pts.sort(key=lambda p: p[1])
    for x, y in pts:
        a = rng.uniform(-rot, rot)
        dx, dy = xs - x, ys - y
        u = dx * np.cos(a) + dy * np.sin(a)
        v = -dx * np.sin(a) + dy * np.cos(a)
        m = (u / rx) ** 2 + (v / ry) ** 2 <= 1
        t.mask(m, cols[1])
        t.mask(m & (v > 0.5), cols[0])
        t.mask(m & (v < -0.7) & (u > 0), cols[2])


def items(at):
    for c in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 21, 22, 27, 28, 36, 37, 38, 39, 40,
              41, 42, 43, 44, 45):
        at.add(f'c{c}', solid(c))
    t = Tex(8, 8, 43)
    t.rect(0, 0, 7, 1, 45)
    t.rect(0, 6, 7, 7, 41)
    at.add('chrome', t)
    at.add('clock', R.clock_face(True))
    at.add('clock_rim', Tex(8, 4, 44))

    # ---------------------------------------------------------------- дуб: рейки, кромки, тумба
    t = Tex(32, 16, 16)
    wood(t, 0, 0, 31, 15, 16, 15, 17, 0.3)
    at.add('oak_h', t)
    t = Tex(16, 32, 16)
    wood(t, 0, 0, 15, 31, 16, 15, 17, 0.3, vertical=True)
    at.add('oak_v', t)
    t = Tex(32, 4, 15)  # кромка столешницы: светлая фаска сверху, тень снизу
    t.rect(0, 0, 31, 0, 17)
    t.rect(0, 3, 31, 3, 14)
    at.add('tedge', t)
    t = Tex(48, 32, 16)  # «остров» на потолке снизу: рейки поперёк, щели тёмные
    for x in range(0, 48, 4):
        wood(t, x, 0, x + 2, 31, 16, 15, 17, 0.25, vertical=True)
        t.rect(x + 3, 0, x + 3, 31, 13)
    at.add('raft', t)
    t = Tex(32, 6, 16)
    for x in range(0, 32, 4):
        t.rect(x + 3, 0, x + 3, 5, 14)
    t.rect(0, 5, 31, 5, 15)
    at.add('raft_side', t)
    # тумба: белые фасады без ручек, швы и ножки-цоколь
    t = Tex(96, 18, 45)
    for x in (0, 24, 48, 72):
        t.rect(x, 0, x, 15, 43)
        t.rect(x + 1, 0, x + 1, 15, 44)
    t.rect(0, 0, 95, 0, 44)
    t.rect(0, 16, 95, 17, 39)  # тень цоколя
    t.rect(10, 6, 14, 6, 43)  # прорези-ручки
    t.rect(34, 6, 38, 6, 43)
    t.rect(58, 6, 62, 6, 43)
    t.rect(82, 6, 86, 6, 43)
    at.add('console_front', t)
    t = Tex(64, 12, 16)
    wood(t, 0, 0, 63, 11, 16, 15, 17, 0.3)
    t.rect(0, 11, 63, 11, 15)
    at.add('console_top', t)

    # ---------------------------------------------------------------- экран: рамка, камера над ним, спикерфон
    t = Tex(16, 16, 38)
    t.rect(0, 0, 15, 0, 39)
    t.rect(0, 15, 15, 15, 37)
    at.add('bezel', t)
    t = Tex(48, 6, 37)  # видеобар: чёрный, сетка динамиков и глазок камеры
    t.rect(0, 0, 47, 0, 39)
    for x in range(2, 46, 2):
        t.px(x, 3, 38)
    t.rect(22, 2, 25, 4, 36)
    t.px(23, 2, 4)
    t.px(30, 2, 9)
    at.add('cambar', t)
    t = Tex(24, 24, T)  # спикерфон сверху: тёмный диск, светящееся кольцо, кнопки
    t.ellipse(12, 12, 11.5, 11.5, 38)
    t.ellipse(12, 12, 10, 10, 39)
    for k in range(24):
        a = k / 24 * 2 * np.pi
        t.px(12 + 7 * np.cos(a), 12 + 7 * np.sin(a), 4 if k % 2 else 3)
    t.ellipse(12, 12, 3, 3, 38)
    t.px(12, 12, 9)
    at.add('speaker_top', t)
    t = Tex(16, 6, 22)  # люк с розетками на столе
    t.frame(0, 0, 15, 5, 40)
    t.rect(1, 1, 14, 4, 39)
    for x in (3, 8, 12):
        t.rect(x, 2, x + 1, 3, 37)
    at.add('hatch', t)

    # ---------------------------------------------------------------- окно, дверь, табличка
    t = Tex(8, 8, 39)  # алюминиевый профиль окна: графит
    t.rect(0, 0, 7, 0, 40)
    t.rect(0, 7, 7, 7, 38)
    at.add('mullion', t)
    t = Tex(32, 6, 45)  # подоконник
    t.rect(0, 0, 31, 0, 45)
    t.rect(0, 5, 31, 5, 43)
    at.add('sill', t)
    t = Tex(96, 12, 44)  # короб конвектора под окнами: решётка
    t.rect(0, 0, 95, 0, 45)
    for x in range(2, 96, 3):
        t.rect(x, 2, x, 9, 42)
    t.rect(0, 11, 95, 11, 41)
    at.add('convector', t)
    t = Tex(36, 88, 16)  # дверь: шпон светлого дуба, вертикальные волокна, стальная ручка
    wood(t, 0, 0, 35, 87, 16, 15, 17, 0.25, vertical=True)
    t.frame(0, 0, 35, 87, 15)
    t.rect(28, 42, 33, 43, 43)
    t.rect(28, 42, 28, 46, 42)
    t.rect(29, 44, 33, 44, 40)
    t.rect(4, 4, 6, 83, 17)  # узкая стеклянная вставка
    t.rect(5, 4, 5, 83, 5)
    at.add('door_m', t)
    t = Tex(8, 8, 41)
    t.rect(0, 0, 7, 0, 42)
    at.add('door_frame', t)
    t = Tex(24, 16, 45)  # табличка у двери: «КАМА» и номер
    t.frame(0, 0, 23, 15, 43)
    t.rect(0, 0, 3, 15, 3)
    t.text(6, 3, 'КАМА', 38)
    t.text(6, 9, '307', 41)
    at.add('plate', t)
    # табличка на стене: синяя полоса слева, крупно «КАМА», ниже номер и ОЭЗ
    t = Tex(26, 15, 45)
    t.frame(0, 0, 25, 14, 43)
    t.rect(1, 1, 3, 13, 2)
    t.rect(1, 1, 1, 13, 3)
    t.text(6, 2, 'КАМА', 38)
    t.text(6, 8, '307', 41)
    t.rect(19, 10, 23, 10, 42)
    at.add('sign_kama', t)

    # ---------------------------------------------------------------- маркерная доска с заметками к звонку
    t = Tex(72, 42, 45)
    t.frame(0, 0, 71, 41, 43)
    # маршрут в две строки: ШЭНЬЧЖЭНЬ, ниже стрелка и КАЗАНЬ
    t.text(3, 3, 'ШЭНЬЧЖЭНЬ', 1)
    t.line([(4, 11), (12, 11)], 1)
    t.px(11, 10, 1)
    t.px(11, 12, 1)
    t.text(16, 9, 'КАЗАНЬ', 1)
    t.text(3, 16, 'М12', 27)
    t.text(19, 16, '500 ШТ', 27)
    # заметки команды к звонку — вопросы из задания, без готовых ответов
    t.text(3, 22, 'ОБРАЗЕЦ', 38)
    t.rect(34, 22, 37, 26, 9)
    t.text(3, 28, 'СРОК', 38)
    t.text(21, 28, '?', 2)
    t.text(3, 34, 'ОПЛАТА', 38)
    t.text(30, 34, '?', 2)
    # схемка: ящик и стрелка
    t.frame(50, 8, 64, 20, 2)
    t.line([(50, 8), (57, 3), (64, 8)], 2)
    t.line([(52, 30), (66, 26)], 27)
    t.line([(52, 34), (62, 33)], 41)
    t.rect(0, 40, 71, 41, 42)  # полочка для маркеров
    for x, c in ((44, 37), (48, 27), (52, 2)):
        t.rect(x, 39, x + 3, 39, c)
    at.add('board', t)
    t = Tex(8, 8, 44)
    t.rect(0, 0, 7, 0, 45)
    at.add('board_edge', t)

    # ---------------------------------------------------------------- кресла: сетчатая спинка, ткань, крестовина
    t = Tex(24, 24, 43)  # спинка спереди: мягкая ткань, вертикальная прострочка, валик сверху
    t.frame(0, 0, 23, 23, 41)
    for x in (6, 12, 18):
        t.rect(x, 4, x, 21, 42)
    t.rect(1, 1, 22, 3, 44)
    t.rect(1, 4, 22, 4, 42)
    t.rect(1, 22, 22, 22, 42)
    at.add('chair_back', t)
    t = Tex(24, 24, 42)
    t.frame(0, 0, 23, 23, 41)
    t.rect(1, 1, 22, 1, 43)
    t.rect(10, 5, 13, 22, 41)  # каркас сзади
    at.add('chair_rear', t)
    t = Tex(24, 24, 43)
    t.noise(0, 0, 23, 23, 42, 0.12)
    t.frame(0, 0, 23, 23, 42)
    t.rect(1, 1, 22, 2, 44)
    at.add('seat', t)
    t = Tex(24, 6, 42)
    t.rect(0, 0, 23, 0, 43)
    t.rect(0, 5, 23, 5, 41)
    at.add('seat_side', t)

    # ---------------------------------------------------------------- на столе: вода, стаканы, блокноты, ноутбук
    t = Tex(10, 26, T)  # бутылка воды: синяя крышка, этикетка
    t.rect(4, 0, 6, 2, 2)
    t.rect(3, 3, 7, 5, 5)
    t.rect(2, 6, 8, 25, 5)
    t.rect(2, 6, 2, 25, 45)
    t.rect(7, 6, 8, 25, 4)
    t.rect(2, 13, 8, 18, 3)
    t.rect(3, 15, 6, 15, 45)
    t.rect(2, 25, 8, 25, 4)
    at.add('bottle', t)
    t = Tex(8, 12, T)  # стакан с водой
    t.rect(1, 0, 6, 11, 5)
    t.rect(1, 0, 6, 0, 45)
    t.rect(1, 0, 1, 11, 45)
    t.rect(1, 4, 6, 4, 4)
    t.rect(2, 11, 6, 11, 4)
    at.add('glass', t)
    t = Tex(16, 22, 45)  # блокнот в клетку с ручкой
    for y in range(3, 22, 3):
        t.rect(1, y, 14, y, 44)
    t.rect(0, 0, 15, 1, 2)
    t.line([(3, 6), (11, 6)], 1)
    t.line([(3, 9), (9, 9)], 1)
    t.line([(3, 12), (12, 12)], 1)
    at.add('pad', t)
    t = Tex(40, 28, 41)  # крышка ноутбука коллеги сзади: серый алюминий, логотип-кружок
    t.rect(0, 0, 39, 0, 43)
    t.rect(0, 27, 39, 27, 40)
    t.ellipse(20, 14, 3, 3, 43)
    t.ellipse(20, 14, 1.6, 1.6, 42)
    at.add('lid_back', t)
    t = Tex(40, 26, 39)  # его клавиатура
    for r in range(4):
        for k in range(10):
            t.rect(2 + k * 4, 2 + r * 4, 4 + k * 4, 4 + r * 4, 38)
    t.rect(14, 19, 26, 24, 40)
    at.add('keys2', t)
    t = Tex(16, 16, 45)  # кружка
    t.rect(0, 0, 15, 2, 44)
    t.rect(4, 6, 11, 9, 2)
    at.add('mug', t)
    t = Tex(16, 16, T)
    t.ellipse(8, 8, 7.5, 7.5, 44)
    t.ellipse(8, 8, 6, 6, 13)
    t.ellipse(7, 7, 2, 1.5, 14)
    at.add('mug_top', t)

    # ---------------------------------------------------------------- растения и кашпо
    t = Tex(56, 84, T)  # фикус лировидный в углу у окна: тонкий ствол, крупные листья-скрипки
    t.line([(28, 83), (27, 60), (29, 38), (27, 18)], 13)
    t.line([(28, 60), (19, 48)], 13)
    t.line([(28, 46), (38, 36)], 13)
    xs, ys = t.grid()
    for (cx, cy, r, a) in ((27, 9, 7, 0.1), (19, 17, 7, -0.6), (35, 16, 7, 0.6), (15, 30, 7, -0.9), (39, 29, 7, 0.8),
                           (24, 26, 6, -0.2), (31, 37, 7, 0.4), (17, 44, 7, -0.7), (40, 42, 6, 0.9), (21, 54, 6, -0.5),
                           (34, 52, 6, 0.6), (26, 47, 5, 0.1)):
        u = (xs - cx) * np.cos(a) + (ys - cy) * np.sin(a)
        v = -(xs - cx) * np.sin(a) + (ys - cy) * np.cos(a)
        m = (u / (r * 0.78)) ** 2 + (v / r) ** 2 <= 1
        t.mask(m, 8)
        t.mask(m & (u < -r * 0.15), 9)
        t.mask(m & (u > r * 0.4) & (v > 0), 7)
        t.line([(cx - np.sin(a) * r * 0.8, cy + np.cos(a) * r * 0.8), (cx + np.sin(a) * r * 0.7, cy - np.cos(a) * r * 0.7)], 7)
    at.add('ficus', t)
    t = Tex(44, 56, T)  # стрелиция у двери: длинные листья веером
    for (x1, y1) in ((4, 8), (12, 2), (22, 0), (32, 3), (40, 10), (8, 22), (36, 20)):
        t.line([(22, 55), (x1, y1 + 14)], 7)
        m = ellipse_mask(t, x1 + (22 - x1) * 0.12, y1 + 6, 4.2, 8)
        t.mask(m, 8)
        t.mask(m & ellipse_mask(t, x1 + (22 - x1) * 0.12 - 1.5, y1 + 4, 2, 6), 9)
        t.line([(x1 + (22 - x1) * 0.12, y1 - 1), (x1 + (22 - x1) * 0.12, y1 + 13)], 7)
    at.add('strelitzia', t)
    t = Tex(18, 34, T)  # сансевиерия на тумбе
    for x0, top, lean in ((3, 6, -2), (6, 1, 0), (9, 4, 1), (12, 0, 2), (15, 8, 3)):
        t.poly([(x0, 33), (x0 + 2.4, 33), (x0 + 1.4 + lean, top), (x0 + 0.6 + lean, top)], 8)
        t.line([(x0, 33), (x0 + lean + 0.6, top + 1)], 10)
        t.line([(x0 + 2, 33), (x0 + lean + 1.6, top + 3)], 7)
    at.add('snake', t)
    t = Tex(40, 40, T)  # монстера в передней части комнаты
    for (x1, y1) in ((8, 12), (18, 4), (30, 4), (36, 14), (12, 24), (30, 22)):
        t.line([(20, 39), (x1 + 2, y1 + 6)], 7)
    for (cx, cy, r) in ((9, 14, 7), (18, 7, 8), (29, 7, 7), (34, 16, 6), (12, 25, 7), (29, 25, 7), (20, 17, 8)):
        t.ellipse(cx, cy, r, r * 0.8, 8)
        t.ellipse(cx - 1, cy - 1, r * 0.75, r * 0.55, 9)
        for k in (-1, 1):
            t.line([(cx + k * r * 0.4, cy - 2), (cx + k * r * 0.95, cy - 3)], T)
            t.line([(cx + k * r * 0.4, cy + 2), (cx + k * r * 0.95, cy + 3)], T)
        t.line([(cx, cy - r * 0.6), (cx, cy + r * 0.6)], 7)
    at.add('monstera', t)
    t = Tex(16, 16, 44)  # высокое белое кашпо
    t.rect(0, 0, 15, 1, 45)
    t.rect(1, 2, 3, 15, 45)
    t.rect(12, 2, 15, 15, 43)
    at.add('planter', t)
    t = Tex(16, 16, 12)
    t.noise(0, 0, 15, 15, 13, 0.3)
    at.add('soil', t)
    t = Tex(16, 8, 41)  # бетонный горшочек
    t.rect(0, 0, 15, 1, 43)
    t.noise(0, 2, 15, 7, 40, 0.15)
    at.add('pot_c', t)
    return at


# ======================================================================================================
# Большие поверхности
# ======================================================================================================

W_BACK = round((X1 - X0) / S)
D_SIDE = round((Z1 - Z0) / S)
H_WALL = round(HGT / S)
Y = lambda y: (HGT - y) / S  # noqa: E731


def plaster(w, h, base=45):
    """Белая стена: еле заметная фактура краски."""
    t = Tex(w, h, base)
    t.noise(0, 0, w - 1, h - 1, 44, 0.025)
    return t


def baseboard(t):
    t.rect(0, t.h - 3, t.w - 1, t.h - 1, 43)
    t.rect(0, t.h - 3, t.w - 1, t.h - 3, 44)


def soft_vertical(t, lo, hi, levels=1, m=None):
    """Ступенька света по горизонтали: левее lo как есть, правее hi — на levels темнее, между — шахматкой."""
    xs, ys = t.grid()
    by = BAYER[ys.astype(int) % 4, xs.astype(int) % 4]
    k = (xs - lo) / max(1, hi - lo)
    lv = np.clip(np.floor(k * levels + by * 0.999), 0, levels)
    shade_levels(t, lv.astype(int), m)


def walls(P):
    out = {}
    # ---- левая (экран): столбец 0 — передняя стена (z = Z1)
    Zl = lambda z: (Z1 - z) / S  # noqa: E731
    t = plaster(D_SIDE, H_WALL)
    s0, s1 = P['slats']
    a, b = int(Zl(s1)), int(Zl(s0))
    # панель из дубовых реек: рейка 2 текселя, щель 1, у пола и под потолком — тёмная тень-зазор
    for x in range(a, b + 1, 3):
        wood(t, x, 1, min(b, x + 1), H_WALL - 2, 16, 15, 17, 0.28, vertical=True)
        if x + 2 <= b:
            t.rect(x + 2, 1, x + 2, H_WALL - 2, 13)
    t.rect(a, 0, b, 0, 43)
    t.rect(a - 1, 0, a - 1, H_WALL - 1, 43)
    t.rect(b + 1, 0, b + 1, H_WALL - 1, 43)
    # подсветка панели сверху: тёплая полоса от скрытой ленты
    t.rect(a, 1, b, 2, 17)
    # экран и тумба заслоняют рейки: мягкая тень по краям рамки и под тумбой
    zc, yc, sw, sh = P['screen']
    bz = P['bezel']
    band_shade(t, Zl(zc + sw / 2 + bz) - 1, Y(yc + sh / 2 + bz) + 1, Zl(zc - sw / 2 - bz) + 2, Y(yc - sh / 2 - bz) + 3, 1)
    c0, c1, ch, _ = P['console']
    band_shade(t, Zl(c1) - 1, Y(ch) - 1, Zl(c0) + 1, H_WALL - 1, 1)
    # табличка «Кама» на белой стене: тень
    g0, g1, gy0, gy1 = P['sign']
    band_shade(t, Zl(g1) + 1, Y(gy1) + 1, Zl(g0) + 1, Y(gy0) + 1, 1)
    baseboard(t)
    # от окна (дальний край, большие столбцы) светлее, к передней стене — на ступень темнее
    soft_vertical(t, Zl(-1.2), Zl(0.6), 1)
    t.rect(0, 0, t.w - 1, 0, 43)
    out['left'] = t

    # ---- дальняя (окна, дверь): столбец 0 — левая стена (x = X0)
    Xb = lambda x: (x - X0) / S  # noqa: E731
    t = plaster(W_BACK, H_WALL)
    wx0, wx1, wy0, wy1 = P['window']
    # над окнами — потолочный короб, под ними — конвектор (его рисует атлас), стена рядом с проёмом светлее
    t.rect(0, 0, Xb(wx1), Y(wy1) - 1, 44)
    t.rect(0, Y(wy1) - 2, Xb(wx1), Y(wy1) - 1, 43)
    d0, d1, dh = P['door']
    t.rect(Xb(d0) - 3, Y(dh) - 3, Xb(d1) + 2, H_WALL - 1, 41)  # наличник двери
    t.rect(Xb(d0) - 2, Y(dh) - 2, Xb(d1) + 1, H_WALL - 1, 42)
    px, py = P['plate']
    band_shade(t, Xb(px) - 3, Y(py) - 3, Xb(px) + 4, Y(py) + 3, 1)
    baseboard(t)
    # простенок с дверью дальше от окна — к правому углу ступень темнее
    soft_vertical(t, Xb(1.3), Xb(2.6), 1)
    out['back'] = t

    # ---- правая: столбец 0 — дальняя стена (z = Z0)
    Zr = lambda z: (z - Z0) / S  # noqa: E731
    t = plaster(D_SIDE, H_WALL)
    b0, b1, by0, by1 = P['board']
    band_shade(t, Zr(b0) + 1, Y(by1) + 1, Zr(b1) + 2, Y(by0) + 2, 1)
    # войлочные панели: три вертикальные полосы приглушённого синего с фактурой
    f0, f1, fy0, fy1 = P['felt']
    n = 3
    step = (Zr(f1) - Zr(f0)) / n
    for i in range(n):
        x0_ = int(Zr(f0) + i * step) + 1
        x1_ = int(Zr(f0) + (i + 1) * step) - 1
        top = Y(fy1) + (0, 6, 3)[i]
        bot = Y(fy0) - (4, 0, 8)[i]
        c = (2, 3, 2)[i]
        t.rect(x0_, top, x1_, bot, c)
        t.noise(x0_, top, x1_, bot, c - 1 if c > 0 else c, 0.12)
        t.rect(x0_, top, x1_, top, c + 1)
        t.rect(x1_ + 1, top + 1, x1_ + 1, bot + 1, 43)
        t.rect(x0_ + 1, bot + 1, x1_ + 1, bot + 1, 43)
    baseboard(t)
    # у окна (столбцы слева) светлее, к передней стене темнее
    soft_vertical(t, Zr(-0.4), Zr(1.4), 1)
    out['right'] = t

    # ---- передняя (за спиной): столбец 0 — правая стена (x = X1)
    Xf = lambda x: (X1 - x) / S  # noqa: E731
    t = plaster(W_BACK, H_WALL)
    # ряд войлочных панелей-квадратов на уровне головы
    for i, x in enumerate(np.arange(-2.9, 2.2, 0.62)):
        c = (2, 41, 3, 40)[i % 4]
        t.rect(Xf(x + 0.55), Y(2.2), Xf(x), Y(1.1), c)
        t.noise(Xf(x + 0.55), Y(2.2), Xf(x), Y(1.1), c - 1, 0.1)
        t.rect(Xf(x + 0.55), Y(1.1) + 1, Xf(x), Y(1.1) + 1, 43)
    baseboard(t)
    shade_levels(t, np.ones(t.a.shape, int))
    out['front'] = t
    return out


def floor_tex(P):
    """Ковролин плиткой 50×50 см: соседние плитки повёрнуты, у окна светлее, тени мебели."""
    w, h = W_BACK, D_SIDE
    t = Tex(w, h, 42)
    X = lambda x: (x - X0) / S  # noqa: E731
    Zf = lambda z: (z - Z0) / S  # noqa: E731
    tile = 20
    for ty in range(0, h, tile):
        for tx in range(0, w, tile):
            vert = ((tx // tile) + (ty // tile)) % 2 == 0
            for k in range(0, tile, 3):
                if vert:
                    t.rect(tx + k, ty, tx + k, ty + tile - 1, 41)
                else:
                    t.rect(tx, ty + k, tx + tile - 1, ty + k, 41)
            t.noise(tx, ty, tx + tile - 1, ty + tile - 1, 43, 0.05, on=42)
    # синяя «дорожка» вдоль окон — акцент, как у Совкомбанка
    t.rect(0, 0, X(P['window'][1]), Zf(Z0 + 0.38), 2)
    t.noise(0, 0, X(P['window'][1]), Zf(Z0 + 0.38), 1, 0.12)
    # свет из окон: у стекла на ступень светлее, шахматный край
    xs, ys = t.grid()
    by = BAYER[ys.astype(int) % 4, xs.astype(int) % 4]
    near_win = (xs < X(P['window'][1]) + (by - 0.5) * 3) & (ys < Zf(Z0 + 1.1) + (by - 0.5) * 4)
    shade_levels(t, np.where(near_win, -1, 0))
    # тень под столом
    band_shade(t, X(TX0), Zf(FAR), X(TX1), Zf(NEAR), 1)
    t.shade(X(TX0) + 3, Zf(FAR) + 3, X(TX1) - 3, Zf(NEAR) - 3, 1)
    # кресла
    for x in P['farX']:
        t.shade_ellipse(X(x), Zf(P['farZ']), 0.3 / S, 0.27 / S, 1)
    for x in P['nearX'] + [0.0]:
        t.shade_ellipse(X(x), Zf(P['nearZ'] + 0.1), 0.3 / S, 0.27 / S, 1)
    ex, ez = P['endChair']
    t.shade_ellipse(X(ex), Zf(ez), 0.27 / S, 0.3 / S, 1)
    # тумба под экраном
    c0, c1, _, cd = P['console']
    band_shade(t, 0, Zf(c0) - 1, X(X0 + cd) + 2, Zf(c1) + 1, 1)
    for key, r in (('bigplant', 0.3), ('doorplant', 0.26), ('frontplant', 0.26)):
        x, z = P[key]
        t.shade_ellipse(X(x), Zf(z), r / S, r * 0.85 / S, 1)
    # у передней стены темнее
    t.shade(0, Zf(1.0), w - 1, h - 1, 1, m=((ys.astype(int) + xs.astype(int)) % 2 == 0))
    t.shade(0, Zf(1.35), w - 1, h - 1, 1)
    return t


def ceiling_tex(P):
    """Белый потолок плиткой 60×60, точечные светильники, кассета кондиционера; пятна света."""
    w, h = W_BACK, D_SIDE
    t = Tex(w, h, 45)
    X = lambda x: (x - X0) / S  # noqa: E731
    Zf = lambda z: (z - Z0) / S  # noqa: E731
    for x in range(0, w, 24):
        t.rect(x, 0, x, h - 1, 44)
    for y in range(0, h, 24):
        t.rect(0, y, w - 1, y, 44)
    for (x, z) in P['downlights']:
        t.ellipse(X(x), Zf(z), 3, 3, 43)
        t.ellipse(X(x), Zf(z), 2, 2, 45)
    cx, cz = P['cassette']
    t.rect(X(cx) - 12, Zf(cz) - 12, X(cx) + 12, Zf(cz) + 12, 44)
    t.frame(X(cx) - 12, Zf(cz) - 12, X(cx) + 12, Zf(cz) + 12, 42)
    for k in range(-9, 10, 2):
        t.rect(X(cx) - 9, Zf(cz) + k, X(cx) + 9, Zf(cz) + k, 43)
    t.rect(X(cx) - 3, Zf(cz) - 3, X(cx) + 3, Zf(cz) + 3, 45)
    # «остров» отбрасывает тень на потолок вокруг себя
    r0, r1, rz0, rz1, _ = P['raft']
    band_shade(t, X(r0) - 1, Zf(rz0) - 1, X(r1) + 1, Zf(rz1) + 1, 1)
    # у передней стены темнее
    xs, ys = t.grid()
    t.shade(0, Zf(1.0), w - 1, h - 1, 1, m=((ys.astype(int) + xs.astype(int)) % 2 == 0))
    return t


def table_tex(P):
    """Столешница светлого дуба: волокна вдоль стола, тени ноутбуков, спикерфона и бутылок."""
    w = 320
    s = (TX1 - TX0) / w
    h = round((NEAR - FAR) / s)
    X = lambda x: (x - TX0) / s  # noqa: E731
    Zt = lambda z: (z - FAR) / s  # noqa: E731
    t = Tex(w, h, 16)
    for y in range(h):
        x = -int(rng.integers(0, 50))
        while x < w:
            n = int(rng.integers(14, 70))
            r = rng.random()
            if r < 0.2:
                t.rect(x, y, x + n, y, 15)
            elif r < 0.32:
                t.rect(x, y, x + n // 2, y, 17)
            x += n + int(rng.integers(6, 36))
    # шпон листами по 1,15 м — едва заметные стыки
    for x in np.arange(TX0 + 1.15, TX1, 1.15):
        t.rect(X(x), 0, X(x), h - 1, 15)
    # тени: ноутбук игрока (x = 0) и ноутбук коллеги, спикерфон, вода
    t.shade(X(-0.19), Zt(-0.36), X(0.21), Zt(-0.06), 1)
    lx, lz, _ = P['colleagueLaptop']
    t.shade_ellipse(X(lx + 0.02), Zt(lz + 0.04), 0.2 / s, 0.13 / s, 1)
    sx, sz = P['speaker']
    t.shade_ellipse(X(sx + 0.02), Zt(sz + 0.03), 0.13 / s, 0.12 / s, 1)
    for (x, z) in P['bottles']:
        t.shade_ellipse(X(x + 0.02), Zt(z + 0.05), 0.05 / s, 0.06 / s, 1)
    for (x, z, _) in P['pads']:
        t.shade(X(x - 0.08), Zt(z - 0.1), X(x + 0.1), Zt(z + 0.13), 1)
    t.frame(0, 0, w - 1, h - 1, 15)
    t.rect(0, 1, w - 1, 1, 17)
    return t


# ======================================================================================================
# Вид из окна: мы на третьем этаже административного корпуса, внизу берёзы и парковка, дальше цеха ОЭЗ,
# за ними Кама и холмистый дальний берег в осеннем лесу
# ======================================================================================================

def view_far():
    x0, x1, y0, y1, _ = VIEW['far']
    s = 0.05
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, 5)
    X = lambda x: (x - x0) / s  # noqa: E731
    Yv = lambda y: (y1 - y) / s  # noqa: E731
    hz = int(Yv(1.75))  # горизонт: дальний берег
    R.sky(t, hz, blues=(3, 4, 5))
    # дальний берег: холмы в осеннем лесу, мягкие волны
    xs = np.arange(w)
    ridge = hz - 10 - 4 * np.sin(xs / 37.0) - 3 * np.sin(xs / 13.0 + 1.3)
    for x in range(w):
        top = int(ridge[x])
        t.rect(x, top, x, hz + 2, 42)
        t.rect(x, top + 3, x, hz + 2, 41)
    for _ in range(int(w * 0.6)):  # пятна осенней листвы на дальнем берегу
        x = int(rng.integers(0, w))
        y = int(rng.integers(int(ridge[x]) + 3, hz + 2))
        t.px(x, y, (21, 22, 20, 9, 41)[int(rng.integers(0, 5))])
    # Кама: широкая лента с бликами
    k0, k1 = hz + 3, hz + 12
    t.rect(0, k0, w - 1, k1, 3)
    t.rect(0, k0, w - 1, k0, 4)
    for _ in range(140):
        x = int(rng.integers(0, w - 6))
        y = int(rng.integers(k0 + 1, k1))
        t.rect(x, y, x + int(rng.integers(2, 6)), y, 5 if rng.random() < 0.5 else 4)
    t.rect(0, k1 + 1, w - 1, k1 + 1, 42)  # ближний берег, песок
    # ближний берег до промзоны: степь и лесополоса
    g0 = k1 + 2
    t.rect(0, g0, w - 1, h - 1, 10)
    t.noise(0, g0, w - 1, h - 1, 9, 0.15)
    for x in range(0, w, 3):  # лесополоса золотом
        y = g0 + 1 + int(1.5 * np.sin(x / 7))
        t.ellipse(x, y, 2.2, 1.6, (21, 22, 9)[(x // 3) % 3])
    # промзона ОЭЗ: белые корпуса с синими полосами, серые цеха с пилообразной крышей, трубы, кран, резервуары
    base = int(Yv(0.25))
    bands = [
        # x0, x1, высота м, вид
        (-14.6, -12.2, 0.7, 'white'), (-11.6, -9.8, 1.0, 'saw'), (-9.0, -6.8, 0.6, 'white'), (-5.9, -4.9, 1.3, 'tall'),
        (-4.2, -2.0, 0.65, 'white'), (-1.2, 0.4, 0.9, 'saw'), (1.4, 3.6, 0.6, 'white'), (4.5, 6.4, 1.0, 'tall'),
    ]
    for (a, b, hh, kind) in bands:
        A, B = X(a), X(b)
        top = Yv(0.25 + hh)
        if kind == 'saw':
            t.rect(A, top, B, base, 43)
            for x in range(int(A), int(B), 6):
                t.poly([(x, top), (x + 5, top - 4), (x + 6, top)], 44)
                t.rect(x + 5, top - 4, x + 5, top, 41)
            t.rect(A, top + 4, B, top + 5, 41)
        else:
            t.rect(A, top, B, base, 45 if kind == 'white' else 44)
            t.rect(B - 2, top, B, base, 43)
            t.rect(A, top + 3, B - 3, top + 5, 2)  # синяя полоса
            for x in range(int(A) + 3, int(B) - 3, 5):
                t.rect(x, top + 9, x + 2, min(base - 2, top + 10), 41)
            t.rect(A, top, B, top, 43)
    # трубы с белым паром, резервуары, башенный кран
    for (cx, hh) in ((-7.4, 2.2), (-3.2, 1.8)):
        X_ = X(cx)
        t.rect(X_ - 2, Yv(0.25 + hh), X_ + 1, base, 44)
        for k, yy in enumerate(range(int(Yv(0.25 + hh)) - 2, int(Yv(0.25 + hh)) - 26, -4)):
            t.ellipse(X_ + 3 + k * 2.2, yy, 2.5 + k * 0.6, 1.8 + k * 0.3, 45)
        t.rect(X_ - 2, Yv(0.25 + hh) + 4, X_ + 1, Yv(0.25 + hh) + 5, 27)
    for cx in (2.2, 2.9, 3.6):
        t.ellipse(X(cx), base - 7, 6, 3, 44)
        t.rect(X(cx) - 6, base - 7, X(cx) + 6, base, 44)
        t.rect(X(cx) + 3, base - 7, X(cx) + 6, base, 43)
    kx = X(-0.6)
    t.rect(kx, Yv(2.5), kx + 1, base, 22)
    t.rect(kx - 22, Yv(2.5), kx + 9, Yv(2.5) + 1, 22)
    t.line([(kx - 22, Yv(2.5) + 1), (kx, Yv(2.95)), (kx + 9, Yv(2.5) + 1)], 21)
    t.rect(kx - 16, Yv(2.5) + 2, kx - 16, Yv(1.9), 38)
    # передний край промзоны: забор и дорога
    t.rect(0, base, w - 1, h - 1, 41)
    t.rect(0, base, w - 1, base, 42)
    t.noise(0, base + 1, w - 1, h - 1, 40, 0.08)
    for x in range(0, w, 8):
        t.rect(x + 2, base + 3, x + 5, base + 3, 44)
    return t


def view_near():
    """Под окнами: берёзы в золоте вдоль аллеи, внизу парковка с машинами."""
    x0, x1, y0, y1, _ = VIEW['near']
    s = 0.025
    w, h = round((x1 - x0) / s), round((y1 - y0) / s)
    t = Tex(w, h, T)
    X = lambda x: (x - x0) / s  # noqa: E731
    Yv = lambda y: (y1 - y) / s  # noqa: E731
    g = int(Yv(-0.55))
    # газон и парковка внизу (видна только из-за стола, если наклониться к окну)
    t.rect(0, g, w - 1, h - 1, 9)
    t.noise(0, g, w - 1, h - 1, 10, 0.2)
    t.rect(0, g + 8, w - 1, h - 1, 40)
    for x in range(0, w, 18):
        t.rect(x, g + 8, x, h - 1, 44)
    for i, x in enumerate(range(4, w - 14, 22)):
        c = (45, 2, 40, 27, 44, 3, 38)[i % 7]
        t.rect(x, g + 12, x + 12, g + 18, c)
        t.rect(x + 2, g + 10, x + 10, g + 12, R.darker(np.array(c)))
        t.rect(x + 3, g + 10, x + 9, g + 10, 4)
    # берёзы: белые стволы с чёрными штрихами, золотые кроны
    for (bx, top, r) in ((-5.4, 2.9, 0.9), (-3.6, 3.2, 1.0), (-1.6, 2.7, 0.85), (0.6, 3.0, 0.95), (2.0, 2.6, 0.6)):
        cx = X(bx)
        t.rect(cx - 2, Yv(top - 0.3), cx + 1, g + 2, 45)
        t.rect(cx + 1, Yv(top - 0.3), cx + 1, g + 2, 43)
        for y in range(int(Yv(top - 0.3)), g, 5):
            a = int(rng.integers(-2, 1))
            t.rect(cx + a, y, cx + a + 1, y, 37)
        m = ellipse_mask(t, cx, Yv(top), r / s, r * 0.75 / s)
        m &= rng.random(t.a.shape) < 0.75
        t.mask(m, 22)
        t.mask(m & (rng.random(t.a.shape) < 0.3), 23)
        t.mask(m & (rng.random(t.a.shape) < 0.25), 21)
        t.mask(m & (rng.random(t.a.shape) < 0.06), 9)
    return t


# ======================================================================================================

def main():
    at = items(Atlas(384, 220))
    P = dict(PLACE)
    surfaces = {f'wall_{k}': v for k, v in walls(P).items()}
    surfaces['floor'] = floor_tex(P)
    surfaces['ceiling'] = ceiling_tex(P)
    surfaces['table'] = table_tex(P)
    surfaces['view_far'] = view_far()
    surfaces['view_near'] = view_near()
    write_all('meet', at, surfaces, dict(PLACE, view=VIEW), 'tools/art/room_meet.py')


if __name__ == '__main__':
    main()
