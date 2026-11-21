# XOD — shared agent entrypoint

Before working on XOD in the `ai-workspace` branch:

1. Read the **latest** canonical protocol: [ai-workspace/protocols/xod-response-format.md](ai-workspace/protocols/xod-response-format.md).
2. Read the **latest** shared work journal: [ai-workspace/handoffs/work-resume-latest.md](ai-workspace/handoffs/work-resume-latest.md).
3. Obey the explicit live status `SOL_STATE` in the journal. Do not assume SOL woke up from elapsed time or old quota screenshots.
4. Keep all development and test artifacts in `ai-workspace/submissions/chat-NN/`. Update the shared journal after completing each substantive unit of work. Do not create extra journal copies.
5. Never overwrite SOL's unmerged local changes: compare actual current code, apply focused patches, preserve his two fixes (duplicate sort keys and maximum filter-group depth).
6. Do not modify `main` without direct instruction. Never assert local XOD integration or Chrome/Edge acceptance without actual tests.
7. Use the user's hierarchy and visual response format: explicitly say **Текущий шаг**, number from strategy to tactics, mark interim messages distinctly, put chronological stages in separate blockquotes inside a framed final report; identify 🟩 SOL, 🟦 CHAT, and 👤 ДИМА.
8. Sol wakes **only when 👤 ДИМА explicitly says so**. Until then, CHAT may independently prepare tests, patches, and documentation in this branch.

**Scope note:** AGENTS.md can guide repo-aware agents that read this branch. It cannot automatically change ChatGPT's global or project-level custom instructions for every separate chat. Those need their own project pointer to the canonical file.
