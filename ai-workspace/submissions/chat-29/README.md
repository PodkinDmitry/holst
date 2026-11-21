# CHAT29 — safe matrix row/column deletion on exact XOD Test13

**Status:** independently reproducible source-backed **candidate patch** with synthetic Node VM checks. **Not integrated into SOL's actual local checkout; no Chrome/Edge/IndexedDB/Drive browser E2E.** No Work and no `main` changes.

## Provenance and defect

- Baseline: cleaned private Test13 source-only commit `6429ad61490301e4b942f2190b0be593d449309c`; ZIP SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`, 449 ZIP entries and CRC PASS; exact `v224/base29.html` SHA256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`.
- Source: genuine `mxRemoveTrack(F,kind,id)` at approximately `base29.html:8051–8061` and the synchronous keyboard/selection router `mxDeleteSelTrack()` at approximately 8244. Existing CHAT28 protects regular `deleteSel → trashItems → trashPut`, but **matrix rows/columns** divert through `mxDeleteSelTrack → mxRemoveTrack` and are removed without creating a Trash copy. Their constituent cells, nested objects and connectors are destroyed. Undo history alone is not a durable backup. The original also blindly does `arr.splice(-1,1)` when the requested track ID no longer exists; and a delayed confirmation can act on a different active board.
- **6/6 negative controls** executed the actual original Test13 `mxRemoveTrack` in Node VM with synthetic dependencies: unbacked row removal, stale-id splicing an unrelated row, no Trash call even if backup storage fails, removal of same-ID objects from a different active board after asynchronous confirmation, double-confirmation removal of two tracks, and disappearance of nested content/connectors with no backup.

## Minimal patch

`matrix_track_backup_before_delete.patch` changes **only one source function** and adds its adjacent in-runtime mutex in `v224/base29.html`; existing track/selection routers, `deleteSel`, Drive, team sync, backend and Trash restore functions remain untouched.

1. Reject stale IDs, foreign frames and invalid kinds **before** any mutation; preserve the existing prohibition on deleting the last row/column.
2. Serialize concurrent track removals with `mxRemoveTrackBusy`, keeping existing async confirmation behavior. Take the full board snapshot and verify that the source board, matrix metadata, selection and items have not changed during confirmation and backup.
3. **Before** `pushHist`, item deletion or `arr.splice`, `await trashPut({kind:'board',...}, {board:clone(board),bm:clone(bmOf(board.id))})`. Backup as a **whole board**, not only removed cells, because restoration of matrix row/column IDs, layout and metadata requires the original matrix frame. Existing `trashRestore` from CHAT27 can restore the board as a separate board, rather than attempt to reconstruct one track in place.
4. Abort without destructive mutation if durable Trash write/readback fails, active board changed or selection/content became stale. A successfully written but unused backup may remain in Trash after an abort. After successful backup, remove the intended track and associated cells/connectors and call existing `changed()`.

**Strict dependencies:** CHAT28's `trashPut` checks persistent Store mode, awaits payload write, re-reads payload and re-reads Trash index. Using this patch with **original unpatched `trashPut` is NOT a validated safety solution**. For full tested behavior, CHAT27 supplies guarded Trash restore. CHAT17/18 remain dependencies of other packages, not integrated into these isolated builds. No patch may overwrite SOL's own duplicate-sort-key and maximum-filter-depth changes.

## Exact verification performed

- `node --check matrix_track_source_gate.js` PASS. `node matrix_track_source_gate.js ORIGINAL_BASE29 PATCHED_BASE29` **36/36 PASS**: six original negative controls and 30 patched scenarios on actual extracted `mxRemoveTrack`, `mxDeleteSelTrack`, and `trashPut` bodies; everything else (Store, LS, UI, board, selection and timing) is synthetic. **Not browser E2E.**
- `git apply --check`, actual `git apply`, and `git apply --reverse --check` PASS with the exact Test13 source and the patch. The same three checks PASS against a separate Test13+CHAT19+CHAT21–28 private source copy from the prior checkpoint. The original ZIP and source were not overwritten.
- Standalone-dependency build: Test13 + CHAT28 + CHAT29 `python build.py` **PASS `ok 4986552`**; combined build Test13 + CHAT19 + CHAT21–29 **PASS `ok 4998872`**, distinct empty output folders, output not published.
- On **one** private combined Test13+CHAT19+CHAT21–29 source copy, reran original public Node harnesses: CHAT21 **21/21**, CHAT22 **20/20**, CHAT23 **23/23**, CHAT24 **26/26**, CHAT25 **35/35**, CHAT26 **25/25**, CHAT27 **30/30**, CHAT28 **33/33**, CHAT29 **36/36** = **249/249 PASS**. These are independently isolated tests against extracted functions, not an actual integrated browser runtime. CHAT25 was run against its required CHAT19 baseline.
- Re-fetched all 13 published CHAT16–28 patch blobs from GitHub. **No original hunk overlaps** the new `mxRemoveTrack` range, and local CHAT21–28 patch `git hash-object` values match GitHub blob IDs. CHAT16–18 and CHAT20 are not incorporated into the combined source build, and their harnesses were not run.

## Security and remaining risks

Only three public UTF-8 text files are included: patch, test harness and this README. Do **not** publish the private Test13 ZIP, full source HTML, built app/extension bundles, real board data, user profiles or credentials. An obvious-secret pattern scan is an aid, not proof of absence.

- Full-board backup duplicates potentially large boards/assets; validate quota, latency and UI responsiveness using real large matrix boards. If persistence is unavailable, the action fails closed: an export/recovery flow is a future UX consideration.
- `Store.get` readback is not a crash/fsync durability guarantee, and payload/index/board mutations are not transactional. Mutex is per JavaScript runtime, not cross-tab; board-state serialization is a best-effort race detector, not a cross-tab CAS. Existing `trashPut` may leave orphaned payload or a backup after aborted deletion.
- Keyboard/selection dispatch invokes the async deletion without awaiting it; the effective destructive action is delayed. Real toolbar, focus and keyboard event tests remain open.
- Nearby matrix operations `mxSpan` and `mxDropFrame` may remove **empty cells** without Trash; independently inspect those paths for any unintended content loss before modifying. This package intentionally addresses only `mxRemoveTrack`.
- Known integration gates: actual SOL checkout reconciliation, SOL's two private fixes, real Chrome/Edge/IndexedDB/Drive/multitab/crash recovery, original `tests/app_regression.py:1265` FAIL, and a complete CHAT16–29 combined product test. No claim of these gates passing is made.

**Owner of next step:** 🟩 SOL for actual source reconciliation and browser acceptance; 🟦 CHAT for a new independent risk on a fresh direct assignment. No extra user input required for this isolated candidate.
