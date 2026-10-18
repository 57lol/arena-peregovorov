import { CHINA_FILLERS } from './fillers'
import { REACTION_RECORDINGS } from './reactions'
import { china } from './scenarios/china'

/** План записи, не реестр готовых аудиофайлов. */
export const CHINA_RECORDINGS = [
  ...REACTION_RECORDINGS.filter((r) => r.face === 'china').map((r) => ({ id: r.id, text: r.text, file: r.path.slice(1) })),
  ...Object.entries(CHINA_FILLERS).map(([id, text]) => ({ id: `filler-${id}`, text, file: `assets/voice-fillers/eleven/china/${id}.mp3` })),
  { id: 'opening-china', text: china.opening, file: 'assets/voice-eleven/china/opening-china.mp3' },
]
