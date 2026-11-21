# CHAT 14 — диагностика FAIL при очистке CacheStorage в XOD Test 13

**Статус:** самостоятельная диагностика и проверенный патч **к тесту**, не исправление продукта и не полная браузерная приёмка. Исходная версия — приватный очищенный Test 13 `6429ad6`; продуктовый JS не менялся.

## Обнаружено

- В `tests/app_regression.py:1265` один `assert` сравнивает сериализованные `S.board`, `S.org`, `LS.get('pal28')`, но не показывает изменившиеся поля.
- Из настоящего исходника `v224/base29.html` следует: `saveNow()` безусловно выполняет `b.updatedAt = Date.now()`; в интервале асинхронного клика по кэшу может завершиться ранее запланированное сохранение. Это **правдоподобное объяснение**, но **не доказанная причина** реального FAIL.
- Изолированный запуск неизменённого `healthPanel300()` в Node VM показал, что он удаляет только старый CacheStorage (`holst-v34`), оставляет `holst-v36`/`other-app` и не меняет синтетическую доску, органайзер и палитру. Эта проверка не заменяет браузерный XOD.
- `tests/app_regression.py` использует **CRLF**. Патч собран с сохранением CRLF и реально прошёл `git apply --check`, `git apply` и побайтовое сравнение результата с подготовленным файлом.

## Состав

- `cache_state_diagnostics.py` — строгое сравнение до/после с ограниченным списком изменённых JSON Pointer paths, типами и короткими SHA-256 вместо содержимого доски. Даже изменение только `updatedAt` или порядка сериализации **по-прежнему даёт FAIL**. Дополнительно фиксирует `dirty/saving/saveAgain/timerPending/updatedAt` до/после.
- `test_cache_state_diagnostics.py` — **12/12 PASS**, включая удаление/добавление, типы, приватность диагностических сообщений, Unicode/экранирование и ограничение количества изменений.
- `cache_cleanup_isolation_gate.js` — **5/5 PASS**. Использует `node:vm` и читает `v224/m_health300.js` **локально** из приватного Test 13; сам файл продукта не загружается в публичный GitHub.
- `app_regression.patch` — минимальный CRLF-aware unified diff только для `tests/app_regression.py`; `assert` не отключён. Для работы теста также нужен `cache_state_diagnostics.py` рядом с `tests/app_regression.py`.

## Воспроизведение из чистого Test 13

```sh
python -m unittest -v test_cache_state_diagnostics.py
node cache_cleanup_isolation_gate.js /PRIVATE_TEST13/v224/m_health300.js
# Перед применением: копия Test 13, без пользовательских данных!
cp cache_state_diagnostics.py /PRIVATE_TEST13/tests/cache_state_diagnostics.py
(cd /PRIVATE_TEST13 && git apply --check /PATH/CHAT14/app_regression.patch)
(cd /PRIVATE_TEST13 && git apply /PATH/CHAT14/app_regression.patch)
python -m py_compile /PRIVATE_TEST13/tests/app_regression.py
# В Playwright/Chrome/Edge исполнителе, где разрешён localhost:
python /PRIVATE_TEST13/tests/app_regression.py /PRIVATE_TEST13/dist/app /PRIVATE_TEST13/tests/fixtures/legacy224 /PRIVATE_TEST13/tests/fixtures/synthetic-board.json --channel msedge
```

На этом CHAT фактически выполнено: **12/12 Python unit + 5/5 Node isolation + синтаксис диагностически модифицированного теста + `python build.py dist` PASS**. `app_regression.py` в полноценном Chromium/Edge **не запускался**: здесь Chromium заблокирован администраторской политикой. FAIL `1265` **пока не локализован**; считать его исправленным нельзя. Патч и программа отлаживаются на синтетических данных; реальные пользовательские файлы не используются.

## Следующая автоматическая развилка

1. Запустить пропатченный тест один раз в разрешённом браузере и получить список изменённых JSON-путей. **Не просить пользователя вручную читать сырые данные.**
2. Если меняется только `/0/updatedAt` и диагностика указывает на фоновое сохранение — подтвердить порядок событий и при необходимости синхронизировать исходную точку снимка. Сохранить строгую проверку после стабилизации.
3. Если отличаются `items`, `groups`, `palettes` или другие содержательные поля — исследовать реальную потерю данных, исправить продукт и повторить полную регрессию, включая проверки **после** шага 30.
4. Перед интеграцией сверить SHA текущего Test 13 у SOL; не перезаписывать более новую сборку. Публичный `main` не изменять.