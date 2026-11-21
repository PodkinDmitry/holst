# CHAT26 — preserve edited demo boards across application upgrades

**State:** isolated Test13 source-backed patch and Node VM tests; **not integrated into SOL's live checkout**. No real Chrome/Edge, IndexedDB or Google Drive E2E verification. No changes to `main` or Work.

## Provenance and exact scope

- Baseline: privately delivered cleaned Test13 source-only ZIP, provenance `6429ad61490301e4b942f2190b0be593d449309c`; ZIP SHA-256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`, CRC check PASS.
- Original `v224/base29.html` SHA-256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`.
- **Only one actual function modified:** `demoBoard()` around original lines 14101–14160, plus a local `demoBoardBusy` flag; patch consists of **two unified-diff hunks** in `v224/base29.html`. No source HTML or real user board is part of this package.
- **Integration dependencies:** CHAT18 `canLeaveCurrentBoard()` must be available; CHAT17 virtual-board writeback semantics must also be present. This patch does not duplicate them. No original hunk overlap was found with CHAT16–25, based on all published patch blobs reread directly from GitHub.

## Source-backed defect, with deliberately negative original controls

The real Test13 `demoBoard()` first executes `if (S.board && dirty) await saveNow()` without checking whether save actually succeeded; `saveNow()` can swallow persistence failures. Then it generates a new demo with the fixed ID `demo24`, overwriting any **existing user-edited demo board** if `LS.demov !== APP_VERSION`. The real function replaces `S.board` after `Backend.saveBoard()` without handling `{removed:true}`, concurrent user navigation, late edits or duplicate invocations.

**6/6 original negative controls** demonstrate these control-flow failures with the authentic extracted source function and synthetic backend: user-edited demo overwrite on upgrade; failed current save; removed destination; late navigation during legacy load; concurrent writes; edits during pending save. No assertion of observed loss in a real user browser is made.

## Mitigation

- Use CHAT18's `canLeaveCurrentBoard()` **before** loading or generating demo; `finishEdit()` is called first.
- Reuse an existing demo only when its ID (from `LS.demobid`, with `demo24` fallback for legacy installs) and app version match. On version change, call `newBoard()` to allocate a fresh, independent board ID; **never hardcode the old editable `demo24` identifier for generated content**.
- Require successful `Backend.saveBoard()` without `removed:true`; leave existing board and version pointer unchanged on storage error.
- Before replacing the current board, verify original board identity, save flags and `updatedAt` captured after the first preflight; late changes keep the original visible. A newly generated demo may already have been stored in that case but is not opened and is not automatically rolled back.
- A local `demoBoardBusy` flag prevents two overlapping opens within one app window and clears on both failure and success. It is not a cross-tab lock.
- Set `LS.demobid` and `LS.demov` only after an actual successful switch to the newly saved demo. Existing legacy demo boards remain accessible from the normal board list.

**Residual risks:** this is not a storage transaction; a late edit after storage commit can leave a separate demo board without advancing the local pointer. Real backend save semantics, multi-window ID collisions, Google Drive behavior, save timer activity and browser lifecycle are untested. The existing post-load demo matrix is still populated through the original `changed()` workflow and awaits its normal autosave; this patch does not make matrix persistence atomic. An `updatedAt` check does not guarantee detection of every possible in-memory mutation.

## Actually executed checks

| Check | Result | Boundaries |
| --- | --- | --- |
| Original source SHA-256 + ZIP CRC | PASS | Private source, never published |
| `demo_board_source_gate.js` | **25/25 PASS** = 6 deliberately unsafe original controls + 19 patched scenarios | Actual extracted full `demoBoard()`; synthetic Backend, `S`, LS, DOM, timing, `canLeaveCurrentBoard()` |
| `node --check` | PASS | Harness syntax |
| `git apply --check` on exact Test13 | PASS | No modification of baseline |
| Apply to Test13+CHAT19/CHAT21–25 | PASS | One separate isolated private source copy |
| Standalone `python build.py` | PASS: `ok 4983041` | Test13+CHAT26 only; runtime dependencies not integrated here |
| Combined `python build.py` | PASS: `ok 4992874` | Test13+CHAT19+CHAT21–26; no actual app browser execution |
| Rerun source-backed Node VM suites on combined copy | **150/150 PASS**: CHAT21 21, CHAT22 20, CHAT23 23, CHAT24 26, CHAT25 35, CHAT26 25 | Synthetic mocks, not an integrated browser E2E |
| Read current GitHub patches CHAT16–25 and compare original hunk ranges | No overlap in demo function | **Not** complete CHAT16–26 composition: CHAT16–18/20 were not actually applied in combined source |
| Public file obvious secret/email/path pattern scan | 0 findings | Heuristic scan; not a proof of absence of all secrets |

## Reproduce in a private scratch copy

```bash
node --check demo_board_source_gate.js
node demo_board_source_gate.js /PRIVATE/Test13/v224/base29.html /PRIVATE/Test13-CHAT26/v224/base29.html
git apply --check demo_board_persistence_guard.patch
# Apply to disposable, source-hash-verified Test13, never to an unreviewed SOL checkout:
git apply demo_board_persistence_guard.patch
python build.py /PRIVATE/empty-build-output
```

Only publish this unified diff, harness and README. Keep the original source-only ZIP, full compiled app, user boards and credentials private.

**Next owner:** 🟩 SOL to reconcile the real checkout, preserve duplicate-sort-key and filter-depth fixes, then run Chrome/Edge/IndexedDB tests and full regression (including existing `tests/app_regression.py:1265` failure). 🟦 CHAT can independently investigate a different source-backed data-safety route on a new direct request. The published result is **prepared and verified**, not accepted or integrated by SOL.
