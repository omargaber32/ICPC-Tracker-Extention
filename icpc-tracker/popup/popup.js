const $ = (selector) => document.querySelector(selector);
const DASHBOARD_PATH = "dashboard/index.html";
const MAX_CONTEST_LIST_PAGES = 30;

let students = [];
let sheets = [];
let groups = [];
let editingStudentId = null;
let editingSheetId = null;
let editingGroupId = null;
let pendingImport = null; // { mode: "new" | "sync", group: {...}, contests: [...], selected: Set }
let busy = false;

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const sameCode = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
const groupOf = (id) => groups.find(g => g.id === id) || null;
function setMessage(selector, text = "", state = "") {
  const node = $(selector); node.textContent = text; node.className = `form-message${state ? ` ${state}` : ""}`;
}
function actionButton(label, action, id, extra = "") {
  const b = el("button", `small-btn ${extra}`.trim(), label);
  b.type = "button"; b.dataset.action = action; b.dataset.id = id; return b;
}

/* ---------- Navigation ---------- */
function showView(name) {
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== `view-${name}`;
}
document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (!nav) return;
  if (busy) return;
  showView(nav.dataset.nav);
  if (nav.dataset.nav === "home") { resetStudentForm(); resetSheetForm(); resetGroupForm(); }
});

async function openDashboard(scrollTo = null) {
  const message = $("#home-message");
  message.textContent = ""; message.className = "form-message";
  const url = chrome.runtime.getURL(DASHBOARD_PATH);
  try {
    // An already-open Dashboard answers this ping with its own tab/window ids, so we can focus it
    // without the "tabs" permission. No answer means none is open.
    let existing = null;
    try { existing = await chrome.runtime.sendMessage({ type: "ICPC_TRACKER_PING_DASHBOARD", scrollTo }); } catch { existing = null; }
    if (existing?.tabId) {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: scrollTo ? `${url}#${scrollTo}` : url });
    }
    window.close();
  } catch (error) {
    message.textContent = error.message || "Couldn't open the Dashboard.";
    message.className = "form-message error";
  }
}
$("#open-dashboard").addEventListener("click", () => openDashboard());
$("#open-backup").addEventListener("click", () => openDashboard("backup"));

/* ---------- Shared rendering ---------- */
function groupOptions(select, selectedId) {
  const previous = selectedId !== undefined ? selectedId : select.value;
  select.replaceChildren();
  for (const g of groups) { const o = el("option", "", g.name); o.value = g.id; select.append(o); }
  const none = el("option", "", groups.length ? "No group" : "No groups yet — add one in Groups"); none.value = ""; select.append(none);
  if (selectedId === "") select.value = "";
  else select.value = groups.some(g => g.id === previous) ? previous : (groups[0]?.id || "");
}
function renderGroupChecks(selectedIds) {
  const box = $("#student-groups");
  const selected = new Set(selectedIds ?? [...box.querySelectorAll("input:checked")].map(i => i.value));
  box.replaceChildren();
  if (!groups.length) { box.append(el("div", "check-note", "No groups yet. Add a group in Groups first; you can also leave a student without a group.")); return; }
  for (const g of groups) {
    const row = el("label", "check-row"), input = document.createElement("input");
    input.type = "checkbox"; input.value = g.id; input.checked = selected.has(g.id);
    row.append(input, el("span", "", g.name)); box.append(row);
  }
}
const groupNamesOf = (student) => studentGroupIds(student).map(id => groupOf(id)?.name).filter(Boolean);
function updateCounts() {
  $("#nav-groups-count").textContent = plural(groups.length, "group", "groups");
  $("#nav-students-count").textContent = plural(students.length, "student", "students");
  $("#nav-sheets-count").textContent = plural(sheets.length, "sheet", "sheets");
  $("#group-count").textContent = plural(groups.length, "group", "groups");
  $("#student-count").textContent = plural(students.length, "student", "students");
  $("#sheet-count").textContent = plural(sheets.length, "sheet", "sheets");
}
function renderAll() {
  updateCounts(); renderGroups(); renderStudents(); renderSheets();
  renderGroupChecks(editingStudentId ? studentGroupIds(students.find(s => s.id === editingStudentId)) : undefined);
  groupOptions($("#sheet-group"), editingSheetId ? sheets.find(s => s.id === editingSheetId)?.groupId : undefined);
}

