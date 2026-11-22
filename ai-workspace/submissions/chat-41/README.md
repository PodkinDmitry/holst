# XOD EXEC-003 · pure `mkOpt224()` and guarded global `pointerup`

**Status:** SOURCE-VERIFIED, **TARGET_E2E_NOT_VERIFIED**. This is an unintegrated, narrow source-only patch against exact cleaned Test13. The original Windows Edge `app_regression.py:1265` failure is documented in canonical journal §31.7.8 / §67; it is **not** claimed fixed or accepted on Windows.

## Source-backed cause and fix

The real Test13 `v224/m_mark224.js` line 12 evaluates `mkOf222()` and executes `(m.opt224 = m.opt224 || {})` during a *read*. Its global `pointerup` handler calls `mkOpt224()` after a 30-ms timeout even without a ray/item drag. Consequently, a normal click can create `S.board.mk222.opt224={}` after the strict pre-cleanup snapshot, exactly matching the bounded Windows Edge JSON Pointer difference `/0/mk222/opt224`. The exact browser event sequencing was not traced, so this is a source-confirmed matching mechanism, not completed on-host causal proof.

`mkopt224_readonly_pointerup.patch` changes **only** `v224/m_mark224.js` in three hunks:

1. `mkOpt224()` reads optional `S.board.mk222.opt224` without invoking the mutating `mkOf222()`, without creating board fields, with unchanged defaults (`move/push` true, `keep` false). It returns a shallow copy of `raw`, preventing incidental write-through.
2. A global `pointerup` with no drag snapshots returns before `mkOpt224()`; absent board clears stale snapshots. Normal ray/item drags still pass through the original movement and push logic.
3. Actual checkbox `change` for `move/push/keep` **creates `m.opt224` only when the user writes**; keeps existing `pushHist()`, `changed()`, `render()`, and preserves other saved flags. Axis `sz/sr/arr` change behavior remains as before.

This patch does **not** modify `tests/app_regression.py`, the strict `before_cleanup == after_cleanup` comparison or its CHAT14 strict diagnostic variant. Do not weaken the assertion, ignore `/0/mk222/opt224`, or infer a browser PASS from simulated Node VM tests. The unrelated mutable reads elsewhere in `mkOf222()` are out of scope.

## Reproduce, in a private clean copy of Test13

The user-private ZIP is never part of this submission. Verify the whole original ZIP SHA256 `a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4`, 449 ZIP entries with CRC PASS, 431 source manifest entries with no mismatches. In the extracted `xod-test13-source` root:

```sh
# $PATCH points to this public source-only patch; never patch the private original in place.
git apply --check "$PATCH"
git apply "$PATCH"
node --check v224/m_mark224.js
node /PUBLIC_PACKAGE/mkopt224_source_gate.js /PRIVATE_CLEAN_TEST13 /PRIVATE_PATCHED_TEST13
python build.py /PRIVATE_EMPTY_BUILD_OUTPUT
```

The harness requires both exact Test13 directories; it validates the original module hashes. It executes real `mkOf222`, `mkLines222` and **the full authentic source of `m_mark224.js`** in a sandboxed Node VM with synthetic DOM, board, callbacks and timers. It also asserts the strict original browser test remains byte-identical.

## Actually executed verification

- **30/30 Node VM PASS**: 5 negative controls reproducing original mutation and aliasing; 25 positive tests for pure reads, absent/existing flags, no-drag pointerup, stale snapshots, panel-open read, explicit `move/push/keep` writes, history/change/render hooks, axes, ray follow and push, slider and grid operations, original strict assert unchanged.
- **3/3 isolated `git apply` checks PASS**: check, apply, reverse-check. Applied source matches the tested private copy exactly.
- `node --check` source module and harness **PASS**.
- `python build.py` from isolated Test13 with patched module **PASS: `ok 4983169`**. Built app HTML contains pure getter, early pointerup guard and explicit checkbox write; old getter mutation absent.
- **Browser constraint:** Chromium launches and loads `about:blank`; localhost navigation on a running isolated test server fails with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. No true application browser E2E, IndexedDB durability test or Windows Edge retest ran. No local SOL checkout, main branch or Work was touched.

## Recommended single target verification (not executed here)

After the owner of the runnable Windows harness receives this published patch, build a **new isolated Test13** with the patch, and run CHAT14's original strict browser `tests/app_regression.py` against that corrected app on the same permitted Windows Edge/localhost environment that produced §67. Compare the safe JSON Pointer diff only; passing the cache-cleanup step is not automatically a full regression or release PASS. If other changed paths appear, debug them independently and preserve real user data. 🟩 SOL retains integration/release authority; 🟦 CHAT-PLAN owns evidence review and any new task.

## Publication boundary

Only `mkopt224_readonly_pointerup.patch`, `mkopt224_source_gate.js`, `verification.json`, and this README are safe to publish. No ZIP, full JS module, HTML, extension bundle, private boards, profiles, tokens, or local Windows paths are included. A heuristic secret scan is useful but is not a formal security audit.
