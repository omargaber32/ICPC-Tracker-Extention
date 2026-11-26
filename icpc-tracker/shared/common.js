// Shared helpers used by the popup and the dashboard page.
// Only students and sheets (contests) configuration is ever persisted.
const STUDENTS_STORAGE_KEY = "icpcTracker.students";
const CONTESTS_STORAGE_KEY = "icpcTracker.contests";
const GROUPS_STORAGE_KEY = "icpcTracker.groups";
const RESULTS_STORAGE_KEY = "icpcTracker.results";
const SETTINGS_STORAGE_KEY = "icpcTracker.settings";
const STATUSES_STORAGE_KEY = "icpcTracker.statuses";

function createId() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeHandle(handle) {
  return String(handle || "").trim().replace(/^@/, "").toLowerCase();
}
function isValidHandle(handle) {
  return /^[A-Za-z0-9_-]{1,24}$/.test(handle);
}
function parseContestUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl).trim()); }
  catch { throw new Error("Enter a valid Codeforces contest URL."); }
  if (parsed.protocol !== "https:" || !["codeforces.com", "www.codeforces.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Only https://codeforces.com contest links are supported.");
  }
  const groupMatch = parsed.pathname.match(/^\/group\/([A-Za-z0-9_-]+)\/contest\/(\d+)(?:\/|$)/i);
  const regularMatch = parsed.pathname.match(/^\/contest\/(\d+)(?:\/|$)/i);
  if (!groupMatch && !regularMatch) throw new Error("The link must point to a Codeforces group contest or a standard contest.");
  const groupCode = groupMatch?.[1] || null;
  const contestId = groupMatch?.[2] || regularMatch?.[1];
  const path = groupCode
    ? `/group/${groupCode}/contest/${contestId}/standings/groupmates/true`
    : `/contest/${contestId}/standings`;
  return { contestId, groupCode, url: `https://codeforces.com${path}` };
}
async function loadStudents() {
  const stored = await chrome.storage.local.get(STUDENTS_STORAGE_KEY);
  const list = stored[STUDENTS_STORAGE_KEY];
  return Array.isArray(list) ? list.filter(s => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.handle === "string") : [];
}
async function saveStudents(students) {
  await chrome.storage.local.set({ [STUDENTS_STORAGE_KEY]: students });
}
async function loadSheets() {
  const stored = await chrome.storage.local.get(CONTESTS_STORAGE_KEY);
  const list = stored[CONTESTS_STORAGE_KEY];
  return Array.isArray(list) ? list.filter(s => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.url === "string") : [];
}
async function saveSheets(sheets) {
  await chrome.storage.local.set({ [CONTESTS_STORAGE_KEY]: sheets });
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- Groups ---------- */
function parseGroupUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl).trim()); }
  catch { throw new Error("Enter a valid Codeforces group link."); }
  if (parsed.protocol !== "https:" || !["codeforces.com", "www.codeforces.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Only https://codeforces.com group links are supported.");
  }
  const match = parsed.pathname.match(/^\/group\/([A-Za-z0-9_-]+)(?:\/|$)/i);
  if (!match) throw new Error("The link must look like https://codeforces.com/group/XXXX (any page inside the group works).");
  return { groupCode: match[1], url: `https://codeforces.com/group/${match[1]}` };
}
async function loadGroups() {
  const stored = await chrome.storage.local.get(GROUPS_STORAGE_KEY);
  const list = stored[GROUPS_STORAGE_KEY];
  return Array.isArray(list) ? list.filter(g => g && typeof g.id === "string" && typeof g.name === "string" && typeof g.groupCode === "string") : [];
}
/** Writes several configuration keys in one call. Only students/groups/sheets are ever persisted. */
async function persistConfig({ students, sheets, groups, statuses }) {
  const payload = {};
  if (statuses) payload[STATUSES_STORAGE_KEY] = statuses;
  if (students) payload[STUDENTS_STORAGE_KEY] = students;
  if (sheets) payload[CONTESTS_STORAGE_KEY] = sheets;
  if (groups) payload[GROUPS_STORAGE_KEY] = groups;
  await chrome.storage.local.set(payload);
}
/** A student can belong to several groups. Older data stored a single `groupId`. */
const studentGroupIds = (student) => Array.isArray(student?.groupIds) ? student.groupIds : (student?.groupId ? [student.groupId] : []);
const sameGroupCode = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/**
 * Upgrades data saved by older versions:
 *  - every sheet that belongs to a Codeforces group gets a matching saved group;
 *  - students get `groupIds` (array) instead of the old single `groupId`, dropping unknown groups;
 *  - if exactly one group had to be created and there were no groups before, students without a group
 *    join it (before groups, every student was tracked against every sheet).
 */
