#!/bin/bash
# Платный прогон «после» (Claude Sonnet 5.5 через AITunnel, как на проде; заход — YandexGPT Pro) тем же набором, что «до».
# Лимиты --budget считают оба провайдера. Оценка по прогону «до»: AITunnel ≈ 315 ₽ (пилот ≈ 4, «шаг за шагом» до/после ≈ 85,
# основной ≈ 150, своё дело и жёсткие ≈ 77), YandexGPT (заходы) ≈ 90 ₽. Без «шаг за шагом» (SKIP_NUDGE=1): AITunnel ≈ 230 ₽.
# Голос не синтезируется.
#   bash scripts/sides5-after.sh [папка]   (по умолчанию ~/Arena-materials/final/sides5-live)
set -euo pipefail
cd "$(dirname "$0")/.."
D=${1:-$HOME/Arena-materials/final/sides5-live}
mkdir -p "$D"
HARD=dorm-hard,stop-hard,shop-hard,launch-hard,client-hard,tara-hard,offer-hard,istanbul-hard,lagos-hard,china-hard

# 1. пилот: если Sonnet не отвечает (ключ без бюджета — 402), реплики пишет запасной Яндекс — тогда стоп
npx tsx scripts/sides5-live.ts "$D/pilot.json" --live --budget 40 --cases istanbul --games hard
if python3 -c "import json,sys;d=json.load(open('$D/pilot.json'));sys.exit(0 if d['games'] and all('claude' in (t.get('model') or '') for g in d['games'] for t in g['turns']) else 1)"; then echo 'пилот: Sonnet отвечает'; else echo 'пилот: Sonnet не отвечает (бюджет ключа?) — стоп'; exit 1; fi

# 2. «шаг за шагом» до и после: по одному пункту на ход, как капитан с Эмре; движок часто уступает ровно просьбу —
#    тут и путалась радость. «До» — из ~/Arena-wt/n-sides5-base (прод 9a59322); SKIP_NUDGE=1 — пропустить
CASES=dorm,stop,shop,launch,client,tara,offer,istanbul,lagos,china
if [ -z "${SKIP_NUDGE:-}" ]; then
  (cd ~/Arena-wt/n-sides5-base && npx tsx scripts/sides5-live.ts "$D/nudge-before.json" --live --budget 70 --cases $CASES --games nudge) | tee "$D/nudge-before.log"
  npx tsx scripts/sides5-live.ts "$D/nudge-after.json" --live --budget 70 --cases $CASES --games nudge | tee "$D/nudge-after.log"
  npx tsx scripts/sides5-judge.ts "$D/nudge-before.json" --export "$D/judge-nudge-before"
  npx tsx scripts/sides5-judge.ts "$D/nudge-after.json" --export "$D/judge-nudge-after"
fi

# 3. основной прогон: 10 дел × 3 партии (как before.json), затем своё дело и жёсткие версии (как before2.json)
npx tsx scripts/sides5-live.ts "$D/after.json" --live --budget 230 | tee "$D/after.log"
npx tsx scripts/sides5-live.ts "$D/after2.json" --live --budget 110 --cases gen,$HARD --games soft,concede --hard-games concede | tee "$D/after2.log"
python3 - "$D" <<'PY'
import json,sys
d=sys.argv[1]; a=json.load(open(f'{d}/after.json')); b=json.load(open(f'{d}/after2.json'))
a['cases'].update(b['cases']); a['games']+=b['games']; a['rub']=a.get('rub',0)+b.get('rub',0)
json.dump(a,open(f'{d}/after-all.json','w'),ensure_ascii=False,indent=1)
print('ходов', sum(len(g['turns']) for g in a['games']), 'расход', round(a['rub'],2))
PY

# 4. промпты судьи; вердикты — субагентами Claude (как для «до»: judge-before/*.json) или платно: sides5-judge.ts без --export
npx tsx scripts/sides5-judge.ts "$D/after-all.json" --export "$D/judge-after"
echo "дальше: судьи-субагенты по ~/Arena-materials/final/sides5-live/judge-agent-prompt.txt (по 14 партий на агента) для judge-after и judge-nudge-*,"
echo "затем: npx tsx scripts/sides5-judge.ts $D/after-all.json --import $D/judge-after (и так же nudge-before/nudge-after)."
echo "или платно (Sonnet через AITunnel, ≈ 2,5 ₽ за партию): npx tsx scripts/sides5-judge.ts $D/after-all.json"
