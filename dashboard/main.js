// main.js — event wiring and start-up.
/* ---------- Cell selection + Done / Not done ---------- */
function selectCell(studentId, sheetId) { selectedCell = { studentId, sheetId }; renderAll(); }
async function setStatus(value) {
  if (!selectedCell) return;
  const key = statusKey(selectedCell.studentId, selectedCell.sheetId), previous = statuses;
  const next = { ...statuses };
  if (value) next[key] = { status: value, updatedAt: new Date().toISOString() }; else delete next[key];
  statuses = pruneStatuses(next, students, sheets); renderAll();
  try { await saveStatuses(statuses); }
  catch { statuses = previous; renderAll(); setCollectionMessage("Couldn't save the status. Please try again."); }
}
$("#groups-root").addEventListener("click", (event) => {
  const td = event.target.closest("td[data-student]"); if (td) selectCell(td.dataset.student, td.dataset.sheet);
});
$("#groups-root").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const td = event.target.closest("td[data-student]"); if (td) { event.preventDefault(); selectCell(td.dataset.student, td.dataset.sheet); }
});
$("#cell-drawer").addEventListener("click", (event) => {
  if (event.target.closest("[data-drawer-close]")) { selectedCell = null; renderAll(); return; }
  const btn = event.target.closest("button[data-set-status]"); if (btn) setStatus(btn.dataset.setStatus);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && selectedCell) { selectedCell = null; renderAll(); } });

/* ---------- Minimise & rearrange group tables ---------- */
const setGroupsMessage = (text) => { $("#groups-message").textContent = text; };
async function setCollapsed(keys) {
  const valid = new Set(buildSections().map(s => s.key));
  const previous = settings;
  settings = { ...settings, collapsedGroups: [...new Set(keys)].filter(k => valid.has(k)) };
  renderAll();
  try { await saveSettings(settings); } catch { settings = previous; renderAll(); setGroupsMessage("Couldn't save the layout."); }
}
const toggleGroup = (key) => setCollapsed(isCollapsed(key) ? (settings.collapsedGroups || []).filter(k => k !== key) : [...(settings.collapsedGroups || []), key]);
/** Moves group `key` next to `targetKey` (before or after it) and saves the new order with the groups. */
async function reorderGroup(key, targetKey, after) {
  if (key === targetKey) return;
  const from = groups.findIndex(g => g.id === key), moving = groups[from];
  if (!moving || !groups.some(g => g.id === targetKey)) return;
  const rest = groups.filter(g => g.id !== key);
  const at = rest.findIndex(g => g.id === targetKey) + (after ? 1 : 0);
  const next = [...rest.slice(0, at), moving, ...rest.slice(at)];
  if (next.every((g, i) => g.id === groups[i].id)) return;
  const previous = groups; groups = next; renderAll();
  try { await persistConfig({ groups }); setGroupsMessage(`Moved “${moving.name}” to position ${at + 1} of ${groups.length}.`); }
  catch { groups = previous; renderAll(); setGroupsMessage("Couldn't save the new order."); }
}
function moveGroupBy(key, delta) {
  const i = groups.findIndex(g => g.id === key), j = i + delta;
  if (i < 0 || j < 0 || j >= groups.length) return;
  return reorderGroup(key, groups[j].id, delta > 0);
}
$("#collapse-all").addEventListener("click", () => setCollapsed(buildSections().map(s => s.key)));
$("#expand-all").addEventListener("click", () => setCollapsed([]));
$("#groups-root").addEventListener("click", (event) => {
  const move = event.target.closest("button[data-move]");
  if (move) { moveGroupBy(move.dataset.key, Number(move.dataset.move)); return; }
  const t = event.target.closest("[data-toggle]"); if (t) toggleGroup(t.dataset.toggle);
});
// Drag and drop (mouse). The ↑ ↓ buttons do the same for keyboard / touch.
let draggedKey = null;
const clearDropMarks = () => document.querySelectorAll(".drop-before, .drop-after, .dragging").forEach(n => n.classList.remove("drop-before", "drop-after", "dragging"));
const dropPosition = (event, panel) => { const r = panel.getBoundingClientRect(); return event.clientY > r.top + r.height / 2; };
$("#groups-root").addEventListener("dragstart", (event) => {
  const grip = event.target.closest("[data-drag]"); if (!grip) return;
  draggedKey = grip.dataset.drag;
  const panel = grip.closest(".group-panel"); panel.classList.add("dragging");
  try { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", draggedKey); event.dataTransfer.setDragImage(panel, 20, 20); } catch { /* optional */ }
});
$("#groups-root").addEventListener("dragover", (event) => {
  if (!draggedKey) return;
  const panel = event.target.closest(".group-panel"); if (!panel || !groups.some(g => g.id === panel.dataset.key)) return;
  event.preventDefault();
  document.querySelectorAll(".drop-before, .drop-after").forEach(n => n.classList.remove("drop-before", "drop-after"));
  if (panel.dataset.key !== draggedKey) panel.classList.add(dropPosition(event, panel) ? "drop-after" : "drop-before");
});
$("#groups-root").addEventListener("drop", (event) => {
  if (!draggedKey) return;
  const panel = event.target.closest(".group-panel"); const key = draggedKey; draggedKey = null;
  if (!panel) { clearDropMarks(); return; }
  event.preventDefault(); const after = dropPosition(event, panel); clearDropMarks();
  if (groups.some(g => g.id === panel.dataset.key)) reorderGroup(key, panel.dataset.key, after);
});
$("#groups-root").addEventListener("dragend", () => { draggedKey = null; clearDropMarks(); });

/* ---------- Wiring ---------- */
$("#update-btn").addEventListener("click", () => runCollection());
$("#reread-btn").addEventListener("click", () => { if (window.confirm("Re-read every sheet from Codeforces? This opens one temporary tab per sheet.")) runCollection({ force: true }); });
$("#stop-btn").addEventListener("click", () => { stopRequested = true; $("#stop-btn").disabled = true; setCollectionMessage("Stopping after the current sheet…"); });
$("#clear-btn").addEventListener("click", async () => {
  if (collecting || !window.confirm("Delete all saved results from this device? Students, groups and sheets are kept.")) return;
  await clearSavedResults(); results.clear(); lastRunSummary = null; setCollectionMessage("Saved results were cleared."); renderAll();
});
$("#auto-toggle").addEventListener("change", async (event) => {
  settings = { ...settings, autoCollect: event.target.checked };
  try { await saveSettings(settings); setCollectionMessage(settings.autoCollect ? "Automatic update is on: it runs once each time this page opens." : "Automatic update is off."); }
  catch { setCollectionMessage("Couldn't save the setting."); }
});
$("#groups-root").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-scope]"); if (!button || collecting) return;
  if (button.dataset.mode === "force" && !window.confirm("Re-read this group's sheets from Codeforces?")) return;
  runCollection({ scope: button.dataset.scope, force: button.dataset.mode === "force" });
});
$("#detail-student").addEventListener("change", renderDetail);

