"use strict";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt1 = (n) => (n == null || Number.isNaN(n) ? "–" : n.toFixed(1));
const pct = (n) => (n == null || Number.isNaN(n) ? "–" : Math.round(n * 100) + "%");
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const stdev = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
const parseDate = (d) => new Date(d + "T12:00:00Z");
const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const niceDate = (d, opts = { month: "short", day: "numeric" }) => parseDate(d).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
const longDate = (d) => niceDate(d, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MAX_SCORE = 7 * 85;
// Krillion's day rolls over at midnight New York time. Answers for a day that
// is still in progress stay hidden so we don't spoil it for late players.
const todayNY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const isLive = (day) => day.date >= todayNY;
const finished = (days) => days.filter((d) => !isLive(d));

// ---------- theme toggle ----------
(function theme() {
  const root = document.documentElement;
  try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch {}
  $("theme-btn").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  });
})();

// ---------- stats ----------
function computeStats(days) {
  days = [...days].sort((a, b) => a.date.localeCompare(b.date));
  // Color follows the entity: order players by first appearance so colors never shift.
  const order = [];
  for (const d of days) for (const p of [...d.players].sort((a, b) => a.username.localeCompare(b.username)))
    if (!order.includes(p.username)) order.push(p.username);
  const color = Object.fromEntries(order.map((u, i) => [u, `var(--s${(i % 8) + 1})`]));

  const players = Object.fromEntries(order.map((u) => [u, {
    username: u, scores: [], dates: [], listed: 0, wins: 0, podiums: 0,
    answers: 0, deepcuts: 0, blanks: 0, tierCounts: {},
    best: null, bestDate: null, worst: null,
    curStreak: 0, longestStreak: 0, longestWinStreak: 0, _winRun: 0,
  }]));

  const h2h = {}; // h2h[a][b] = {w, l, t}
  for (const a of order) { h2h[a] = {}; for (const b of order) h2h[a][b] = { w: 0, l: 0, t: 0 }; }

  for (const d of days) {
    const played = d.players.filter((p) => p.score != null);
    const top = played.length ? Math.max(...played.map((p) => p.score)) : null;
    for (const p of d.players) players[p.username].listed++;
    for (const p of played) {
      const s = players[p.username];
      s.scores.push(p.score); s.dates.push(d.date);
      if (s.best == null || p.score > s.best) { s.best = p.score; s.bestDate = d.date; }
      if (s.worst == null || p.score < s.worst) s.worst = p.score;
      if (played.length > 1 && p.score === top) { s.wins++; s._winRun++; } else s._winRun = 0;
      s.longestWinStreak = Math.max(s.longestWinStreak, s._winRun);
      if (p.rank != null && p.rank <= 3) s.podiums++;
      for (const a of p.answers ?? []) {
        s.answers++;
        if (a.answer == null) s.blanks++;
        if (a.tier === "deepcut") s.deepcuts++;
        const t = a.tier ?? "none"; s.tierCounts[t] = (s.tierCounts[t] ?? 0) + 1;
      }
      for (const q of played) {
        if (q === p) continue;
        const r = h2h[p.username][q.username];
        if (p.score > q.score) r.w++; else if (p.score < q.score) r.l++; else r.t++;
      }
    }
    for (const p of d.players) if (p.score == null) players[p.username]._winRun = 0;
  }

  // Play streaks (consecutive calendar days with a score).
  const lastDate = days.at(-1)?.date;
  for (const s of Object.values(players)) {
    let run = 0, prev = null;
    for (const d of s.dates) { run = prev && dayDiff(prev, d) === 1 ? run + 1 : 1; s.longestStreak = Math.max(s.longestStreak, run); prev = d; }
    // Current streak counts if they played today or yesterday (today may still be in progress).
    s.curStreak = prev && dayDiff(prev, lastDate) <= 1 ? run : 0;
    s.games = s.scores.length;
    s.avg = mean(s.scores);
    s.sd = stdev(s.scores);
    s.total = sum(s.scores);
    s.participation = s.listed ? s.games / s.listed : null;
    s.deepcutRate = s.answers ? s.deepcuts / s.answers : null;
    s.winRate = s.games ? s.wins / s.games : null;
    s.last7 = mean(s.scores.slice(-7));
  }
  return { days, order, color, players, h2h };
}

