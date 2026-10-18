/** Safari отвечает колбэком, Chrome ещё и промисом: обрабатываем оба пути. */
export function decodeAudio(ctx: Pick<BaseAudioContext, 'decodeAudioData'>, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    if (!data.byteLength) return reject(new Error('Пустой звук'))
    const pending = ctx.decodeAudioData(data, resolve, reject)
    pending?.then(resolve, reject)
  })
}
