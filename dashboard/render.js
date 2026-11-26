// render.js — draws the Results panel, one table per group and the Individual View.
/* ---------- Rendering ---------- */
function setCollectionMessage(text) { $("#collection-message").textContent = text; }

function renderCollectionPanel() {
  $("#stat-groups").textContent = String(groups.length);
  $("#stat-students").textContent = String(students.length);
  $("#stat-sheets").textContent = String(sheets.length);
  for (const id of ["#update-btn", "#reread-btn", "#clear-btn"]) $(id).disabled = collecting;
  $("#update-btn").textContent = collecting ? "Collecting…" : "Update results";
  $("#stop-btn").hidden = !collecting; $("#stop-btn").disabled = stopRequested;
  $("#auto-toggle").checked = Boolean(settings.autoCollect);
  const pill = $("#collection-state");
  let label = results.size ? "Saved results" : "Not collected", cls = "";
  if (collecting) { label = "Collecting"; cls = "busy"; }
  else if (lastRunSummary) {
    if (lastRunSummary.blocked) { label = "Blocked by Codeforces"; cls = "error"; }
    else if (lastRunSummary.failed && lastRunSummary.failed === lastRunSummary.read) { label = "Failed"; cls = "error"; }
    else if (lastRunSummary.failed || lastRunSummary.partial || lastRunSummary.stopped) { label = "Partial"; cls = "warn"; }
    else { label = "Up to date"; cls = "success"; }
  }
  pill.textContent = label; pill.className = `status-pill${cls ? ` ${cls}` : ""}`;
  const newest = newestCollectedAt();
  if (!collecting && !lastRunSummary && newest) setCollectionMessage(`Showing saved results. Newest data: ${fmtTime(newest)}.`);
}

function renderCell(student, sheet) {
  const td = renderCellBase(student, sheet);
  td.dataset.student = student.id; td.dataset.sheet = sheet.id; td.tabIndex = 0;
  td.classList.add("cell-click");
  const status = statusOf(student, sheet);
  if (status) td.classList.add(`status-${status}`);
  if (selectedCell && selectedCell.studentId === student.id && selectedCell.sheetId === sheet.id) td.classList.add("cell-selected");
  td.title += `${td.title ? " — " : ""}Click for details${status ? ` · marked ${status === "done" ? "Done" : "Not done"}` : ""}`;
  return td;
}
function renderCellBase(student, sheet) {
  const c = cellFor(student, sheet);
  switch (c.kind) {
    case "count": { const td = el("td", `cell-count${c.count === 0 ? " zero" : ""}`, String(c.count)); td.title = `${student.name}: ${c.count} solved in ${sheet.name}`; return td; }
    case "notfound": { const td = el("td", "cell-notfound", "Not found"); td.title = `@${student.handle} was not present in the collected standings for ${sheet.name}. This is not a score of 0.`; return td; }
    case "notfound-partial": { const td = el("td", "cell-partial", "Not found (partial)"); td.title = `Only part of ${sheet.name}'s standings was collected, so @${student.handle} may be on a page that was not read.`; return td; }
    case "failed": { const td = el("td", "cell-failed", "Failed"); td.title = c.error || "This sheet could not be collected."; return td; }
    case "reading": return el("td", "cell-pending", "Reading…");
    default: return el("td", "cell-pending", "Not collected");
  }
}

function sheetSubLabel(sheet) {
  const state = runState.get(sheet.id), r = resultFor(sheet);
  if (state === "reading") return ["reading", "Reading…"];
  if (state === "waiting") return ["", "Waiting"];
  if (r?.refreshError) return ["partial", "Update failed"];
  if (r?.status === "partial") return ["partial", "Partial"];
  if (r?.status === "failed") return ["failed", "Failed"];
  return null;
}

