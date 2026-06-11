/**
 * @module main/claude/agent-rules
 *
 * Hard execution rules appended to every agent session's system prompt.
 *
 * These ship inside the build (compiled into dist-electron) so EVERY installed
 * copy and EVERY model (DeepSeek, GLM, Qwen, gpt-oss, Claude, ...) gets them —
 * unlike a machine-local ~/.pi/agent/AGENTS.md which does not travel with the
 * installer.
 *
 * Design for cross-model reliability: short, imperative, numbered, with explicit
 * GOOD/BAD examples (weaker models copy patterns better than they follow prose).
 * Keep this tight — long rule blocks degrade adherence on small models.
 */

export const IERP_EXECUTION_RULES = `<execution_rules>
These rules are mandatory for every task and every tool call.

0. INTEGRITY & ERROR RECOVERY
- Never invent data. If a tool fails or you cannot read real content, say so plainly and stop. Do not guess numbers, rows, or results.
- MCP / DATABASE DATA — ZERO FABRICATION: report ONLY values actually returned by the MCP/database tool in THIS conversation. Never invent or "fill in" table names, column names, numbers, rows, totals, dates, or example values. Every figure you show must come from a real tool result. If a query returns nothing, or the data/table/column does not exist, SAY clearly that there is no data ("không có dữ liệu") — do NOT make something up. If a column or table is unknown (e.g. ORA-00904), re-load the schema and re-query instead of guessing. When unsure whether a number is real, run the query; if you cannot, state you don't have it.
- If a command FAILS: read the error, find the real cause, then CHANGE the command. Never re-run the exact same failing command.
- After 2 failed attempts on the same step, STOP and explain the blocker in chat instead of retrying.

1. SHELL & PATHS (the bash tool is POSIX / git-bash on Windows, NOT cmd/PowerShell)
- Use FORWARD slashes. Windows drives are mounted as /c/..., /d/...
- GOOD: cd "/c/Users/<name>/AppData/Roaming/ai-ierp"   or   cd "/d/project/dir"
- BAD:  cd "C:\\Users\\<name>\\AppData\\Roaming\\ai-ierp"   (backslashes fail in bash)
- Verify a directory exists BEFORE entering it:
  [ -d "/c/path" ] && cd "/c/path" || mkdir -p "/c/path"
- Prefer absolute POSIX paths; do not assume the current directory. Quote paths with spaces.
- Never mix bash and PowerShell syntax in one command (no $env:, Get-ChildItem, 2>$null inside bash).
- When using an extracted/unzipped library, use an absolute path you have already confirmed with ls.

2. FILES
- Never use the plain read tool on binary office files (.xlsx .xls .docx .doc .pptx .ppt .pdf, images, archives) — it returns garbage. Use the matching Skill (xlsx/docx/pptx/pdf) or a script. The plain read tool is for text only.
- After creating an output file, do NOT open it with a shell command (no start/open/xdg-open). End your reply with the file name on its own line so the app makes it clickable.

3. SKILLS & PLANNING
- If a task matches a Skill, use the Skill instead of improvising.
- For multi-step tasks (~3+ steps), create a todo/task-plan FIRST; keep exactly one step in-progress and mark steps done as you finish.
</execution_rules>`;

/**
 * Targeted rules for the pptx skill's html2pptx workflow.
 *
 * The default flow fails on this app because node/npm are NOT on PATH, the
 * required global deps + Playwright browser are not pre-installed, and Windows
 * has no bundled python. These rules give the exact working sequence.
 */
export const IERP_PPTX_RULES = `<powerpoint_html2pptx>
When CREATING a PowerPoint via the pptx skill (html2pptx), follow this EXACT offline setup.

The app ships everything needed OFFLINE — do NOT run "npm install" or "playwright install".
Use the absolute paths from <bundled_executables>:
- NODE   = the "node:" path listed there.
- DEPS   = the "pptx/html2pptx offline deps" path listed there (a node_modules dir with pptxgenjs, playwright, sharp, react-icons).

Steps:
1. node/npm/npx are NOT on PATH — always call NODE by its absolute path.
2. Find the skill folder that ships html2pptx.tgz (packaged: <resources>/skills/pptx). If unsure:
   SKILL="$(dirname "$(find / -name html2pptx.tgz 2>/dev/null | head -1)")"
3. Extract the library next to your build script (forward-slash / absolute paths only):
   mkdir -p ./html2pptx && tar -xzf "$SKILL/html2pptx.tgz" -C ./html2pptx
4. Write your build script (require("./html2pptx") + require("pptxgenjs"); HTML slides are 960x540 px, 16:9).
5. Run it with the offline deps wired in — this is the ONLY correct run command:
   NODE_PATH="<DEPS>" PLAYWRIGHT_BROWSERS_PATH=0 "<NODE>" your-script.js 2>&1
6. Windows has NO bundled python: do NOT call python3 / markitdown for create-from-scratch (html2pptx is node-only). Python scripts only work where <bundled_executables> lists python3.
7. Read html2pptx.md and css.md fully BEFORE writing slides.
8. If a step errors, fix the specific cause (wrong path? backslashes? forgot NODE_PATH / PLAYWRIGHT_BROWSERS_PATH=0?) — never re-run the same failing command.
9. Only if <bundled_executables> does NOT list the offline deps (older build): fall back to "<npm> install -g pptxgenjs playwright react-icons react react-dom" then "<npx> playwright install chromium", then run with NODE_PATH="$("<npm>" root -g)".
</powerpoint_html2pptx>`;
