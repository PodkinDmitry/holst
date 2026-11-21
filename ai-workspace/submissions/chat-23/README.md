# CHAT 23 — Data-loss protection when opening historical board copies (Test 13)

**Status:** patch and source-backed tests validated in isolated copies; **not integrated into SOL's actual checkout, and not browser E2E**. Only `ai-workspace` patch/test/README are intended for publication. Do not publish the Test13 ZIP, full source, assembled HTML or live user data.

## Source, permissions and ownership

- Started from GitHub checkpoint §41 (CHAT22), live `AGENTS.md`, `ai-workspace/protocols/xod-response-format.md` v2.8, `ai-workspace/protocols/xod-autonomous-worker.md` and idle lease. The journal said `SOL_STATE=AWAKE`, `WORK_EXECUTION=COMPLETED`, `NEXT_AGENT=CHAT`; this user explicitly invoked the next CHAT research/patch cycle. GitHub lock owner for this turn: `chat23-history-safety-20261122-high`.
- Local private cleaned Test13 source-only snapshot commit `6429ad61490301e4b942f2190b0be593d449309c`; exact ZIP SHA256: `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`; ZIP CRC checked. Exact unmodified `v224/base29.html` SHA256: `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`.
- Only an isolated copy of that source was changed. **No Work, no `main`, no SOL checkout or personal board manipulation.** SOL retains overall orchestration/integration ownership.

## Actual defect in original openHistory()

The real `openHistory()` function in `v224/base29.html` (original lines 6170–6196) reads a past board snapshot, builds a new board and executes `await Backend.saveBoard(nb); closeXdlg(); S.board=null; loadBoard(nb)` with no check of the old board's unsaved state. It does not reject `Backend.saveBoard` returning `{removed:true}`, and accepts an HTTP error JSON response from Drive as a board with an empty `items` list (`j.board || j`, then `src.items || []`). The version-history dialog permits concurrent clicks, creating multiple copies. These are demonstrable **control-flow faults on authentic source handlers using mocked storage/network**; no user-data loss in real Chrome/Edge was observed or claimed.

## Narrow patch

`history_navigation_guard.patch` changes **one hunk in `v224/base29.html`, only the history-copy handler**:

1. Accept **only** revisions with an `items` array; reject non-OK Drive HTTP responses and broken/missing snapshots rather than silently creating empty copies.
2. Require `canLeaveCurrentBoard()` from CHAT18 and the unchanged original board identity **before** saving the historical copy. It ensures in-flight/failed writes are not silently discarded.
3. Reject `{removed:true}` from `Backend.saveBoard(nb)`.
4. Repeat the guard/board-identity check after the asynchronous copy save and **before** replacing the current board. If newly created user edits cannot be saved, leave the current board open; the new copy is already separately saved and discoverable in the board index. This does not make the operation atomic.
5. Allow only one history-copy request per dialog at a time; restore button state on error, denial or normal completion.

**Dependency:** CHAT18 `canLeaveCurrentBoard()` and CHAT17 for correct virtual-board writeback. Do not combine with SOL modifications except after source reconciliation. No backend, import, sync, undo/history storage, deletion or UI layout code was changed.

## Tests performed

- `node --check history_source_gate.js` — PASS.
- `node history_source_gate.js /EXACT_TEST13/v224/base29.html /PRIVATE_PATCHED/v224/base29.html` — **23/23 PASS**. It executes actual original and patched `openHistory()` code, not a copied mock implementation. **5 original negative controls:** unsafe transition with dirty board, accepting `{removed:true}`, concurrent duplicate writes, navigation after changed current board, and error JSON transformed into blank board. Additional patched cases check preservation on denial, backend failure, non-OK Drive response, malformed revision, read/network failure, mid-flight edit, changed active board, deduplication during reads/writes, error/retry unlock and successful local/cloud history copy. **DOM/Store/Backend/Drive/fetch are synthetic Node VM fixtures**, not IndexedDB or real REST.
- `git apply --check` and application — PASS against exact clean Test13, and **PASS** against Test13+CHAT21+CHAT22 from the previous isolated cycle.
- After applying CHAT23 on the combined Test13+CHAT21+CHAT22 copy, reran **CHAT21 Split 21/21 PASS**, **CHAT22 imports 20/20 PASS**, **CHAT23 history 23/23 PASS**. These are source-backed Node VM suites with synthetic infrastructure, *not browser E2E*.
- `python build.py` from a fresh isolated Test13+CHAT23 source tree — **PASS** (`ok 4983695`); from Test13+CHAT21+CHAT22+CHAT23 — **PASS** (`ok 4988914`). Output bundles remain private.
- Verified the GitHub-provided patch hunk ranges for CHAT16–22 do **not** intersect the original `openHistory()` hunk. This is **only static non-overlap**; a complete CHAT16–23 application/build/test suite was **not performed** in this cycle.
- Only the patch, Node harness and README were scanned for typical credential patterns/user identifiers; no real key or personal path found. This is a limited signature scan, not a substitute for comprehensive secret scanning.

## Reproduce / review

```sh
cd /PRIVATE_EXACT_TEST13_COPY
# Reconcile CHAT17/18 and existing SOL edits before adoption.
git apply --check /PATH/chat-23/history_navigation_guard.patch
git apply /PATH/chat-23/history_navigation_guard.patch
node --check /PATH/chat-23/history_source_gate.js
node /PATH/chat-23/history_source_gate.js /PRIVATE_ORIGINAL_TEST13/v224/base29.html v224/base29.html
python build.py /PRIVATE_EMPTY_BUILD_OUTPUT
```

## Outstanding/next owner

- **SOL:** confirm actual current local HEAD/tree and two prior critical fixes (duplicate sort keys / maximum filter-group depth), reconcile accumulated CHAT patches, run full real Chrome/Edge history browsing, real IndexedDB/Google Drive failure and race tests, recover after reload, verify cached source `Store.get` behavior and check original `tests/app_regression.py:1265` known FAIL. No SOL integration or browser acceptance is inferred from this package.
- **CHAT upon next explicit authorization:** independently inspect other unguarded destructive transitions (e.g. `removeBoardLocally` after remote deletion, demo board, workspace switching) with source-specific semantics. Do not guard global sync/delete code blindly.
- **No user decision or manual file transfer needed** for the published, unintegrated patch.
