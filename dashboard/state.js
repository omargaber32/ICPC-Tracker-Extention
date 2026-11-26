// state.js — shared page state, group sections, saved results and derived cell data.
// Dashboard scripts are plain scripts that share globals; load order: state, collector, render, backup, main.
const $ = (selector) => document.querySelector(selector);

let students = [];
let sheets = [];
let groups = [];
let settings = { autoCollect: false, collapsedGroups: [] };
/** studentId|sheetId -> { status: "done" | "notdone" } — marks the user sets by hand (saved). */
let statuses = {};
/** The table cell whose details are open: { studentId, sheetId } or null. */
let selectedCell = null;
/** sheet.id -> compact result (same shape that is saved). */
const results = new Map();
/** sheet.id -> "waiting" | "reading" for the current run. */
const runState = new Map();
let collecting = false;
let stopRequested = false;
let currentTempTabId = null;
let lastRunSummary = null;
let autoStarted = false; // automatic update happens at most once per page load
const MAX_CONSECUTIVE_FAILURES = 3;

/* ---------- Sections (one table per group) ---------- */
function buildSections() {
  const validGroup = (id) => groups.some(g => g.id === id);
  const sections = groups.map(g => ({
    key: g.id, title: g.name, subtitle: `Group ${g.groupCode}`,
    students: students.filter(s => studentGroupIds(s).includes(g.id)), sheets: sheets.filter(s => s.groupId === g.id),
  }));
  const looseStudents = students.filter(s => !studentGroupIds(s).some(validGroup));
  const looseSheets = sheets.filter(s => !validGroup(s.groupId));
  if (looseStudents.length || looseSheets.length) {
    sections.push({ key: "ungrouped", title: "No group", subtitle: "Students and sheets without a group", students: looseStudents, sheets: looseSheets });
  }
  return sections;
}
const sectionsOfStudent = (student) => buildSections().filter(s => s.students.some(x => x.id === student.id));
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return iso || ""; } };

/* ---------- Saved results ---------- */
function persistResults() {
  const obj = {}; for (const [id, r] of results) obj[id] = r;
  return saveResults(obj).catch(() => setCollectionMessage("Couldn't save results on this device (they are still shown)."));
}
async function loadSaved() {
  const saved = await loadSavedResults();
  results.clear();
  for (const sheet of sheets) {
    const r = saved[sheet.id];
    if (r && r.url === sheet.url && r.found && Array.isArray(r.covered)) results.set(sheet.id, r);
  }
}
const newestCollectedAt = () => [...results.values()].map(r => r.collectedAt).filter(Boolean).sort().pop() || null;

/* ---------- Derived data ---------- */
/** A result only counts if it belongs to the sheet as it is saved now. */
function resultFor(sheet) {
  const r = results.get(sheet.id);
  return r && r.url === sheet.url ? r : null;
}
/** What a table cell should say for a student in a sheet. Missing is never reported as 0. */
function cellFor(student, sheet) {
  const r = resultFor(sheet);
  if (!r) return { kind: runState.get(sheet.id) ? "reading" : "pending" };
  if (r.status === "failed") return { kind: "failed", error: r.error };
  const key = normalizeHandle(student.handle);
  if (!r.covered.includes(key)) return { kind: runState.get(sheet.id) ? "reading" : "pending" }; // student added after this sheet was read
  const solved = r.found[key];
  if (solved) return { kind: "count", count: solved.length, solved, partialSheet: r.status === "partial" };
  return { kind: r.status === "partial" ? "notfound-partial" : "notfound" };
}
function totalFor(student, sectionSheets) {
  let sum = 0, incomplete = false, any = false;
  for (const sheet of sectionSheets) {
    const c = cellFor(student, sheet);
    if (c.kind === "count") { sum += c.count; any = true; } else incomplete = true;
  }
  return { sum, incomplete, any };
}


const statusOf = (student, sheet) => statuses[statusKey(student.id, sheet.id)]?.status || null;

const isCollapsed = (key) => (settings.collapsedGroups || []).includes(key);
