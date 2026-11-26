# ICPC Tracker v0.13.0 — Minimise & rearrange group tables

## v0.13.0
- **Minimise**: each group table has a ▾ button (or click the group's title). A minimised group shows only its header and a one-line summary (e.g. "Minimised · 1 failed"); its **Update / Re-read** buttons keep working. **Minimise all / Expand all** buttons sit above the tables. The state is remembered between visits.
- **Rearrange**: drag a group by its ⠿ handle and drop it before/after another (a blue line shows where it will land), or use the **↑ ↓** buttons (keyboard and touch friendly; the move is announced). The "No group" section stays last.
- The order is saved with your groups, so the popup's Groups list and your backups use the same order.

# ICPC Tracker v0.12.0 — Cell details with Done / Not done marks, split Dashboard code

## v0.12.0
### Click a cell
- Click (or focus + Enter) any student × sheet cell: a details drawer opens at the bottom right with
  - the **solved** problems (green chips) and **not solved** problems (red chips), each linking to the problem on Codeforces;
  - a **Status** you choose: **Done**, **Not done** or **No status**.
- The cell turns **green** when marked Done, **red** when marked Not done, and keeps its normal look with no status. The Individual View shows the same marks.
- Marks are yours (not collected data): they are saved on this device (`icpcTracker.statuses`), survive "Clear saved results", and can be set even for sheets that are not collected yet.
- Not found / failed / not collected cells explain themselves in the drawer instead of guessing solved problems. Esc or × closes it.
- Marks of deleted students or sheets are cleaned up automatically.
- Backups now include the marks (stored by handle + contest, so they restore correctly). Merge keeps marks you already set; Replace restores the backup's.

### Dashboard code split (no behaviour change)
`dashboard/dashboard.js` is now five plain scripts that share globals, loaded in this order by `index.html`:
`state.js` (state, sections, saved results, derived cell data) → `collector.js` (reading standings) → `render.js` (panels, tables, drawer) → `backup.js` → `main.js` (wiring, start-up).

# Earlier versions

# ICPC Tracker v0.11.0 — Multi-group students, backup & restore, unofficial participants, pagination, saved results

## v0.11.0
### A student can be in several groups
- Students → the form now has a checkbox per group. The student appears in the table of **every** group they belong to, each using that group's own sheets. Sheets are still read once each (no extra requests).
- The Individual View shows one block per group of the selected student, with a total per group.
- Deleting a group only removes that group from students; they stay in their other groups.
- Existing data is migrated automatically (`groupId` → `groupIds`).

### Backup & restore (Dashboard → "Backup & restore", also reachable from the popup)
- **Download backup** saves a dated `.json` file with your **groups, sheets and students** (not collected results, not settings). It contains student names and handles: store it somewhere safe.
- **Restore from file…** validates the file and shows what it contains before changing anything.
  - **Merge** (default): adds what's missing; keeps existing items (groups matched by Codeforces code, sheets by contest, students by handle; an existing student just gains the extra groups).
  - **Replace**: makes your data exactly match the backup; a safety copy of your current data is downloaded first, and you must confirm.
- Nothing in the file is trusted: sheet links are re-parsed (only real codeforces.com contest links survive), group codes and handles are re-validated, duplicates and unknown references are dropped, and every skipped entry is listed. Backups made by a newer extension version are refused.
- The file chooser lives on the Dashboard page because Chrome closes the popup when a file dialog opens.

## Test steps (v0.11.0)
1. Popup → Students → tick two groups for a student → Dashboard: the student appears in both group tables.
2. Dashboard → Backup & restore → **Download backup**.
3. Make a change (delete a student), then **Restore from file…** with **Merge**: the student comes back.
4. Try **Replace** with the same file: a "before-restore" safety file downloads, then data matches the backup.
5. Try restoring a random JSON/text file: you should get a clear error and no changes.



## v0.10.0: unofficial participants are now read
- In every temporary standings tab the extension looks for the page's **"Show unofficial"** checkbox, turns it on if needed, waits for the page to update, and confirms it is on before reading (the web page has no URL parameter for this; only the API does). Virtual / out-of-competition rows are therefore included.
- A student's official and unofficial rows (even on different pages) are merged: solved problems are the union.
- Because duplicate rows are now likely, **early stop was removed**: every standings page is read.
- If the checkbox can't be turned on, the sheet is **Partial** ("Not found (partial)" for missing students). If the option isn't found on the page at all, the sheet stays Complete but carries a note.
- Sheets saved by earlier versions are re-read automatically by the next **Update results** (they were read without unofficial rows).
- Side effect to know: Codeforces remembers this checkbox in your browser, so "Show unofficial" will also be on when you open standings yourself.
- Unverified: the checkbox's exact markup on the real page. It is located by id/name/class containing "unofficial" or by its "Show unofficial" label text. If it isn't found, the notice on that sheet says so; tell me what the page's HTML looks like.


## v0.9.0: standings pagination
- Sheets with several standings pages are now read **page by page** (sequentially, with the same 3 s + jitter pause between pages). Page links come from the pager Codeforces itself renders; the extension follows them (and the same URL pattern for pages the pager skips). URLs are never guessed when no pattern is available.
- **Early stop (saves requests):** once every tracked student of the group has been seen, remaining pages are not requested. The result is Complete and the note says it stopped early.
- Results are **Complete** when all pages needed were read, otherwise **Partial** with the unreadable page numbers (shown as `Not found (partial)` for missing students, never 0). Found students always keep their counts.
- Safety: paging stops after 2 consecutive page failures; a rate-limit/captcha page on any page stops the whole run; a sheet interrupted by a block is not saved half-way. Capped at 40 pages per sheet.
- Duplicate rows (same handle) across pages are merged (union of solved problems).
- Known limitation of early stop: if a student had two rows (e.g. official + unofficial) on different pages, the second row is not seen once everyone has been found.
- **Test:** open a sheet with more than one standings page; check in the Dashboard that a student on page 2+ is found, and compare counts with Codeforces. Group "groupmates" standings are often a single page, so you may not see paging at all.


## v0.8.1 fix: wrong names ("Final standings" / "Current standings")
The contests page keeps the real name as plain text in the first cell of each contest row; the reader used a nearby "Final standings" link instead. It now reads the row text first (verified against the real page markup you sent). Sheets already saved with those wrong names are repaired by **Popup → Groups → Sync** (names you typed yourself are never touched). Names guessed from the standings page are also replaced the next time that sheet is read.

## 1. Saved results (deliberate change of the old "never persist results" rule — approved by the owner)
- After each sheet is read, results are saved to `chrome.storage.local` under `icpcTracker.results`, so the Dashboard opens instantly with data and sends **zero** requests.
- Saved data is minimal: per sheet the status, time collected, problem names, and the solved problems of **only your tracked students**. Other participants are never stored.
- **Clear saved results** (Dashboard) wipes it. Students, groups and sheets are kept. Uninstalling the extension also removes everything.
- A student added after a sheet was read shows `Not collected` (never `Not found` or 0) until you press Update.
- If a re-read fails, the earlier good result stays visible with a notice ("showing results from …").

## 2. Fewer, gentler requests
- **Update results**: reads only sheets that have no saved result, failed last time, or don't cover all students. **Re-read everything** (confirm) fetches all again. Each group has its own **Update** and **Re-read** buttons.
- **Automatic update when the Dashboard opens is OFF by default** (checkbox in the Results panel). When on, it runs once per page load and does the same as Update.
- **Slower and jittered**: 3 s + up to 0.8 s random pause between page loads (was 1.2 s). The same pause is used between group contest-list pages.
- **Block detection**: if Codeforces shows "too many requests", a captcha, or a verification page, collection stops immediately with a clear message. Collection also stops after 3 sheets in a row fail (login lost, no access, etc.).
- Still read-only, one tab at a time, in your own logged-in browser.

## 3. Real sheet names
- The group contests reader now accepts name links that point to sub-pages (e.g. `/problems`), skips action links ("Enter", "Standings", …), and falls back to the row's text or the link's title.
- If a sheet still only has a default name like `Contest 123`, it is renamed automatically (a) when you press **Sync** on its group, or (b) the first time its standings are read (the contest name is taken from the standings page). Names you set yourself are never overwritten. You can always rename via Sheets → Edit.

## Storage keys
`icpcTracker.students`, `icpcTracker.contests` (sheets), `icpcTracker.groups`, `icpcTracker.results`, `icpcTracker.settings`.

## Test steps
1. Reload the extension. Open the Dashboard: it should show your previous data only if results were saved before; otherwise "Not collected" and **no tabs open** by itself.
2. Press **Update results**. Tabs open one at a time, roughly 3–4 s apart. Close and reopen the Dashboard: data appears immediately with no tabs.
3. Press Update again: "Everything is already up to date".
4. Popup → Groups → **Sync** on a group whose sheets have names like `Contest 123`: names should become the real names ("Updated N sheet names"). If they don't, collect once; names are also fixed from the standings page.
5. Add a student to a group → Dashboard shows `Not collected` for them → Update reads only that group's sheets.
6. Optionally tick "Update automatically when this page opens" and reopen the Dashboard.

## Not verified
- Real Codeforces pages: the contests-list layout, the standings page's contest-name element, and the exact wording of rate-limit/captcha pages are best-effort and unverified. If a name is still wrong or a block isn't detected, tell me what the page looks like.
- Only the first standings page of each sheet is read (sheets with more pages are marked Partial; pagination comes later).
- Unofficial participants are still not requested.
- Tested with static checks and jsdom tests with mocked `chrome` APIs (about 80 checks). Not loaded in a real Chrome.
