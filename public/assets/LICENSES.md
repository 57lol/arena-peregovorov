# Лицензии графики, шрифтов и звука

## Шрифты (`fonts/`)

| Файл | Шрифт | Автор | Лицензия |
|---|---|---|---|
| `ark-pixel-12-prop.woff2` | Ark Pixel Font, 12px proportional (latin) | TakWolf, github.com/TakWolf/ark-pixel-font | SIL OFL 1.1, без зарезервированного имени (`OFL-ark-pixel.txt`). Файл урезан до латиницы, кириллицы и знаков препинания через pyftsubset. |
| `PixeloidSans.ttf`, `PixeloidSans-Bold.ttf` | Pixeloid Sans | GGBotNet, ggbot.itch.io/pixeloid-font | SIL OFL 1.1, зарезервированное имя «Pixeloid» (`OFL-pixeloid.txt`). Лежит без изменений, поэтому не урезан. |

## Палитра

Apollo, 46 цветов. Автор AdamCYounis, lospec.com/palette-list/apollo. Формальной лицензии на странице нет. Палитра — это набор hex-значений, авторство указываем.

## Портреты, сцены, рамки, иконки (`portraits/`, `scenes/`, `ui/`)

Нарисованы командой программно, по пиксельной сетке, без нейросетей и чужих ассетов. Исходники лежат в `tools/art/` (`portraits.py`, `people.py`, `pixel.py`, `scenes.py`, `frames.py`), иконки в `src/game/ui/PixelIcon.tsx`. Лицензия та же, что у кода проекта.

## Звук (`audio/`)

Всё CC0 (общественное достояние): атрибуция не требуется, указываем из вежливости. Лицензию проверяли на странице каждого файла 29.09.2026. Файлы нарезаны, склеены в бесшовные петли и пережаты скриптом `tools/audio/build.py`.

| Файл | Исходник | Автор | Лицензия |
|---|---|---|---|
| `music-menu.mp3` (титул) | «Chill lofi inspired», opengameart.org/content/chill-lofi-inspired | omfgdude | CC0 |
| `music-map.mp3` (карта, папка дел, разбор) | «lofi hip hop», opengameart.org/content/lofi-hip-hop | omfgdude | CC0 |
| `music-cutscene.mp3` | «Scroller» из «Chill Chiptunes (Collection)», opengameart.org/content/chill-chiptunes-collection | HoliznaCC0 | CC0 |
| `amb-office.mp3` | «Room Tone Office 13», freesound.org/s/203306 + «Typing», freesound.org/s/167155 | mzui, DSPena | CC0 |
| `amb-factory.mp3` | «Industrial ambience», freesound.org/s/393398 | Lewente | CC0 |
| `amb-shop.mp3` | «Supermarket», freesound.org/s/237331 | Soundkrampf | CC0 |
| `amb-street.mp3` | «citystreet3.wav», freesound.org/s/36734 | moxobna | CC0 |
| `amb-dorm.mp3` | «Interior City Apartment», freesound.org/s/397889 | MJSoundDesign | CC0 |
| `amb-bus.mp3` | «bus_interior_highway.WAV», freesound.org/s/264409 | ivolipa | CC0 |
| `sfx-click.mp3` | Interface Sounds (`click_001`), kenney.nl/assets/interface-sounds | Kenney | CC0 |
| `sfx-page1.mp3`, `sfx-page2.mp3`, `sfx-paper.mp3` | RPG Audio (`bookFlip1`, `bookFlip2`, `bookPlace1`), kenney.nl/assets/rpg-audio | Kenney | CC0 |
| `sfx-stamp.mp3`, `sfx-step0..4.mp3` | Impact Sounds (`impactPunch_heavy_001`, `footstep_concrete_000..004`), kenney.nl/assets/impact-sounds | Kenney | CC0 |

Голос собеседника синтезирует Yandex SpeechKit на лету, в репозитории его нет.
