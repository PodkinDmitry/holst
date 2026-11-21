# XOD — shared agent entrypoint

Before working on XOD in the `ai-workspace` branch:

1. Read the **latest** canonical protocol: [ai-workspace/protocols/xod-response-format.md](ai-workspace/protocols/xod-response-format.md).
2. Read the **latest** shared work journal: [ai-workspace/handoffs/work-resume-latest.md](ai-workspace/handoffs/work-resume-latest.md).
3. Obey the **latest** `SOL_STATE` and `WORK_EXECUTION` in the journal. `AWAKE` means the user reported Work availability, **not** that SOL resumed or approved any handoff. Do not infer a model's state from elapsed time, old quota screenshots or an earlier message.
4. Keep all development and test artifacts in `ai-workspace/submissions/chat-NN/`. Update the shared journal after completing each substantive unit of work. Do not create extra journal copies.
5. Never overwrite SOL's unmerged local changes: compare actual current code, apply focused patches, preserve his two fixes (duplicate sort keys and maximum filter-group depth). Reports or simulated-storage PASS do not prove real XOD integration.
6. Do not modify `main` without direct instruction. Never assert local XOD integration or Chrome/Edge acceptance without actual tests.
7. Roles: 🟩 **SOL is the master orchestrator and strategic owner of all XOD workstreams**, not a narrow integration subtask executor. 🟦 CHAT provides delegated research, tests and patches; 👤 ДИМА approves only significant decisions. Use the user's hierarchical response format, show **Текущий шаг**, label roles and real validation status.
8. **Wake-up handoff is a governance transition, not an integration ticket.** `SOL_STATE=SLEEPING`: CHAT may carry out independent work using the lease. `SOL_STATE=AWAKE` + `WORK_EXECUTION=NOT_STARTED`: stop independent new development and prepare a complete copy-to-Work handoff for the **existing SOL Work chat**; do not assert that Work has run. `WORK_EXECUTION=STARTED` requires actual execution evidence; only then coordinate new CHAT tasks under SOL's leadership. Never overwrite another agent's live lease.

## SOL wake-up: mandatory orchestration checkpoint

On any SOL return, start from **journal §24 (current master-orchestrator handoff, superseding the narrower historical §23)** and validate against more recent explicit user decisions. Read the whole latest journal, original XOD iteration strategy and actual local build/files as accessible; audit all CHAT packages produced while SOL was away (not just those listed in §24). Classify each as verified / unverified / already integrated / incompatible / superseded, noting alternate patches and fake-storage limitations. Restore the strategic priority **3.0 foundation → 3.0b critical bugs → later features such as YouTube 3.3** unless the user has explicitly changed it. Do not let an impressive pile of YouTube patches silently replace the approved roadmap.

After the audit, SOL autonomously leads strategy, task allocation, integration, quality gates, documentation and the next high-value implementation; it does **not** stop at a single integration task or report unless a genuine blocker requires user action. Assign only to agents/tools actually callable, not imagined cross-chat delegation. Record role ownership and acceptance evidence in the same journal; preserve main and user data.

**GitHub-first cross-chat continuity (response format §4.10):** a new agent with GitHub access must **read current AGENTS.md, canonical protocol, journal, source plan and lock itself**, not ask the user to copy these documents from another chat. GitHub does not automatically deliver updates or initiate a chat. When the user must activate a *different* chat/Work session, give at most a short startup instruction pointing to GitHub, using clipboard only if needed to simplify that activation; copy a full handoff only when the destination cannot read the sources. Never use same-chat issueNewTurn to claim cross-chat delivery. Details: ai-workspace/protocols/xod-response-format.md §§4.9–4.10 and ai-workspace/protocols/xod-autonomous-worker.md §4.

**Scope:** this AGENTS.md affects agents that read the working branch; it cannot automatically update every ChatGPT conversation.
