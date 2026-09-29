"""Сборка звука игры: музыка и эмбиент — в бесшовные петли, щелчки и шаги — в короткие mp3.

Исходники (все CC0, ссылки — в public/assets/LICENSES.md) скачать в папку SRC:
  Kenney: rpg-audio, interface-sounds, impact-sounds (распаковать как есть);
  OpenGameArt: chill_chiptunes.zip (HoliznaCC0), ChillLofi.ogg, lofihiphop.ogg (omfgdude);
  freesound: hq-превью под именем <id>.mp3 в SRC/fs.
Запуск: python tools/audio/build.py SRC  (нужны numpy и ffmpeg в PATH или FFMPEG=...).

Петля: берём кусок [a, a+L), последние XF секунд смешиваем с тем, что звучало перед a, — сигнал становится
периодическим с периодом L. По краям — по G секунд того же цикла: mp3-декодер добавляет тишину в начало,
а плеер играет [G, G+L) — со сдвигом на задержку декодера это всё тот же цикл, без щелчка.
"""

import json, os, subprocess, sys
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
FF = os.environ.get('FFMPEG', 'ffmpeg')
OUT = os.path.join(os.path.dirname(__file__), '../../public/assets/audio')
SR = 44100
G = 0.25  # запас по краям петли, секунды


def load(p, sr=SR):
    raw = subprocess.run([FF, '-v', 'quiet', '-i', p, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def save(x, name, kbps):
    x = np.clip(x, -1, 1).astype(np.float32)
    subprocess.run([FF, '-v', 'quiet', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', os.path.join(OUT, name)],
                   input=x.tobytes(), check=True)


def norm(x, db):
    """Громкость по RMS: музыка тише речи, эмбиент ещё тише."""
    return x * (10 ** (db / 20) / (np.sqrt((x ** 2).mean()) + 1e-9))


def feats(x, hop=1024):
    n = 4096
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    S = np.log1p(np.abs(np.fft.rfft(fr))[:, :400])
    return S / (np.linalg.norm(S, axis=1, keepdims=True) + 1e-9), hop


def best_loop(x, lo, hi, a0, a1):
    """Ищем начало a и длину L, при которых звук около a+L больше всего похож на звук около a."""
    F, hop = feats(x)
    w = int(3 * SR / hop)
    best = (-1, 0, 0)
    for a in range(int(a0 * SR / hop), int(a1 * SR / hop), int(0.5 * SR / hop)):
        A = F[a - w:a + w]
        for L in range(int(lo * SR / hop), int(hi * SR / hop)):
            if a + L + w >= len(F):
                break
            s = (A * F[a + L - w:a + L + w]).sum()
            if s > best[0]:
                best = (s, a * hop, L * hop)
    _, a, L = best
    # точная подгонка по форме волны: ±30 мс
    ref = x[a:a + 2048]
    r = int(0.03 * SR)
    c = [np.dot(ref, x[a + L + d:a + L + d + 2048]) for d in range(-r, r)]
    return a, L + int(np.argmax(c)) - r


def loop(x, a, L, xf):
    seg = x[a:a + L].copy()
    n = int(xf * SR)
    t = np.linspace(0, np.pi / 2, n)
    seg[-n:] = seg[-n:] * np.cos(t) + x[a - n:a] * np.sin(t)
    g = int(G * SR)
    return np.concatenate([seg[-g:], seg, seg[:g]]), L / SR


def fade(x, ms_in=3, ms_out=15):
    x = x.copy()
    a, b = int(ms_in * SR / 1000), min(len(x) // 3, int(ms_out * SR / 1000))
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b)
    return x


def trim(x, rel=0.01):
    nz = np.where(np.abs(x) > rel * np.abs(x).max())[0]
    return x[max(0, nz[0] - 64):nz[-1] + 256] if len(nz) else x


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    k = lambda *p: os.path.join(SRC, *p)
    hol = k('chill', 'Chill Chiptunes')

    # музыка: (файл, имя, длина петли от–до, где искать начало, дБ)
    for src, name, lo, hi, a0, a1, db in [
        (k('ChillLofi.ogg'), 'menu', 55, 70, 8, 30, -21),
        (k('lofihiphop.ogg'), 'map', 55, 70, 8, 30, -21),
        (os.path.join(hol, '04 HoliznaCC0 - Scroller.ogg'), 'cutscene', 45, 60, 6, 25, -22),
    ]:
        x = load(src)
        a, L = best_loop(x, lo, hi, a0, a1)
        y, per = loop(norm(x, db), a, L, 0.5)
        save(y, f'music-{name}.mp3', 64)
        meta[f'music-{name}'] = round(per, 5)
        print(name, 'loop', a / SR, per)

    # эмбиент мест и автобус: (файлы с долями, имя, начало, длина, дБ)
    fs = lambda i: k('fs', f'{i}.mp3')
    for srcs, name, a, L, db in [
        ([(fs(203306), 1.0), (fs(167155), 0.35)], 'office', 12, 24, -34),
        ([(fs(393398), 1.0)], 'factory', 20, 24, -32),
        ([(fs(237331), 1.0)], 'shop', 15, 24, -33),
        ([(fs(36734), 1.0)], 'street', 30, 24, -32),
        ([(fs(397889), 1.0)], 'dorm', 60, 24, -36),
        ([(fs(264409), 1.0)], 'bus', 15, 20, -28),
    ]:
        parts = [norm(load(p), 0) * w for p, w in srcs]
        n = min(len(p) for p in parts)
        x = sum(p[:n] for p in parts)
        y, per = loop(norm(x, db), int(a * SR), int(L * SR), 2.0)
        save(y, f'amb-{name}.mp3', 48)
        meta[f'amb-{name}'] = round(per, 5)
        print(name, per)

    # короткие звуки: имя → (файл, дБ пика)
    rpg, ui, imp = k('rpg-audio', 'Audio'), k('interface-sounds', 'Audio'), k('impact-sounds', 'Audio')
    sfx = {
        'click': (os.path.join(ui, 'click_001.ogg'), -10),
        'page1': (os.path.join(rpg, 'bookFlip1.ogg'), -6),
        'page2': (os.path.join(rpg, 'bookFlip2.ogg'), -6),
        'paper': (os.path.join(rpg, 'bookPlace1.ogg'), -6),
        'stamp': (os.path.join(imp, 'impactPunch_heavy_001.ogg'), -3),
    }
    for i in range(5):
        sfx[f'step{i}'] = (os.path.join(imp, f'footstep_concrete_00{i}.ogg'), -10)
    for name, (p, db) in sfx.items():
        x = fade(trim(load(p)))
        x = x * (10 ** (db / 20) / (np.abs(x).max() + 1e-9))
        save(x, f'sfx-{name}.mp3', 64)
    gen = os.path.join(os.path.dirname(__file__), '../../src/game/audio/loops.gen.ts')
    with open(gen, 'w') as f:
        f.write('// Сгенерировано tools/audio/build.py: период петли в секундах (в файле он начинается с GUARD).\n')
        f.write(f'export const GUARD = {G}\nexport const LOOPS: Record<string, number> = {json.dumps(meta)}\n')


if __name__ == '__main__':
    main()
