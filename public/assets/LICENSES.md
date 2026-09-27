# Лицензии графики и шрифтов

## Шрифты (`fonts/`)

| Файл | Шрифт | Автор | Лицензия |
|---|---|---|---|
| `ark-pixel-12-prop.woff2` | Ark Pixel Font, 12px proportional (latin) | TakWolf, github.com/TakWolf/ark-pixel-font | SIL OFL 1.1, без зарезервированного имени (`OFL-ark-pixel.txt`). Файл урезан до латиницы, кириллицы и знаков препинания через pyftsubset. |
| `PixeloidSans.ttf`, `PixeloidSans-Bold.ttf` | Pixeloid Sans | GGBotNet, ggbot.itch.io/pixeloid-font | SIL OFL 1.1, зарезервированное имя «Pixeloid» (`OFL-pixeloid.txt`). Лежит без изменений, поэтому не урезан. |

## Палитра

Apollo, 46 цветов. Автор AdamCYounis, lospec.com/palette-list/apollo. Формальной лицензии на странице нет. Палитра — это набор hex-значений, авторство указываем.

## Портреты, сцены, рамки, иконки (`portraits/`, `scenes/`, `ui/`)

Нарисованы командой программно, по пиксельной сетке, без нейросетей и чужих ассетов. Исходники лежат в `tools/art/` (`portraits.py`, `scenes.py`, `frames.py`), иконки в `src/game/ui/PixelIcon.tsx`. Лицензия та же, что у кода проекта.