function jinxes(days) {
  const out = [];
  for (const d of days) {
    const byKey = new Map();
    for (const p of d.players) for (const a of p.answers ?? []) {
      if (a.answer == null) continue;
      const k = a.prompt + "\u0000" + norm(a.answer);
      if (!byKey.has(k)) byKey.set(k, { date: d.date, prompt: a.prompt, answer: a.answer, tier: a.tier, who: [] });
      byKey.get(k).who.push(p.username);
    }
    for (const j of byKey.values()) if (j.who.length > 1) out.push(j);
  }
  return out.reverse();
}

function loneDeepCuts(days) {
  const out = [];
  for (const d of days) {
    const counts = new Map();
    for (const p of d.players) for (const a of p.answers ?? []) if (a.answer != null) {
      const k = a.prompt + "\u0000" + norm(a.answer); counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const p of d.players) for (const a of p.answers ?? [])
      if (a.tier === "deepcut" && counts.get(a.prompt + "\u0000" + norm(a.answer)) === 1)
        out.push({ date: d.date, username: p.username, prompt: a.prompt, answer: a.answer });
  }
  return out.reverse();
}

// ---------- render: shared bits ----------
let S; // computed stats
const sw = (u) => `<span class="swatch" style="background:${S.color[u]}"></span>`;
const who = (u) => `${sw(u)}<span class="user">@${esc(u)}</span>`;
const tierLabel = (t) => `<span class="tier tier-${esc(t ?? "none")}">${t ? esc(t) : "no catch"}</span>`;

function catchList(answers) {
  return `<div class="catch">${answers.map((a) => `
    <div class="catch-row">
      <div><div class="q">${esc(a.prompt)}</div><div class="a">${a.answer == null ? '<span class="dim">—</span>' : esc(a.answer)}</div></div>
      <div style="text-align:right">${tierLabel(a.tier)}<div class="dim">${a.score}</div></div>
    </div>`).join("")}</div>`;
}

function boardHtml(day) {
  const played = day.players.filter((p) => p.score != null);
  const skipped = day.players.filter((p) => p.score == null);
  if (!played.length) return `<div class="empty">Nobody has dived yet.</div>`;
  const live = isLive(day);
  return (live ? `<div class="not-played" style="padding:0 0 4px">🔒 Answers are hidden until the day ends (midnight ET) — no spoilers.</div>` : "") +
    played.map((p) => `
    <div class="board-row">
      <div class="rank">#${p.rank}</div>
      ${live || !p.answers
        ? `<div style="line-height:36px">${who(p.username)}</div>`
        : `<details><summary>${who(p.username)}</summary>${catchList(p.answers)}</details>`}
      <div class="board-score">${p.score}</div>
    </div>`).join("") +
    (skipped.length ? `<div class="not-played">Still on the surface: ${skipped.map((p) => "@" + esc(p.username)).join(", ")}</div>` : "");
}

// ---------- render: sections ----------
function renderToday() {
  const d = S.days.at(-1);
  $("today-title").textContent = `Latest dive · ${longDate(d.date)}`;
  $("today").innerHTML = boardHtml(d);
  $("today-hint").hidden = isLive(d);
}