// Lets the popup find and focus this tab instead of opening a duplicate.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ICPC_TRACKER_PING_DASHBOARD") return;
  if (message.scrollTo === "backup") $("#backup-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  chrome.tabs.getCurrent().then((tab) => sendResponse({ tabId: tab?.id ?? null, windowId: tab?.windowId ?? null }))
    .catch(() => sendResponse(null));
  return true;
});
// Best effort: don't leave a temporary standings tab behind if this page is closed mid-collection.
window.addEventListener("pagehide", () => { if (currentTempTabId !== null) chrome.tabs.remove(currentTempTabId).catch(() => {}); });

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes[STUDENTS_STORAGE_KEY] || changes[CONTESTS_STORAGE_KEY] || changes[GROUPS_STORAGE_KEY]) {
    [students, sheets, groups] = await Promise.all([loadStudents(), loadSheets(), loadGroups()]);
    statuses = pruneStatuses(statuses, students, sheets);
    renderAll();
  }
  if (changes[STATUSES_STORAGE_KEY]) { statuses = await loadStatuses(); renderAll(); }
});
(async () => {
  try {
    ({ students, sheets, groups } = await migrateData());
    settings = { collapsedGroups: [], ...(await loadSettings()) };
    statuses = await loadStatuses();
    await loadSaved();
  } catch { setCollectionMessage("Couldn't load saved data."); }
  renderAll();
  if (location.hash === "#backup") $("#backup-panel")?.scrollIntoView({ block: "start" });
  // Optional automatic update (default OFF): once per page load, only missing/failed sheets, visible and stoppable.
  if (settings.autoCollect && !autoStarted) { autoStarted = true; runCollection({ auto: true }); }
})();