/* ---------- Groups ---------- */
function renderGroups() {
  const list = $("#group-list"); list.replaceChildren();
  if (!groups.length) { list.append(el("div", "empty-state", "No groups yet. Paste a Codeforces group link above to import its sheets.")); return; }
  for (const g of groups) {
    const card = el("article", "item-card");
    const identity = el("div", "item-identity"), details = el("div", "item-details");
    const sCount = sheets.filter(s => s.groupId === g.id).length, stCount = students.filter(s => studentGroupIds(s).includes(g.id)).length;
    details.append(el("strong", "", g.name), el("span", "", `${g.groupCode} · ${plural(stCount, "student", "students")} · ${plural(sCount, "sheet", "sheets")}`));
    identity.append(el("span", "avatar", g.name.trim().charAt(0).toUpperCase() || "G"), details);
    const actions = el("div", "item-actions");
    for (const [label, action, extra] of [["Sync", "sync", ""], ["Open", "open", ""], ["Edit", "edit", ""], ["Delete", "delete", "danger"]]) {
      const b = actionButton(label, action, g.id, extra); b.setAttribute("aria-label", `${label} ${g.name}`); actions.append(b);
    }
    card.append(identity, actions); list.append(card);
  }
}
function resetGroupForm() {
  editingGroupId = null; $("#group-form").reset(); $("#group-url").disabled = false;
  $("#find-sheets").hidden = false; $("#save-group-edit").hidden = true; $("#cancel-group-edit").hidden = true;
  setMessage("#group-form-message");
}
function setBusy(isBusy, message = "") {
  busy = isBusy;
  for (const id of ["#find-sheets", "#import-save"]) $(id).disabled = isBusy;
  $("#group-list").querySelectorAll("button").forEach(b => { b.disabled = isBusy; });
  setMessage("#group-form-message", message);
}

/** Gives tracked sheets that only have a default name ("Contest 123") the real name from the group's list. */
function applyNameFixes(group, contests) {
  let count = 0;
  sheets = sheets.map((sheet) => {
    if (sheet.groupId !== group.id || !isDefaultSheetName(sheet.name)) return sheet;
    const match = contests.find(c => c.contestId === sheet.contestId);
    if (!match || isDefaultSheetName(match.name)) return sheet;
    count++; return { ...sheet, name: match.name, updatedAt: new Date().toISOString() };
  });
  return count;
}

/** Reads a group's contests list(s) through temporary background tabs. */
async function fetchGroupContests(code) {
  const pathRegex = new RegExp(`^/group/${code.replace(/[^A-Za-z0-9_-]/g, "")}/contests`, "i");
  const validatePath = (tabUrl) => assertPathMatches(tabUrl, pathRegex, "group's contests page");
  const type = "ICPC_TRACKER_GET_GROUP_CONTESTS";
  const first = await readInTempTab(`https://codeforces.com/group/${code}/contests`, type, { validatePath });
  if (!first.isGroupContestsPage) throw new Error(first.error || "Codeforces did not show the group's contests page.");
  const found = new Map();
  const add = (data) => { for (const c of data.contests || []) if (!found.has(c.contestId)) found.set(c.contestId, c); };
  add(first);
  const extraPages = [...new Map((first.pageLinks || []).filter(p => p.page > 1).map(p => [p.page, p.path]))].slice(0, MAX_CONTEST_LIST_PAGES);
  let pagesFailed = 0;
  for (const [, path] of extraPages) {
    await politeDelay();
    try { add(await readInTempTab(`https://codeforces.com${path}`, type, { validatePath })); } catch (error) { if (error.blocked) throw error; pagesFailed++; }
  }
  return { contests: [...found.values()], pagesRead: 1 + extraPages.length - pagesFailed, pagesTotal: 1 + extraPages.length };
}

