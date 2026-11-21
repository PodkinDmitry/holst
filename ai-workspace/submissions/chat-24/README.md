# CHAT24 — Safe background local deletion during Drive sync (Test13)

**State:** Source-backed negative controls reproduced; minimal patch and isolation tests passed. Published artifacts are **not** integrated in SOL's real checkout. There has been **no Chrome/Edge, IndexedDB, Google Drive or end-to-end acceptance**.

## Source and scope

- Private, source-only **Test13 `6429ad61490301e4b942f2190b0be593d449309c`**. Source ZIP SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`; ZIP CRC check passed. Original `v224/base29.html` SHA256 `3861195fb4ad5b5fd3a64f0eb0954856844feb7146a1e9545d31a53dceb9366c`. ZIP stays private.
- Minimal delta: **only `v224/base29.html`**, in `removeBoardLocally(bid)` (original ~3066) and its two background `Drive.sync` callers (original ~3499 and ~3506). No API changes for manual board removal, no direct changes to Drive REST/MCP sync transports or user profiles.
- On actual original source, `Drive.sync` may decide a remotely deleted board is safe to remove based on its **persisted** hash, while unsaved edits still exist in `S.board`. `removeBoardLocally` used to run `Backend.deleteBoard(bid).catch(() => {})`, remove the index regardless of failure, and **replace an active board and clear `dirty`**. A race while `Backend.deleteBoard` was pending could also evict a board the user had just opened.

## Behavior of the proposed guard

1. **Never automatically delete the currently opened board**, including a welcome board. Also defer background deletion while `saving` or `saveAgain` is in progress. Remote cleanup can proceed when the board is no longer open and no save is pending.
2. **Do not swallow a failed local deletion:** return `false` and keep catalog state unchanged. Return `true` only after a confirmed local delete and catalog update.
3. The two **real `Drive.sync` callers** now advance `removed`, `changed`, and `this.st.meta[bid]` **only after `removeBoardLocally()` returns true**. Failed/deferred deletions keep sync metadata so a later cycle can retry. Existing two-deletions-per-cycle cap is retained.
4. If navigation opens the board **during** an asynchronous storage deletion, do **not** replace the in-memory board; flag its status as error/dirty and prompt the user to **export that board before leaving**. This fallback limits immediate in-memory loss but is **not a transaction guarantee**: the underlying local copy might have been removed. An actual browser race test remains necessary.
5. Normal inactive-board cleanup, inactive pristine welcome-board cleanup when remote boards exist, and conflict/push routing for changed saved boards remain as in Test13.

## Files and reproduction

- `drive_sync_local_delete_guard.patch`: apply with `git apply --check` and `git apply` from a **verified private Test13 checkout root**. Apply only after comparing with SOL's actual checkout, preserving his duplicate-sort-key and maximum-filter-depth changes.
- `drive_sync_source_gate.js`: Node VM source-backed test. Extracts **the real `removeBoardLocally` function and `Drive.sync` method** from the original and patched Test13 HTML; backend, Board, Drive transport and UI are **synthetic**. It needs two local paths, not the source bytes in GitHub:

```bash
node --check drive_sync_source_gate.js
node drive_sync_source_gate.js /PRIVATE-EXACT/v224/base29.html /PRIVATE-PATCHED/v224/base29.html
```

## Tests actually executed (CHAT24)

- **26/26 Node VM PASS:** 6 original negative controls (original data-loss sequences really occur in the source-backed synthetic harness) and 20 patched scenarios, including failed backend deletion, open-board deferral, pending save, retry, metadata retention, welcome cleanup, and navigation-while-delete race. This is **not** a real browser or database test.
- `node --check` PASS.
- `git apply --check` and application PASS on **clean exact Test13** and **Test13+CHAT21+CHAT22+CHAT23**. Tests additionally ran against the actual combined patched source, **26/26**.
- Source-built standalone Test13+CHAT24: `python build.py <empty-output>` **PASS**, `ok 4983370`.
- Source-built Test13+CHAT21+CHAT22+CHAT23+CHAT24: `python build.py <empty-output>` **PASS**, `ok 4989243`.
- On the latter combined source: **CHAT21 21/21, CHAT22 20/20, CHAT23 23/23, CHAT24 26/26 = 90/90 Node VM PASS**. All fixtures are synthetic.
- Independently fetched the exact CHAT16–23 patch blobs from `ai-workspace`; original hunk line ranges do not overlap CHAT24 changes. **CHAT16–20 have NOT been applied/tested together with CHAT24 in this cycle.** A static non-overlap check is not a combined full regression.

## Open risks and ownership

- **Unverified**: actual local Storage/IndexedDB and Google Drive deletion rechecks, other-tab editing, browser edit/delete race, crash recovery, all CHAT16–24 joint application, legacy `tests/app_regression.py:1265` failure. Background cleanup may be deferred while an affected board stays active; this is intentional. If another navigation activates an inactive board during the storage deletion, the in-memory fallback **requires manual export** and cannot itself restore an already deleted local record.
- **🟩 SOL:** verify the newest actual checkout, keep SOL-only fixes, reconcile/apply patches, run Chrome/Edge with real Drive/IndexedDB and the complete regression suite, then approve integration.
- **🟦 CHAT:** source-backed testing and minimal patch publication only; no Work, no `main` changes. **👤 User:** no manual source re-upload required.

**Privacy:** only this report, the focused diff and source-backed synthetic test harness should be committed to `ai-workspace/submissions/chat-24/`. Never publish full Test13 HTML, private ZIP, built bundle, boards or tokens.
