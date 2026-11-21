# XOD · CHAT 01 — YouTube table component

**Status:** staged for Sol integration. Not yet integrated into XOD. Browser acceptance pending.

## Files
- `xod-youtube-table300.js` — self-contained DOM component exposing exactly `window.mountYoutubeTable300(root, { entries, fields, onApply })`.
- `xod-youtube-table300.css` — scoped `.yt-table300` styles; typography and color inherit from XOD.
- `xod-youtube-table300-test.html` — autonomous local HTML test harness; open with the other two files in the same directory.

## Contract
`entries`: `{id:string,type:'video'|'channel'|'playlist',title:string,values:{[key]:string}}`

`fields`: `{key:string,label:string,types:string[],options:[{value:string,label:string}]}`

`onApply({ids:string[],key:string,value:string})` returns `Promise<{entries,applied:number,skipped:number,failed:number}>`. The returned `entries` is the entire new table snapshot. Selected IDs, including incompatible types, must be passed unchanged to the callback. Persistence, menus, network, and user authentication are explicitly out of scope.

## Sol next step
1. Use only this staged package and the current XOD source tree (not historical 2.24). Inspect the existing YouTube storage/mass-edit API before connecting `onApply`.
2. Run the HTML test with a **real browser**. Record actual PASS/FAIL results and any environment-dependent defects. A previous authoring run passed JS syntax checks and nine scenarios in a simulated DOM; real Chromium was **not** successfully run in that environment.
3. Integrate the component behind XOD's existing YouTube table navigation. Connect saving so that one `onApply` handles single and bulk edits, returns all records plus accurate `applied/skipped/failed` counters, and does not fabricate success.
4. Verify re-opening/reloading, mixed selection, repeat same value, thrown/rejected Promise recovery, disabled concurrent submit, textContent safety, check-all indeterminate, keyboard focus, narrow/dark theme. Regression-test related existing functionality.
5. Make integration changes in the **actual XOD development branch**, not `main` or this handoff-only branch unless instructed. Save a short report with changed paths, evidence, open issues, and Work usage.
6. Do not ask the user to download or re-upload the staged files.

## Scope and provenance
Prepared in ChatGPT ordinary chat on 2026-11-21 from the user's CHAT 01 contract only. No historical XOD source files were used. No GitHub main-branch changes were made by staging.

**Links:** `https://github.com/PodkinDmitry/holst/tree/ai-workspace/ai-workspace/submissions/chat-01`.
