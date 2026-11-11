// Fetches today's Krillion friends leaderboard and merges it into docs/data/.
// Usage: KRILLION_REFRESH_TOKEN=... node scripts/scrape.mjs   (or put it in .env)
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_DIR = path.join(ROOT, "docs", "data");
const DAYS_DIR = path.join(DATA_DIR, "days");

// Public Firebase web API key from krillion.io's client bundle (not a secret).
const FIREBASE_API_KEY = "AIzaSyBaZVDjFZV4zv5OaOApvy-nVQSOl0bf_ok";

async function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

async function getIdToken(refreshToken) {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://krillion.io/" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) {
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(body.error ?? body)}. ` +
      `The refresh token may be revoked — grab a new one from krillion.io.`);
  }
  return body.id_token;
}

async function fetchFriends(idToken) {
  const res = await fetch("https://krillion.io/api/friends", {
    headers: { Authorization: `Bearer ${idToken}`, "User-Agent": "krillion-stats-scraper" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`/api/friends failed (${res.status}): ${JSON.stringify(body)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") || !Array.isArray(body.leaderboard)) {
    throw new Error(`Unexpected response shape: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

// Keep only game data — drop the account's profile/invite token and the `self` flag.
function sanitize(row) {
  const answers = Array.isArray(row.answers)
    ? row.answers.map((a) => ({
        prompt: String(a.prompt ?? ""),
        answer: a.answer == null ? null : String(a.answer),
        score: Number(a.score) || 0,
        tier: a.tier ?? null,
      }))
    : null;
  return { username: String(row.username), score: row.score == null ? null : Number(row.score), answers };
}

// Merge a fresh snapshot into what we already have for that date. A player who
// has played never reverts to "not played"; a newer non-null score wins.
export function mergeDay(existing, date, rows) {
  const byUser = new Map((existing?.players ?? []).map((p) => [p.username, p]));
  for (const row of rows.map(sanitize)) {
    const prev = byUser.get(row.username);
    if (!prev || row.score != null) byUser.set(row.username, row);
  }
  const players = [...byUser.values()].sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.username.localeCompare(b.username),
  );
  let rank = 0, lastScore = null, seen = 0;
  for (const p of players) {
    if (p.score == null) { p.rank = null; continue; }
    seen++;
    if (p.score !== lastScore) { rank = seen; lastScore = p.score; }
    p.rank = rank;
  }
  // Prompts are shared by everyone on a given day; store them once for convenience.
  const prompts = players.find((p) => p.answers)?.answers.map((a) => a.prompt) ?? existing?.prompts ?? [];
  return { date, prompts, players };
}

async function readJson(file) {
  return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null;
}

async function main() {
  await loadDotEnv();
  const token = process.env.KRILLION_REFRESH_TOKEN;
  if (!token) throw new Error("KRILLION_REFRESH_TOKEN is not set");

  const data = await fetchFriends(await getIdToken(token));
  await mkdir(DAYS_DIR, { recursive: true });

  const dayFile = path.join(DAYS_DIR, `${data.date}.json`);
  const merged = mergeDay(await readJson(dayFile), data.date, data.leaderboard);
  await writeFile(dayFile, JSON.stringify(merged, null, 2) + "\n");

  // Rebuild the combined file the website loads.
  const files = (await readdir(DAYS_DIR)).filter((f) => f.endsWith(".json")).sort();
  const days = await Promise.all(files.map((f) => readJson(path.join(DAYS_DIR, f))));
  await writeFile(path.join(DATA_DIR, "all.json"), JSON.stringify({ days }) + "\n");

  const played = merged.players.filter((p) => p.score != null);
  console.log(`${data.date}: ${played.length}/${merged.players.length} played — ` +
    played.map((p) => `${p.username} ${p.score}`).join(", "));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
