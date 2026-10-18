// Живой прогон конструктора «Своё дело» на разных формах: npx tsx scripts/gen-live.ts [номера форм через запятую]
// Ключи из ~/Arena/.env. Ответы модели по попыткам — в ~/Arena-materials/final/night/gen-raw/ (для разбора без новых трат).
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

process.loadEnvFile(join(homedir(), 'Arena/.env'))
process.env.CACHE_DIR ??= join(homedir(), 'Arena-materials/final/night/gen-raw/.cache')
const { makeLLM } = await import('../src/server/llm')
const { GenerateRequest, generateScenario } = await import('../src/server/generate')
const { auditScenario, SCENARIOS } = await import('../src/content/scenarios')

export const FORMS = [
  { sphere: 'Закупки', theme: 'Поставка подшипников для нового цеха', playerRole: 'менеджер по закупкам завода в Алабуге', opponentTone: 'cold', opponentRole: 'менеджер поставщика из Набережных Челнов', opponentGoals: 'продать дороже и получить деньги быстрее', difficulty: 2, goals: 'не уступать в цене сразу и искать размен' },
  { sphere: 'Найм', theme: 'оффер ведущему инженеру-технологу', playerRole: 'руководитель отдела', opponentTone: 'neutral', opponentRole: 'инженер, которого зовут конкуренты', opponentGoals: 'оклад выше и переезд за счёт компании', difficulty: 2, goals: 'удержать бюджет и не потерять кандидата' },
  { sphere: 'Аренда', theme: 'аренда склада под интернет-магазин', playerRole: 'владелец небольшого магазина', opponentTone: 'aggressive', opponentRole: 'владелец склада', opponentGoals: 'сдать надолго и без простоя', difficulty: 3, goals: '' },
  { sphere: 'Продажи', theme: 'годовой контракт на поставку упаковки', playerRole: 'менеджер по продажам', opponentTone: 'cold', opponentRole: 'директор по закупкам клиента', opponentGoals: 'скидку и отсрочку платежа', difficulty: 2, goals: 'не давать скидку без встречной уступки' },
  { sphere: 'Подряд', theme: 'внедрение CRM для отдела продаж', playerRole: 'руководитель IT-интегратора', opponentTone: 'evasive', opponentRole: 'IT-директор заказчика', opponentGoals: 'сделать быстрее и дешевле, оплатить после сдачи', difficulty: 2, goals: 'защитить аванс' },
  { sphere: 'Закупки', theme: 'госзаказ: поставка ноутбуков в школы по 44-ФЗ', playerRole: 'контрактный управляющий управления образования', opponentTone: 'neutral', opponentRole: 'менеджер поставщика-победителя', opponentGoals: 'сдвинуть сроки поставки и получить аванс', difficulty: 1, goals: 'не сорвать сроки' },
  { sphere: 'Продажи', theme: 'продажа партии станков ЧПУ', playerRole: 'коммерческий директор завода-производителя', opponentTone: 'friendly', opponentRole: 'главный инженер покупателя', opponentGoals: 'длинную гарантию и бесплатное обучение', difficulty: 2, goals: '' },
  { sphere: 'Аренда', theme: 'сдаю офис IT-компании', playerRole: 'собственник бизнес-центра', opponentTone: 'neutral', opponentRole: 'операционный директор IT-компании', opponentGoals: 'низкую ставку и ремонт за счёт собственника', difficulty: 2, goals: 'не отдать ремонт бесплатно' },
  { sphere: 'Подряд', theme: 'разработка мобильного приложения для сети клиник', playerRole: 'заказчик, директор по цифре клиник', opponentTone: 'aggressive', opponentRole: 'директор студии разработки', opponentGoals: 'аванс 50% и фикс без штрафов', difficulty: 3, goals: 'выбить штрафы за срыв сроков' },
  { sphere: 'Найм', theme: 'переход в новую компанию аналитиком данных', playerRole: 'кандидат, аналитик данных', opponentTone: 'cold', opponentRole: 'HR-директор банка', opponentGoals: 'нанять дешевле и без удалёнки', difficulty: 2, goals: 'договориться о зарплате и удалёнке' },
] as const

const only = process.argv[2]?.split(',').map(Number)
const out = join(homedir(), 'Arena-materials/final/night/gen-raw', process.env.RUN ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'))
mkdirSync(out, { recursive: true })
const { llm } = makeLLM('yandex')
const rows: string[] = []
for (const [n, f] of FORMS.entries()) {
  if (only && !only.includes(n + 1)) continue
  const req = GenerateRequest.parse(f)
  const raws: unknown[] = []
  const spy = { ...llm, json: async (r: Parameters<typeof llm.json>[0]) => { const x = await llm.json(r); raws.push({ user: r.user, out: x }); return x } }
  const t0 = Date.now()
  const r = await generateScenario(spy, req, SCENARIOS).catch((e) => ({ source: 'error', attempts: 0, problems: [String(e)], scenario: undefined }) as never)
  const sec = Math.round((Date.now() - t0) / 1000)
  const audit = r.source === 'llm' ? auditScenario(r.scenario).problems : []
  writeFileSync(join(out, `form${n + 1}.json`), JSON.stringify({ req, raws, result: r }, null, 1))
  const line = `| ${n + 1} | ${f.sphere}: ${f.theme} | ${r.source} | ${r.attempts} | ${sec} с | ${r.source === 'llm' ? `${r.scenario.title} (${r.scenario.opponent.character.name}); аудит: ${audit.length ? audit.join('; ') : 'ок'}` : `${r.scenario?.title ?? '—'}; ${r.problems.join(' / ').slice(0, 300)}`} |`
  console.log(line)
  rows.push(line)
}
console.log(`\nсохранено в ${out}`)
