# Голос и LLM для «Переговорки»: цены, доступ из РФ, что брать

## Что стоит сейчас (17.10.2026)

**Модели.**
- Разметка реплики игрока — YandexGPT 5.1 Pro (`YANDEX_ANALYZE_MODEL`), temperature 0, строгий JSON, кэш.
- Реплику собеседника пишет Claude Sonnet 5.5 через AITunnel — по умолчанию, если есть `AITUNNEL_API_KEY`. AITunnel — OpenAI-совместимый посредник с рублёвой оплатой, с нашего сервера отвечает. Рассуждение выключаем (`reasoning_effort` по модели), иначе реплика тормозит. Не ответила за 8 с — пишет YandexGPT 5.1 Pro, дальше заготовка. `VOICE_LLM=main` — всё на Яндексе, без ключей — правила и заготовки. Зависла три раза подряд — 2 минуты ход идёт запасным путём.
- Всё под общим бюджетом `LLM_TOTAL_RUB` (6000 ₽): с 80% модели Яндекса переходят на Lite, со 100% — офлайн и без голоса. Цену хода AITunnel берём из ответа (`usage.cost_rub`).
- Модель реплики можно выбрать на запрос (`?llm=`, заголовок `x-voice-llm`): по умолчанию разрешены `aitunnel:claude-sonnet-5.5`, `aitunnel:gpt-6.1-sol`, `yandex:yandexgpt-5.1` (`VOICE_LLM_ALLOWED`), 200 таких ходов в сутки на IP. В лаборатории `/?lab` — YandexGPT Pro, Lite, AITunnel и офлайн. GigaChat, Claude CLI, Anthropic и OpenAI напрямую, SaluteSpeech из кода удалены.

**Промпт реплики.** Модель играет живого человека, движок даёт рамку: карточка персонажа (биография, характер, манера, примеры речи), что ему важно в сделке словами без очков, весь разговор и решение движка на этот ход. Закрытые причины модель не видит, пока движок не разрешит их рассказать. Ответ — JSON `{line, emotion, terms, agrees, reveals}`.

**Проверка.** Сверяем заявленное с решением движка: условия, согласие, раскрытые причины. Поверх ловим выдуманные цифры (в том числе между вариантами), выданные тайны, «рассказать причину» без причины, мат, путаницу сторон. Не прошло — одна переписка, потом безопасный вариант, потом заготовка. Код — `src/server/voice.ts`, живая партия с записью попыток и рублей — `scripts/dialog-live.ts` (платно, `--live`).

**Голос.**
- Основной — ElevenLabs v4 Turbo через свой воркер Cloudflare (`TTS_PROVIDER=elevenlabs`, `ELEVEN_RELAY_URL`). Ключ живёт только в воркере, браузер к ElevenLabs не ходит. У каждого лица свой голос из библиотеки (`CAST` в `src/server/tts.ts`), свой seed, stability 0,6. Вступления и фразы-паузы записаны заранее на `eleven_v4`.
- ElevenLabs озвучивает только тексты, которые выдал сервер (реплики хода, вступления дел, собранные дела). Лимиты: 60 синтезов в час на вход, 300 в сутки на пропуск (общий потолок IP ×10), 20 000 символов в сутки на сайт (`ELEVEN_DAILY_CHARS`), повторы из кэша бесплатны. Очередь по потокам тарифа (`ELEVEN_CONCURRENCY`, 5 на Creator), на 429 — один повтор. Новые голоса прогреваются при старте сервера.
- Запасной — SpeechKit: livetts-голоса у лиц, ударения и паузы (`NATURAL_SPEECH=voices+`). Говорит он, если у ElevenLabs лимит, очередь, первый байт позже 2,5 с или три сбоя подряд (тогда пауза 5 минут); опоздавший звук ElevenLabs ложится в кэш. Кто говорит сейчас — `/api/health` → `speech.voice`.
- Голос OpenAI на проде запрещён и из кода убран, голоса AITunnel тоже.
- Ударения: словарь `src/content/stress-dict.ts` и правила, омографы — YandexGPT Lite (ждём 0,5 с). SpeechKit получает «+», ElevenLabs — знак ударения U+0301. Англицизмы и сокращения пишем как говорят (вайфай, О-Э-З, Камаз). Пометки вроде `[sighs]` ставит модель, на экране и у SpeechKit их вырезаем (`src/server/tags.ts`).
- Распознавание по коду на 18.10: потоковый Scribe при настроенном воркере, иначе Яндекс; `?stt=off` оставляет только Яндекс. У Яндекса есть хедж и повтор, таймаут попытки 8 с. Секунды Scribe резервируются заранее, попытки Яндекса учитываются отдельно. Наблюдение «10–15% зависают» — прежний замер, не гарантия текущей частоты.

