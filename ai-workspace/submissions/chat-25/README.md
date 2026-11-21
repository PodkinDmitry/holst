# CHAT 25 — bulk board deletion: late-edit and navigation safety

**Status:** source-backed patch and Node VM tests only. **Not integrated into SOL's actual checkout. No Chrome/Edge or live IndexedDB/Google Drive E2E acceptance.** `main` and Work were not touched.

## Provenance and prerequisites

- Exact privately supplied cleaned **Test 13** source-only ZIP: commit `6429ad61490301e4b942f2190b0be593d449309c`, SHA-256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`, CRC OK.
- Original private `v224/base29.html` SHA-256: `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`.
- **Critical:** CHAT19 already added the basic `canLeaveCurrentBoard()` check to `bselAct()`. That fix must be preserved, not duplicated. This patch is generated **against Test13 with CHAT19's exact four text changes**, and intentionally replaces the CHAT19 bulk-deletion hunk with a stronger implementation. Apply CHAT18 (defines `canLeaveCurrentBoard`) and CHAT17 (safe virtual writeback) as prerequisites in the integrated product. This patch alone **will not apply to raw Test13 without CHAT19 first**.
- Only two functions are changed in the private source: `deleteBoardWithTrash300(id, beforeDelete)` and `bselAct(e)`; plus one `bselDeleteBusy` local flag. The optional callback leaves the existing single-board deletion behavior intact.

## Source-backed negative controls and targeted mitigation

The real handler bodies extracted from the original Test13 and its CHAT19 state were executed in Node VM against synthetic board, backend, trash, modal, and async navigation models.

- **6 original Test13 negative controls**: unsaved active edits discarded, trash snapshot older than in-memory edits, edits arriving during delete discarded, double-click duplicate delete, late navigation replaced by fallback load, and partial failure erases retry selection.
- **CHAT19 verified, not repeated:** an initial rejected save stops active-board bulk deletion. CHAT19 still exhibited **4 residual unsafe controls** (edit during backend deletion, double-click, late navigation/fallback, edit during async trash snapshot).
- **24 patched scenarios**: preflight and post-preflight safety, virtual/save-failure refusal, edit after trash creation, backend failure, double-click mutex, delete active last, abort if current board changes during confirmation, preserve late edits after already-started backend deletion, retain failed selections for retry, successful inactive and active deletion, retry/cancellation, unchanged optional-callback behavior for single deletion, stale selection handling.
- Backend deletion callback now checks again **after awaited trash snapshot** and **before** invoking `Backend.deleteBoard`; a changed/dirty board is not deleted. During bulk operation the originally active board is processed last, `finishEdit()` and CHAT18's `canLeaveCurrentBoard()` are called. Active-board identity, `dirty`, `saving`, and `saveAgain` are checked before releasing the board. A mutex prevents repeated bulk-delete runs.
- Failure of some deletions keeps their entries selected, rather than silently clearing the entire selection. A fallback navigation does not override a different user navigation that happened while awaiting a load.
- **Residual unfixable-in-JS atomicity gap:** a user may edit or navigate to a board *after* the backend deletion starts and before its promise resolves. The patch retains the visible in-memory board, marks error, and prompts an immediate **manual file export**. The deleted storage record is **not** guaranteed recoverable by this safeguard. Successful deletions in a batch are not rolled back when later deletions fail. A trash snapshot can remain when the pre-delete condition subsequently rejects; this is safer than deleting the changed board.

## Actual checks performed

| Check | Observed result | Limitation |
| --- | --- | --- |
| ZIP SHA-256 and CRC; original source SHA-256 | **PASS** | Private input; not published |
| Original/CHAT19 negative controls plus patched behavior | **35/35 PASS**: 6 original + 5 CHAT19 controls (1 existing guard + 4 residual) + 24 patched | Real extracted JS functions, **synthetic environment** |
| `node --check bulk_board_source_gate.js` | **PASS** | Harness syntax only |
| `git apply --check` and actual apply on clean Test13+CHAT19 | **PASS** | CHAT19 text hunks introduced into a fresh isolated source copy |
| `python build.py` on Test13+CHAT19+CHAT25 | **PASS**: `ok 4985438` | Bundle not opened in Chrome/Edge |
| `git apply --check` and actual apply on Test13+CHAT19+CHAT21–24 | **PASS** | No CHAT16–18/20 applied as full joint patch set |
| `python build.py` on Test13+CHAT19+CHAT21–25 | **PASS**: `ok 4991640` | Not SOL checkout, no E2E |
| 5 source-backed harnesses on one Test13+CHAT19+CHAT21–25 source | **125/125 PASS**: CHAT21 21/21, CHAT22 20/20, CHAT23 23/23, CHAT24 26/26, CHAT25 35/35 | Each harness stubs DOM/storage and CHAT18's helper for CHAT25; not an end-to-end integration |
| Current published patch hunks CHAT16–24 compared | **No overlap for CHAT16–18, CHAT20–24**; **intentional overlap/supersession of CHAT19 bulk hunk** | Static check for other patches; their combined runtime was not executed |
| Public file secret/path/email signature scan | **0 obvious matches** | Pattern scan is not a proof of no secrets |

## Reproduce locally without altering an actual user checkout

Make a clean private Test13 source copy (not `main`). Apply the published CHAT19 patch first. Ensure CHAT18 is included when testing actual runtime behavior; CHAT17's virtual-board writeback is required for virtual board safety. Apply this packet's `bulk_board_delete_guard.patch` with `git apply --check` before `git apply`.

```bash
node --check bulk_board_source_gate.js
node bulk_board_source_gate.js /private/Test13/v224/base29.html /private/Test13-plus-CHAT19-25/v224/base29.html /private/Test13-plus-CHAT19/v224/base29.html
python build.py /empty/output/directory
```

The standalone harness executes *real extracted* original/CHAT19/patched function bodies with synthetic storage. Paths in the example are placeholders. Source versions, user boards, credentials, and built application HTML must **not** be pushed to the public repository.

## Review and pending gates

🟩 **SOL**: reconcile with current real checkout, keep both SOL fixes (duplicate sort keys and max filter-group depth), verify CHAT17/18/19 prerequisites, run actual Chrome/Edge checks on trash restores and edited boards while bulk deletion is pending; inspect the original `tests/app_regression.py:1265` FAIL and full combined CHAT16–25. Only then accept/integrate. 🟦 **CHAT** can investigate other independent data-safety paths on the next *directly authorized* request. No Work/main or browser integration is asserted by this package.
