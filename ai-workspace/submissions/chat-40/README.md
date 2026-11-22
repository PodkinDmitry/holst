# CHAT-EXEC · EXEC-001 — диагностика `app_regression.py:1265` (Test 13)

**Статус: `BLOCKED_BROWSER_WITH_SOURCE_EVIDENCE`.** Задача получена, принята и начата в отдельном CHAT-EXEC по прямому запросу пользователя. Источник скачан **напрямую из Google Drive**, SHA/ZIP CRC/manifest проверены. Подлинный XOD browser E2E в данном окружении не стартует: Chromium возвращает `net::ERR_BLOCKED_BY_ADMINISTRATOR` для разрешённого локального HTTP-сервера. Поэтому истинный JSON-diff исходного FAIL на строке 1265 и root cause **пока неизвестны**. Нового продуктового патча нет.

## Проверенный источник и права

- Google Drive: owner-only файл `XOD-Test13-source-6429ad6.zip`, metadata `shared=false`, размер **6 036 778 байт**; есть право чтения, содержимое получено через подключённый Drive.
- ZIP SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4` — **совпал**.
- ZIP **449 записей**, `testzip()=None`, все **431** checksum-записи `SOURCE_SHA256SUMS.txt` — **PASS**.
- Исходный `v224/base29.html` SHA256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c` — **совпал**.
- Приватный Test13, личные профили, приложения, исходный HTML, сборки, ZIP или Drive-токены в GitHub **не публиковались**. Старый `holst-devkit-2.24` не использовался как подмена.

## Фактическая проверка браузера

Для временного Python HTTP-сервера на `127.0.0.1` проверено:

- `/usr/bin/chromium` запускается через `playwright.sync_api`;
- `page.goto('about:blank')` — **PASS**;
- `page.goto('http://127.0.0.1:<ephemeral-port>/')` — **`net::ERR_BLOCKED_BY_ADMINISTRATOR`**.

Следовательно, исходный `tests/app_regression.py` не может пройти первый `page.goto(base+'?debug=1&wel=0')` (~1194) до проверки 1265, пока администраторская политика навигации остаётся в силе. Полный тест, реальный CacheStorage/IndexedDB и Chrome/Edge Windows **не запускались и не принимались**. Политику браузера не обходили и не меняли.

## Новая полезная проверка: настоящий `scheduleSave` / `saveNow`

`cache_save_race_source_gate.js` извлекает **реальный исходный код функций** из неизменённого приватного `v224/base29.html` и исполняет его с *синтетическими* `Backend`, `Date` и планировщиком таймеров. Gate прежде требует точный SHA исходника. Он проверяет 8 сценариев (8/8 PASS, `node --check` PASS): отсутствие изменений без записи; создание ожидающего таймера; поздний `saveNow` после снимка; завершение записи до снимка; несоответствие «таймерный handle ненулевой» vs «таймер ещё ожидает»; отказ Backend; незавершённую запись; вызов `saveNow` при `dirty=false`.

**Что действительно доказано в исходнике:** `scheduleSave()` может поставить отложенную запись. При запуске **подлинный `saveNow()`** синхронно присваивает `S.board.updatedAt=Date.now()` *до* результата `await Backend.saveBoard`. Если между двумя снимками из строки 1265 сработает ранее поставленный таймер, строковое сравнение изменится **только по JSON-пути `/0/updatedAt`** даже без действия с CacheStorage. Это воспроизведённая *возможная гонка*, но **не доказательство причины исторического browser FAIL**.

**Уточнение инструментария CHAT14:** выражение `timerPending:!!saveTimer` в [`CHAT14/app_regression.patch`](../chat-14/app_regression.patch) может показывать `true` после того, как таймер уже сработал: `saveNow()` вызывает `clearTimeout(saveTimer)` без сброса `saveTimer=0`. Поэтому эта диагностическая метка фактически означает «handle ненулевой», а не «есть ожидающий таймер». Это подтверждено исполнением исходника. Не делать вывод о гонке только по данному флагу. Старый опубликованный патч и его строгий assert здесь не менялись.

```bash
node --check cache_save_race_source_gate.js
node cache_save_race_source_gate.js /PRIVATE_TEST13/v224/base29.html
# ожидается TOTAL 8/8 PASS
```

Не дублировались ранее выполненные **CHAT14 12/12 Python + 5/5 Node** и **CHAT34 407/407 synthetic Node VM**: их прежние факты не засчитываются повторно как тесты EXEC-001. Используемые утверждения и границы: [CHAT14](../chat-14/README.md), [CHAT34](../chat-34/README.md).

## Метрики и доказательность

Точный канонический [`ai-workspace/tools/xod-metrics.py`](../../tools/xod-metrics.py), Git blob `3fef19a28becb2c9ff81571c972ac04415bc1c61`, **побайтово восстановлен из публичного GitHub-кода**, SHA подтверждён. Запущены `--self-test` (PASS) и `--input` на локальных наблюдённых данных (без выдуманных процентов успешности). Вывод: `gate_status=UNKNOWN`, `release_gates_all_pass=false`, target progress **н/д**; `work_usage.observed_events=0` означает **нет измерений**, а не нулевой расход. `accuracy_evidence_index_pct=50` означает только покрытие свидетельств (scope/source/source-tests), **не** готовность XOD 3.0, и не должен включаться в проценты релизной готовности. Локальный приватный вход и экспортированный полный Python-код метрик не дублируются в GitHub.

## Минимальный следующий шаг для оператора с разрешённым браузером

1. На машине с разрешённым localhost, нужным Chromium/Edge и совместимым Playwright создать **копию** проверенного Test13 (не перезаписывать checkout SOL).
2. Применить только **диагностический** [`CHAT14/app_regression.patch`](../chat-14/app_regression.patch) к `tests/app_regression.py`, разместить `cache_state_diagnostics.py` рядом; предварительно пройти `git apply --check` и `python -m py_compile`. Строгая проверка должна остаться строгой.
3. Запустить `tests/app_regression.py` с позиционными аргументами `app previous board` и необязательным `--channel`, как в подлинном `app_regression.py:1172–1178`; получить только ограниченные **JSON Pointer paths/типы/короткие хэши**, `dirty/saving/saveAgain` и связанные timing-свидетельства, **не значения личных досок**. Учитывать, что `timerPending` не является достоверным признаком pending timer.
4. Если различается только `/0/updatedAt`, подтвердить порядок фоновой записи и исправлять тестовое ожидание **только при доказанном отсутствии изменения содержимого**; если отличаются `items`, `groups`, `palettes` — расследовать продуктовую потерю данных. Выполнить отрицательный и положительный browser regression после любой правки.

**Владение:** 🟦 CHAT-EXEC — source-backed diagnostics выполнена, E2E заблокирована; 🟦 CHAT-PLAN — прочитать живую запись §60 и назначить доступного оператора; 🟩 SOL — интеграция и решение о релизе только после реальной приёмки. Никаких изменений в `main`, Work, Codex или локальных исправлениях SOL.

## Артефакты

- `cache_save_race_source_gate.js` — новый source-backed Node VM gate (без копирования приватных функций целиком).
- `verification.json` — машинный результат, только публичные хэши/статусы и явные ограничения.
- `README.md` — этот воспроизводимый контракт.