function renderRecords() {
  const ps = Object.values(S.players).filter((p) => p.games);
  const pick = (arr, f, dir = 1) => arr.filter((p) => f(p) != null).sort((a, b) => dir * (f(b) - f(a)))[0];
  const minGames = Math.min(5, Math.max(1, ...ps.map((p) => p.games)));
  const eligible = ps.filter((p) => p.games >= minGames);
  const best = pick(ps, (p) => p.best);
  const avg = pick(eligible, (p) => p.avg);
  const wins = pick(ps, (p) => p.wins);
  const steady = pick(eligible.filter((p) => p.sd != null), (p) => p.sd, -1);
  const deep = pick(eligible, (p) => p.deepcutRate);
  const streak = pick(ps, (p) => p.longestStreak);
  const winStreak = pick(ps, (p) => p.longestWinStreak);
  const hot = pick(ps.filter((p) => p.curStreak > 0), (p) => p.last7);
  const cards = [
    best && ["All-time high", best.best, best.username, `${longDate(best.bestDate)} · ${pct(best.best / MAX_SCORE)} of max`],
    avg && ["Best average", fmt1(avg.avg), avg.username, `over ${avg.games} dives`],
    wins && ["Most daily wins", wins.wins, wins.username, `${pct(wins.winRate)} win rate`],
    winStreak && winStreak.longestWinStreak > 1 && ["Longest win streak", winStreak.longestWinStreak, winStreak.username, "days in a row on top"],
    deep && ["Deep-cut machine", pct(deep.deepcutRate), deep.username, `${deep.deepcuts} deep cuts found`],
    steady && ["Steadiest diver", "±" + fmt1(steady.sd), steady.username, `score std. dev. (min ${minGames} dives)`],
    streak && ["Longest play streak", streak.longestStreak, streak.username, "consecutive days"],
    hot && ["On fire", fmt1(hot.last7), hot.username, "avg over last 7 dives"],
  ].filter(Boolean);
  $("records").innerHTML = cards.map(([label, value, u, meta]) => `
    <div class="card record"><div class="label">${label}</div><div class="value">${value}</div>
    <div>${who(u)}</div><div class="meta">${esc(meta)}</div></div>`).join("");
}

const COLUMNS = [
  { key: "username", label: "Diver", left: true, fmt: (p) => who(p.username), sort: (p) => p.username, dir: 1 },
  { key: "avg", label: "Avg", fmt: (p) => `<span class="big">${fmt1(p.avg)}</span>` },
  { key: "best", label: "Best", fmt: (p) => p.best ?? "–" },
  { key: "last7", label: "Last 7", fmt: (p) => fmt1(p.last7) },
  { key: "games", label: "Dives", fmt: (p) => p.games },
  { key: "wins", label: "Wins", fmt: (p) => p.wins },
  { key: "podiums", label: "Top 3", fmt: (p) => p.podiums },
  { key: "deepcutRate", label: "Deep cut %", fmt: (p) => pct(p.deepcutRate) },
  { key: "blanks", label: "Blanks", fmt: (p) => p.blanks },
  { key: "curStreak", label: "Streak", fmt: (p) => (p.curStreak ? p.curStreak + "🔥" : "0") },
  { key: "participation", label: "Showed up", fmt: (p) => pct(p.participation) },
  { key: "total", label: "Total", fmt: (p) => p.total.toLocaleString() },
];
let sortKey = "avg", sortDir = -1;
function renderStandings() {
  const col = COLUMNS.find((c) => c.key === sortKey);
  const val = col.sort ?? ((p) => p[sortKey] ?? -Infinity);
  const rows = Object.values(S.players).sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir || (b.games - a.games);
  });
  $("standings").innerHTML = `<table><thead><tr>${COLUMNS.map((c) =>
    `<th class="sortable ${c.left ? "left" : ""} ${c.key === sortKey ? "sorted" : ""}" data-key="${c.key}">${c.label}${c.key === sortKey ? (sortDir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((p) => `<tr>${COLUMNS.map((c) => `<td class="${c.left ? "left" : ""}">${c.fmt(p)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  $("standings").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.key;
    if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = COLUMNS.find((c) => c.key === k).dir ?? -1; }
    renderStandings();
  }));
}