async function migrateData() {
  let [students, sheets, groups] = await Promise.all([loadStudents(), loadSheets(), loadGroups()]);
  const hadGroups = groups.length > 0;
  let changed = false, created = 0;
  for (const sheet of sheets) {
    if (sheet.groupId && groups.some(g => g.id === sheet.groupId)) continue;
    if (sheet.groupCode) {
      let group = groups.find(g => sameGroupCode(g.groupCode, sheet.groupCode));
      if (!group) {
        group = { id: createId(), name: `Group ${sheet.groupCode}`, groupCode: sheet.groupCode, url: `https://codeforces.com/group/${sheet.groupCode}`, createdAt: new Date().toISOString() };
        groups = [...groups, group]; created++;
      }
      sheet.groupId = group.id; changed = true;
    } else if (sheet.groupId) { sheet.groupId = null; changed = true; }
  }
  const assignAll = !hadGroups && created === 1;
  for (const student of students) {
    const hadIds = JSON.stringify(student.groupIds), hadLegacy = "groupId" in student;
    let ids = [...new Set(studentGroupIds(student).filter(id => groups.some(g => g.id === id)))];
    if (assignAll && !ids.length) ids = [groups[0].id];
    student.groupIds = ids; delete student.groupId;
    if (hadLegacy || hadIds !== JSON.stringify(ids)) changed = true;
  }
  if (changed) await persistConfig({ students, sheets, groups });
  return { students, sheets, groups };
}

/* ---------- Temporary background tabs (read-only) ---------- */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGE_LOAD_TIMEOUT_MS = 45000;
// Be gentle with Codeforces: pause between page loads, with a little random jitter.
var REQUEST_DELAY_MS = 3000;
var REQUEST_JITTER_MS = 800;
var UNOFFICIAL_POLL_MS = 500;
const politeDelay = () => sleep(REQUEST_DELAY_MS + Math.random() * REQUEST_JITTER_MS);
/** Thrown when Codeforces shows a rate-limit / captcha / "verify you are human" page. */
class BlockedError extends Error {
  constructor(reason) { super(`Codeforces appears to be limiting requests (${reason}). Collection was stopped. Wait several minutes, open Codeforces normally to confirm it works, then try again.`); this.blocked = true; }
}
// Names that were guessed rather than chosen by the user (so it is safe to replace them with the real name).
const isDefaultSheetName = (name) => /^(contest\s*)?#?\d+$/i.test(String(name || "").trim()) || /^((current|final)\s+)?standings(\s*»)?$/i.test(String(name || "").trim()) || /^enter\s*»?$/i.test(String(name || "").trim());

