# CHAT27 — safe restoration from board/object Trash on exact XOD Test13

**Status:** source-backed isolation patch and regression harness **published for review only**. Not applied to SOL's real checkout; no Chrome/Edge/IndexedDB/Drive user-data acceptance or real browser E2E has been performed. `main` and Work are unchanged.

## Provenance and exact scope

- Private cleaned Test13 source-only archive: commit `6429ad61490301e4b942f2190b0be593d449309c` (historical local SHA `542ddd0`). Archive SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`; ZIP CRC PASS.
- Original exact `v224/base29.html` SHA256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`. This private original is an input to the harness, **not uploaded** here.
- Only `v224/base29.html` is modified, in **one unified diff hunk** around `trashRestore()` (original lines ≈12832–12853). No data model, Store schema, backend APIs, object-delete handlers, or remote sync changes.
- **Required dependency:** CHAT18 `canLeaveCurrentBoard()` (and CHAT17 for correct virtual-board persistence). A standalone build on bare Test13 succeeds structurally but the patched *active-object recovery path* must not be used before CHAT18 is present. CHAT25 changes the **preceding** `deleteBoardWithTrash300` helper; the new diff uses only one line of context and was confirmed to apply both to clean original Test13 and after CHAT19/21–26 without overwriting CHAT25.

## Proven defects, demonstrated by original source in Node VM

The original `trashRestore()` removes the sole Trash record regardless of save acknowledgement and also provides a wrong-board fallback. The published harness executes the real original function extracted from exact private Test13 HTML against controllable synthetic storage.

Six original **negative controls** actually reproduced:
1. Restoring a board with `Backend.saveBoard()` returning `{removed:true}` deletes the Trash record although no board was stored.
2. Restoring objects to an inactive board with a `{removed:true}` acknowledgement likewise consumes the Trash record.
3. Restoring objects into the active board consumes Trash immediately after `changed()`, *before* successful autosave; a failure leaves no recovery copy.
4. If the original board is missing, deleted objects are inserted into a different currently opened board rather than staying in Trash.
5. Two concurrent restore clicks can create two copies of the same deleted board.
6. An unsuccessful `Store.del()` is ignored and its Trash index entry removed, stranding an otherwise still-present backup.

These demonstrate **code-path defects under simulated failures**. They do **not** prove observed loss in any real user's browser.

## Minimal mitigation

- Serializes `trashRestore` calls with a local `trashRestoreBusy` flag and `try/finally`. No cross-tab lock is claimed.
- Validates board/object snapshot shape. For an existing board-ID collision, clones the Trash payload and allocates an independent `b...` board identifier without mutating the stored Trash payload.
- Requires successful `Backend.saveBoard()` without `{removed:true}` before consuming board or inactive-object Trash. On failure, leaves the original Trash record and original in-memory board intact.
- An object restore targets only its **original board**. When that board is unavailable, it refuses the restore instead of using whichever unrelated board is open. Nonactive destination is cloned before save so failed writes do not alter the preexisting in-memory instance.
- Restoring objects into the active board uses the existing `changed()`/autosave path, then awaits CHAT18 `canLeaveCurrentBoard()` before clearing its backup. A per-entry transient `trashRestorePending` map lets a retry flush already-inserted objects without duplicating them in the same live board. Active virtual boards are refused.
- `Store.del()` failures no longer remove the corresponding index entry, so a recovery copy is not made undiscoverable by a failed cleanup operation.

### Known limitations

- Trash restoration remains **non-transactional** across board save, Trash data deletion and index update. A failed Trash deletion can leave a duplicate restored board on later retry; this is a duplication risk, not the original irrecoverable-loss defect. Cross-tab writes/changes are not protected.
- The in-memory retry map does not persist across reloads or board switches. An unsaved active-board restore might be repeated after reopen; the backup stays available. A late user edit during an asynchronous backend save still depends on existing app autosave and concurrency semantics.
- The original `trashItems()` object-deletion path itself starts `trashPut()` without awaiting successful Trash persistence. This is **another independent open risk**, not silently fixed here. Likewise `trashDrop()` permanent Trash deletion and auto-cleanup retain their original contracts.
- A system that acknowledges a write before making it truly durable cannot be made transactional by checking a return value; real storage/Crash testing is required.

## Reproduction and actual checks

In a private local directory containing unmodified exact Test13:

```bash
node --check ai-workspace/submissions/chat-27/trash_restore_source_gate.js
node ai-workspace/submissions/chat-27/trash_restore_source_gate.js ORIGINAL/v224/base29.html PATCHED/v224/base29.html
(cd ORIGINAL && git apply --check /path/to/trash_restore_persistence_guard.patch)
(cd COMBINED_WITH_CHAT19_AND_CHAT21_TO_26 && git apply --check /path/to/trash_restore_persistence_guard.patch)
python build.py /an/empty/build/directory
```

- **30/30 Node VM PASS**: 6 source-backed original negative controls + 24 corrected scenarios. Dependencies (Store, Backend, DOM, CH18 guard) deliberately synthetic.
- `node --check` on the public harness PASS.
- `git apply --check` on exact original source PASS; `git apply --check` and actual apply on copy of Test13+CHAT19+CHAT21–26 PASS; reverse-check on applied copy PASS. Diff uses 1 context line because CHAT25 modified the adjacent helper; earlier 3-line-context patch failed on the combined copy and **was not published**.
- `python build.py` clean Test13+CHAT27 isolated build PASS `ok 4985528`; combined Test13+CHAT19+CHAT21–27 build PASS `ok 4995361` (fresh output directories). Output bundles not published.
- **180/180 Node VM PASS** on one combined source: CHAT21 21/21, CHAT22 20/20, CHAT23 23/23, CHAT24 26/26, CHAT25 35/35, CHAT26 25/25, CHAT27 30/30. This is still synthetic function-level testing, **not browser E2E or SOL acceptance**.
- Live GitHub blobs CHAT16–26 inspected for source hunk conflicts. CHAT25 has adjacent diff context around original line 12832, **but no shared edited `trashRestore()` statements**. Other CHAT16–24/26 source hunks do not intersect; combined application with CHAT16–18/20 and tests of those packages **was not performed**. Actual SOL's two fixes (duplicate sort keys; maximum filter-group depth) were not available for reconciliation.

## Safe publication and owners

Only this scoped diff, the executable harness and this README belong in the public `ai-workspace/submissions/chat-27/`. No private Test13 archive, original/synthesized full HTML, build bundle, board, profile, token, user keys, or backup is part of the package. A simple secrets/email/path signature scan of the three public files found no positive hits; this is only an indicator, not exhaustive assurance.

**Next owner:** 🟩 SOL for source reconciliation, preserving SOL's two independent local fixes, browser storage/Crash acceptance, original regression at `tests/app_regression.py:1265`, and deciding on integration. 🟦 CHAT on a *separate user-authorized follow-up* for the unawaited `trashItems()` deletion backup risk. **Current status:** prepared/published/tested independently, **not** integrated or browser-verified.
