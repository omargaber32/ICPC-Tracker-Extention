// collector.js — reads standings through temporary background tabs (read-only, one at a time, polite pauses).
/* ---------- Collection ---------- */
const MAX_STANDINGS_PAGES = 40;
const MAX_CONSECUTIVE_PAGE_FAILURES = 2;
const STANDINGS_TYPE = "ICPC_TRACKER_GET_STANDINGS_DATA";
const standingsPathCheck = (tabUrl) => assertPathMatches(tabUrl, /\/contest\/\d+\/standings/, "standings page");

/** Checks one standings page belongs to this sheet. Page 1 must also contain participants. */
function checkStandingsPage(sheet, data, { first }) {
  if (!data.isStandingsPage) throw new Error(data.error || "No standings table found. The sheet may be private or inaccessible with your account, or Codeforces changed its page layout.");
  if (String(data.contestId) !== String(sheet.contestId) || (data.groupCode || null) !== (sheet.groupCode || null)) {
    throw new Error("The loaded standings page does not match the saved sheet.");
  }
  if (first && !data.participants?.length) throw new Error("The standings table has no participant rows, so no results could be read.");
}

/** Builds the compact result from every page that was read. */
function buildResult(sheet, pagesData, trackedHandles, info) {
  const tracked = new Set(trackedHandles), found = {}, all = new Set();
  for (const data of pagesData) {
    for (const p of data.participants || []) {
      const key = normalizeHandle(p.handle); all.add(key);
      if (!tracked.has(key)) continue;
      // Official and unofficial rows of the same handle are merged (union of solved problems).
      const set = new Set(found[key] || []); for (const name of p.solved) set.add(name); found[key] = [...set];
    }
  }
  const first = pagesData[0];
  const notes = [];
  if (info.unreadPages.length) notes.push(`Read ${info.pagesRead} of ${info.pagesTotal} standings pages (${info.unreadPages.length === 1 ? "page" : "pages"} ${info.unreadPages.join(", ")} could not be read). Students missing from the pages that were read may be on a page that was not.`);
  if (info.unofficial === false) notes.push("“Show unofficial” could not be turned on for this sheet, so students who only took part unofficially (virtual / out of competition) may be missing.");
  else if (info.unofficial === null) notes.push("The “Show unofficial” option was not found on the page, so unofficial participants may be missing.");
  const complete = info.unreadPages.length === 0 && info.unofficial !== false;
  return {
    sheetId: sheet.id, url: sheet.url, status: complete ? "complete" : "partial", error: null, refreshError: null, note: notes.join(" ") || null,
    problems: (first.problems || []).map(p => p.name), problemCount: first.problemCount, participantCount: all.size,
    pagesRead: info.pagesRead, pagesTotal: info.pagesTotal, unofficial: info.unofficial,
    collectedAt: new Date().toISOString(), covered: [...tracked], found, contestName: first.contestName || null,
  };
}

/** Makes sure the page shows unofficial participants. Returns true (on), false (couldn't enable) or null (no such option). */
async function ensureUnofficial(tabId) {
  const state = () => chrome.tabs.sendMessage(tabId, { type: "ICPC_TRACKER_GET_UNOFFICIAL_STATE" });
  const first = await requestFromTab(tabId, "ICPC_TRACKER_GET_UNOFFICIAL_STATE");
  if (!first.found) return null;
  if (first.checked) return true;
  await requestFromTab(tabId, "ICPC_TRACKER_ENABLE_UNOFFICIAL");
  // The page re-renders (or reloads) after the click: give it time, then confirm the option is really on.
  for (let i = 0; i < 20; i++) {
    await sleep(UNOFFICIAL_POLL_MS);
    try {
      const s = await state();
      if (s?.found && s.checked && s.hasTable) { await sleep(UNOFFICIAL_POLL_MS); return true; }
    } catch { /* page is reloading */ }
  }
  return false;
}

/** Reads page 1, then follows Codeforces' own pager links page by page (sequentially, politely). */
async function collectSheet(sheet, trackedHandles) {
  let unofficial = null, sawFalse = false, sawTrue = false;
  const prepare = async (tabId) => {
    const state = await ensureUnofficial(tabId);
    if (state === false) sawFalse = true; else if (state === true) sawTrue = true;
  };
  const read = (url) => readInTempTab(url, STANDINGS_TYPE, { validatePath: standingsPathCheck, onTab: (id) => { currentTempTabId = id; }, prepare });
  try {
    const firstData = await read(sheet.url);
    checkStandingsPage(sheet, firstData, { first: true });
    const pagesData = [firstData];

    const pagePaths = new Map();
    const learn = (data) => {
      for (const l of data.pagination?.pageLinks || []) if (!pagePaths.has(l.page)) pagePaths.set(l.page, l.path);
      return Math.max(1, data.pagination?.highestLinkedPage || 1, ...pagePaths.keys());
    };
    let maxPage = learn(firstData);
    const template = () => { for (const p of pagePaths.values()) { const m = p.match(/^(.*\/page\/)\d+(.*)$/); if (m) return (n) => `${m[1]}${n}${m[2]}`; } return null; };
    const unread = [];
    let pagesRead = 1, consecutive = 0, stoppedForFailures = false;
    // Every page is read: with unofficial rows shown, one handle can have several rows on different pages.
    for (let page = 2; page <= Math.min(maxPage, MAX_STANDINGS_PAGES); page++) {
      if (stoppedForFailures) { unread.push(page); continue; }
      const path = pagePaths.get(page) || template()?.(page);
      if (!path) { unread.push(page); continue; }          // can't build a trustworthy URL for this page
      await politeDelay();
      try {
        const data = await read(`https://codeforces.com${path}`);
        checkStandingsPage(sheet, data, { first: false });
        pagesData.push(data); pagesRead++; consecutive = 0;
        maxPage = Math.max(maxPage, learn(data));
      } catch (error) {
        if (error.blocked) throw error;
        unread.push(page); consecutive++;
        if (consecutive >= MAX_CONSECUTIVE_PAGE_FAILURES) stoppedForFailures = true;
      }
    }
    for (let page = MAX_STANDINGS_PAGES + 1; page <= maxPage; page++) unread.push(page);
    unofficial = sawFalse ? false : sawTrue ? true : null;
    return buildResult(sheet, pagesData, trackedHandles, { pagesRead, pagesTotal: maxPage, unreadPages: unread, unofficial });
  } catch (error) {
    if (error.blocked) throw error; // stop the whole run
    return { sheetId: sheet.id, url: sheet.url, status: "failed", error: error.message || "Unknown collection error.", collectedAt: new Date().toISOString(), covered: [], found: {} };
  }
}