// ---------- chart ----------
let range = "all";
const hidden = new Set();
function renderChart() {
  const box = $("chart");
  const last = S.days.at(-1).date;
  const days = range === "all" ? S.days : S.days.filter((d) => dayDiff(d.date, last) < Number(range));
  const users = S.order.filter((u) => S.players[u].games);

  $("legend").innerHTML = users.map((u) =>
    `<button type="button" data-u="${esc(u)}" aria-pressed="${!hidden.has(u)}">${sw(u)}@${esc(u)}</button>`).join("");
  $("legend").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    hidden.has(b.dataset.u) ? hidden.delete(b.dataset.u) : hidden.add(b.dataset.u); renderChart();
  }));

  const W = Math.max(320, box.clientWidth), H = 300, m = { t: 12, r: 12, b: 28, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  if (days.length === 0) { box.innerHTML = `<div class="empty">No data in this range.</div>`; return; }
  const first = days[0].date;
  const span = Math.max(1, dayDiff(first, days.at(-1).date));
  const x = (d) => m.l + (days.length === 1 ? iw / 2 : (dayDiff(first, d) / span) * iw);
  const yMax = Math.max(100, Math.ceil(Math.max(...days.flatMap((d) => d.players.map((p) => p.score ?? 0))) / 100) * 100);
  const y = (v) => m.t + ih - (v / yMax) * ih;

  const ticksY = []; for (let v = 0; v <= yMax; v += yMax > 400 ? 100 : 50) ticksY.push(v);
  const nX = Math.min(days.length, Math.max(2, Math.floor(iw / 90)));
  const ticksX = days.length === 1 ? [days[0].date] : Array.from({ length: nX }, (_, i) => days[Math.round((i * (days.length - 1)) / (nX - 1))].date);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily scores per player">`;
  svg += `<g class="grid">${ticksY.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>`;
  svg += `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  svg += `<g class="axis">${ticksY.map((v) => `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}`;
  svg += [...new Set(ticksX)].map((d) => `<text x="${x(d)}" y="${H - 6}" text-anchor="middle">${niceDate(d)}</text>`).join("") + `</g>`;
  for (const u of users) {
    if (hidden.has(u)) continue;
    const pts = days.map((d) => ({ d: d.date, s: d.players.find((p) => p.username === u)?.score })).filter((p) => p.s != null);
    // Break the line across missed days so gaps are honest.
    let path = "", prev = null;
    for (const p of pts) { path += `${prev && dayDiff(prev, p.d) === 1 ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.s).toFixed(1)}`; prev = p.d; }
    svg += `<path d="${path}" fill="none" stroke="${S.color[u]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += pts.map((p) => `<circle cx="${x(p.d)}" cy="${y(p.s)}" r="${pts.length > 60 ? 2 : 3.5}" fill="${S.color[u]}" stroke="var(--surface)" stroke-width="1.5"/>`).join("");
  }
  svg += `<line id="crosshair" y1="${m.t}" y2="${m.t + ih}" stroke="var(--axis)" stroke-width="1" opacity="0"/>`;
  svg += `<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="hit"/></svg><div class="tooltip" id="tip"></div>`;
  box.innerHTML = svg;

  const tip = $("tip"), cross = $("crosshair"), svgEl = box.querySelector("svg");
  const move = (ev) => {
    const r = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const d = days.reduce((best, dd) => (Math.abs(x(dd.date) - px) < Math.abs(x(best.date) - px) ? dd : best), days[0]);
    const rows = d.players.filter((p) => p.score != null && !hidden.has(p.username)).sort((a, b) => b.score - a.score);
    cross.setAttribute("x1", x(d.date)); cross.setAttribute("x2", x(d.date)); cross.setAttribute("opacity", 1);
    tip.innerHTML = `<div class="t-date">${longDate(d.date)}</div>` + (rows.length ? rows.map((p) =>
      `<div class="t-row"><span>${sw(p.username)}@${esc(p.username)}</span><strong>${p.score}</strong></div>`).join("") : `<div class="dim">no dives</div>`);
    tip.style.opacity = 1;
    const left = (x(d.date) / W) * r.width;
    tip.style.left = Math.min(Math.max(0, left + 12), r.width - tip.offsetWidth) + "px";
    tip.style.top = "8px";
  };
  const hit = $("hit");
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { tip.style.opacity = 0; cross.setAttribute("opacity", 0); });
}

function renderH2H() {
  const users = S.order.filter((u) => S.players[u].games);
  $("h2h").innerHTML = `<table class="h2h"><thead><tr><th></th>${users.map((u) => `<th>${sw(u)}${esc(u)}</th>`).join("")}</tr></thead><tbody>` +
    users.map((a) => `<tr><td>${who(a)}</td>${users.map((b) => {
      if (a === b) return `<td class="self">·</td>`;
      const r = S.h2h[a][b];
      if (!r.w && !r.l && !r.t) return `<td class="dim">–</td>`;
      return `<td class="${r.w > r.l ? "win" : r.w < r.l ? "lose" : ""}">${r.w}–${r.l}${r.t ? `<span class="dim">–${r.t}</span>` : ""}</td>`;
    }).join("")}</tr>`).join("") + `</tbody></table>`;
}

function renderLists() {
  const top = S.days.flatMap((d) => d.players.filter((p) => p.score != null).map((p) => ({ ...p, date: d.date })))
    .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, 10);
  $("top-scores").innerHTML = top.map((p, i) => `<div class="list-row"><div><span class="dim">${i + 1}.</span> ${who(p.username)}<div class="dim">${longDate(p.date)}</div></div><div class="board-score">${p.score}</div></div>`).join("") || `<div class="empty">No dives yet.</div>`;

  const j = jinxes(finished(S.days)).slice(0, 12);
  $("jinxes").innerHTML = j.map((x) => `<div class="list-row"><div><div class="catch-row"><div><div class="q">${esc(x.prompt)}</div><div class="a">“${esc(x.answer)}”</div></div></div>
    <div>${x.who.map((u) => sw(u) + "@" + esc(u)).join(" &nbsp;")}</div></div><div style="text-align:right">${tierLabel(x.tier)}<div class="dim">${niceDate(x.date)}</div></div></div>`).join("") || `<div class="empty">No jinxes yet — great minds haven't thought alike.</div>`;

  const dc = loneDeepCuts(finished(S.days)).slice(0, 15);
  $("deepcuts").innerHTML = dc.map((x) => `<div class="list-row"><div><div class="q dim" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">${esc(x.prompt)}</div><div>“${esc(x.answer)}” <span class="dim">—</span> ${who(x.username)}</div></div><div class="dim">${niceDate(x.date)}</div></div>`).join("") || `<div class="empty">None yet.</div>`;
}

function renderArchive() {
  const sel = $("day-select");
  sel.innerHTML = [...S.days].reverse().map((d) => `<option value="${d.date}">${longDate(d.date)}</option>`).join("");
  const show = () => { const d = S.days.find((x) => x.date === sel.value); $("archive").innerHTML = boardHtml(d); };
  sel.addEventListener("change", show);
  show();
}

// ---------- boot ----------
async function main() {
  try {
    const res = await fetch("data/all.json", { cache: "no-cache" });
    const { days } = await res.json();
    if (!days?.length) throw new Error("no data yet");
    S = computeStats(days);
    const n = S.days.length;
    $("subtitle").textContent = `${n} day${n === 1 ? "" : "s"} logged · ${niceDate(S.days[0].date)} – ${niceDate(S.days.at(-1).date)} · ${S.order.length} divers`;
    renderToday(); renderRecords(); renderStandings(); renderChart(); renderH2H(); renderLists(); renderArchive();
    $("range-filters").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      range = b.dataset.range;
      $("range-filters").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderChart();
    }));
    let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderChart, 150); });
  } catch (e) {
    $("subtitle").textContent = "Couldn't load data: " + e.message;
  }
}
main();
