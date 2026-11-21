# CHAT30 — safe matrix cell merging and frame drop on exact XOD Test13

**Status:** independent, source-backed **candidate** with synthetic Node VM tests and two isolated builds. **Not integrated into SOL's real local checkout. No Chrome/Edge, IndexedDB, Google Drive, multitab or browser E2E acceptance.** Work and `main` were not used.

## Exact source and scope

- Private cleaned Test13 source-only ZIP commit `6429ad61490301e4b942f2190b0be593d449309c`. Verified original ZIP SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4` (449 entries; CRC OK). Original `v224/base29.html` SHA256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`.
- The one source patch modifies **only `v224/base29.html`** around `mxSpan()` (~8095) and `mxDropFrame()` (~8142); adds a shared `mxAutoBlankCell()` predicate and one per-runtime `mxSpanBusy` mutex. Three small unified diff hunks. Original Test13 and SOL checkout remain unchanged.
- No changes to backends, Drive sync, manual board deletion, bulk deletion or matrix track removal from CHAT29.

## Reproduced unsafe original branches

**8/8 negative controls** execute the genuine *original* Test13 functions in a Node VM with synthetic board/layout/storage/drag objects:

1. `mxSpan` deletes an adjacent matrix cell despite its user-defined properties, because its only emptiness check counts nested objects.
2. `mxSpan` destroys an unconfigured placeholder ID without even attempting durable Trash backup.
3. A stale/invalid anchor column can produce `NaN` cell-span metadata.
4. An existing merged cell anchored outside the target may overlap a newly expanded span because only its anchor is compared.
5. `mxDropFrame` deletes a styled/properties-bearing cell as if it were empty.
6. `mxDropFrame` deletes an empty cell still referenced by a connector.
7. A drop onto the interior of an existing merged cell can delete the whole merged occupant.
8. A named cell is overwritten on drop despite its user title.

These are **source control-flow reproductions**, not evidence of real user data loss in an actual browser.

## Patch behavior and exact dependencies

- `mxAutoBlankCell` only considers an unstyled, unnamed, unlinked, unmerged, unused generated matrix placeholder replaceable. It rejects custom fields, a nonwhite fill, nested geometry, connectors and pins pointing to it. During a frame drop, currently dragged items are excluded from the occupancy test, so the normal empty-placeholder flow still works if the dragged frame is already inside the target bounds. Other unknown external referencing systems have **not** been audited.
- `mxSpan` rejects missing/foreign cells, stale matrix track IDs, malformed increments and overlapping or edited neighboring cells. If an expansion would delete genuine pristine placeholders, it **awaits** a **whole-board** Trash snapshot, including matrix tracks, original cell IDs, assets and board metadata, **before** changing history, items or span dimensions. If backup fails, storage is memory-only, selected objects change, or the source board changes during the wait, it aborts destructive changes. A failed late check may leave an extra unconsumed Trash snapshot. Shrinking a span, which regenerates cells, does not require a destructive backup. A late post-commit rendering exception is reported as a partial update rather than falsely claiming the operation was undone.
- `mxDropFrame` remains synchronous so the existing pointer-up control-flow is preserved. It can replace **only a truly pristine generated placeholder**. Any styling, title, extra fields, attached contents, connector/pin reference or merged occupant refuses replacement and retains the original frame; this deliberately favors data integrity over completing an ambiguous drop. Pristine placeholder IDs can still disappear; externally stored references to these IDs were not validated.
- **Mandatory dependency:** CHAT28's published `trashPut()` implementation must be present for a meaningful durability gate: it rejects memory-only storage, awaits the payload write, reads it back and confirms Trash index persistence. The patch can apply/build on bare Test13, but **is not a validated safety repair without CHAT28**. CHAT27's `trashRestore` is required for the tested guarded full-board restore path; CHAT29's matrix-track patch is independent but uses CHAT28. CHAT17/18 are dependencies of other published routes. Never overwrite SOL's separate duplicate-sort-key and max-filter-depth fixes.
- `mxSpan` now returns a Promise. Its existing `mxSpanPop` click handler does not await it; the destructive mutation is delayed until backup confirmation. Real UI state, popover behavior, keyboard/mouse ordering and autosave need browser acceptance.

## Exact tests performed

- `node --check matrix_span_drop_source_gate.js` **PASS**. `node matrix_span_drop_source_gate.js ORIGINAL_BASE29 PATCHED_BASE29` **46/46 PASS**: 8 original negative controls plus 38 patched-path scenarios. The harness runs source-extracted **real functions** `mxSpan`, `mxDropFrame`, `mxSlotAt`, `mxOccupant`, `mxAutoBlankCell`, `withFrameContents`, `mxNewCell`, `mxInsertCells`, `mxRaise`, `mxShift`, and `trashPut`; environment, Store, LS, selection, geometry and rendering remain synthetic. The exact original base29 SHA is checked by the harness. **Not browser E2E.**
- `git apply --check`, actual `git apply`, `git apply --reverse --check`: **PASS** for exact original Test13; standalone safety build uses Test13+CHAT28+CHAT30. The same patch also applies and reverses over an isolated copy of Test13+CHAT19+CHAT21–29, without overwriting any original.
- `python build.py` **3 isolated PASS** in separate new output directories: bare Test13+CHAT30 **`ok 4986490`** (compile-only, **not safe without CHAT28**); Test13+CHAT28+CHAT30 **`ok 4988141`** (dependency-aware standalone); and Test13+CHAT19+CHAT21–30 **`ok 5002321`** (partial combined). All output bundles remain private.
- **295/295 Node VM PASS** on one isolated combined Test13+CHAT19+CHAT21–30 source copy, running ten existing actual published suites: CHAT21 21/21, CHAT22 20/20, CHAT23 23/23, CHAT24 26/26, CHAT25 35/35 (on its required separate CHAT19 baseline), CHAT26 25/25, CHAT27 30/30, CHAT28 33/33, CHAT29 36/36, CHAT30 46/46. All use synthetic dependencies; combined source is **not SOL's checkout** and not integrated browser runtime.
- All **14** public patch blobs CHAT16–29 were independently re-fetched from the live `ai-workspace` branch; no original hunk-range overlaps with CHAT30's changes. CHAT16–18 and CHAT20 were **not** applied or exercised in the combined source copy. Static non-overlap is **not** complete compatibility proof. Real SOL source unknown.

## Publication and remaining risks

Publish **only these three UTF-8 text files** to `ai-workspace/submissions/chat-30/`: `matrix_span_drop_guard.patch`, `matrix_span_drop_source_gate.js`, and this `README.md`. Do **not** publish whole Test13 HTML, ZIP, extension, built bundle, real boards/assets, credentials, private profiles or a duplicate journal. A pattern scan for obvious keys, secrets, emails and local personal paths is heuristic, not proof.

**Open:** actual Chrome/Edge IndexedDB/Drive persistence, real pointer-up/popover dispatch behavior, collision detection under real geometry and nested matrices, cross-tab atomicity, crash/fsync durability and full-board snapshot quota/latency. Failure to write a full backup intentionally cancels destructive merging. Potential external references to pristine placeholder IDs are not modeled. The original `tests/app_regression.py:1265` failure, comprehensive Test13+CHAT16–30 source reconciliation and SOL's two private fixes remain unverified. No patch here is production-integrated.

**Next owner:** 🟩 SOL for actual checkout reconciliation, acceptance, and strategic integration; 🟦 CHAT only after a new direct XOD task for a different residual source-backed risk. No action or archive transfer required from the user for this isolated submission.
