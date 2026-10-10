#!/usr/bin/env node
// migrations/*.sql 을 이름 순서로, 아직 적용하지 않은 것만 실행한다. (가계부 scripts/migrate.mjs 와 같은 방식)
//   DATABASE_URL=... node scripts/migrate.mjs
//   MIGRATE_STRICT=1: 주소가 없거나 접속하지 못하면 실패로 끝낸다 (자동 배포용)
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import postgres from "postgres";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "migrations");
const strict = process.env.MIGRATE_STRICT === "1";
const url = process.env.DATABASE_URL;

if (!url) {
  console.warn("migrate: 경고 — DATABASE_URL 이 없어 DB 적용을 건너뜀.");
  process.exit(strict ? 1 : 0);
}

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
const mask = (e) => (e instanceof Error ? e.message.replace(/\/\/[^@\s]*@/g, "//****@") : String(e));

try {
  await sql`select 1`;
} catch (e) {
  console.warn("migrate: 경고 — DB 에 접속하지 못해 적용을 건너뜀:", mask(e));
  await sql.end({ timeout: 1 }).catch(() => {});
  process.exit(strict ? 1 : 0);
}

try {
  await sql.unsafe(`
    create schema if not exists calc_meta;
    create table if not exists calc_meta.migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const done = new Set((await sql`select name from calc_meta.migrations`).map((r) => r.name));
  for (const name of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const body = readFileSync(join(DIR, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into calc_meta.migrations (name) values (${name})`;
    });
    console.log(`migrate: ${name} — 적용`);
  }

  // 요율 이력 기록: data/rates/<연도>/rates.json 이 바뀌면 새 버전 행을 추가한다 (계산은 번들된 JSON 을 쓰고, 이 표는 이력용)
  for (const year of readdirSync(join(ROOT, "data", "rates")).filter((d) => /^\d{4}$/.test(d))) {
    const rates = readFileSync(join(ROOT, "data", "rates", year, "rates.json"));
    const wh = readFileSync(join(ROOT, "data", "rates", year, "withholding.json"));
    const sha = createHash("sha256").update(rates).update(wh).digest("hex");
    const json = JSON.parse(rates.toString("utf8"));
    const from = json.nps?.limits?.[0]?.from ?? `${year}-01-01`;
    const version = sha.slice(0, 12);
    const r = await sql`
      insert into rate_sets (year, version, effective_from, sha256, note)
      values (${Number(year)}, ${version}, ${from}, ${sha}, ${`asOf ${json.asOf}`})
      on conflict (year, version) do nothing returning id`;
    if (r.length) console.log(`migrate: 요율 ${year} 버전 ${version} 기록`);
  }
  console.log("migrate: DB 가 최신이에요.");
} catch (e) {
  console.error("migrate: 실패 —", mask(e));
  process.exitCode = 1;
} finally {
  await sql.end();
}
