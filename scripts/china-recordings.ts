// Только список для записи: никаких сетевых запросов.
import { CHINA_RECORDINGS } from '../src/content/china-recordings'
import { forEleven, spellOut } from '../src/server/direct'
import { accent, render, settle } from '../src/server/stress'
import { CAST, elevenBody } from '../src/server/tts'

console.log(JSON.stringify(CHINA_RECORDINGS.map((r) => ({
  ...r, who: 'china', voice: CAST.china,
  body: elevenBody({ who: 'china', voice: CAST.china, text: render(spellOut(settle(accent(forEleven(r.text)))), 'eleven').replace(/[«»"]/g, '') }),
})), null, 2))
