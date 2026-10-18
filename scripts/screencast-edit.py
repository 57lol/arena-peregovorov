"""Монтаж скринкаста v2 из записи scripts/screencast-rec.ts: режет части по плану, ставит подписи, кладёт голоса
ровно туда, где они звучали в записи (голос игрока — те же mp3, что ушли в поддельный микрофон), выравнивает громкость
голосов, подкладывает тихую музыку игры. Ничего не подделывает: только режет и склеивает.

Запуск: python3 scripts/screencast-edit.py [--raw ~/Arena-materials/final/screencast-v2/raw] [--out …/screencast.mp4] [--dry]
"""
import argparse, json, os, re, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HOME = os.path.expanduser('~')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--raw', default=f'{HOME}/Arena-materials/final/screencast-v2/raw')
ap.add_argument('--out', default=f'{HOME}/Arena-materials/final/screencast-v2/screencast.mp4')
ap.add_argument('--dry', action='store_true')
a = ap.parse_args()
FONT = f'{REPO}/public/assets/fonts/PixeloidSans-Bold.ttf'
FONT_R = f'{REPO}/public/assets/fonts/PixeloidSans.ttf'
MUSIC = f'{REPO}/public/assets/audio/music-menu.mp3'
W, H, FPS = 1920, 1080, 30
VOICE_LUFS, MUSIC_QUIET, MUSIC_UP = -16.5, -35.0, -26.0  # музыка всегда тише голоса

# ---------- план: часть, от, до (секунды от первого кадра части), подпись, скорость, крупно, музыка громче ----------
Z_FACE = (960, 540, 480, 160)  # кроп w,h,x,y: лицо и губы собеседника
PLAN = [
    dict(p='hub', a=0.4, b=5.6, cap='«Переговорка» — тренажёр деловых переговоров голосом', up=True),
    dict(p='hub', a=5.6, b=16.6, sp=1.5, cap='Хаб жюри: настроить → провести → разбор → команда', up=True),
    dict(p='hub', a=17.0, b=21.4, cap='Дело «Тара к запуску»: закупка коробок для новой линии', up=True),
    dict(p='tara-weak', a=1.6, b=5.0, cap='3D-переговорка: Марат здоровается живым голосом'),
    dict(p='tara-weak', a=5.0, b=9.45, cap='Губы двигаются под речь', zoom=Z_FACE),
    dict(p='tara-weak', a=24.5, b=32.2, cap='Игрок отвечает голосом. Слабый ход — ультиматум'),
    dict(p='tara-weak', a=32.2, b=36.6, cap='Реакция — за полсекунды, следом живой ответ'),
    dict(p='tara-weak', a=36.6, b=43.6, cap='«Мимо»: на ультиматум Марат встаёт и уходит'),
    dict(p='tara-weak', a=46.3, b=50.7, cap='Переиграть с этого хода — без перезапуска'),
    dict(p='tara', a=24.7, b=32.9, cap='Сильный ход: сначала спросить, что ему важно'),
    dict(p='tara', a=32.9, b=39.4, cap='«В точку»: доверие растёт, Марат открывается'),
    dict(p='tara', a=124.9, b=136.4, cap='Размен: оплата по факту в обмен на поставку за 48 часов'),
    dict(p='tara', a=136.4, b=146.8, cap='По рукам: выгода 60 из 100, без сделки было бы 26'),
    dict(p='tara', a=160.2, b=165.6, cap='Разбор: итог, что получилось, что дальше'),
    dict(p='tara', a=166.4, b=175.6, cap='Подробный разбор: доверие, напряжение, ценность по ходам'),
    dict(p='tara-weak', a=191.0, b=197.0, cap='Профиль 22 приёмов против сильных переговорщиков'),
    dict(p='cabinet', a=0.8, b=12.4, sp=1.6, cap='Кабинет руководителя: одно дело всей команде по ссылке', up=True),
    dict(p='board', a=0.4, b=9.6, cap='Живая доска: итоги, финалы и типичные ошибки команды', up=True),
    dict(p='setup', a=1.6, b=15.6, sp=2.5, cap='«Своё дело»: руководитель заполняет бриф', up=True),
    dict(p='setup', a=15.6, b=26.4, sp=1.6, cap='Нейросеть пишет историю, движок считает выгоду сторон', up=True),
    dict(p='setup', a=26.4, b=31.4, cap='Готово за 10 секунд — новое дело можно играть', up=True),
    dict(p='english', a=0.7, b=3.4, cap='Дело на английском: поставщик из Стамбула', up=True),
    dict(p='english', a=29.1, b=35.2, cap='Говорим по-английски, разбор и подсказки — по-русски'),
    dict(p='english', a=36.1, b=43.2, cap='Emre отвечает живым голосом'),
    dict(p='china', a=0.7, b=3.4, cap='Поставщик из Шэньчжэня: торг в юанях и лишнее в комплекте', up=True),
    dict(p='china', a=30.3, b=39.0, cap='Отказываемся от лишнего и торгуемся'),
    dict(p='china', a=39.8, b=46.4, cap='Ли Вэй держит свою линию'),
    dict(p='phone', a=1.6, b=4.6, phone=True, cap='С телефона — то же самое', up=True),
    dict(p='phone', a=4.8, b=7.6, phone=True, cap='С телефона — то же самое', up=True),
    dict(p='phone', a=7.9, b=13.9, phone=True, cap='Переговорка в вертикальном экране'),
    dict(card=True, d=6.0, up=True),
]


