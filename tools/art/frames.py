"""Рамки для 9-slice (border-image) в палитре Apollo. Каждая — 12x12, срез 4px.
Запуск: ~/Arena-materials/.venv/bin/python tools/art/frames.py
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from apollo import RGB  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

FRAMES = {
    # диалоговое окно: тёмно-синее поле, латунный кант, заклёпки
    'dialog': (['..kkkkkkkk..',
                '.kBBBBBBBBk.',
                'kBrbbbbbbrBk',
                'kBbnnnnnnbBk',
                'kBbnnnnnnbBk',
                'kBbnnnnnnbBk',
                'kBbnnnnnnbBk',
                'kBbnnnnnnbBk',
                'kBbnnnnnnbBk',
                'kBrbbbbbbrBk',
                '.kBBBBBBBBk.',
                '..kkkkkkkk..'],
               {'k': 37, 'B': 21, 'b': 19, 'r': 23, 'n': 0}),
    # табличка с именем: латунь
    'plate': (['..kkkkkkkk..',
               '.kYYYYYYYYk.',
               'kYyyyyyyyyDk',
               'kYyyyyyyyyDk',
               'kYyyyyyyyyDk',
               'kYyyyyyyyyDk',
               'kYyyyyyyyyDk',
               'kYyyyyyyyyDk',
               'kYyyyyyyyyDk',
               'kYyyyyyyyyDk',
               '.kDDDDDDDDk.',
               '..kkkkkkkk..'],
              {'k': 18, 'Y': 23, 'y': 22, 'D': 21}),
    # бумажный лист (поле ввода, «оффер на столе»)
    'paper': (['.kkkkkkkkkk.',
               'kwwwwwwwwwwk',
               'kwwwwwwwwwwk',
               'kwwwwwwwwwwk',
               'kwwwwwwwwwwk',
               'kwwwwwwwwwwk',
               'kwwwwwwwwwwk',
               'kwwwwwwwwwwk',
               'kwwwwwwwwwwk',
               'kgwwwwwwwwgk',
               'kggggggggggk',
               '.kkkkkkkkkk.'],
              {'k': 38, 'w': 45, 'g': 44}),
    # пружина блокнота: тайл, повторяется по горизонтали
    'ring': (['....kkk.....',
              '...kMMmk....',
              '...kMmmk....',
              '...kMmmk....',
              '...kMmmk....',
              '...kMmmk....',
              '...kMmmk....',
              '...kmmmk....',
              '...hkkkh....',
              '....hhh.....',
              '............',
              '............'],
             {'k': 38, 'M': 44, 'm': 42, 'h': 44}),
}


def main():
    out = os.path.join(ROOT, 'public', 'assets', 'ui')
    os.makedirs(out, exist_ok=True)
    for name, (rows, legend) in FRAMES.items():
        im = Image.new('RGBA', (12, 12), (0, 0, 0, 0))
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != '.':
                    im.putpixel((x, y), RGB[legend[ch]] + (255,))
        im.save(os.path.join(out, f'frame-{name}.png'))
        print('ok', name)


if __name__ == '__main__':
    main()
