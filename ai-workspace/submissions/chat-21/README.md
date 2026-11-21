# CHAT 21 — Split iframe persistence handshake (Test 13)

**Статус:** source-backed patch и автономные Node VM испытания; **НЕ интегрирован** в локальный checkout SOL, **НЕ принят** в Chrome/Edge. Приоритет XOD 3.0 «Фундамент» — сохранность досок. Выполнено обычным CHAT без Work, `main` не изменена.

## Состояние и источник

- Начало: актуальные GitHub `AGENTS.md`, `xod-response-format.md` v2.8, `work-resume-latest.md` §39 и idle `chat-run-lock.json`. Роль SOL: главный оркестратор, Work execution завершён, прямой запрос пользователя назначил CHAT следующую узкую работу.
- Проверен приватный source-only ZIP Test13 `6429ad61490301e4b942f2190b0be593d449309c`: SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`. `v224/base29.html` SHA256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`.
- Не повторялись FSM исправления CHAT20 (опубликованы §39), не изменены внешние механизмы синхронизации/удаления досок.

## Доказанный дефект и граница

Оригинальные `enterSplit`, `exitSplit`, `closePane` из `v224/base29.html` вызваны Node VM с **синтетическим** хранилищем и iframe-подобными посредниками:

1. `exitSplit`: до проверки дочерних редакторов записывает `S.split=null`, очищает контейнер iframe; возможные грязные изменения в iframe уже недоступны.
2. `closePane`: удаление одной панели очищает и **пересоздаёт все** iframe, даже если отказала запись другой панели.
3. `enterSplit`: при `dirty=true` ждёт `saveNow()`, но исключение подавлено самим `saveNow()`, так что обычный редактор скрывается после отказа записи. Переключение layout также может удалить iframe без save handshake.

Это воспроизведение **потенциального логического риска** на настоящих обработчиках Test13, **не доказательство потери личных данных** и не настоящая проверка iframe в браузере.

## Патч и контракт

- `split_iframe_persistence_guard.patch` — unified diff только к `v224/base29.html`, без вложенных приватных исходников.
- В дочернем `?pane=1` добавлена обработка сообщений `split-save` (`prepare`/`cancel`): завершить текстовую правку, вызвать существующий `canLeaveCurrentBoard()` (CHAT18), после подтверждения чистого состояния ответить `split-save-ack`; при отказе/смене доски/drag — `ok=false`. Временная блокировка ввода до отмены с автоматическим снятием через 15 сек защищает окно согласования; reply несёт только `id`, индекс панели, board id и булевый результат, **не данные доски**.
- Родитель обращается **ко всем текущим iframe**, а не только удаляемому. Валидирует `e.source`, nonce, индекс, board id, ответ `ok`, завершение не позже 10 секунд и неизменность layout. При любой ошибке сохраняет Split, LS и iframe; отправляет `cancel` всем pane. В случае подтверждения всех панелей — сначала `Local.loadBoard` (для выхода), потом удаление iframe и переключение. Закрытие панели и перестройка layout защищены тем же протоколом.
- Защищён вход из обычного редактора через `canLeaveCurrentBoard`; запрещены конкурирующие родительские split-операции, а изменение размеров во время handshake не запускается.
- **Зависимость CHAT18 обязательна:** `canLeaveCurrentBoard()` должен существовать и отражать успех сохранения. CHAT17 требуется для корректного writeback виртуальных досок; совместимость с CHAT16–20 подлежит проверке на реальной копии перед интеграцией.

## Фактические проверки

- `split_iframe_source_gate.js`: **21/21 PASS** Node VM, реальные функции/обработчик из original/patched Test13; 3 negative controls на original, отказы/успехи Split, тайм-аут, missing target, concurrent call, source/id/board verification, отмена in-flight и остановка ввода. Вспомогательная моделируемая DOM-среда и запись **не равны** браузерному E2E.
- `node --check split_iframe_source_gate.js` PASS.
- `git apply --check` на точном исходнике Test13 PASS (патч создаёт только изменения в `v224/base29.html`).
- `python build.py /FRESH_EMPTY_DIST` на изолированной изменённой копии Test13 — PASS (`ok 4987356`), создаёт статический `app/index.html` без изменения личных досок.
- Проверка пересечений с CHAT16–20: отдельный пункт; не объявлять фактическую совместную интеграцию без совместной сборки и повторных тестов.

## Применение только к копии Test13

```sh
cd /PRIVATE_TEST13_COPY
# Использовать собственный source и проверить наличие обязательного CHAT18 helper.
grep -n 'async function canLeaveCurrentBoard' v224/base29.html
git apply --check /PATH/chat-21/split_iframe_persistence_guard.patch
git apply /PATH/chat-21/split_iframe_persistence_guard.patch
node --check /PATH/chat-21/split_iframe_source_gate.js
node /PATH/chat-21/split_iframe_source_gate.js /PRIVATE_UNMODIFIED_TEST13/v224/base29.html v224/base29.html
python build.py /NEW_EMPTY_DIST
```

До приёмки в настоящих Chrome/Edge требуется тест с двумя/тремя iframe, ошибкой Local/IndexedDB в одной панели, включённой текстовой правкой, медленной записью, переключением layout, закрытием и `max`, перезапуском и последующим чтением данных. Также остаётся исходный `tests/app_regression.py:1265` FAIL. Не обходить корпоративные/управляемые browser policies. Проверить `beforeunload` во время reset при реальном Chrome/Edge: JavaScript message handshake не гарантирует сохранность от аварийного закрытия вкладки. Ни ZIP Test13, ни full HTML, ни профили/доски/контакты не публиковать.