function renderSection(section) {
  const collapsed = isCollapsed(section.key);
  const panel = el("section", `panel group-panel${collapsed ? " collapsed" : ""}`);
  panel.dataset.key = section.key;
  const title = el("div", "section-title");
  const leftWrap = el("div", "group-head-left");
  const index = groups.findIndex(g => g.id === section.key); // -1 for the "No group" section (not movable)
  if (index >= 0) {
    const grip = el("span", "drag-handle", "⠿"); grip.draggable = true; grip.dataset.drag = section.key; grip.title = "Drag to reorder"; grip.setAttribute("aria-hidden", "true");
    leftWrap.append(grip);
  }
  const toggle = el("button", "icon-btn chevron", collapsed ? "▸" : "▾"); toggle.type = "button"; toggle.dataset.toggle = section.key;
  toggle.setAttribute("aria-expanded", String(!collapsed)); toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${section.title}`); toggle.title = collapsed ? "Expand" : "Minimise";
  const left = el("div"); left.append(el("p", "eyebrow", "GROUP"));
  const h = el("h2", "group-title", section.title); h.append(el("small", "", section.subtitle)); h.dataset.toggle = section.key; left.append(h);
  leftWrap.append(toggle, left);
  const right = el("div", "group-actions");
  right.append(el("span", "count-pill", `${section.students.length} students · ${section.sheets.length} sheets`));
  if (index >= 0) {
    const up = el("button", "icon-btn", "↑"); up.type = "button"; up.dataset.move = "-1"; up.dataset.key = section.key; up.disabled = index === 0; up.title = "Move up"; up.setAttribute("aria-label", `Move ${section.title} up`);
    const down = el("button", "icon-btn", "↓"); down.type = "button"; down.dataset.move = "1"; down.dataset.key = section.key; down.disabled = index === groups.length - 1; down.title = "Move down"; down.setAttribute("aria-label", `Move ${section.title} down`);
    right.append(up, down);
  }
  if (section.students.length && section.sheets.length) {
    const update = el("button", "btn small", "Update"); update.type = "button"; update.dataset.scope = section.key; update.dataset.mode = "update"; update.disabled = collecting; update.title = "Read only this group's missing or failed sheets";
    const reread = el("button", "btn small", "Re-read"); reread.type = "button"; reread.dataset.scope = section.key; reread.dataset.mode = "force"; reread.disabled = collecting; reread.title = "Fetch all of this group's sheets again";
    right.append(update, reread);
  }
  title.append(leftWrap, right); panel.append(title);

  if (collapsed) {
    const failed = section.sheets.filter(s => resultFor(s)?.status === "failed").length;
    const partial = section.sheets.filter(s => resultFor(s)?.status === "partial").length;
    const marks = section.students.reduce((n, st) => n + section.sheets.filter(sh => statusOf(st, sh)).length, 0);
    const bits = [];
    if (failed) bits.push(`${failed} failed`); if (partial) bits.push(`${partial} partial`);
    panel.append(el("p", "collapsed-summary", bits.length ? `Minimised · ${bits.join(" · ")}` : "Minimised"));
    return panel;
  }

  if (!section.students.length || !section.sheets.length) {
    panel.append(el("div", "empty-state", !section.students.length && !section.sheets.length
      ? "This group has no students or tracked sheets yet."
      : !section.students.length ? "No students in this group yet. Add students and choose this group in the popup."
      : "No tracked sheets in this group yet. Use Sync in the popup's Groups view."));
    return panel;
  }
  const scroll = el("div", "table-scroll"), table = el("table", "summary-table");
  const head = el("thead"), headRow = el("tr");
  headRow.append(el("th", "student-col", "Student"));
  for (const sheet of section.sheets) {
    const th = el("th", "", sheet.name);
    const r = resultFor(sheet); th.title = r?.collectedAt ? `${sheet.name} — collected ${fmtTime(r.collectedAt)}` : sheet.name;
    const sub = sheetSubLabel(sheet);
    if (sub) { const s = el("span", `sheet-sub ${sub[0]}`.trim(), sub[1]); if (r?.error || r?.refreshError) s.title = r.error || r.refreshError; th.append(s); }
    headRow.append(th);
  }
  headRow.append(el("th", "total-col", "Total")); head.append(headRow);
  const body = el("tbody");
  for (const student of section.students) {
    const row = el("tr");
    const name = el("th", "student-col", student.name); name.scope = "row"; name.title = `@${student.handle}`; row.append(name);
    for (const sheet of section.sheets) row.append(renderCell(student, sheet));
    const t = totalFor(student, section.sheets);
    const total = el("td", t.any ? "total-col cell-count" : "total-col cell-pending", t.any ? `${t.sum}${t.incomplete ? "*" : ""}` : "—");
    if (t.any && t.incomplete) total.title = "Total of the sheets with results. Sheets that are not collected, failed, or where the student was not found are not included.";
    row.append(total); body.append(row);
  }
  table.append(head, body); scroll.append(table); panel.append(scroll);

  const notices = el("div", "notices");
  for (const sheet of section.sheets) {
    const r = resultFor(sheet);
    const text = r?.status === "failed" ? r.error : r?.refreshError || r?.note;
    if (text) { const n = el("div", "notice"); n.append(el("strong", "", `${sheet.name}: `), document.createTextNode(text)); notices.append(n); }
  }
  panel.append(notices);
  return panel;
}

function renderGroups() {
  const root = $("#groups-root"); root.replaceChildren();
  const sections = buildSections();
  if (!sections.length) {
    const panel = el("section", "panel"); panel.append(el("div", "empty-state", "No groups yet. Open the extension popup → Groups and paste a Codeforces group link to import its sheets."));
    root.append(panel); return;
  }
  for (const section of sections) root.append(renderSection(section));
}

function renderDetail() {
  const select = $("#detail-student"), content = $("#detail-content"), previous = select.value;
  select.replaceChildren();
  if (!students.length) {
    const o = el("option", "", "No students available"); o.value = ""; select.append(o);
    content.replaceChildren(el("div", "empty-state", "Add a student from the extension popup to see their details.")); return;
  }
  const names = (s) => studentGroupIds(s).map(id => groups.find(g => g.id === id)?.name).filter(Boolean).join(", ");
  for (const s of students) { const o = el("option", "", `${s.name} (@${s.handle})${names(s) ? ` — ${names(s)}` : ""}`); o.value = s.id; select.append(o); }
  select.value = students.some(s => s.id === previous) ? previous : students[0].id;
  const student = students.find(s => s.id === select.value);
  const sections = sectionsOfStudent(student);
  const head = el("div", "detail-head"); head.append(el("strong", "", student.name), el("span", "", `@${student.handle}${sections.length ? ` · ${sections.map(s => s.title).join(", ")}` : ""}`));
  const blocks = [head];
  if (!sections.length) blocks.push(el("div", "empty-state", "This student isn't in any group yet."));
  for (const section of sections) {
    const block = el("div", "detail-group");
    const t = totalFor(student, section.sheets);
    const title = el("div", "detail-group-title"); title.append(el("strong", "", section.title), el("span", "", t.any ? `Total ${t.sum}${t.incomplete ? "*" : ""}` : "No results yet"));
    const list = el("div", "detail-list");
    if (!section.sheets.length) list.append(el("div", "empty-state", "This group has no tracked sheets."));
    for (const sheet of section.sheets) {
      const c = cellFor(student, sheet), row = el("div", "detail-row");
      const text = c.kind === "count" ? `${c.count} solved` : c.kind === "notfound" ? "Not found" : c.kind === "notfound-partial" ? "Not found (partial)" : c.kind === "failed" ? "Failed" : c.kind === "reading" ? "Reading…" : "Not collected";
      const st = statusOf(student, sheet);
      if (st) row.classList.add(`status-${st}`);
      row.append(el("span", "", sheet.name), el("span", c.kind === "count" ? "cell-count" : "cell-pending", st ? `${text} · ${st === "done" ? "Done" : "Not done"}` : text)); list.append(row);
    }
    block.append(title, list); blocks.push(block);
  }
  content.replaceChildren(...blocks);
}

function renderGroupsToolbar() {
  const bar = $("#groups-toolbar"), n = buildSections().length;
  bar.hidden = n < 1;
  $("#expand-all").disabled = !buildSections().some(s => isCollapsed(s.key));
  $("#collapse-all").disabled = buildSections().every(s => isCollapsed(s.key));
}

/* ---------- Cell details drawer (solved / not solved + Done / Not done mark) ---------- */
function problemChip(sheet, name, solved) {
  const label = `${solved ? "✓" : "✗"} ${name}`;
  if (/^[A-Za-z0-9]+$/.test(name)) {
    const a = el("a", `chip ${solved ? "chip-solved" : "chip-unsolved"}`, label);
    a.href = sheet.groupCode ? `https://codeforces.com/group/${sheet.groupCode}/contest/${sheet.contestId}/problem/${name}` : `https://codeforces.com/contest/${sheet.contestId}/problem/${name}`;
    a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = `Open problem ${name}`; return a;
  }
  return el("span", `chip ${solved ? "chip-solved" : "chip-unsolved"}`, label);
}
function renderCellDrawer() {
  const drawer = $("#cell-drawer");
  const student = selectedCell && students.find(s => s.id === selectedCell.studentId);
  const sheet = selectedCell && sheets.find(s => s.id === selectedCell.sheetId);
  if (!student || !sheet) { selectedCell = null; drawer.hidden = true; drawer.replaceChildren(); return; }
  const group = groups.find(g => g.id === sheet.groupId);
  const c = cellFor(student, sheet), r = resultFor(sheet), status = statusOf(student, sheet);
  drawer.hidden = false;

  const head = el("div", "drawer-head");
  const titles = el("div"); titles.append(el("strong", "", student.name), el("span", "drawer-sub", `@${student.handle}`), el("span", "drawer-sub", `${sheet.name}${group ? ` · ${group.name}` : ""}`));
  const close = el("button", "drawer-close", "×"); close.type = "button"; close.dataset.drawerClose = "1"; close.setAttribute("aria-label", "Close details");
  head.append(titles, close);

  const statusBox = el("div", "drawer-status"); statusBox.append(el("span", "drawer-label", "Status"));
  const seg = el("div", "segmented"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Status");
  for (const [value, label] of [["done", "Done"], ["notdone", "Not done"], ["", "No status"]]) {
    const b = el("button", `seg seg-${value || "none"}`, label); b.type = "button"; b.dataset.setStatus = value;
    const active = (status || "") === value; if (active) b.classList.add("seg-active"); b.setAttribute("aria-pressed", String(active)); seg.append(b);
  }
  statusBox.append(seg);

  const body = el("div", "drawer-body");
  if (c.kind === "count" && r) {
    const solved = c.solved, unsolved = (r.problems || []).filter(p => !solved.includes(p));
    body.append(el("p", "drawer-summary", `${solved.length} of ${r.problems?.length || r.problemCount || solved.length} problems solved`));
    const s1 = el("div", "chips"); s1.append(el("span", "drawer-label", "Solved")); for (const p of solved) s1.append(problemChip(sheet, p, true)); if (!solved.length) s1.append(el("span", "drawer-none", "None"));
    const s2 = el("div", "chips"); s2.append(el("span", "drawer-label", "Not solved")); for (const p of unsolved) s2.append(problemChip(sheet, p, false)); if (!unsolved.length) s2.append(el("span", "drawer-none", "All solved"));
    body.append(s1, s2);
  } else if (c.kind === "notfound" && r) {
    body.append(el("p", "drawer-summary", "Not found in the collected standings"), el("p", "drawer-note", "No submissions were seen for this student in this sheet. Every problem counts as not solved."));
    const s2 = el("div", "chips"); s2.append(el("span", "drawer-label", "Not solved")); for (const p of r.problems || []) s2.append(problemChip(sheet, p, false)); body.append(s2);
  } else if (c.kind === "notfound-partial") {
    body.append(el("p", "drawer-summary", "Not found (partial standings)"), el("p", "drawer-note", "Only part of this sheet's standings was read, so the student may be on a page that was not. Solved / not solved is unknown."));
  } else if (c.kind === "failed") {
    body.append(el("p", "drawer-summary", "This sheet could not be collected"), el("p", "drawer-note", c.error || ""));
  } else {
    body.append(el("p", "drawer-summary", c.kind === "reading" ? "Reading this sheet…" : "Not collected yet"), el("p", "drawer-note", "Use Update results to read it. You can still set a status."));
  }
  const foot = el("div", "drawer-foot");
  if (r?.collectedAt) foot.append(el("span", "", `Collected ${fmtTime(r.collectedAt)}`));
  const open = el("a", "drawer-link", "Open standings ↗"); open.href = sheet.url; open.target = "_blank"; open.rel = "noopener noreferrer"; foot.append(open);
  drawer.replaceChildren(head, statusBox, body, foot);
}

function renderAll() { renderCollectionPanel(); renderGroups(); renderGroupsToolbar(); renderDetail(); renderBackupPanel(); renderCellDrawer(); }