function openImport(data) {
  pendingImport = { ...data, selected: new Set() };
  $("#import-panel").hidden = false; $("#import-filter").value = "";
  $("#import-title").textContent = data.mode === "new" ? `Choose sheets for “${data.group.name}”` : `New sheets in “${data.group.name}”`;
  const note = [`Found ${plural(data.contests.length, "contest", "contests")} not yet tracked.`];
  if (data.alreadyTracked) note.push(`${data.alreadyTracked} already tracked ${data.alreadyTracked === 1 ? "is" : "are"} hidden.`);
  if (data.pagesFailed) note.push(`${plural(data.pagesFailed, "list page", "list pages")} could not be read, so some contests may be missing.`);
  note.push("Tick the ones you want to track.");
  $("#import-note").textContent = note.join(" ");
  renderImportList();
}
function closeImport() { pendingImport = null; $("#import-panel").hidden = true; $("#import-list").replaceChildren(); }
function renderImportList() {
  if (!pendingImport) return;
  const filter = $("#import-filter").value.trim().toLowerCase();
  const list = $("#import-list"); list.replaceChildren();
  const shown = pendingImport.contests.filter(c => !filter || c.name.toLowerCase().includes(filter) || c.contestId.includes(filter));
  if (!shown.length) list.append(el("div", "empty-state", pendingImport.contests.length ? "No contests match the filter." : "No new contests found."));
  for (const c of shown) {
    const row = el("label", "import-row");
    const box = document.createElement("input"); box.type = "checkbox"; box.value = c.contestId; box.checked = pendingImport.selected.has(c.contestId);
    row.append(box, el("span", "import-name", c.name), el("small", "", `#${c.contestId}`)); row.title = c.name; list.append(row);
  }
  $("#import-count").textContent = `${pendingImport.selected.size} selected`;
}
$("#import-list").addEventListener("change", (event) => {
  const box = event.target.closest("input[type=checkbox]"); if (!box || !pendingImport) return;
  box.checked ? pendingImport.selected.add(box.value) : pendingImport.selected.delete(box.value);
  $("#import-count").textContent = `${pendingImport.selected.size} selected`;
});
$("#import-filter").addEventListener("input", renderImportList);
$("#import-all").addEventListener("click", () => {
  if (!pendingImport) return;
  const filter = $("#import-filter").value.trim().toLowerCase();
  for (const c of pendingImport.contests) if (!filter || c.name.toLowerCase().includes(filter) || c.contestId.includes(filter)) pendingImport.selected.add(c.contestId);
  renderImportList();
});
$("#import-none").addEventListener("click", () => { if (pendingImport) { pendingImport.selected.clear(); renderImportList(); } });
$("#import-cancel").addEventListener("click", () => { closeImport(); setMessage("#group-form-message", "Nothing was saved."); });
$("#import-save").addEventListener("click", async () => {
  if (!pendingImport || busy) return;
  const { mode, group, contests, selected } = pendingImport;
  const now = new Date().toISOString();
  const chosen = contests.filter(c => selected.has(c.contestId)).sort((a, b) => Number(a.contestId) - Number(b.contestId));
  const newSheets = [];
  for (const c of chosen) {
    if (sheets.some(s => s.contestId === c.contestId && sameCode(s.groupCode, group.groupCode))) continue;
    newSheets.push({ id: createId(), name: c.name, ...parseContestUrl(`https://codeforces.com/group/${group.groupCode}/contest/${c.contestId}`), groupId: group.id, createdAt: now });
  }
  const previous = { groups, sheets };
  const nextGroups = mode === "new" ? [...groups, group] : groups;
  const nextSheets = [...sheets, ...newSheets];
  try {
    await persistConfig({ groups: nextGroups, sheets: nextSheets });
    groups = nextGroups; sheets = nextSheets;
    closeImport(); resetGroupForm(); renderAll();
    setMessage("#group-form-message", mode === "new"
      ? `Group “${group.name}” saved with ${plural(newSheets.length, "sheet", "sheets")}.`
      : `${plural(newSheets.length, "sheet", "sheets")} added to “${group.name}”.`, "success");
  } catch {
    groups = previous.groups; sheets = previous.sheets; renderAll();
    setMessage("#group-form-message", "Couldn't save. Please try again.", "error");
  }
});

