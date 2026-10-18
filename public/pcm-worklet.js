// Тяжёлую конвертацию делаем вне аудиопотока.
// Нет каналов на входе (Firefox так отдаёт поток, который замолчал) — шлём тишину: без кадров пауза в речи
// не наступает, и голосовой ход ждал бы вечно.
class SttPcm extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    const n = channels?.length ? channels[0].length : 128;
    if (!n) return true;
    const mono = new Float32Array(n);
    if (channels?.length) for (const channel of channels) for (let i = 0; i < n; i++) mono[i] += channel[i] / channels.length;
    this.port.postMessage(mono, [mono.buffer]);
    return true;
  }
}
registerProcessor('stt-pcm', SttPcm);