function waitForTabComplete(tabId, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    const onUpdated = (id, change) => { if (id === tabId && change.status === "complete") finish(); };
    const timer = setTimeout(() => finish(new Error("Timed out while loading the Codeforces page.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") finish(); })
      .catch(() => finish(new Error("The temporary tab was closed before it finished loading.")));
  });
}
async function requestFromTab(tabId, type) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const data = await chrome.tabs.sendMessage(tabId, { type });
      if (data) return data;
    } catch (error) { lastError = error; }
    await sleep(350);
  }
  throw new Error(lastError?.message || "The page reader did not respond. If you are logged out of Codeforces or lack access, log in and try again.");
}
/** Throws a readable error when Codeforces sent the tab somewhere other than the expected page. */
function assertPathMatches(tabUrl, expectedPathRegex, label) {
  if (!tabUrl) throw new Error("Codeforces opened a page this extension can't read. Check that you're logged in and can open it manually.");
  let path;
  try { path = new URL(tabUrl).pathname; } catch { throw new Error("Codeforces opened an unreadable page."); }
  if (/^\/(enter|login)(\/|$)/.test(path)) throw new Error("Codeforces redirected to the login page. Log in to Codeforces in this browser profile, then try again.");
  if (!expectedPathRegex.test(path)) throw new Error(`Codeforces redirected to a different page (${path}) instead of the ${label}. You may not have access.`);
}
/** Reads settings. Defaults: automatic collection is OFF. */
async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return { autoCollect: false, ...(stored[SETTINGS_STORAGE_KEY] || {}) };
}
async function saveSettings(settings) { await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings }); }
/**
 * Saved results (compact): sheetId -> { url, status, collectedAt, problems, covered, found, ... }.
 * They only contain the tracked students' solved problems, nothing about other participants.
 */
async function loadSavedResults() {
  const stored = await chrome.storage.local.get(RESULTS_STORAGE_KEY);
  const value = stored[RESULTS_STORAGE_KEY];
  return value && value.version === 1 && value.results && typeof value.results === "object" ? value.results : {};
}
async function saveResults(resultsObject) { await chrome.storage.local.set({ [RESULTS_STORAGE_KEY]: { version: 1, results: resultsObject } }); }
async function clearSavedResults() { await chrome.storage.local.remove(RESULTS_STORAGE_KEY); }

/** Opens `url` in an inactive tab, asks the content script for data, always closes the tab. */
async function readInTempTab(url, messageType, { validatePath, onTab, prepare } = {}) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (!tabId) throw new Error("Chrome did not return a tab ID.");
    onTab?.(tabId);
    await waitForTabComplete(tabId);
    if (validatePath) validatePath((await chrome.tabs.get(tabId)).url);
    if (prepare) await prepare(tabId);
    const data = await requestFromTab(tabId, messageType);
    if (data?.blocked) throw new BlockedError(data.blocked);
    return data;
  } finally {
    onTab?.(null);
    if (tabId !== null) { try { await chrome.tabs.remove(tabId); } catch { /* already closed */ } }
  }
}

/* ---------- Backup & restore (groups, sheets, students only) ---------- */
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

function buildBackup({ students, sheets, groups, statuses = {} }, appVersion = "") {
  return {
    app: "ICPC Tracker", type: "backup", version: BACKUP_VERSION, appVersion, exportedAt: new Date().toISOString(),
    data: {
      groups: groups.map(g => ({ id: g.id, name: g.name, groupCode: g.groupCode, url: g.url, createdAt: g.createdAt })),
      sheets: sheets.map(s => ({ id: s.id, name: s.name, url: s.url, contestId: s.contestId, groupCode: s.groupCode || null, groupId: s.groupId || null, createdAt: s.createdAt })),
      students: students.map(s => ({ id: s.id, name: s.name, handle: s.handle, groupIds: studentGroupIds(s), createdAt: s.createdAt })),
      statuses: statusesToNatural(statuses, students, sheets),
    },
  };
}

/**
 * Validates and sanitises backup text. Nothing from the file is trusted: URLs are re-parsed (so only real
 * Codeforces contest links survive), handles are re-validated, ids are re-linked, duplicates are dropped.
 * Returns { ok, error?, data?, warnings, summary }.
 */
