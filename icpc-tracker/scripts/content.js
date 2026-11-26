// Reads only the currently rendered Codeforces standings DOM.
function getStandingsTable() { return document.querySelector("table.standings"); }
function getStandingsPageInfo() {
  const path=location.pathname;
  const groupMatch=path.match(/^\/group\/([^/]+)\/contest\/(\d+)\/standings/);
  const contestMatch=path.match(/^\/contest\/(\d+)\/standings/);
  const contestId=groupMatch?.[2]||contestMatch?.[1]||null;
  const table=getStandingsTable();
  const headers=table?[...table.querySelectorAll('th a[href*="/problem/"]')]:[];
  const rows=table?[...table.querySelectorAll("tr[participantid]")]:[];
  return {isStandingsPage:Boolean(contestId&&table),contestId,groupCode:groupMatch?.[1]||null,problemCount:headers.length,participantCount:rows.length,url:location.href,pageTitle:document.title};
}
function getStandingsData() {
  const info=getStandingsPageInfo(); const table=getStandingsTable();
  if(!info.isStandingsPage||!table) return {...info,error:"This page does not contain a supported standings table.",blocked:detectBlock()};
  const headerLinks=[...table.querySelectorAll('th a[href*="/problem/"]')];
  const problems=headerLinks.map((link,index)=>({index,name:(link.textContent||"").trim()||String.fromCharCode(65+index),href:link.getAttribute("href")||"",problemId:link.closest("th")?.getAttribute("problemid")||link.getAttribute("problemid")||null}));
  const participants=[...table.querySelectorAll("tr[participantid]")].map(row=>{
    const profile=row.querySelector('a[href^="/profile/"]');
    const handle=profile?decodeURIComponent(profile.getAttribute("href").split("/").filter(Boolean).pop()||""):"";
    const cells=[...row.querySelectorAll("td")]; const solved=[];
    const resultCells=cells.filter(cell=>cell.hasAttribute("problemid"));
    resultCells.forEach((cell,index)=>{
      const problem=problems.find(item=>item.problemId&&item.problemId===cell.getAttribute("problemid"))||problems[index];
      const accepted=cell.hasAttribute("acceptedsubmissionid")||Boolean(cell.querySelector(".cell-accepted"))||/^\s*\+/.test(cell.textContent||"");
      if(accepted&&problem&&!solved.includes(problem.name)) solved.push(problem.name);
    });
    return {handle,participantId:row.getAttribute("participantid"),solved,solvedCount:solved.length};
  }).filter(p=>p.handle);
  // Follow the pager links Codeforces itself renders (no URLs are invented here).
  const pageMap=new Map();
  for(const a of document.querySelectorAll("a[href]")){
    let path; try{path=new URL(a.getAttribute("href"),location.origin).pathname;}catch{continue;}
    const m=path.match(/\/standings(?:\/.*)?\/page\/(\d+)\/?$/);
    if(m) pageMap.set(Number(m[1]),path);
  }
  const pager=[...pageMap.keys()];
  const pageLinks=[...pageMap].map(([page,path])=>({page,path})).sort((x,y)=>x.page-y.page);
  const current=location.pathname.match(/\/page\/(\d+)/);
  return {...info,problems,participants,pagination:{currentPage:current?Number(current[1]):1,hasPaginationLinks:pager.length>0,highestLinkedPage:pager.length?Math.max(...pager):1,pageLinks},extractedAt:new Date().toISOString(),contestName:getContestName(),blocked:null,unofficialShown:(t=>t?t.checked:null)(getUnofficialToggle())};
}
/** The standings page's "Show unofficial" checkbox (located by id/name/class or by its label text). */
function getUnofficialToggle(){
  const boxes=[...document.querySelectorAll('input[type="checkbox"]')];
  const labelOf=b=>(b.closest("label")?.textContent||(b.id&&document.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.textContent)||b.parentElement?.textContent||"");
  return boxes.find(b=>/unofficial/i.test(`${b.id} ${b.name} ${b.className}`))||boxes.find(b=>/show\s+unofficial/i.test(labelOf(b)))||null;
}
function detectBlock(){
  if(document.querySelector("table.standings")) return null;
  const title=(document.title||"").toLowerCase(), text=(document.body?.innerText||document.body?.textContent||"").slice(0,1500).toLowerCase();
  const rules=[[/too many requests/,"too many requests"],[/rate.?limit/,"rate limit"],[/^just a moment/,"verification page"],[/verify(ing)? (that )?you are (a )?human/,"human verification"],[/checking (if the site connection is secure|your browser)/,"browser check"],[/attention required/,"attention required page"],[/captcha/,"captcha"],[/unusual traffic/,"unusual traffic notice"]];
  for(const [re,label] of rules) if(re.test(title)||re.test(text)) return label;
  return null;
}
function getContestName(){
  const el=document.querySelector(".contest-name a, .contest-name");
  const t=(el?.textContent||"").replace(/\s+/g," ").trim();
  if(t) return t;
  const m=(document.title||"").match(/^(?:Standings|Dashboard|Contest)[^-]*-\s*(.+?)\s*-\s*Codeforces$/i);
  return m?m[1].trim():null;
}
function getGroupContests(){
  const m=location.pathname.match(/^\/group\/([^/]+)\/contests/i);
  if(!m) return {isGroupContestsPage:false,error:"This is not a group contests page.",blocked:detectBlock()};
  const code=m[1].toLowerCase(), found=new Map(), pages=new Map();
  const action=/^(enter|standings|current|final|results?|virtual|register|participate|start|view|problems?|submit|status|my|custom|rooms?|tests?|manage|edit|until|[»«›‹])\b/i;
  const usable=t=>t&&t.length>=2&&/[\p{L}]/u.test(t)&&!action.test(t)&&!/^\d{1,2}:\d{2}/.test(t);
  const clean=t=>(t||"").replace(/\s+/g," ").trim();
  for(const a of document.querySelectorAll("a[href]")){
    let path; try{path=new URL(a.getAttribute("href"),location.origin).pathname;}catch{continue;}
    const c=path.match(/^\/group\/([^/]+)\/contest\/(\d+)(?:\/.*)?$/i);
    if(c&&c[1].toLowerCase()===code){
      let entry=found.get(c[2]); if(!entry){entry={contestId:c[2],name:"",row:a.closest("tr")};found.set(c[2],entry);}
      if(!entry.name){const t=clean(a.textContent), title=clean(a.getAttribute("title"));
        if(usable(t)) entry.name=t; else if(usable(title)) entry.name=title;}
    }
    const p=path.match(/^\/group\/([^/]+)\/contests\/page\/(\d+)/i);
    if(p&&p[1].toLowerCase()===code) pages.set(Number(p[2]),path);
  }
  // Codeforces puts the contest name as plain text in the first cell of the contest's row,
  // next to the "Enter »" link, so the row text is the most reliable source.
  const ownText=td=>{let t="";for(const n of td.childNodes) if(n.nodeType===3) t+=n.nodeValue+" ";return clean(t);};
  const contests=[...found.values()].map(e=>{
    let name="";
    const firstCell=e.row?.querySelector("td");
    if(firstCell){const t=ownText(firstCell); if(t&&/[\p{L}\p{N}]/u.test(t)) name=t.slice(0,160);}
    if(!name) name=e.name;
    if(!name&&e.row){ // fall back to the first non-action cell text of the contest's row
      for(const td of e.row.querySelectorAll("td")){const t=clean(td.textContent).slice(0,120); if(usable(t)){name=t;break;}}
    }
    return {contestId:e.contestId,name:name||`Contest ${e.contestId}`,nameFound:Boolean(name)};
  });
  return {isGroupContestsPage:true,groupCode:m[1],contests,pageLinks:[...pages].map(([page,path])=>({page,path})).sort((x,y)=>x.page-y.page),currentPage:Number((location.pathname.match(/\/page\/(\d+)/)||[])[1]||1),pageTitle:document.title,blocked:contests.length?null:detectBlock()};
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.type==="ICPC_TRACKER_GET_UNOFFICIAL_STATE"){const t=getUnofficialToggle();sendResponse({found:Boolean(t),checked:t?t.checked:null,hasTable:Boolean(getStandingsTable())});return;}
  if(message?.type==="ICPC_TRACKER_ENABLE_UNOFFICIAL"){const t=getUnofficialToggle();let clicked=false;if(t&&!t.checked){t.click();clicked=true;}sendResponse({found:Boolean(t),clicked,checked:t?t.checked:null});return;}
  if(message?.type==="ICPC_TRACKER_GET_GROUP_CONTESTS"){sendResponse(getGroupContests());return;}
  if(message?.type==="ICPC_TRACKER_GET_PAGE_INFO"){sendResponse(getStandingsPageInfo());return;}
  if(message?.type==="ICPC_TRACKER_GET_STANDINGS_DATA") sendResponse(getStandingsData());
});