$("#group-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  if (editingGroupId) { await saveGroupName(); return; }
  closeImport();
  let parsed;
  try { parsed = parseGroupUrl($("#group-url").value); }
  catch (error) { setMessage("#group-form-message", error.message, "error"); $("#group-url").focus(); return; }
  const dup = groups.find(g => sameCode(g.groupCode, parsed.groupCode));
  if (dup) { setMessage("#group-form-message", `This group is already saved as “${dup.name}”. Use Sync to look for new sheets.`, "error"); return; }
  const name = $("#group-name").value.trim() || `Group ${parsed.groupCode}`;
  setBusy(true, "Opening the group's contests page in a background tab…");
  try {
    const { contests, pagesFailed = 0, pagesTotal, pagesRead } = await fetchGroupContests(parsed.groupCode);
    setBusy(false);
    if (!contests.length) { setMessage("#group-form-message", "No contests were found. Check that you're logged in to Codeforces and are a member of this group.", "error"); return; }
    setMessage("#group-form-message", "");
    openImport({ mode: "new", group: { id: createId(), name, groupCode: parsed.groupCode, url: parsed.url, createdAt: new Date().toISOString() }, contests, alreadyTracked: 0, pagesFailed: pagesTotal - pagesRead });
  } catch (error) { setBusy(false); setMessage("#group-form-message", error.message || "Couldn't read the group's contests.", "error"); }
});
async function saveGroupName() {
  const group = groupOf(editingGroupId); const name = $("#group-name").value.trim();
  if (!group) { resetGroupForm(); return; }
  if (!name) { setMessage("#group-form-message", "Enter a group name.", "error"); return; }
  const previous = groups; groups = groups.map(g => g.id === group.id ? { ...g, name, updatedAt: new Date().toISOString() } : g);
  try { await persistConfig({ groups }); renderAll(); resetGroupForm(); setMessage("#group-form-message", "Group renamed.", "success"); }
  catch { groups = previous; renderAll(); setMessage("#group-form-message", "Couldn't save the group. Please try again.", "error"); }
}
$("#cancel-group-edit").addEventListener("click", resetGroupForm);