def run(cmd, **kw):
    return subprocess.run(['nice', '-n', '15', *cmd], check=True, **kw)


def font(size, bold=True):
    return ImageFont.truetype(FONT if bold else FONT_R, size)


def caption_png(text, path):
    """Подпись: тёмная плашка снизу по центру, крупный пиксельный шрифт."""
    f = font(36)
    l, t, r, b = f.getbbox(text)
    tw, th = r - l, b - t
    pw, ph = tw + 64, th + 34
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0 = (W - pw) // 2, H - ph - 34
    d.rounded_rectangle((x0, y0, x0 + pw, y0 + ph), radius=10, fill=(14, 16, 28, 228), outline=(234, 170, 64, 255), width=3)
    d.text((x0 + 32 - l, y0 + 17 - t), text, font=f, fill=(255, 246, 228, 255))
    im.save(path)


def final_card(bg_frame, path):
    """Финальная карточка: кадр титула притушен, название и адрес сайта (без ключа)."""
    bg = Image.open(bg_frame).convert('RGB').resize((W, H)).filter(ImageFilter.GaussianBlur(6))
    dark = Image.new('RGB', (W, H), (12, 12, 26))
    im = Image.blend(bg, dark, 0.72)
    d = ImageDraw.Draw(im)

    def center(y, text, f, fill):
        l, t, r, b = f.getbbox(text)
        d.text(((W - (r - l)) // 2 - l, y - t), text, font=f, fill=fill)

    center(250, 'Переговорка', font(126), (240, 190, 90))
    center(420, 'Тренажёр деловых переговоров голосом', font(45, False), (245, 238, 225))
    center(486, 'закупки · продажи · найм · своё дело · English · Китай', font(36, False), (200, 196, 210))
    center(640, 'arena-peregovorov.ru', font(90), (255, 255, 255))
    center(790, 'В браузере и на телефоне, без установки', font(36, False), (200, 196, 210))
    center(930, 'Команда «Би 2 Би» · ЛЦТ 2026 · кейс ОЭЗ «Алабуга»', font(32, False), (170, 166, 186))
    im.save(path)


def lufs(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = re.findall(r'^\s+I:\s+(-?[\d.]+) LUFS', out, re.M)
    v = float(m[-1]) if m else -20.0
    return v if v > -70 else -20.0


# ---------- звук частей: отрезки [начало, конец] в секундах части + смещение в файле ----------
def part_info(p):
    d = json.load(open(f'{a.raw}/{p}/marks.json'))
    t0 = d.get('video_t0', d['frames'][0]['t'])
    pieces = []
    ap_ = f'{a.raw}/{p}/audio.json'
    if os.path.exists(ap_):
        au = json.load(open(ap_))
        ev = au['ev']
        for i, e in enumerate(ev):
            if e['type'] != 'play' or e['src'] not in au['files']:
                continue
            nxt = next((x for x in ev[i + 1:] if x['src'] == e['src']), None)
            dur = (nxt['ct'] - e['ct']) if nxt and nxt['ct'] > e['ct'] else ((nxt['t'] - e['t']) / 1000 if nxt else 30)
            if dur <= 0.05:
                continue
            pieces.append(dict(file=f"{a.raw}/{p}/audio/{au['files'][e['src']]}", s=(e['t'] - t0) / 1000, d=dur, off=e['ct']))
    for s in d.get('says', []):
        pieces.append(dict(file=s['file'], s=(s['t'] - t0) / 1000, d=s['dur'], off=0.0))
    return pieces


tmp = tempfile.mkdtemp(prefix='sc-edit-', dir=os.path.dirname(a.out))
try:
    info = {}
    clips, pieces, music_env = [], [], []
    O = 0.0
    for k, c in enumerate(PLAN):
        if c.get('card'):
            dur = c['d']
        else:
            sp = c.get('sp', 1.0)
            dur = (c['b'] - c['a']) / sp
            if c['p'] not in info:
                info[c['p']] = part_info(c['p'])
            if sp == 1.0:
                for pc in info[c['p']]:
                    lo, hi = max(pc['s'], c['a']), min(pc['s'] + pc['d'], c['b'])
                    if hi - lo > 0.08:
                        pieces.append((pc['file'], pc['off'] + lo - pc['s'], hi - lo, O + lo - c['a'], lo > pc['s'] + 0.05, hi < pc['s'] + pc['d'] - 0.05))
        clips.append((k, c, O, dur))
        music_env.append((O, O + dur, MUSIC_UP if c.get('up') else MUSIC_QUIET))
        O += dur
    total = O
    for k, c, o, dur in clips:
        print(f"{o:6.1f}–{o + dur:6.1f}  {c.get('p', 'карточка'):10s} {c.get('cap', '')}")
    print(f'итого {total:.1f} с, кусков звука {len(pieces)}')
    if a.dry:
        raise SystemExit

    # ---------- видео по кускам (сразу сжатое) ----------
    parts = []
    for k, c, o, dur in clips:
        out = f'{tmp}/v{k:02d}.mp4'
        n = round(dur * FPS)
        if c.get('card'):
            bg = f'{tmp}/bg.png'
            run(['ffmpeg', '-v', 'error', '-y', '-ss', '3', '-i', f'{a.raw}/hub/video.mp4', '-frames:v', '1', bg])
            final_card(bg, f'{tmp}/card.png')
            run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-i', f'{tmp}/card.png', '-frames:v', str(n),
                 '-vf', 'fade=t=in:st=0:d=0.6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', out])
            parts.append(out)
            continue
        cap = f'{tmp}/c{k:02d}.png'
        caption_png(c['cap'], cap)
        sp = c.get('sp', 1.0)
        src = f"{a.raw}/{c['p']}/video.mp4"
        if c.get('phone'):
            # вертикальный экран телефона в рамке по центру, фон — размытый кадр игры
            ph_h = 940
            ph_w = round(390 * ph_h / 844 / 2) * 2
            fc = (f"[0:v]setpts=(PTS-STARTPTS)/{sp},fps={FPS},tpad=stop_mode=clone:stop_duration=30,scale={ph_w}:{ph_h}:flags=lanczos,pad={ph_w + 28}:{ph_h + 28}:14:14:color=0x15141c[ph];"
                  f"[2:v]scale={W}:{H},boxblur=18:2,eq=brightness=-0.25[bg];[bg][ph]overlay=(W-w)/2:(H-h)/2-30[m];[m][1:v]overlay=0:0")
            inputs = ['-ss', f"{c['a']:.3f}", '-t', f"{c['b'] - c['a'] + 1:.3f}", '-i', src, '-i', cap, '-ss', '3', '-i', f'{a.raw}/hub/video.mp4']
        else:
            z = c.get('zoom')
            zf = f',crop={z[0]}:{z[1]}:{z[2]}:{z[3]},scale={W}:{H}:flags=neighbor' if z else f',scale={W}:{H}:flags=lanczos'
            fc = f'[0:v]setpts=(PTS-STARTPTS)/{sp},fps={FPS},tpad=stop_mode=clone:stop_duration=30{zf},format=yuv420p[v];[v][1:v]overlay=0:0'
            inputs = ['-ss', f"{c['a']:.3f}", '-t', f"{c['b'] - c['a'] + 1:.3f}", '-i', src, '-i', cap]
        run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', fc, '-frames:v', str(n), '-an',
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', str(FPS), out])
        parts.append(out)
        print('кусок', k, 'готов')
    with open(f'{tmp}/list.txt', 'w') as f:
        f.write(''.join(f"file '{p}'\n" for p in parts))
    video = f'{tmp}/video.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{tmp}/list.txt', '-c', 'copy', video])

    # ---------- звук: голоса выровнены по громкости, музыка игры тихо снизу ----------
    gains = {}
    for fpath, *_ in pieces:
        if fpath not in gains:
            gains[fpath] = VOICE_LUFS - lufs(fpath)
    args, flt = [], []
    for i, (fpath, off, dur, at, cut_in, cut_out) in enumerate(pieces):
        args += ['-ss', f'{off:.3f}', '-t', f'{dur:.3f}', '-i', fpath]
        fin = 0.06 if cut_in else 0.01
        fout = 0.25 if cut_out else 0.03
        flt.append(f'[{i}:a]aresample=48000,aformat=channel_layouts=stereo,volume={gains[fpath]:.2f}dB,'
                   f'afade=t=in:d={fin},afade=t=out:st={max(0, dur - fout):.3f}:d={fout},adelay={int(at * 1000)}:all=1[a{i}]')
    m = len(pieces)
    mus_gain = lufs(MUSIC)
    env = '+'.join(f'between(t,{s:.2f},{e:.2f})*{10 ** ((lvl - mus_gain) / 20):.4f}' for s, e, lvl in music_env)
    args += ['-stream_loop', '-1', '-i', MUSIC]
    flt.append(f'[{m}:a]atrim=0:{total:.3f},aresample=48000,aformat=channel_layouts=stereo,volume=\'{env}\':eval=frame,'
               f'afade=t=in:d=1.5,afade=t=out:st={total - 2.5:.3f}:d=2.5[mus]')
    mix = ''.join(f'[a{i}]' for i in range(m)) + f'[mus]amix=inputs={m + 1}:normalize=0:dropout_transition=0,alimiter=limit=0.8:level=0,apad[aout]'
    audio = f'{tmp}/audio.m4a'
    run(['ffmpeg', '-v', 'error', '-y', *args, '-filter_complex', ';'.join(flt) + ';' + mix, '-map', '[aout]', '-t', f'{total:.3f}',
         '-c:a', 'aac', '-b:a', '192k', audio])

    # ---------- итог: H.264, разумный битрейт ----------
    run(['ffmpeg', '-v', 'error', '-y', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium',
         '-crf', '21', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-c:a', 'copy', '-shortest', '-movflags', '+faststart', a.out])
    poster = os.path.join(os.path.dirname(a.out), 'poster.png')
    run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{clips[9][2] + 6:.2f}', '-i', a.out, '-frames:v', '1', poster])
    print('готово:', a.out, os.path.getsize(a.out) // 2 ** 20, 'МБ;', 'постер', poster)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