**Экономика, сверка 18.10.** Sonnet — ориентировочно 0,5–1,5 ₽ за ход, разметка Pro — около 1 ₽; короткая партия — ориентир 10–15 ₽, полная встреча и повторы могут стоить больше. ElevenLabs расходует кредиты тарифа; 8 ₽/1000 символов Turbo и 16 ₽ для полной модели — внутренний расчёт сервера, не отдельный платёж за реплику. Распознавание учитывается дополнительно: Яндекс по блокам 15 с, Scribe по секундам и расчётному курсу. Формулы — `budget.ts`, `tts.ts`, `sttStream.ts`; допущения — в [экономике продукта](../product.md#экономика).

Историческая запись 17.10: три хода с голосом и прогревом — 12,4 ₽ (модели 7,1, голос 5,3). Она не подтверждает среднюю стоимость полной партии; исходный журнал этого замера в репозитории не приложен.

Для внедрения в Алабуге — SpeechKit; ElevenLabs оставляем экспортной/английской версии в поддерживаемых регионах. Описанная выше цепочка через воркер относится к демонстрационной конфигурации. Текущие тарифы и условия доступа в этой сверке по коду не перепроверялись.

## Исследование 29.09

Дальше — как было 29.09: цены, доступ и выводы того дня. Курс ЦБ на 29.09.2026: **1 $ = 84,41 ₽** ([cbr.ru][cbr]). Цены с НДС, если провайдер российский; у зарубежных — без налогов. С тех пор ElevenLabs заработал через свой воркер, Claude — через AITunnel, а Сбер, OpenAI и Anthropic напрямую из кода ушли.

Что проверено руками, а не только по докам:
- с нашего сервера на рег.ру (IP 31.31.197.49, страна RU) 29.09 дёрнул API всех провайдеров без ключа;
- нашим ключом Яндекса синтезировал фразу в SpeechKit v1 и v3, включая голоса `alena`, `madirus` и новую модель `livetts`;
- токенизацию русского сравнил на 4000 символах из README: YandexGPT 957 токенов, OpenAI `o200k` 1175 (×1,23), `cl100k` 1819 (×1,9).

### Коротко

1. **OpenAI, Anthropic и ElevenLabs с нашего сервера не работают.** OpenAI отвечает `403 unsupported_country_region_territory`, Anthropic — `403 Request not allowed`, ElevenLabs редиректит на страницу про санкционные страны. России нет в списках поддерживаемых стран ни у [OpenAI][oa-countries], ни у [Anthropic][ant-countries]. Российской картой у них тоже не заплатить: Visa/MC, выпущенные в РФ, за рубежом не работают с марта 2022 ([Visa][visa]). Работать с ними можно только через российского посредника (ProxyAPI), это примерно ×3 к цене.
2. **Сбер закрывает двери для новых физлиц.** SaluteSpeech с 15.07.2026 не продаёт пакеты физлицам и не продлевает им Freemium ([тарифы][salute-ind]). У GigaChat новые клиенты с 01.09.2026 платят только через cloud.ru ([тарифы][giga-ind]). Если у капитана нет старого проекта в Studio, на Сбер не рассчитываем.
3. **YandexGPT 5.1 Pro дорогой: ~38 ₽ за партию.** При `LLM_DAILY_RUB=150` это ~4 партии в день. Lite — 9,5 ₽. Разумный компромисс — дешёвая модель для разметки и Pro или Alice AI LLM для реплик (ниже).
4. **Голос почти бесплатный** при любом выборе: 0,3–2,8 ₽ за партию. Исключение — ElevenLabs (7–14 ₽), но он всё равно заблокирован.
5. **SpeechKit v3 дешевле v1 на наших коротких репликах**: v3 берёт 0,1626 ₽ за каждые начатые 250 символов, v1 — 1342 ₽ за млн символов. Реплика в 150 символов стоит 0,16 ₽ против 0,20 ₽.

### Допущения по объёму

| | Значение |
|---|---|
| LLM за партию | 43 000 вход + 4 500 выход в токенах YandexGPT (так считает наш `.cache/usage`) |
| Пересчёт токенов | OpenAI ×1,23 (замер); Claude Haiku/Sonnet 4.5 ×1,9 (оценка по `cl100k`, не замерял); Claude 4.7+ и Sonnet 5.x ещё +30% к этому, так пишет сама Anthropic ([pricing][ant-price]); GigaChat ≈ как Яндекс (не замерял) |
| Озвучка | 11 реплик × ~150 символов = 1 700 символов, ~2 минуты звука |
| Распознавание | 10 × 8 с = 80 с |

### Голос (TTS)

| Провайдер / модель | Цена | ₽ за партию | С сервера в РФ | Оплата картой РФ | Русский (субъективно) |
|---|---|---|---|---|---|
| **SpeechKit v3** `general` | 0,1626 ₽ за начатые 250 симв. ([цены][sk-price]) | **1,79** | да, проверено | да | хороший; голоса v3 (anton, kirill, dasha…) живее v1 |
| SpeechKit v3 `livetts` (вышла 24.09.2026) | 0,25 ₽ за начатые 250 симв. | 2,75 | да, синтез проверен | да | новые голоса со «сценарными амплуа»; на слух не сравнивал |
| SpeechKit v1 | 1 342 ₽ за 1 млн симв. | 2,28 | да, проверено | да | как сейчас в игре |
| SaluteSpeech (юрлица) | 0,000186 ₽/симв., постоплата от 15 000 ₽/мес ([тарифы][salute-legal]) | 0,32 | эндпоинт отвечает; нужен сертификат Минцифры | да, но новым клиентам закрыто с 15.07.2026 | сопоставим со SpeechKit |
| SaluteSpeech (физлица) | Freemium 200 тыс. симв./мес; пакет 1 млн = 1 000 ₽ ([тарифы][salute-ind]) | 0 / 1,70 | то же | продажи и продление Freemium прекращены 15.07.2026 | — |
| OpenAI `gpt-4o-mini-tts` | $0,60 / 1M текст. токенов + $12 / 1M аудиотокенов ([pricing][oa-price]) | ~2,5 (при ≈$0,015/мин; этой оценки на странице цен сейчас нет) | **нет, 403** | нет | выразительный, но «голоса оптимизированы под английский» ([гайд][oa-tts]); лёгкий акцент — субъективно |
| OpenAI `tts-1` / `tts-1-hd` | $15 / $30 за 1M симв. | 2,15 / 4,30 | нет, 403 | нет | заметно хуже `gpt-4o-mini-tts`, не понимает `instructions` |
| то же через ProxyAPI | `gpt-4o-mini-tts` 3 093 ₽, `tts-1` 3 866 ₽ за 1M симв. ([прайс][proxyapi]) | 5,26 / 6,57 | да (запросы идут на российский адрес) | да | — |
| ElevenLabs Flash v2.5 | $0,05 за 1K симв. ([pricing, архив 20.09][el-price]) | 7,17 | **нет, блок по стране** ([help][el-geo]) | нет | лучший по эмоциям — субъективно |
| ElevenLabs Multilingual v2 / v3 | $0,10 за 1K симв. | 14,35 | нет | нет | то же |
| Google Cloud TTS | Chirp 3 HD $30, WaveNet $4 за 1M симв. ([pricing][g-price]) | 4,30 / 0,57 | новых клиентов из РФ не берут с 10.03.2022 ([TechCrunch][cloud-ru]) | нет | не проверял |
| Azure Speech | цену не проверил (страница показывает `$-`) | — | новые продажи в РФ остановлены 04.03.2022 ([Microsoft][ms-ru]) | нет | не проверял |

Про ElevenLabs отдельно: даже мой европейский VPN-IP (дата-центр в Дании) получает тот же редирект. Судя по всему, они режут и «подозрительные» облака, так что ретранслятор тоже не гарантия. Условия сервиса прямо запрещают доступ из РФ, поэтому как рабочий вариант его не рассматриваю.

#### Голоса SpeechKit (русские)

Из [списка голосов][sk-voices] на 29.09.2026:

| Голос | Пол | Амплуа | API |
|---|---|---|---|
| `filipp` | м | — | v1, v3 |
| `ermil` | м | neutral, good | v1, v3 |
| `zahar` | м | neutral, good | v1, v3 |
| `madi_ru` | м | — | v1, v3 |
| `alexander` | м | neutral, good | только v3 |
| `kirill` | м | neutral, strict, good | только v3 |
| `anton` | м | neutral, good | только v3 |
| `jane` | ж | neutral, good, evil | v1, v3 |
| `omazh` | ж | neutral, evil | v1, v3 |
| `marina` | ж | neutral, whisper, friendly | v1, v3 |
| `dasha` | ж | neutral, good, friendly | только v3 |
| `julia` | ж | neutral, strict | только v3 |
| `lera` | ж | neutral, friendly | только v3 |
| `masha` | ж | good, strict, friendly | только v3 |
| `saule_ru`, `zamira_ru`, `zhanar_ru`, `yulduz_ru` | ж | neutral, strict, friendly, whisper (набор у каждого свой) | только v3; это казахские и узбекские дикторы, говорят по-русски |
| `nigora` | ж | — | v1, v3; узбекский голос в русской локализации |
| LiveTTS: `sofia`, `vera`, `irina` (ж), `vasily`, `sergey`, `denis` (м) | | «сценарные амплуа» | v3 `model: "livetts"` и Realtime |

`alena` и `madirus` из таблицы пропали, но **работают**: 29.09 синтезировал оба в v1, `alena/good` ещё и в v3. Похоже, их просто убрали из витрины. Для кастинга надёжнее перейти на голоса из таблицы, а alena держать как запасной. Для «строгого» переговорщика подходят `kirill`/`julia`/`masha` с амплуа `strict`, для «раздражённого» — `jane`/`omazh` с `evil`.

#### SaluteSpeech: голоса

Из [списка голосов][salute-voices]: Наталья `Nec_24000`, Марфа `May_24000`, Александра `Ost_24000` (ж); Борис `Bys_24000`, Тарас `Tur_24000`, Сергей `Pon_24000` (м). У каждого есть вариант `_8000` для телефонии. Амплуа нет, интонацией управляют через SSML.

#### OpenAI: акцент и голоса

- Поле `instructions` официально управляет «Accent, Emotional range, Intonation, Impressions, Speed of speech, Tone, Whispering» ([гайд][oa-tts]). Значит, «говори по-русски с лёгким китайским акцентом» — законный запрос. Насколько убедительно это звучит, не проверял: ключа нет, а с сервера API закрыт.
- Голоса: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar. Для качества OpenAI советует `marin` или `cedar`.
- `instructions` не работает с `tts-1` и `tts-1-hd`.

### Распознавание (STT), если включим

| Провайдер | Цена | ₽ за партию (10 × 8 с) |
|---|---|---|
| SpeechKit sync | 0,1626 ₽ за 15 с, минимум 15 с на запрос ([цены][sk-price]) | 1,63 (каждый 8-секундный запрос считается как 15 с) |
| SaluteSpeech | 0,01 ₽/с (юрлица), 1 200 ₽ за 1 000 мин (физлица) | 0,80 / 1,60, но новым клиентам закрыто |
| OpenAI `gpt-4o-mini-transcribe` | $0,003/мин ([pricing][oa-price]) | 0,34, но 403 из РФ |
| ElevenLabs Scribe v2 | $0,22/час | 0,41, но заблокирован |

### LLM для собеседника

| Модель | Цена за 1K токенов (вход / выход) | ₽ за партию | С сервера в РФ | Оплата картой РФ | Русский (субъективно) |
|---|---|---|---|---|---|
| **YandexGPT Pro 5.1** | 0,8 / 0,8 ₽ ([цены AI Studio][ya-price]) | **38,0** | да (прод) | да | хороший, «родной» |
| YandexGPT Lite 5 | 0,2 / 0,2 ₽ | **9,5** | да | да | беднее и суше; для разметки хватает |
| Alice AI LLM | 0,5 / 1,2 ₽ | 26,9 | да | да | не гонял на наших промптах |
| Alice AI LLM Flash | 0,1 / 0,2 ₽ | 5,2 | да | да | не гонял; кандидат на разметку |
| Qwen3.6 35B (в AI Studio) | 0,2 / 0,3 ₽ | 9,95 | да | да | не гонял |
| GigaChat 2 Lite | 0,065 ₽ ([юрлица, pay-as-you-go][giga-legal]; физлицам — пакет 20M за 1 300 ₽, та же ставка) | 3,1 | эндпоинт отвечает, нужен сертификат | новым — только через cloud.ru | неплохой, шаблонный |
| GigaChat 2 Pro | 0,5 ₽ (пакет 3M = 1 500 ₽) | 23,8 | то же | то же | — |
| GigaChat 2 Max | 0,65 ₽ (пакет 3M = 1 950 ₽) | 30,9 | то же | то же | — |
| GigaChat Freemium (физлица) | 250M Lite + 40M Pro + 25M Max + 50M 3 Ultra на 12 мес ([тарифы][giga-ind]) | 0 | то же | — | дают ли его новым регистрациям после 01.09 — не проверено |
| OpenAI `gpt-4.1-mini` | $0,40 / $1,60 за 1M ([pricing][oa-price]) | 2,53 | **нет, 403** | нет | хороший |
| OpenAI `gpt-4o-mini` | $0,15 / $0,60 | 0,95 | нет | нет | нормальный |
| OpenAI `gpt-5-mini` / `gpt-5-nano` | $0,25 / $2 и $0,05 / $0,40 | 2,05 / 0,41 + скрытые токены рассуждений | нет | нет | reasoning-модели; поддержку `temperature` не проверял |
| OpenAI `gpt-5.4-mini` / `gpt-5.4-nano` | $0,75 / $4,50 и $0,20 / $1,25 | 5,45 / 1,48 | нет | нет | — |
| через ProxyAPI: `gpt-4.1-mini` / `gpt-4o-mini` / `gpt-5-mini` | 104 / 413, 39 / 155, 65 / 516 ₽ за 1M ([прайс][proxyapi]) | 7,8 / 2,9 / 6,3 | да | да | как у OpenAI |
| Claude Haiku 4.5 | $1 / $5 за 1M ([pricing][ant-price]) | ~10,5 | **нет, 403** | нет | очень хороший, держит роль |
| Claude Sonnet 5.5 | $2 / $10 (новый токенизатор, +30%) | ~27 | нет | нет | лучший из списка — субъективно |
| Claude Sonnet 4.5 | $3 / $15 | ~31,5 | нет | нет | — |
| Claude Haiku 4.5 через ProxyAPI | 295 / 1 474 ₽ за 1M | ~36,7 | да | да | — |

Заметки:
- Haiku 4.5 уходит на пенсию «не раньше 15.10.2026» ([models][ant-models]), то есть сразу после окна жюри. До 14.10 доживёт, но впритык.
- **Микс, который стоит попробовать.** Примерно 25k/3k токенов за партию уходит на разметку (JSON, temperature 0), 18k/1,5k — на реплики.
  - Lite на разметку + Pro 5.1 на реплики: ≈ 5,6 + 15,6 = **21 ₽**.
  - Alice Flash на разметку + Alice AI LLM на реплики: ≈ 3,1 + 10,8 = **14 ₽**.
  - Сейчас на Pro обе задачи: 38 ₽.
- Внешние бенчмарки русского (MERA и т.п.) я видел только в пересказах, первоисточник не открывал. Поэтому качество оценено субъективно.
- Стартовый грант Yandex Cloud для новых аккаунтов в РФ — от 4 000 ₽ и действует на любые сервисы ([billing][ya-grant]). Сколько он действует, не проверял.

### Соответствие ТЗ

- Ключи из env: у всех провайдеров так и есть, в коде уже сделано.
- Офлайн-режим при падении провайдера: есть, от провайдера не зависит.
- Внешний API с сервера: у российских (Яндекс, Сбер) работает напрямую. У OpenAI и Anthropic — только через посредника с `*_BASE_URL`. ElevenLabs и Google/Azure отпадают.
- Сбер: Node 22 по умолчанию не доверяет сертификату Минцифры (`SELF_SIGNED_CERT_IN_CHAIN` на сервере). При этом системное хранилище AlmaLinux его уже содержит. Проверил: `node --use-system-ca` и `NODE_EXTRA_CA_CERTS=/etc/pki/tls/certs/ca-bundle.crt` оба дают нормальный ответ. `NODE_TLS_REJECT_UNAUTHORIZED=0`, который предлагает дока Сбера, не нужен.

### Рекомендации

**Голос**
- Лучшее качество из того, что реально работает: **SpeechKit v3 `livetts`** (sofia/vera/irina/vasily/sergey/denis) или v3 `general` с `kirill`/`dasha`/`masha` и амплуа. Стоит ~2–3 ₽ за партию, ключ уже есть. Livetts надо один раз послушать: модель вышла пять дней назад.
- Цена/качество: **SpeechKit v3 `general`**, 1,8 ₽ за партию. Переключение с v1 — просто дешевле и больше голосов.
- Самое дешёвое: SaluteSpeech (0,3 ₽ юрлицам или Freemium). Но новым клиентам он закрыт, так что по факту самый дешёвый — тот же **SpeechKit v3**.
- Китайский акцент — только `gpt-4o-mini-tts` через ProxyAPI (~5 ₽ за партию). Это приятная фишка, но не основа.

**LLM**
- Лучшее качество: Claude Sonnet 5.5 или Haiku 4.5 через ProxyAPI (~37 ₽ за партию у Haiku) — дорого и с посредником. Без посредника лучший вариант — **YandexGPT Pro 5.1** (38 ₽).
- Цена/качество: **микс Lite 5 (разметка) + Pro 5.1 (реплики), ~21 ₽**. Или сначала прогнать на наших промптах Alice AI LLM (~14 ₽ с Flash на разметке).
- Самое дешёвое: **YandexGPT Lite** (9,5 ₽) или Alice Flash (5,2 ₽). Если у капитана живой Freemium GigaChat — GigaChat 2 Lite/Pro бесплатно.
- Бюджет: поднять `LLM_DAILY_RUB` до реального. 150 ₽ — это ~4 партии на Pro, ~7 на миксе, ~16 на Lite.

### Для разработчика

**SpeechKit v3 REST** (проверено запросом 29.09)
- `POST https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis`
- Заголовки: `Authorization: Api-Key <key>` (или `Bearer <IAM>`), `Content-Type: application/json`. `x-folder-id` для ключа сервисного аккаунта не обязателен.
- Тело: `{"text":"…","hints":[{"voice":"kirill"},{"role":"strict"},{"speed":1.1}],"outputAudioSpec":{"containerAudio":{"containerAudioType":"MP3"}},"loudnessNormalizationType":"LUFS"}`
  - `hints` — массив, в каждом объекте одно поле: `voice` | `role` | `speed` | `volume` | `pitchShift`.
  - `containerAudioType`: `WAV` | `OGG_OPUS` | `MP3`. Вместо контейнера можно `rawAudio: {audioEncoding: "LINEAR16_PCM", sampleRateHertz: 22050}`.
  - `loudnessNormalizationType`: `MAX_PEAK` | `LUFS`.
  - `"model":"livetts"` + голоса `sofia|vera|irina|vasily|sergey|denis`. Без `model` работает `general`.
  - `unsafeMode: true` — для длинных текстов.
- Ответ: NDJSON, по строке на чанк: `{"result":{"audioChunk":{"data":"<base64 mp3>"},"textChunk":null,"startMs":"0","lengthMs":"480","wordTimings":[],"chunkType":"AUDIO_ONLY"}}`.
  - Последняя строка бывает `TEXT_ONLY` с `audioChunk: null`, её надо пропускать.
  - Куски mp3 просто склеиваются. Ошибка приходит как `{"error":{…}}`.
- Документация: [utteranceSynthesis][sk-v3].
- v1 для сравнения: `POST https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize`, form-urlencoded `text, lang=ru-RU, voice, emotion, speed, format=mp3|oggopus|lpcm, folderId`.

[cbr]: https://www.cbr.ru/scripts/XML_daily.asp?date_req=29/09/2026
[sk-price]: https://aistudio.yandex.ru/docs/ru/speechkit/pricing
[sk-voices]: https://aistudio.yandex.ru/docs/ru/speechkit/tts/voices
[sk-v3]: https://aistudio.yandex.ru/docs/ru/speechkit/tts-v3/api-ref/Synthesizer/utteranceSynthesis
[ya-price]: https://aistudio.yandex.ru/docs/ru/ai-studio/pricing
[ya-grant]: https://yandex.cloud/ru/docs/billing/concepts/bonus-account
[salute-ind]: https://developers.sber.ru/docs/ru/salutespeech/tariffs/individual-tariffs
[salute-legal]: https://developers.sber.ru/docs/ru/salutespeech/tariffs/legal-tariffs
[salute-voices]: https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/voices
[giga-ind]: https://developers.sber.ru/docs/ru/gigachat/tariffs/individual-tariffs
[giga-legal]: https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs
[oa-price]: https://developers.openai.com/api/docs/pricing
[oa-tts]: https://developers.openai.com/api/docs/guides/text-to-speech
[ant-price]: https://platform.claude.com/docs/en/about-claude/pricing
[ant-models]: https://platform.claude.com/docs/en/about-claude/models/overview
[el-price]: https://web.archive.org/web/20260920155037/https://elevenlabs.io/pricing/api
[el-geo]: https://help.elevenlabs.io/hc/en-us/articles/22497891312401-Do-you-restrict-access-to-the-service-and-platform-for-any-specific-countries
[g-price]: https://cloud.google.com/text-to-speech/pricing
[cloud-ru]: https://techcrunch.com/2022/03/10/amazon-microsoft-and-google-have-suspended-cloud-sales-in-russia
[ms-ru]: https://blogs.microsoft.com/on-the-issues/2022/03/04/microsoft-suspends-russia-sales-ukraine-conflict/
[proxyapi]: https://proxyapi.ru/pricing/list
[oa-countries]: https://developers.openai.com/api/docs/supported-countries
[ant-countries]: https://www.anthropic.com/supported-countries
[visa]: https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.18871.html
