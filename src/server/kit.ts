// Комплектация одной настройкой. KIT=base — базовая, полностью российский контур: разметка и реплики на YandexGPT 5.1 Pro,
// голос и распознавание на Yandex SpeechKit. Claude (AITunnel), ElevenLabs и Scribe выключаются, даже если ключи заданы.
// Без KIT — основная комплектация: Claude через AITunnel, Яндекс — запасной.

export function applyKit(env: NodeJS.ProcessEnv = process.env): void {
  if (env.KIT !== 'base') return
  for (const k of ['AITUNNEL_API_KEY', 'ELEVEN_RELAY_URL', 'ELEVEN_RELAY_SECRET', 'ELEVENLABS_API_KEY', 'TTS_PROVIDER']) delete env[k]
  Object.assign(env, { LLM_PROVIDER: 'yandex', ANALYZE_LLM: 'main', ANALYZE_LLM_EN: 'main', VOICE_LLM: 'main', STT_STREAM: 'off' })
}
