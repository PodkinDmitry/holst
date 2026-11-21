# CHAT 15 — проверяемая стабилизация исходного снимка перед cache cleanup (21.11.2026)

**Статус:** подготовлен и независимо проверен **только тестовый патч** для приватной XOD Test 13, очищенный commit `6429ad6`. Product JS **не менялся**. Результат не означает устранение первоначального FAIL в полноценном браузере.

## Реальное доказательство источника конкуренции

В **неизменённых функциях** `scheduleSave(quiet)` и `saveNow()`, извлечённых из приватного `v224/base29.html` через Node VM, воспроизведены задержки сохранения **450/900 мс**. Даже без изменения объектов доски вызов `saveNow()` меняет `S.board.updatedAt = Date.now()`, что **может** изменить строку `JSON.stringify([S.board,S.org,LS.get('pal28')])` между исходным и итоговым снимками. Это подтверждённый **механизм потенциального false-positive** на тесте, **не доказательство**, что именно он вызвал предыдущий FAIL `tests/app_regression.py:1265` в Work.

Из CHAT 14 известно, что изолированный обработчик удаления старого CacheStorage не меняет доску; это не проверка полноценного приложения.

## Изменение

Перед снимком `before_cleanup` вводится тестовый барьер `wait_for_cache_baseline(ev, page.wait_for_timeout)`. Он сравнивает сериализованное состояние до/после окна **1050 мс**, большего максимального debounce 900 мс, и требует `dirty=False`, `saving=False`, `saveAgain=False` **на обеих сторонах окна**. Если фоновые изменения продолжаются — **AssertionError**, данные не игнорируются. По умолчанию максимум 6 интервалов.

После действий «Проверить кэш / Удалить» строгий `assert_cache_state_unchanged` из CHAT 14 остаётся на месте. **Ни `updatedAt`, ни изменения board/org/palette не исключены из сравнения.** Данные и их содержимое не печатаются.

## Файлы

- `cache_baseline_quiescence.py` — дополнительный Python-хелпер (помещать в `tests/` локальной копии XOD).
- `test_cache_baseline_quiescence.py` — 8 самостоятельных негативных и позитивных тестов хелпера.
- `source_save_race_gate.js` — 4 изолированных теста, **читающих настоящее** `v224/base29.html` из локального приватного снимка, без его публикации.
- `app_regression_test13.patch` — **единый** CRLF-preserving patch от **исходного** `tests/app_regression.py` Test 13, включающий диагностический блок CHAT 14 и стабилизирующий барьер CHAT 15. Не применять поверх уже изменённого теста CHAT 14.
- Дополнительно требуется `cache_state_diagnostics.py` из [CHAT 14](../chat-14/cache_state_diagnostics.py).

**Сверка Git:** все четыре файла побайтово соответствуют локально протестированным: git blob `4c4c6f53930069e1dafc6cb87c21314b697d7b33`, `67abb4e850f7cb89fcbb875825114dcf10b2508e`, `ea9f5751cdf8325627d786ca210a4218c3f10b95`, `098f72c4374faafb49e3ce079596d6eb427cb67a` в том же порядке. В том числе **27 CRLF-строк** патча сохранены.

## Проверки и запуск

Фактически выполнено в CHAT, без Work: **8/8** новых Python-тестов, **4/4** теста исходного autosave через Node VM, повторно **12/12** CHAT14 Python и **5/5** CHAT14 Node; суммарно **29/29** unit/isolation. `python -m py_compile` обоих хелперов и инструментированного `app_regression.py` — PASS; `git apply --check`, `git apply`, `cmp` с ожидаемыми байтами на точном Test13 — PASS; `python build.py dist` на неизменённых исходниках — PASS (`ok 4983041`). Процесс тестирования **не запускал Chrome/Edge Playwright**, полная регрессия **OPEN**.

Для локальной копии точного очищенного Test13 (`6429ad6`):

```sh
# В каталоге CHAT15:
python -m unittest -q test_cache_baseline_quiescence.py
node source_save_race_gate.js /PRIVATE_TEST13/v224/base29.html

# На отдельной КОПИИ Test13, прежде чем менять файлы:
cp cache_baseline_quiescence.py /PRIVATE_TEST13/tests/
cp /PATH/CHAT14/cache_state_diagnostics.py /PRIVATE_TEST13/tests/
cd /PRIVATE_TEST13
git apply --check /PATH/CHAT15/app_regression_test13.patch
git apply /PATH/CHAT15/app_regression_test13.patch
python -m py_compile tests/app_regression.py

# Затем в среде с разрешённым Chrome/Edge и localhost:
python build.py dist
python tests/app_regression.py dist/app tests/fixtures/legacy224 tests/fixtures/synthetic-board.json --channel msedge
```

**Важное условие:** если `git apply --check` не проходит, значит тест уже менялся или это не тот источник — **не форсировать**. Не заменять SOL более новый локальный Test13. После получения реального браузерного результата сравнить пути CHAT14: если состояние всё ещё меняется — исследовать причину, **не маркировать 3.0 как принятую**. Если тест стабилен — выполнить все проверки после #30, чтобы получить полный E2E PASS.

**Безопасность:** приватный архив и его 432 файла не публиковались в открытом `holst`. В публичном `ai-workspace` размещены только хелпер, unit-тест, изолированный runner и ограниченный diff теста. Ветка `main` и конфигурация Work не затрагивались.
