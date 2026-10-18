import { LAGOS_FILLERS } from './fillers'
import { REACTION_RECORDINGS } from './reactions'
import { lagos } from './scenarios/lagos'

/** План записи: файлов пока нет. После подбора CAST.lagos записать и проверить на слух все 21 клип. */
export const LAGOS_RECORDINGS = [
  { id: 'opening-lagos', text: lagos.opening, file: 'assets/voice-eleven/lagos/opening-lagos.mp3' },
  ...Object.entries(LAGOS_FILLERS).map(([id, text]) => ({ id: `filler-${id}`, text, file: `assets/voice-fillers/eleven/lagos/${id}.mp3` })),
  ...REACTION_RECORDINGS.filter((r) => r.face === 'lagos').map((r) => ({ id: r.id, text: r.text, file: r.path.slice(1) })),
]