function sheetNeedsUpdate(sheet, section) {
  const r = resultFor(sheet);
  if (!r || r.status === "failed") return true;
  if (r.unofficial === undefined) return true; // saved before unofficial participants were read
  const covered = new Set(r.covered);
  return section.students.some(s => !covered.has(normalizeHandle(s.handle)));
}

/** Gives a sheet its real Codeforces name when it only has a default one like "Contest 123". */
async function fixSheetName(sheet, contestName) {
  if (!contestName || !isDefaultSheetName(sheet.name) || isDefaultSheetName(contestName)) return;
  try {
    const latest = await loadSheets();
    const next = latest.map(s => s.id === sheet.id && isDefaultSheetName(s.name) ? { ...s, name: contestName, updatedAt: new Date().toISOString() } : s);
    await persistConfig({ sheets: next }); // storage listener refreshes the page
  } catch { /* cosmetic only */ }
}

/** scope: "all" or a section key. force: re-read even if a good saved result exists. */
async function runCollection({ scope = "all", force = false, auto = false } = {}) {
  if (collecting) return;
  const sections = buildSections().filter(s => s.students.length && (scope === "all" || s.key === scope));
  const jobs = [];
  for (const section of sections) {
    const handles = section.students.map(s => normalizeHandle(s.handle));
    for (const sheet of section.sheets) if (force || sheetNeedsUpdate(sheet, section)) jobs.push({ sheet, handles });
  }
  if (!jobs.length) {
    setCollectionMessage(!sections.length
      ? (!groups.length && !sheets.length ? "Add a group from the extension popup to get started." : "Add students (and assign them to a group) so their handles can be matched.")
      : "Everything is already up to date. Use “Re-read everything” to fetch it again.");
    return;
  }
  collecting = true; stopRequested = false; lastRunSummary = null;
  for (const { sheet } of jobs) runState.set(sheet.id, "waiting");
  renderAll();
  let consecutiveFailures = 0, blockedMessage = null, stopReason = null, readCount = 0, failedCount = 0, partialCount = 0;
  for (let i = 0; i < jobs.length; i++) {
    if (stopRequested) break;
    const { sheet, handles } = jobs[i];
    runState.set(sheet.id, "reading");
    setCollectionMessage(`${auto ? "Updating automatically — " : ""}reading ${i + 1}/${jobs.length}: ${sheet.name}`);
    renderAll();
    let result;
    try { result = await collectSheet(sheet, handles); }
    catch (error) { if (error.blocked) { blockedMessage = error.message; runState.delete(sheet.id); break; } result = { sheetId: sheet.id, url: sheet.url, status: "failed", error: error.message, collectedAt: new Date().toISOString(), covered: [], found: {} }; }
    const previous = results.get(sheet.id);
    if (result.status === "failed" && previous && previous.status !== "failed") {
      results.set(sheet.id, { ...previous, refreshError: `${result.error} (showing results from ${fmtTime(previous.collectedAt)})` });
    } else results.set(sheet.id, result);
    runState.delete(sheet.id);
    if (result.status === "failed") { failedCount++; consecutiveFailures++; } else { consecutiveFailures = 0; readCount++; if (result.status === "partial") partialCount++; }
    await persistResults();
    if (result.status !== "failed") await fixSheetName(sheet, result.contestName);
    renderAll();
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { stopReason = `${MAX_CONSECUTIVE_FAILURES} sheets in a row failed, so collection was stopped to avoid sending more requests. Check that you're logged in and have access, wait a few minutes, then try again.`; break; }
    if (i < jobs.length - 1 && !stopRequested) await politeDelay();
  }
  runState.clear(); collecting = false;
  lastRunSummary = { stopped: stopRequested || Boolean(stopReason) || Boolean(blockedMessage), total: jobs.length, read: readCount + failedCount, failed: failedCount, partial: partialCount, blocked: Boolean(blockedMessage) };
  setCollectionMessage(blockedMessage || stopReason || (stopRequested
    ? `Stopped. ${readCount + failedCount}/${jobs.length} sheets were processed; the rest keep their previous results.`
    : `Finished: ${readCount}/${jobs.length} sheets read${failedCount ? `, ${failedCount} failed` : ""}${partialCount ? `, ${partialCount} partial` : ""}. Results saved on this device.`));
  renderAll();
}

