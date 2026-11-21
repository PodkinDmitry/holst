# CHAT 22 — guard for board-file / Whimsical / Notion import navigation (Test 13)

**Status:** SOURCE-BACKED PATCH AND NODE-VM TESTS PASSED; **NOT integrated into SOL checkout; NOT accepted in real Chrome/Edge**. No Work or `main` changes. This is a small public patch/test package against a private source-only ZIP, not a public copy of the product.

## Canonical checkpoint and provenance

- Started after GitHub journal §40 / CHAT21; read `AGENTS.md`, canonical response format v2.8, the latest journal and idle lock; captured lease `chat22-source-routes-20261122-high` with optimistic SHA. `SOL_STATE=AWAKE`, `WORK_EXECUTION=COMPLETED`, `NEXT_AGENT=CHAT`; SOL remains chief orchestrator.
- Exact private cleaned Test13 ZIP `6429ad61490301e4b942f2190b0be593d449309c` from the pre-existing private Drive handoff (§30.5–30.6): ZIP SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`. Original `v224/base29.html` SHA256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`; ZIP CRC PASS. No real user boards were read or changed.

## Reproduced defect, priority and scope

Actual original functions `importBoardFile`, `whimImport`, `whimImport2`, and `ntImport` were extracted and executed in Node VM using synthetic board data and controlled asynchronous storage. **4/4 original negative controls** loaded a new/imported board despite an unsaved current board / denied preflight. The original code either calls `await saveNow()` without checking its retained `dirty` state, or performs no save check before replacing `S.board`. Because `saveNow` catches its own storage exceptions in this codebase, `await saveNow()` alone is insufficient.

Additional independent risk: importers use `Backend.saveBoard(b)` but did not reject its `{removed:true}` result. Under XOD storage semantics this is not proof of persistence; the imported board should not be opened as if saved.

These are **proven source-control-flow faults under simulated failures**, not evidence of loss of personal boards in a running Chrome/Edge app.

## Minimal patch

[`import_board_navigation_guard.patch`](./import_board_navigation_guard.patch): 6 narrow hunks in **only** `v224/base29.html`:

1. `importBoardFile`: `canLeaveCurrentBoard()` gate before creating imported records; rejects `{removed:true}` for any imported board; repeats gate after asynchronous saves and before switching. If import records are saved but a new edit happens mid-import, the importer keeps the current board open and informs the user; already saved imported records remain discoverable in the board list.
2. `whimImport` and `whimImport2`: gate before committing and switching (after conversion); refuse an unconfirmed/removed write and do not update `whimsrc` metadata on a rejected extended import.
3. `ntImport`: gate before conversion of Notion pages into a board, recheck after the potentially long conversion, reject `{removed:true}` before changing the opened board. Life OS record import follows its existing independent workflow, and is **not** made atomic by this patch.

**Dependency:** the `canLeaveCurrentBoard()` helper from CHAT18 is required, with CHAT17 for virtual writeback semantics. Apply on an isolated verified Test13 copy; do not replace SOL's current source wholesale. No changes to backends, formats, imports unrelated to board navigation, cloud sync or SOL's duplicate-sort-key / max-filter-depth corrections.

## Tests actually performed

- [`import_board_source_gate.js`](./import_board_source_gate.js): **20/20 Node VM PASS** on genuine extracted source functions: 4 original negative controls, 4 denied-preflight cases, 4 allowed successful imports, 4 `{removed:true}` rejection cases, 2 second-gate failures, backend exception and Whimsical provenance rollback. Harness uses mock `canLeaveCurrentBoard()` and synthetic storage/DOM, *not* an actual Chromium/WebView instance.
- `node --check` harness **PASS**.
- `git apply --check` on exact original Test13 **PASS**. Same test on independently preserved `Test13+CHAT21` local working copy **PASS**. `git apply` on Test13+CHAT21 **PASS**, new 20/20 test set rerun on that combined copy **PASS**.
- `python build.py` on separately changed Test13 **PASS** (`ok 4983945`), and on Test13+CHAT21+CHAT22 **PASS** (`ok 4988260`). Both were built into new empty output directories. These are build passes, not browser E2E.
- Published CHAT16–21 patch hunk ranges were fetched directly from GitHub and **do not overlap** any CHAT22 hunk. This proves only static range separation. **Full runtime tests of combined CHAT16–22 did not run**, and we do not claim SOL checkout integration.
- Only this patch, test and README may be published; all large private HTML, ZIP, assembled HTML/ZIP, user boards, browser profiles and credentials must stay private. Patch/test underwent a simple secret/path signature scan; absence of matches is not an exhaustive secrecy proof.

## Handoff / limitations

```sh
cd /PRIVATE_CLEAN_TEST13_COPY
# First ensure CHAT17 + CHAT18, and any needed CHAT16/19/20/21 patches have been reconciled against fresh SOL code.
git apply --check /PATH/chat-22/import_board_navigation_guard.patch
git apply /PATH/chat-22/import_board_navigation_guard.patch
node --check /PATH/chat-22/import_board_source_gate.js
node /PATH/chat-22/import_board_source_gate.js /UNCHANGED_TEST13/v224/base29.html v224/base29.html
python build.py /EMPTY_DIST
```

Browser verification still required: Chrome/Edge with real IndexedDB/Drive failure, in-flight writes and slow imports (including back navigation while import is in progress); check imported board recovery after restart, Whimsical updates, Notion pages and ownership, and the prior `tests/app_regression.py:1265` failure. Do not bypass managed browser policy. Other unprotected paths (history copy, team space creation/moves, remote deletion) remain separate risks requiring their own source-specific contracts; do not add a global `loadBoard` guard blindly.

**Proposed next owner:** SOL for code reconciliation, browser regression/E2E and acceptance; CHAT on a separately authorized next run for an independent unresolved data-preservation route. No cross-chat handoff is inferred merely from GitHub publication.
