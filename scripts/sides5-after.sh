#!/bin/bash
# Платный прогон «после» (Claude Sonnet 5.5 через AITunnel, как на проде; заход — YandexGPT Pro) тем же набором, что «до».
# AITunnel ≈ 245 ₽ (пилот ≈ 17 + основной ≈ 150 + жёсткие и своё дело ≈ 77), YandexGPT ≈ 60 ₽. Голос не синтезируется.
#   bash scripts/sides5-after.sh [папка]   (по умолчанию ~/Arena-materials/final/sides5-live)
set -euo pipefail
cd "$(dirname "$0")/.."
D=${1:-$HOME/Arena-materials/final/sides5-live}
mkdir -p "$D"
HARD=dorm-hard,stop-hard,shop-hard,launch-hard,client-hard,tara-hard,offer-hard,istanbul-hard,lagos-hard,china-hard

# 1. пилот: если Sonnet не отвечает (ключ без бюджета — 402), реплики пишет запасной Яндекс — тогда стоп
npx tsx scripts/sides5-live.ts "$D/pilot.json" --live --budget 40 --cases istanbul --games hard
if python3 -c "import json,sys;d=json.load(open('$D/pilot.json'));sys.exit(0 if d['games'] and all('claude' in (t.get('model') or '') for g in d['games'] for t in g['turns']) else 1)"; then echo 'пилот: Sonnet отвечает'; else echo 'пилот: Sonnet не отвечает (бюджет ключа?) — стоп'; exit 1; fi

# 2. основной прогон: 10 дел × 3 партии (как before.json), затем своё дело и жёсткие версии (как before2.json)
npx tsx scripts/sides5-live.ts "$D/after.json" --live --budget 230 | tee "$D/after.log"
npx tsx scripts/sides5-live.ts "$D/after2.json" --live --budget 100 --cases gen,$HARD --games soft,concede --hard-games concede | tee "$D/after2.log"
python3 - "$D" <<'PY'
import json,sys
d=sys.argv[1]; a=json.load(open(f'{d}/after.json')); b=json.load(open(f'{d}/after2.json'))
a['cases'].update(b['cases']); a['games']+=b['games']; a['rub']=a.get('rub',0)+b.get('rub',0)
json.dump(a,open(f'{d}/after-all.json','w'),ensure_ascii=False,indent=1)
print('ходов', sum(len(g['turns']) for g in a['games']), 'расход', round(a['rub'],2))
PY

# 3. промпты судьи; вердикты — субагентами Claude (как для «до»: judge-before/*.json) или платно: sides5-judge.ts без --export
npx tsx scripts/sides5-judge.ts "$D/after-all.json" --export "$D/judge-after"
echo "дальше: вердикты в $D/judge-after/<партия>.json, затем npx tsx scripts/sides5-judge.ts $D/after-all.json --import $D/judge-after"
