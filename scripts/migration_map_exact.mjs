import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const dir = path.resolve(process.cwd(), "supabase/migrations");
const files = fs
  .readdirSync(dir)
  .filter((f) => /\.sql$/.test(f))
  .sort();
console.log(
  "# FASE14D FINAL MIGRATION MAP — EXACT — per file reale timestamp ordinato (NO numeri fittizi)\n",
);
console.log("| ordinal | timestamp | filename | purpose | commit introduced |");
console.log("| --- | --- | --- | --- | --- |");
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const m = /^(\d+)_?(.*)\.sql$/.exec(f);
  const ts = m?.[1] ?? "";
  const rest = m?.[2] ?? f;
  const full = path.join(dir, f);
  const content = fs.readFileSync(full, "utf8");
  // First comment block purpose
  const purp =
    content.match(
      /--\s*(Obiettivi|T[0-9]\.|Purpose|FASE[0-9][A-Za-z]?|Compito|MIGRATION|Scope)\s*:?\s*([^\n]*)/i,
    )?.[2] ??
    content
      .split("\n")
      .slice(0, 3)
      .map((s) => s.replace(/^--\s*/, "").trim())
      .filter(Boolean)[0] ??
    rest.slice(0, 80);
  let commit = "91c2e39";
  try {
    // First commit introducing this file in the current branch
    const raw = execSync(`git log --oneline --follow -- "supabase/migrations/${f}" 2>&1`, {
      encoding: "utf8",
    }).trim();
    const line = raw.split("\n").pop()?.trim();
    if (line) {
      commit = line.split(/\s/)[0] + " " + line.slice(8).slice(0, 40);
    }
  } catch {
    void 0;
  }
  const isF14d = /fase14d/.test(f);
  const mark = isF14d ? " **FASE14D**" : "";
  console.log(
    "| %s%s | %s | %s | %s | %s |",
    String(i + 1).padStart(3, "0"),
    mark,
    ts
      .replace(
        /(.{4})(.{2})(.{2})(.{2})(.{2})(.{2})/,
        (_, Y, mo, d, h, mi, s) => `${Y}-${mo}-${d} ${h}:${mi}:${s}`,
      )
      .replace(/-00-00 00:00:00$/, ""),
    f,
    purp.replace(/\|/g, "\\|").slice(0, 100),
    commit.replace(/\|/g, "\\|").slice(0, 60),
  );
}
console.log("\nTotal migration files:", files.length);
console.log(
  "FASE14D introduced files:",
  files.filter((f) => /fase14d/.test(f)).map((f) => f.replace(/_.*\.sql$/, "")),
);
