// Живой звук для Firefox (и Zen на нём). mp3 в MediaSource Firefox не умеет, поэтому играет поток по ссылке, а его кэш
// отдаёт декодеру данные только целыми блоками по 32 КБ (проверено 19.10 на Zen 158): заход в ~15 КБ молчал, пока не
// приходило продолжение (+2–4 с), а последние ~0,7 с каждого куска ждали следующего — голос рвался посреди слова.
// Пока синтез молчит, дописываем нули до границы блока — между кадрами, не внутри: декодер пропускает их как мусор.

export const BLOCK = 32768

/** Длина звена потока с начала buf: тег ID3, кадр mp3 или 1 байт мусора; null — звено ещё не пришло целиком. */
function unit(b: Uint8Array, at: number): number | null {
  const n = b.length - at
  if (b[at] === 0x49 && (n < 3 || (b[at + 1] === 0x44 && b[at + 2] === 0x33))) {
    if (n < 10) return null
    const size = ((b[at + 6] & 0x7f) << 21) | ((b[at + 7] & 0x7f) << 14) | ((b[at + 8] & 0x7f) << 7) | (b[at + 9] & 0x7f)
    return 10 + size + (b[at + 5] & 0x10 ? 10 : 0)
  }
  if (b[at] !== 0xff) return 1
  if (n < 4) return null
  const ver = (b[at + 1] >> 3) & 3, layer = (b[at + 1] >> 1) & 3, bri = b[at + 2] >> 4, sri = (b[at + 2] >> 2) & 3
  if ((b[at + 1] & 0xe0) !== 0xe0 || ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return 1
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }
  const br = (ver === 3 ? BR1 : BR2)[bri] * 1000
  return Math.floor(((ver === 3 ? 144 : 72) * br) / SR[ver][sri]) + ((b[at + 2] >> 1) & 1)
}

/**
 * Поток mp3 → тот же поток, но пока источник молчит дольше idleMs, отданное дополняется нулями до границы BLOCK.
 * Кадры не режутся: недошедший кадр ждёт своего конца.
 */
export async function* padToBlocks(src: AsyncIterator<Uint8Array>, idleMs = 80): AsyncGenerator<Uint8Array> {
  let held: Uint8Array = new Uint8Array(0)
  let sent = 0
  // Читаем наперёд, но ошибку источника держим обработанной, пока потребитель занят предыдущим куском.
  const read = () => {
    const p = src.next()
    void p.catch(() => {})
    return p
  }
  let next = read()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    for (;;) {
      const idle = new Promise<'idle'>((r) => (timer = setTimeout(() => r('idle'), idleMs)))
      const got = await Promise.race([next, idle])
      clearTimeout(timer)
      if (got === 'idle') {
        if (!held.length && sent % BLOCK) {
          const zeros = new Uint8Array(BLOCK - (sent % BLOCK))
          sent += zeros.length
          yield zeros
        }
        // до новых данных больше не дописываем: блок уже целый
        const r = await next
        if (r.done) break
        next = read()
        ;({ held, sent } = yield* emit(r.value))
        continue
      }
      if (got.done) break
      next = read()
      ;({ held, sent } = yield* emit(got.value))
    }
    if (held.length) yield held
  } finally {
    clearTimeout(timer)
    // Остановка HTTP-чтения закрывает и исходного подписчика на живой звук.
    await src.return?.()
  }

  function* emit(chunk: Uint8Array): Generator<Uint8Array, { held: Uint8Array; sent: number }> {
    const b = new Uint8Array(held.length + chunk.length)
    b.set(held)
    b.set(chunk, held.length)
    let at = 0
    for (;;) {
      const len = unit(b, at)
      if (len === null || at + len > b.length) break
      at += len
    }
    if (at) yield b.subarray(0, at)
    return { held: b.slice(at), sent: sent + at }
  }
}
