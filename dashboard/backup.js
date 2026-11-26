// backup.js — download / restore of groups, sheets, students (and your Done / Not done marks).
/* ---------- Backup & restore ---------- */
const APP_VERSION = chrome.runtime.getManifest?.().version || "";
let pendingRestore = null;

function downloadJson(filename, object) {
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = href; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const setBackupMessage = (text, kind = "") => { const n = $("#backup-message"); n.textContent = text; n.className = `muted status-line ${kind}`.trim(); };

function renderBackupPanel() {
  $("#last-backup").textContent = settings.lastBackupAt ? `Last backup: ${fmtTime(settings.lastBackupAt)}` : "No backup made yet.";
  $("#backup-count").textContent = `${groups.length} groups · ${sheets.length} sheets · ${students.length} students`;
}
async function makeBackup() {
  try {
    downloadJson(`icpc-tracker-backup-${stamp()}.json`, buildBackup({ students, sheets, groups, statuses }, APP_VERSION));
    settings = { ...settings, lastBackupAt: new Date().toISOString() }; await saveSettings(settings);
    renderBackupPanel(); setBackupMessage(`Backup downloaded: ${groups.length} groups, ${sheets.length} sheets, ${students.length} students. Keep the file somewhere safe; it contains your students' names and handles.`, "ok");
  } catch { setBackupMessage("Couldn't create the backup file.", "bad"); }
}
function resetRestore() { pendingRestore = null; $("#restore-file").value = ""; $("#restore-preview").hidden = true; $("#restore-preview-body").replaceChildren(); }
$("#backup-btn").addEventListener("click", makeBackup);
$("#restore-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; resetRestore(); if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) { setBackupMessage("That file is too large to be an ICPC Tracker backup.", "bad"); return; }
  let parsed;
  try { parsed = parseBackup(await file.text()); } catch { parsed = { ok: false, error: "Couldn't read that file." }; }
  if (!parsed.ok) { setBackupMessage(parsed.error, "bad"); $("#restore-file").value = ""; return; }
  pendingRestore = parsed;
  const s = parsed.summary, body = $("#restore-preview-body"); body.replaceChildren();
  body.append(el("p", "", `Backup contains ${s.groups} groups, ${s.sheets} sheets and ${s.students} students${s.statuses ? ` (plus ${s.statuses} Done / Not done marks)` : ""}${s.exportedAt ? ` (made ${fmtTime(s.exportedAt)})` : ""}.`));
  if (parsed.warnings.length) {
    const list = el("ul", "warn-list"); for (const w of parsed.warnings.slice(0, 8)) list.append(el("li", "", w));
    if (parsed.warnings.length > 8) list.append(el("li", "", `…and ${parsed.warnings.length - 8} more.`));
    body.append(el("p", "", "Some entries were skipped because they were invalid or duplicated:"), list);
  }
  $("#restore-preview").hidden = false; setBackupMessage("Choose how to restore, then confirm.");
});
$("#restore-cancel").addEventListener("click", () => { resetRestore(); setBackupMessage("Restore cancelled. Nothing was changed."); });
$("#restore-btn").addEventListener("click", async () => {
  if (!pendingRestore || collecting) return;
  const mode = document.querySelector("input[name=restore-mode]:checked")?.value || "merge";
  const incoming = pendingRestore.data;
  try {
    if (mode === "replace") {
      if (!window.confirm(`Replace ALL current groups, sheets and students with the backup?\n\nA safety copy of your current data is downloaded first.`)) return;
      downloadJson(`icpc-tracker-before-restore-${stamp()}.json`, buildBackup({ students, sheets, groups, statuses }, APP_VERSION));
      const restored = naturalToStatuses(incoming.statuses, incoming.students, incoming.sheets).map;
      await persistConfig({ students: incoming.students, sheets: incoming.sheets, groups: incoming.groups, statuses: restored });
      setBackupMessage(`Restored ${incoming.groups.length} groups, ${incoming.sheets.length} sheets and ${incoming.students.length} students (replaced the previous data).`, "ok");
    } else {
      const merged = mergeBackup({ students, sheets, groups }, incoming);
      const withMarks = naturalToStatuses(incoming.statuses, merged.students, merged.sheets, statuses);
      await persistConfig({ students: merged.students, sheets: merged.sheets, groups: merged.groups, statuses: withMarks.map });
      const c = merged.counts; c.statuses = withMarks.added;
      setBackupMessage(`Merged: added ${c.groups} groups, ${c.sheets} sheets, ${c.students} students; ${c.studentsUpdated} students got extra groups${c.statuses ? `; ${c.statuses} Done / Not done marks added` : ""}; ${c.skipped} items already existed.`, "ok");
    }
    resetRestore();
    [students, sheets, groups] = await Promise.all([loadStudents(), loadSheets(), loadGroups()]);
    statuses = await loadStatuses();
    await loadSaved(); lastRunSummary = null; renderAll();
  } catch { setBackupMessage("Couldn't restore the backup. Your data was not changed.", "bad"); }
});

