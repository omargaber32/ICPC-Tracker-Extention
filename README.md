# ICPC Tracker Extention

A Chrome extension (Manifest V3) that helps you monitor how your students are doing in Codeforces group contests. Instead of opening every contest, switching on "Show unofficial" and searching for each handle by hand, ICPC Tracker reads the standings for you and shows one progress table per group.

**Version:** 0.13.0 · **Stack:** HTML, CSS, vanilla JavaScript, Chrome extension APIs (no frameworks, no build step)

---

## Contents

1. [Overview](#1-overview)
2. [Dashboard](#2-dashboard)
3. [Groups and sheets](#3-groups-and-sheets)
4. [Students](#4-students)
5. [Backup and restore](#5-backup-and-restore)
6. [Known limitations](#6-known-limitations)

---

## 1. Overview

### What it does

- Keeps a list of **groups** (Codeforces groups), the **sheets** (contests) you track in each group, and your **students**.
- Reads the standings of every tracked sheet and matches the results to your students by Codeforces handle.
- Shows a **Students × Sheets** table for each group, with the number of problems each student solved.
- Lets you inspect any cell to see exactly which problems were solved, and mark it **Done** or **Not done**.

### Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `icpc-tracker` folder (or reload it if it is already loaded).
3. Pin the extension and click its icon.
4. Make sure you are **logged in to Codeforces** in the same browser profile. Private group standings are read through your own session.

### The popup

The popup is the navigation hub:

| Item | What it opens |
|---|---|
| **Groups** | Add, sync, rename and delete groups; choose which sheets to track |
| **Students** | Add, edit and delete students and assign them to groups |
| **Sheets** | Add or edit individual sheets, open them on Codeforces |
| **Backup & restore** | Jumps to the backup panel on the Dashboard |
| **Dashboard** | Opens the full-page Dashboard in a new tab (or focuses it if it is already open) |

A small "current page" strip shows whether the active tab is a supported Codeforces standings page.

### Privacy and safety

- **Local-first:** everything is stored in `chrome.storage.local` on your device. There is no backend, no database, no cloud sync and no Google sign-in.
- **Read-only:** the extension only reads standings pages. It never submits solutions or changes anything on Codeforces.
- **No secrets:** it never stores your password, cookies or API keys.
- **Permissions:** `storage`, `activeTab`, and access to `https://codeforces.com/*`.
- **Gentle on Codeforces:**
  - sheets are read one at a time in a temporary background tab;
  - there is a pause of about 3 seconds (plus a little random jitter) between page loads;
  - if Codeforces shows a rate-limit, captcha or verification page, collection stops immediately;
  - collection also stops after 3 sheets in a row fail;
  - nothing is read automatically unless you turn that option on.
- **Side effect to know about:** to include unofficial participants the extension switches on the "Show unofficial" checkbox on the standings page. Codeforces remembers that choice, so it will also be on when you open standings yourself.

### What is stored

| Storage key | Contents |
|---|---|
| `icpcTracker.groups` | Groups (name, Codeforces group code, link). The array order is the display order |
| `icpcTracker.contests` | Sheets (name, contest id, group code, standings link, owning group) |
| `icpcTracker.students` | Students (name, handle, list of group ids) |
| `icpcTracker.statuses` | Your Done / Not done marks |
| `icpcTracker.results` | Saved results (see below) |
| `icpcTracker.settings` | Preferences (automatic update on/off, minimised groups, last backup time) |

**Saved results** are deliberately small: for each sheet, the status, when it was collected, the problem names, and the solved problems of **your tracked students only**. Other participants are never stored. You can wipe them at any time with **Clear saved results**.

### Project structure

```text
icpc-tracker/
├── manifest.json
├── README.md
├── shared/common.js        Storage helpers, URL parsing, migration, temporary-tab reader, backup logic
├── scripts/content.js      Content script: reads Codeforces pages (standings, group contests list)
├── popup/                  Popup UI (index.html, popup.css, popup.js)
└── dashboard/
    ├── index.html, dashboard.css
    ├── state.js            Page state, group sections, saved results, derived cell data
    ├── collector.js        Reads standings (pagination, unofficial, block detection)
    ├── render.js           Results panel, group tables, Individual View, cell drawer
    ├── backup.js           Backup / restore panel
    └── main.js             Event wiring and start-up
```

---

## 2. Dashboard

The Dashboard is a full-page view that opens in its own browser tab. If it is already open, the popup simply focuses it.

### Results panel (collecting data)

| Button | What it does |
|---|---|
| **Update results** | Reads only the sheets that have no saved result, failed last time, or don't yet cover all of the group's students (for example after you add a student) |
| **Re-read everything** | Fetches every sheet again (asks for confirmation) |
| **Stop after current sheet** | Appears while collecting; stops cleanly. Sheets not reached keep their previous results |
| **Clear saved results** | Deletes saved results from this device. Groups, sheets, students and your marks are kept |
| **Update automatically when this page opens** | Optional, **off by default**. When on, it runs the same as *Update results* once each time the Dashboard opens |

The Dashboard opens instantly with your previously saved results and sends no requests until you ask (or enable the automatic option). Progress and errors are shown live, and a status badge shows the overall state (Saved results, Collecting, Up to date, Partial, Failed, or Blocked by Codeforces).

### One table per group

Each group has its own **Students × Sheets** table:

- **Rows** are the group's students, **columns** are the group's tracked sheets, and the last column is each student's **Total**.
- The student name column stays visible while you scroll horizontally.
- A student who belongs to several groups appears in every one of those groups' tables, using that group's sheets.
- Each group has its own **Update** and **Re-read** buttons that work only on that group's sheets.

### What a cell can say

Missing information is never shown as zero.

| Cell | Meaning |
|---|---|
| **a number** | The student was found. `0` really means "found, solved nothing" |
| **Not found** | The sheet was read completely and the student's handle is not in the standings |
| **Not found (partial)** | Only part of the standings could be read, so the student may be on a page that was not read |
| **Failed** | The sheet could not be read (hover for the reason; details are listed under the table) |
| **Not collected** | Nothing has been collected for this sheet (or for this student, if added later) yet |

A **Total** shown with `*` means some of that student's cells had no result, so the total only counts sheets that did.

Sheets with several standings pages are read page by page, following the pager Codeforces shows. If some pages cannot be read, the sheet is marked **Partial** and says which pages were missed. Official and unofficial rows of the same student (even on different pages) are merged, so their solved problems are combined.

### Cell details and Done / Not done

Click a cell (or focus it and press **Enter**) to open the details drawer at the bottom right:

- **Solved** problems as green chips and **Not solved** problems as red chips. Each chip links to the problem on Codeforces.
- A **Status** you choose: **Done**, **Not done** or **No status**.
- When you pick a status the cell changes colour: **green** for Done, **red** for Not done, and unchanged when there is no status.
- You can set a status even if the sheet has not been collected yet.
- Cells that are Not found, Failed or Not collected explain themselves instead of guessing which problems were solved.

Press **Esc** or **×** to close the drawer. Your marks are saved on your device, survive *Clear saved results*, and are cleaned up automatically when a student or sheet is deleted.

### Individual View

Pick a student to see their progress in **every group they belong to**: one block per group with that group's sheets, the solved count (and Done / Not done mark) for each, and a total per group.

### Minimise and rearrange groups

- Click **▾** (or the group's title) to **minimise** a group. A minimised group keeps its header and a one-line summary (for example "Minimised · 1 failed"), and its Update / Re-read buttons still work. **Minimise all** and **Expand all** are above the tables.
- **Drag** a group by its **⠿** handle and drop it before or after another group (a blue line shows where it will land), or use the **↑ ↓** buttons, which also work with the keyboard and on touch screens.
- The "No group" section (shown only if some students or sheets have no group) stays last and cannot be moved.
- Minimised state is remembered. The order is saved together with your groups, so the popup and your backups use the same order.

---

## 3. Groups and sheets

A **group** is a Codeforces group. A **sheet** is a saved contest that belongs to one group. Students are matched against the sheets of the groups they belong to.

### Adding a group (recommended way)

1. Popup → **Groups**.
2. Paste any link inside the group, for example `https://codeforces.com/group/XXXX`, and optionally type a name.
3. Click **Find sheets**. The extension opens the group's contests page in a temporary background tab and lists every contest it finds, using the names shown on that page.
4. Tick the sheets you want to track. There is a filter box, **Select shown** and **Clear**.
5. Click **Save**. **Nothing is stored until you do**, and only the ticked sheets are saved.

If the group's list has several pages, they are read in turn with the same gentle pauses.

### Managing groups

| Action | What it does |
|---|---|
| **Sync** | Re-reads the group's contest list and offers only contests that are not tracked yet. It also replaces placeholder sheet names (such as "Contest 123") with the real names |
| **Open** | Opens the group on Codeforces |
| **Edit** | Renames the group |
| **Delete** | After confirmation, removes the group and its sheets. Its students are kept and simply leave that group |

The same group cannot be added twice (the group code is compared ignoring letter case).

### Sheets

You can also manage sheets one at a time from **Sheets** in the popup:

- **Add a sheet** by pasting a contest link, or open the contest on Codeforces and click **Use active page**.
- Each sheet needs a **name**, a **link** and a **group**. A contest link from a group (`https://codeforces.com/group/{groupCode}/contest/{contestId}`) must belong to a group you have already saved. Standard contests (`https://codeforces.com/contest/{contestId}`) can be attached to any group.
- **Edit**, **Delete** (with confirmation) and **Open** are available for every sheet.
- The extension converts every link to its standings page automatically:
  - group contests: `https://codeforces.com/group/{groupCode}/contest/{contestId}/standings/groupmates/true`
  - standard contests: `https://codeforces.com/contest/{contestId}/standings`
- The same contest cannot be saved twice (contest id plus group code).
- If a sheet's link is edited, its old saved result is discarded because it no longer matches.

### Sheet names

Names normally come from the contests page of the group. If a sheet ends up with a placeholder name, it is replaced with the real contest name the next time you **Sync** the group or read that sheet. Names you typed yourself are never overwritten.

---

## 4. Students

Open the popup and choose **Students**.

### Fields

| Field | Rules |
|---|---|
| **Name** | Required |
| **Codeforces handle** | Required. Letters, numbers, `_` or `-`, up to 24 characters. A leading `@` is ignored |
| **Groups** | Optional checkboxes, one per saved group. **A student can belong to several groups** |

### Rules

- Handles must be unique, ignoring letter case (`OmarCoder` and `omarcoder` are the same student).
- Deleting a student asks for confirmation.
- Matching against the standings is case-insensitive.
- A student appears on the Dashboard in every group they belong to. A student with no group is not read from any standings; they appear in a "No group" section only if there are sheets or students without a group.
- When you add a student to a group after results were saved, that student shows **Not collected** until you press **Update results** (only the affected group's sheets are read).
- Deleting a group removes that group from its students but keeps the students and their other groups.

### Upgrading from older versions

Data saved by earlier versions is migrated automatically the first time you open the popup or Dashboard: sheets from a Codeforces group get a matching group, and the old single group of a student becomes the new list of groups.

---

## 5. Backup and restore

Backup and restore live on the **Dashboard** (the popup's **Backup & restore** item jumps straight to it). The file chooser is on the Dashboard because Chrome closes the popup when a file dialog opens.

### What a backup contains

A single JSON file with your **groups, sheets and students**, plus your **Done / Not done marks**. It does not contain collected results or preferences.

- The file is named like `icpc-tracker-backup-2026-11-26-14-30-00.json`.
- It contains your students' names and Codeforces handles, so keep it somewhere safe.
- The panel shows when you last made a backup.

### Making a backup

Click **Download backup**. Make one before reinstalling the extension, changing computers, or restoring another file.

### Restoring

1. Click **Restore from file…** and choose a backup file.
2. A preview shows what the file contains. Nothing has changed yet. Entries that are invalid or duplicated are listed and skipped.
3. Choose a mode and click **Restore**:

| Mode | What happens |
|---|---|
| **Merge** (default) | Adds what is missing and keeps everything you have. Groups are matched by Codeforces group code, sheets by contest, students by handle. An existing student keeps their name and simply gains any extra groups from the backup. Marks you already set are kept |
| **Replace** | Makes your data exactly match the backup. A safety copy of your current data is downloaded first, and you must confirm |

### Validation

Nothing in a backup file is trusted blindly:

- the file must be a valid ICPC Tracker backup (a different or corrupted file is rejected with a clear message, and nothing changes);
- backups made by a newer version of the extension are refused;
- every sheet link is checked again, so only real `codeforces.com` contest links survive, and standings links are rebuilt from the contest id;
- group codes, handles and marks are re-validated, duplicates are dropped, and references to missing groups are removed.

Marks are stored by student handle and contest, so they come back on the right cells even though internal ids change during a restore.

---

## 6. Known limitations

- **Not yet tested in a real browser by the author.** The code was checked with static analysis and automated tests that use a simulated browser; please report anything that behaves differently in Chrome.
- The extension depends on Codeforces' page layout. These parts are best-effort and may need adjusting if Codeforces changes its pages: the group contests list, the "Show unofficial" checkbox, the pager, the contest name on standings pages, and the wording of rate-limit pages.
- If the "Show unofficial" option cannot be found or switched on, the affected sheet carries a note (or is marked Partial) because students who took part only unofficially may be missing.
- Reading is done through temporary tabs, so a large number of sheets takes time. Keep the Dashboard tab open until collection finishes; closing it stops the run (results already read are kept).
- Frequent full re-reads increase the number of requests sent to Codeforces. Prefer **Update results** and leave the automatic option off unless you need it.