$("#group-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]"); if (!button || busy) return;
  const group = groupOf(button.dataset.id); if (!group) return;
  const action = button.dataset.action;
  if (action === "open") { await chrome.tabs.create({ url: group.url }); return; }
  if (action === "edit") {
    closeImport(); editingGroupId = group.id; $("#group-url").value = group.url; $("#group-url").disabled = true; $("#group-name").value = group.name;
    $("#find-sheets").hidden = true; $("#save-group-edit").hidden = false; $("#cancel-group-edit").hidden = false;
    setMessage("#group-form-message", `Editing ${group.name}.`); $("#group-name").focus(); return;
  }
  if (action === "sync") {
    closeImport(); resetGroupForm();
    setBusy(true, `Looking for new sheets in “${group.name}”…`);
    try {
      const { contests, pagesTotal, pagesRead } = await fetchGroupContests(group.groupCode);
      setBusy(false);
      const renamed = applyNameFixes(group, contests);
      if (renamed) { try { await persistConfig({ sheets }); renderAll(); } catch { /* names are cosmetic */ } }
      const renameNote = renamed ? ` Updated ${plural(renamed, "sheet name", "sheet names")}.` : "";
      const fresh = contests.filter(c => !sheets.some(s => s.contestId === c.contestId && sameCode(s.groupCode, group.groupCode)));
      if (!contests.length) { setMessage("#group-form-message", "No contests were found. Check that you're logged in to Codeforces and are a member of this group.", "error"); return; }
      if (!fresh.length) { setMessage("#group-form-message", `No new sheets. Everything in this group is already tracked.${renameNote}`, "success"); return; }
      setMessage("#group-form-message", "");
      openImport({ mode: "sync", group, contests: fresh, alreadyTracked: contests.length - fresh.length, pagesFailed: pagesTotal - pagesRead });
    } catch (error) { setBusy(false); setMessage("#group-form-message", error.message || "Couldn't read the group's contests.", "error"); }
    return;
  }
  if (action === "delete") {
    const sCount = sheets.filter(s => s.groupId === group.id).length, stCount = students.filter(s => studentGroupIds(s).includes(group.id)).length;
    if (!window.confirm(`Delete group “${group.name}”?\n\nIts ${plural(sCount, "sheet", "sheets")} will be removed. Its ${plural(stCount, "student", "students")} will be kept (they stay in any other groups they belong to).`)) return;
    const previous = { groups, sheets, students };
    groups = groups.filter(g => g.id !== group.id);
    sheets = sheets.filter(s => s.groupId !== group.id);
    students = students.map(s => studentGroupIds(s).includes(group.id) ? { ...s, groupIds: studentGroupIds(s).filter(id => id !== group.id) } : s);
    try { await persistConfig({ groups, sheets, students }); if (editingGroupId === group.id) resetGroupForm(); renderAll(); setMessage("#group-form-message", `“${group.name}” was deleted.`, "success"); }
    catch { ({ groups, sheets, students } = previous); renderAll(); setMessage("#group-form-message", "Couldn't delete the group. Please try again.", "error"); }
  }
});

/* ---------- Students ---------- */
function renderStudents() {
  const list = $("#student-list"); list.replaceChildren();
  if (!students.length) { list.append(el("div", "empty-state", "No students yet. Add your first student above.")); return; }
  for (const s of students) {
    const card = el("article", "item-card"), identity = el("div", "item-identity"), details = el("div", "item-details");
    details.append(el("strong", "", s.name), el("span", "", `@${s.handle} · ${groupNamesOf(s).join(", ") || "No group"}`));
    identity.append(el("span", "avatar", s.name.trim().charAt(0).toUpperCase() || "?"), details);
    const actions = el("div", "item-actions");
    const edit = actionButton("Edit", "edit", s.id); edit.setAttribute("aria-label", `Edit ${s.name}`);
    const del = actionButton("Delete", "delete", s.id, "danger"); del.setAttribute("aria-label", `Delete ${s.name}`);
    actions.append(edit, del); card.append(identity, actions); list.append(card);
  }
}
function resetStudentForm() {
  editingStudentId = null; $("#student-form").reset(); renderGroupChecks(groups[0] ? [groups[0].id] : []);
  $("#save-student").textContent = "Add student"; $("#cancel-edit").hidden = true; setMessage("#form-message");
}
$("#student-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#student-name").value.trim();
  const handle = $("#student-handle").value.trim().replace(/^@/, "");
  const groupIds = [...$("#student-groups").querySelectorAll("input:checked")].map(i => i.value);
  if (!name) { setMessage("#form-message", "Enter the student's name.", "error"); $("#student-name").focus(); return; }
  if (!handle || !isValidHandle(handle)) { setMessage("#form-message", "Enter a valid Codeforces handle (letters, numbers, _ or -; up to 24 characters).", "error"); $("#student-handle").focus(); return; }
  const dup = students.find(s => normalizeHandle(s.handle) === normalizeHandle(handle) && s.id !== editingStudentId);
  if (dup) { setMessage("#form-message", `The handle @${dup.handle} is already in your list.`, "error"); return; }
  const wasEditing = Boolean(editingStudentId); const previous = students; const now = new Date().toISOString();
  students = wasEditing
    ? students.map(s => s.id === editingStudentId ? { ...s, name, handle, groupIds, updatedAt: now } : s)
    : [...students, { id: createId(), name, handle, groupIds, createdAt: now }];
  try {
    await persistConfig({ students }); resetStudentForm(); renderAll();
    setMessage("#form-message", wasEditing ? "Student updated." : "Student added.", "success");
  } catch { students = previous; renderAll(); setMessage("#form-message", "Couldn't save the student. Please try again.", "error"); }
});
$("#cancel-edit").addEventListener("click", resetStudentForm);
$("#student-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const student = students.find(s => s.id === button.dataset.id); if (!student) return;
  if (button.dataset.action === "edit") {
    editingStudentId = student.id; $("#student-name").value = student.name; $("#student-handle").value = student.handle;
    renderGroupChecks(studentGroupIds(student));
    $("#save-student").textContent = "Save changes"; $("#cancel-edit").hidden = false;
    setMessage("#form-message", `Editing ${student.name}.`); $("#student-name").focus(); return;
  }
  if (!window.confirm(`Delete ${student.name} (@${student.handle}) from your student list?`)) return;
  const previous = students; students = students.filter(s => s.id !== student.id);
  try {
    await persistConfig({ students }); if (editingStudentId === student.id) resetStudentForm(); renderAll();
    setMessage("#form-message", `${student.name} was deleted.`, "success");
  } catch { students = previous; renderAll(); setMessage("#form-message", "Couldn't delete the student. Please try again.", "error"); }
});