function parseBackup(text) {
  const fail = (error) => ({ ok: false, error, warnings: [] });
  if (typeof text !== "string" || !text.trim()) return fail("The file is empty.");
  if (text.length > MAX_BACKUP_BYTES) return fail("The file is too large to be an ICPC Tracker backup.");
  let json;
  try { json = JSON.parse(text); } catch { return fail("This file is not valid JSON, so it can't be an ICPC Tracker backup."); }
  if (!json || json.app !== "ICPC Tracker" || json.type !== "backup") return fail("This file is not an ICPC Tracker backup.");
  if (typeof json.version !== "number" || json.version > BACKUP_VERSION) return fail("This backup was made by a newer version of ICPC Tracker. Update the extension first.");
  const raw = json.data || {};
  if (!Array.isArray(raw.groups) || !Array.isArray(raw.sheets) || !Array.isArray(raw.students)) return fail("The backup is missing its groups, sheets or students.");
  const warnings = [];
  const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const used = new Set();
  const uniqueId = (id) => { let x = typeof id === "string" && id && id.length <= 100 && !used.has(id) ? id : createId(); used.add(x); return x; };

  const groups = [], groupIdMap = new Map();
  for (const g of raw.groups) {
    const code = str(g?.groupCode, 60), name = str(g?.name, 80);
    if (!/^[A-Za-z0-9_-]+$/.test(code)) { warnings.push(`Skipped a group with an invalid code (“${name || "unnamed"}”).`); continue; }
    if (groups.some(x => sameGroupCode(x.groupCode, code))) { warnings.push(`Skipped a duplicate group (${code}).`); continue; }
    const id = uniqueId(g.id); groupIdMap.set(g.id, id);
    groups.push({ id, name: name || `Group ${code}`, groupCode: code, url: `https://codeforces.com/group/${code}`, createdAt: str(g.createdAt, 40) || new Date().toISOString() });
  }
  const sheets = [];
  for (const s of raw.sheets) {
    let parsed;
    try { parsed = parseContestUrl(str(s?.url, 500)); } catch { warnings.push(`Skipped sheet “${str(s?.name, 80) || "unnamed"}”: its link is not a Codeforces contest link.`); continue; }
    if (sheets.some(x => x.contestId === parsed.contestId && sameGroupCode(x.groupCode, parsed.groupCode))) { warnings.push(`Skipped a duplicate sheet (contest ${parsed.contestId}).`); continue; }
    let groupId = groupIdMap.get(s.groupId) || null;
    if (!groupId && parsed.groupCode) groupId = groups.find(g => sameGroupCode(g.groupCode, parsed.groupCode))?.id || null;
    sheets.push({ id: uniqueId(s.id), name: str(s.name, 160) || `Contest ${parsed.contestId}`, ...parsed, groupId, createdAt: str(s.createdAt, 40) || new Date().toISOString() });
  }
  const students = [];
  for (const st of raw.students) {
    const handle = str(st?.handle, 40).replace(/^@/, ""), name = str(st?.name, 80);
    if (!name || !isValidHandle(handle)) { warnings.push(`Skipped a student with a missing name or invalid handle (“${name || handle || "unnamed"}”).`); continue; }
    if (students.some(x => normalizeHandle(x.handle) === normalizeHandle(handle))) { warnings.push(`Skipped a duplicate student (@${handle}).`); continue; }
    const legacy = Array.isArray(st.groupIds) ? st.groupIds : (st.groupId ? [st.groupId] : []);
    const ids = [...new Set(legacy.map(id => groupIdMap.get(id)).filter(Boolean))];
    students.push({ id: uniqueId(st.id), name, handle, groupIds: ids, createdAt: str(st.createdAt, 40) || new Date().toISOString() });
  }
  const statuses = [];
  for (const n of Array.isArray(raw.statuses) ? raw.statuses : []) {
    const handle = str(n?.handle, 40).replace(/^@/, ""), contestId = String(n?.contestId ?? "");
    const groupCode = n?.groupCode ? str(n.groupCode, 60) : null;
    if (!STATUS_VALUES.includes(n?.status) || !isValidHandle(handle) || !/^\d{1,12}$/.test(contestId) || (groupCode && !/^[A-Za-z0-9_-]+$/.test(groupCode))) { warnings.push("Skipped an invalid Done / Not done mark."); continue; }
    statuses.push({ handle, groupCode, contestId, status: n.status, updatedAt: str(n.updatedAt, 40) || null });
  }
  return { ok: true, data: { groups, sheets, students, statuses }, warnings, summary: { groups: groups.length, sheets: sheets.length, students: students.length, statuses: statuses.length, exportedAt: str(json.exportedAt, 40) || null, appVersion: str(json.appVersion, 20) || null } };
}

