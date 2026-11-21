# CHAT28 — confirmed Trash backup before object deletion (Test13)

**Status:** source-backed candidate, isolated Node VM/tests and two private builds passed. **Not integrated into SOL's checkout. No Chrome/Edge E2E.** Work and `main` unchanged.

## Source and problem

- Base: private cleaned source-only **Test13** commit `6429ad61490301e4b942f2190b0be593d449309c` (original local commit `542ddd0`). Archive SHA256: `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4` (ZIP CRC PASS). Original `v224/base29.html` SHA256: `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`.
- Original `deleteSel` at approximately `v224/base29.html:4554–4573` calls synchronous `trashItems()` but does **not** wait for its promise, and removes objects and modifies pins and Undo immediately. `trashItems` at ~12812 fires and forgets `trashPut()`, which catches Store.set failures; `trashPut` uses `LS.set`, which silently catches failures. Hence storage/Trash index failure does not stop the destructive action. A related Store panel `delfile` action at ~12912 similarly fires `trashItems` without awaiting it for non-active boards while temporarily modifying `S.board`.
- Six negative controls executed the **actual extracted original functions** under synthetic storage, demonstrating unsafe control flow: failed Store write; silently failed Trash index; memory-only storage; deletion before pending write completes; no success return from `trashItems`; no postwrite payload readback. **No actual user data loss in a browser was demonstrated.**

## Proposed narrow patch

`trash_items_backup_first.patch`: five hunks, **only** `v224/base29.html`:

1. `deleteSel` becomes `async` and prevents concurrent deletion with a local mutex. It retains the old `mxDeleteSelTrack` special branch. It calculates the existing frame/connector deletion set, finishes editing, snapshots the items and selected IDs, then **awaits** `trashItems` before touching Undo, pins, selected objects, active object or `changed()`. A failed copy or a changed board/selection aborts without destructive mutation; success preserves previous removal semantics. Call sites keep invoking `deleteSel()` without awaiting it, as their event dispatch expects synchronous returns; deletion completes asynchronously, only after the backup check.
2. `trashPut` refuses `Store.mode === 'mem'` because a memory-only Trash cannot survive a reload. It checks both the completed `Store.set` with `Store.get` readback and `trashIdx()` readback after `trashSaveIdx()`, reporting `false` on failures. `LS.set` exceptions alone cannot be relied on because they are caught internally. A failed index may leave an orphan payload; it must not remove objects.
3. `trashItems(list, board = S.board)` becomes async and returns `true` only after `trashPut` has confirmed the backup. Explicit `board` avoids temporary global `S.board` reassignment.
4. Non-active Store panel `delfile` now awaits `trashItems(list, b)` before saving a clone of the modified board, checks `{removed:true}`, and avoids writing if that board became active during the backup. The **active-board** branch keeps calling `deleteSel()`; its asynchronous deletion is handled by the new guard.

**Dependency/reconciliation:** designed for exact source Test13, and actually applied/tested after the **CHAT19 + CHAT21–27** isolated set. CHAT18's `canLeaveCurrentBoard` and CHAT17's virtual writeback behavior are used by some of those earlier packages; the new patch does not implement those helpers. No unreviewed change to Team, Drive sync, Trash restore, or SOL's two local fixes.

## Verification commands

With both exact original and patched private `v224/base29.html` in separate directories:

```bash
node --check trash_items_source_gate.js
node trash_items_source_gate.js ORIGINAL/v224/base29.html PATCHED/v224/base29.html
cd ORIGINAL && git apply --check /path/to/trash_items_backup_first.patch
cd PATCHED_SOURCE && python build.py /path/to/new-empty-output
```

**Observed** on the actual exact archive, separate working copies:

- `33/33 PASS` `trash_items_source_gate.js`: 6 negative controls on genuine original `deleteSel`, `trashItems`, `trashPut`; 27 patched checks on those actual extracted functions (Store.set/get failures; silent LS index failures; memory-only Store; waits; duplicate calls; board/selection/in-place content changes while writing; frame-linked connectors; pin detachment; asset snapshot; metadata; retry; Store panel source presence). Store, LS, Backend, DOM, UI, frame, Undo, time and navigation are synthetic. The Store panel branch has **static verification only**, not a runtime UI test.
- `git apply --check` PASS for exact original Test13. `git apply --check`, actual application and reverse-check PASS for private isolated **Test13 + CHAT19 + CHAT21–27**; prior version's full source was not published.
- `python build.py` PASS from isolated Test13+CHAT28: output `ok 4984692`. PASS from isolated Test13+CHAT19+CHAT21–28: output `ok 4997012`. Private HTML and ZIP builds were **not published**.
- On the same combined private copy the **seven real earlier Node harnesses** passed: CHAT21 `21/21`, CHAT22 `20/20`, CHAT23 `23/23`, CHAT24 `26/26`, CHAT25 `35/35` (with required CHAT19 base), CHAT26 `25/25`, CHAT27 `30/30`. Along with CHAT28 `33/33` this gives **213/213** isolated VM checks. No real-browser, IndexedDB, multi-tab or Drive E2E.
- Earlier CHAT16–18/20 compatibility: the new hunk positions are non-overlapping on original source, but these packages were not merged or executed in this combined private copy. This is **not** a claim of full CHAT16–28 integration.

## Security and residual risks

Only this textual `.patch`, this `.js` harness and this `README.md` are intended for public `ai-workspace/submissions/chat-28/`. No full `base29.html`, private ZIP, board data, profiles, secrets, completed app/extension ZIP, or assembled HTML. Static secret-pattern screening is advisory; publication should still be SHA-verified.

- Async UI usage means a click can finish before deletion; the board and selection are checked before final commit, but other UI actions could observe the pending operation. The mutex is **per JS runtime only**: no cross-tab CAS and no transactional guarantee across Trash payload/index/board write.
- Checking a completed `Store.get` and index readback is stronger than fire-and-forget; it does **not** prove crash durability or disk fsync. A memory-only Store is deliberately refused; the UI should offer export.
- Backup may remain in Trash on abort if user edited/switched board in the meantime. Unused assets are not removed by this patch.
- Matrix track deletion (`mxDeleteSelTrack`) is a separate existing branch which this patch does not route through Trash.
- The Store panel active-board `delfile` branch invokes the new async `deleteSel`, but its subsequent `storeScan/draw` may complete before deletion finishes; the backend and browser flow needs acceptance work.
- Existing known `tests/app_regression.py:1265` failure remains open, as do full real SOL source reconciliation, browser Chrome/Edge, IndexedDB/Drive/crash recovery, SOL duplicate-sort-key/max-depth fixes and release acceptance.

**Next owner:** 🟩 SOL decides reconciliation/integration after actual browser checks; 🟦 CHAT can address a distinct remaining loss path after a new direct assignment. No user input needed for this isolated candidate.