/* ---------- Sheets ---------- */
function renderSheets() {
  const list = $("#sheet-list"); list.replaceChildren();
  if (!sheets.length) { list.append(el("div", "empty-state", "No sheets yet. Import them from a group, or add a contest link above.")); return; }
  for (const sheet of sheets) {
    const card = el("article", "item-card"), identity = el("div", "item-identity"), details = el("div", "item-details");
    details.append(el("strong", "", sheet.name), el("span", "", `${groupOf(sheet.groupId)?.name || "No group"} · Contest ${sheet.contestId}`));
    identity.append(el("span", "avatar", "CF"), details);
    const actions = el("div", "item-actions");
    for (const [label, action, extra] of [["Open", "open", ""], ["Edit", "edit", ""], ["Delete", "delete", "danger"]]) {
      const b = actionButton(label, action, sheet.id, extra); b.setAttribute("aria-label", `${label} ${sheet.name}`); actions.append(b);
    }
    card.append(identity, actions); list.append(card);
  }
}
function resetSheetForm() {
  editingSheetId = null; $("#sheet-form").reset(); groupOptions($("#sheet-group"), undefined);
  $("#save-sheet").textContent = "Add sheet"; $("#cancel-sheet-edit").hidden = true; setMessage("#sheet-form-message");
}
$("#sheet-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#sheet-name").value.trim();
  if (!name) { setMessage("#sheet-form-message", "Enter a name for this sheet.", "error"); $("#sheet-name").focus(); return; }
  let parsed;
  try { parsed = parseContestUrl($("#sheet-url").value); }
  catch (error) { setMessage("#sheet-form-message", error.message, "error"); $("#sheet-url").focus(); return; }
  let group = groupOf($("#sheet-group").value);
  if (parsed.groupCode) {
    const owner = groups.find(g => sameCode(g.groupCode, parsed.groupCode));
    if (!owner) { setMessage("#sheet-form-message", `This contest belongs to group ${parsed.groupCode}, which isn't saved yet. Add the group in Groups first.`, "error"); return; }
    if (group && group.id !== owner.id) { setMessage("#sheet-form-message", `This contest belongs to “${owner.name}”. Select that group, or choose “No group” to use it automatically.`, "error"); return; }
    group = owner;
  }
  const dup = sheets.find(s => s.contestId === parsed.contestId && sameCode(s.groupCode, parsed.groupCode) && s.id !== editingSheetId);
  if (dup) { setMessage("#sheet-form-message", `Contest ${parsed.contestId} is already saved as “${dup.name}”.`, "error"); return; }
  const wasEditing = Boolean(editingSheetId); const previous = sheets; const now = new Date().toISOString();
  const groupId = group?.id || null;
  sheets = wasEditing
    ? sheets.map(s => s.id === editingSheetId ? { ...s, name, ...parsed, groupId, updatedAt: now } : s)
    : [...sheets, { id: createId(), name, ...parsed, groupId, createdAt: now }];
  try {
    await persistConfig({ sheets }); resetSheetForm(); renderAll();
    setMessage("#sheet-form-message", wasEditing ? "Sheet updated." : "Sheet saved.", "success");
  } catch { sheets = previous; renderAll(); setMessage("#sheet-form-message", "Couldn't save this sheet. Please try again.", "error"); }
});
$("#cancel-sheet-edit").addEventListener("click", resetSheetForm);
$("#use-active-sheet").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error("Couldn't read the active tab URL. Open a Codeforces contest page first.");
    const parsed = parseContestUrl(tab.url);
    $("#sheet-url").value = tab.url;
    if (!$("#sheet-name").value.trim()) $("#sheet-name").value = `Contest ${parsed.contestId}`;
    const owner = parsed.groupCode ? groups.find(g => sameCode(g.groupCode, parsed.groupCode)) : null;
    if (owner) $("#sheet-group").value = owner.id;
    setMessage("#sheet-form-message", "Active Codeforces contest link filled in. Check the name and group, then save.", "success");
  } catch (error) { setMessage("#sheet-form-message", error.message || "Open a Codeforces contest page first.", "error"); }
});
$("#sheet-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const sheet = sheets.find(s => s.id === button.dataset.id); if (!sheet) return;
  const action = button.dataset.action;
  if (action === "open") { await chrome.tabs.create({ url: sheet.url }); return; }
  if (action === "edit") {
    editingSheetId = sheet.id; $("#sheet-name").value = sheet.name; $("#sheet-url").value = sheet.url;
    groupOptions($("#sheet-group"), sheet.groupId || "");
    $("#save-sheet").textContent = "Save changes"; $("#cancel-sheet-edit").hidden = false;
    setMessage("#sheet-form-message", `Editing ${sheet.name}.`); $("#sheet-name").focus(); return;
  }
  if (!window.confirm(`Delete “${sheet.name}” (Contest ${sheet.contestId}) from your sheets?`)) return;
  const previous = sheets; sheets = sheets.filter(s => s.id !== sheet.id);
  try {
    await persistConfig({ sheets }); if (editingSheetId === sheet.id) resetSheetForm(); renderAll();
    setMessage("#sheet-form-message", `“${sheet.name}” was deleted.`, "success");
  } catch { sheets = previous; renderAll(); setMessage("#sheet-form-message", "Couldn't delete this sheet. Please try again.", "error"); }
});

/* ---------- Current page strip ---------- */
function setStatus(message, state = "neutral") {
  $("#page-status").textContent = message; $("#status-dot").className = `status-dot ${state}`;
}
async function inspectCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { setStatus("Couldn't identify the active tab.", "error"); return; }
    const info = await chrome.tabs.sendMessage(tab.id, { type: "ICPC_TRACKER_GET_PAGE_INFO" });
    if (!info?.isStandingsPage) { setStatus("Open a Codeforces contest standings page to inspect it.", "error"); return; }
    setStatus("Codeforces standings page detected.", "success");
    $("#contest-id").textContent = info.contestId || "—";
    $("#group-code").textContent = info.groupCode || "Standard contest";
    $("#problem-count").textContent = String(info.problemCount);
    $("#participant-count").textContent = String(info.participantCount);
    $("#page-details").hidden = false;
  } catch { setStatus("This tab isn't a supported Codeforces standings page, or it hasn't finished loading.", "error"); }
}

/* ---------- Init ---------- */
async function init() {
  try { ({ students, sheets, groups } = await migrateData()); }
  catch { setMessage("#home-message", "Couldn't load saved data from this browser.", "error"); }
  renderAll();
  inspectCurrentPage();
}
init();