/** Adds what is missing from `incoming` to `current` without touching existing items (groups by Codeforces code, sheets by contest, students by handle). */
function mergeBackup(current, incoming) {
  const groups = current.groups.map(g => ({ ...g })), sheets = current.sheets.map(s => ({ ...s })), students = current.students.map(s => ({ ...s, groupIds: studentGroupIds(s) }));
  const used = new Set([...groups, ...sheets, ...students].map(x => x.id));
  const fresh = (id) => { const x = id && !used.has(id) ? id : createId(); used.add(x); return x; };
  const counts = { groups: 0, sheets: 0, students: 0, studentsUpdated: 0, skipped: 0 };
  const idMap = new Map();
  for (const g of incoming.groups) {
    const existing = groups.find(x => sameGroupCode(x.groupCode, g.groupCode));
    if (existing) { idMap.set(g.id, existing.id); counts.skipped++; continue; }
    const id = fresh(g.id); idMap.set(g.id, id); groups.push({ ...g, id }); counts.groups++;
  }
  for (const s of incoming.sheets) {
    if (sheets.some(x => x.contestId === s.contestId && sameGroupCode(x.groupCode, s.groupCode))) { counts.skipped++; continue; }
    sheets.push({ ...s, id: fresh(s.id), groupId: idMap.get(s.groupId) || null }); counts.sheets++;
  }
  for (const st of incoming.students) {
    const ids = [...new Set(st.groupIds.map(id => idMap.get(id)).filter(Boolean))];
    const existing = students.find(x => normalizeHandle(x.handle) === normalizeHandle(st.handle));
    if (existing) {
      const merged = [...new Set([...existing.groupIds, ...ids])];
      if (merged.length !== existing.groupIds.length) { existing.groupIds = merged; counts.studentsUpdated++; } else counts.skipped++;
      continue;
    }
    students.push({ ...st, id: fresh(st.id), groupIds: ids }); counts.students++;
  }
  return { groups, sheets, students, counts };
}

/* ---------- Done / Not done marks (set by the user per student and sheet) ---------- */
const STATUS_VALUES = ["done", "notdone"];
const statusKey = (studentId, sheetId) => `${studentId}|${sheetId}`;
async function loadStatuses() {
  const stored = await chrome.storage.local.get(STATUSES_STORAGE_KEY);
  const raw = stored[STATUSES_STORAGE_KEY], out = {};
  if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw)) if (v && STATUS_VALUES.includes(v.status)) out[k] = { status: v.status, updatedAt: v.updatedAt || null };
  return out;
}
async function saveStatuses(map) { await chrome.storage.local.set({ [STATUSES_STORAGE_KEY]: map }); }
/** Keeps only marks whose student and sheet still exist. */
function pruneStatuses(map, students, sheets) {
  const sIds = new Set(students.map(s => s.id)), shIds = new Set(sheets.map(s => s.id)), out = {};
  for (const [k, v] of Object.entries(map)) { const [a, b] = k.split("|"); if (sIds.has(a) && shIds.has(b)) out[k] = v; }
  return out;
}
/** id-based marks -> portable records (handle + group code + contest id) that survive a restore. */
function statusesToNatural(map, students, sheets) {
  const out = [];
  for (const [k, v] of Object.entries(map || {})) {
    const [a, b] = k.split("|"); const st = students.find(s => s.id === a), sh = sheets.find(s => s.id === b);
    if (st && sh) out.push({ handle: st.handle, groupCode: sh.groupCode || null, contestId: sh.contestId, status: v.status, updatedAt: v.updatedAt || null });
  }
  return out;
}
/** portable records -> id-based marks for the given students/sheets. Marks already in `base` win. */
function naturalToStatuses(natural, students, sheets, base = {}) {
  const out = { ...base }; let added = 0;
  for (const n of natural || []) {
    const st = students.find(s => normalizeHandle(s.handle) === normalizeHandle(n.handle));
    const sh = sheets.find(s => s.contestId === n.contestId && sameGroupCode(s.groupCode, n.groupCode));
    if (!st || !sh) continue;
    const key = statusKey(st.id, sh.id);
    if (!out[key]) { out[key] = { status: n.status, updatedAt: n.updatedAt || null }; added++; }
  }
  return { map: out, added };
}
