import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { Env } from "./env.ts";
import { origin } from "./env.ts";
import { withSql, DbUnavailable } from "./db.ts";
import { compute, isCalcKey, sanitizeInputs, CALC_KEYS, type CalcKey } from "../render/calculators.ts";
import { resolveRates, todayKst } from "../core/rates.ts";
import { basisPage, calculatorPage, feedbackPage, homePage, isTableMan, notFoundPage, sharedPage, tableDetailPage, tableIndexPage, tableRows, toRaw } from "./pages.ts";
import { buildReport } from "./report.ts";
import { contentDisposition, toPdf, toXlsx } from "./export.ts";
import { clientKey, getShare, insertFeedback, insertShare, overLimit, purgeExpired, rateHistory, sha256Hex, trackUsage } from "./store.ts";
import { CALCS } from "./meta.ts";

type AppEnv = { Bindings: Env };

const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"].join("; ");

export const app = new Hono<AppEnv>();

function ctxOf(c: Context<AppEnv>): Pick<ExecutionContext, "waitUntil"> {
  try {
    return c.executionCtx;
  } catch {
    return { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };
  }
}
const pageCtx = (c: Context<AppEnv>) => ({ origin: origin(c.env), version: c.env.ASSET_VERSION ?? "dev" });

app.use("*", async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("Content-Security-Policy", CSP);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
});

const html = (c: Context<AppEnv>, body: string, cache: "static" | "dynamic" = "static", status: 200 | 404 = 200) => {
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", cache === "static" ? "public, max-age=60, s-maxage=300" : "private, no-cache");
  return c.body(body, status);
};

app.get("/", (c) => html(c, homePage(pageCtx(c))));

for (const key of CALC_KEYS) {
  app.get(CALCS[key].path, (c) => {
    const search = new URL(c.req.url).searchParams;
    trackUsage(c.env, ctxOf(c), key, "view_count");
    return html(c, calculatorPage(pageCtx(c), key, search), [...search.keys()].length ? "dynamic" : "static");
  });
}

app.get("/salary/table", (c) => {
  trackUsage(c.env, ctxOf(c), "table", "view_count");
  return html(c, tableIndexPage(pageCtx(c)));
});
app.get("/salary/table/:man", (c) => {
  const man = Number(c.req.param("man"));
  if (!isTableMan(man)) return html(c, notFoundPage(pageCtx(c)), "static", 404);
  trackUsage(c.env, ctxOf(c), "table", "view_count");
  return html(c, tableDetailPage(pageCtx(c), man));
});

app.get("/basis", async (c) => {
  let history = null;
  if (c.env.HYPERDRIVE) {
    history = await withSql(c.env, ctxOf(c), (sql) => rateHistory(sql)).catch(() => null);
  }
  const files: { name: string; href: string }[] = [];
  if (c.env.FILES) {
    const list = await c.env.FILES.list({ prefix: "sources/" }).catch(() => null);
    for (const o of list?.objects ?? []) files.push({ name: o.key.replace("sources/", ""), href: `/${o.key}` });
  }
  return html(c, basisPage(pageCtx(c), history, files));
});

app.get("/sources/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice(1));
  if (!c.env.FILES || !/^sources\/[\w./-]+$/.test(key) || key.includes("..")) return html(c, notFoundPage(pageCtx(c)), "static", 404);
  const obj = await c.env.FILES.get(key);
  if (!obj) return html(c, notFoundPage(pageCtx(c)), "static", 404);
  const type = key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".txt") ? "text/plain; charset=utf-8" : "application/octet-stream";
  return new Response(obj.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "Content-Disposition": "inline" } });
});

// ---------------- 공유 ----------------

app.get("/r/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9A-Za-z]{8}$/.test(id)) return html(c, notFoundPage(pageCtx(c)), "static", 404);
  try {
    const row = await withSql(c.env, ctxOf(c), (sql) => getShare(sql, id));
    if (!row || !isCalcKey(row.calculator)) return html(c, notFoundPage(pageCtx(c)), "static", 404);
    return html(c, sharedPage(pageCtx(c), id, row.calculator, row.inputs, row.expires_at, row.rate_year), "dynamic");
  } catch (e) {
    if (e instanceof DbUnavailable) return html(c, notFoundPage(pageCtx(c)), "static", 404);
    console.error("share read failed", e instanceof Error ? e.message : e);
    return c.text("잠시 후 다시 시도해 주세요.", 503);
  }
});

const ShareBody = z.object({ calculator: z.enum(["salary", "payroll", "insurance", "freelancer", "yearend"]), inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) });

app.post("/api/share", async (c) => {
  const text = await c.req.text();
  if (text.length > 8192) return c.json({ error: "too_large", message: "입력이 너무 커요." }, 413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return c.json({ error: "bad_json", message: "요청 형식이 올바르지 않아요." }, 400);
  }
  const parsed = ShareBody.safeParse(json);
  if (!parsed.success) return c.json({ error: "invalid", message: "요청 내용이 올바르지 않아요." }, 400);
  const key = parsed.data.calculator as CalcKey;
  const inputs = sanitizeInputs(key, parsed.data.inputs);
  const check = compute(key, inputs);
  if (!check.ok) return c.json({ error: "invalid_inputs", message: "입력값을 확인해 주세요.", fields: check.errors }, 400);
  try {
    const rl = await clientKey(c.env, c.req.header("cf-connecting-ip"), "share");
    const result = await withSql(c.env, ctxOf(c), async (sql) => {
      if (await overLimit(sql, rl, 10)) return { limited: true as const };
      const rateYear = resolveRates(inputs.asOf).set.year;
      return { limited: false as const, id: await insertShare(sql, key, rateYear, inputs) };
    });
    if (result.limited) {
      c.header("Retry-After", "60");
      return c.json({ error: "too_many_requests", message: "잠시 뒤에 다시 시도해 주세요." }, 429);
    }
    trackUsage(c.env, ctxOf(c), key, "share_count");
    return c.json({ id: result.id, url: `${origin(c.env)}/r/${result.id}` }, 201);
  } catch (e) {
    if (e instanceof DbUnavailable) return c.json({ error: "unavailable", message: "공유 기능을 지금은 쓸 수 없어요." }, 503);
    console.error("share failed", e instanceof Error ? e.message : e);
    return c.json({ error: "server", message: "링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요." }, 500);
  }
});

// ---------------- 내려받기 ----------------

app.get("/api/export/:fmt", async (c) => {
  const fmt = c.req.param("fmt");
  const key = c.req.query("c") ?? "";
  if ((fmt !== "xlsx" && fmt !== "pdf") || !isCalcKey(key)) return c.json({ error: "invalid", message: "요청이 올바르지 않아요." }, 400);
  const raw = Object.fromEntries(new URL(c.req.url).searchParams);
  delete raw.c;
  const inputs = sanitizeInputs(key, raw);
  if (!inputs.asOf) inputs.asOf = todayKst();
  const report = buildReport(key, inputs);
  if (!report) return c.json({ error: "invalid_inputs", message: "입력값을 확인해 주세요." }, 400);

  const canonical = JSON.stringify([key, fmt, Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)), resolveRates(inputs.asOf).set.year]);
  const objKey = `exports/${await sha256Hex(canonical)}.${fmt}`;
  const type = fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
  const headers = { "Content-Type": type, "Content-Disposition": contentDisposition(report.fileName, fmt), "Cache-Control": "private, max-age=300" };

  const files = c.env.FILES;
  if (files) {
    const hit = await files.get(objKey).catch(() => null);
    if (hit) return new Response(hit.body, { headers: { ...headers, "X-Cache": "hit" } });
  }
  if (c.env.HYPERDRIVE) {
    const rl = await clientKey(c.env, c.req.header("cf-connecting-ip"), "export");
    const limited = await withSql(c.env, ctxOf(c), (sql) => overLimit(sql, rl, 20)).catch(() => false);
    if (limited) {
      c.header("Retry-After", "60");
      return c.json({ error: "too_many_requests", message: "잠시 뒤에 다시 시도해 주세요." }, 429);
    }
  }
  try {
    const bytes = fmt === "xlsx" ? await toXlsx(report) : await toPdf(report);
    if (files) ctxOf(c).waitUntil(files.put(objKey, bytes, { httpMetadata: { contentType: type }, customMetadata: { calc: key } }).then(() => undefined).catch(() => undefined));
    trackUsage(c.env, ctxOf(c), key, "export_count");
    return new Response(bytes as unknown as BodyInit, { headers: { ...headers, "X-Cache": "miss" } });
  } catch (e) {
    console.error("export failed", e instanceof Error ? e.message : e);
    return c.json({ error: "export_failed", message: "파일을 만들지 못했어요. 다시 시도해 주세요." }, 500);
  }
});

// ---------------- 계산 API / 신고 ----------------

app.get("/api/calc/:key", (c) => {
  const key = c.req.param("key");
  if (!isCalcKey(key)) return c.json({ error: "not_found", message: "알 수 없는 계산기예요." }, 404);
  const out = compute(key, toRaw(new URL(c.req.url).searchParams));
  c.header("Cache-Control", "no-store");
  return c.json({ ok: out.ok, errors: out.errors, adjusted: out.adjusted, summary: out.summary, html: out.html }, out.ok ? 200 : 400);
});

const FeedbackBody = z.object({
  calculator: z.enum(["salary", "payroll", "insurance", "freelancer", "yearend", "other"]),
  message: z.string().trim().min(1).max(2000),
  contact: z.string().trim().max(200).optional(),
  page_url: z.string().trim().max(500).optional(),
});

app.post("/api/feedback", async (c) => {
  const type = c.req.header("content-type") ?? "";
  const wantsJson = type.includes("application/json");
  let body: Record<string, unknown>;
  try {
    body = wantsJson ? ((await c.req.json()) as Record<string, unknown>) : Object.fromEntries((await c.req.formData()).entries());
  } catch {
    return c.json({ error: "bad_request", message: "요청 형식이 올바르지 않아요." }, 400);
  }
  const fail = (status: 400 | 429 | 503, error: string, message: string, calc = "other") => {
    if (wantsJson) return c.json({ error, message }, status);
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(feedbackPage(pageCtx(c), calc, "error", message), status);
  };
  const parsed = FeedbackBody.safeParse(body);
  if (!parsed.success) return fail(400, "invalid", "내용을 1~2,000자로 입력해 주세요.");
  const calc = parsed.data.calculator;
  try {
    const rl = await clientKey(c.env, c.req.header("cf-connecting-ip"), "feedback");
    const limited = await withSql(c.env, ctxOf(c), async (sql) => {
      if (await overLimit(sql, rl, 5)) return true;
      await insertFeedback(sql, { calculator: calc, message: parsed.data.message, contact: parsed.data.contact || null, pageUrl: parsed.data.page_url || null });
      return false;
    });
    if (limited) {
      c.header("Retry-After", "60");
      return fail(429, "too_many_requests", "잠시 뒤에 다시 시도해 주세요.", calc);
    }
    return wantsJson ? c.body(null, 204) : c.redirect("/feedback?status=ok", 303);
  } catch (e) {
    if (!(e instanceof DbUnavailable)) console.error("feedback failed", e instanceof Error ? e.message : e);
    return fail(503, "unavailable", "지금은 접수할 수 없어요. 잠시 후 다시 시도해 주세요.", calc);
  }
});

app.get("/feedback", (c) => {
  const q = new URL(c.req.url).searchParams;
  const calc = q.get("c") ?? "other";
  return html(c, feedbackPage(pageCtx(c), isCalcKey(calc) ? calc : "other", q.get("status") === "ok" ? "ok" : null), "dynamic");
});

// ---------------- 상태 / SEO ----------------

app.get("/api/health", async (c) => {
  const rates = resolveRates();
  const out: Record<string, unknown> = {
    상태: "정상",
    서비스: "homesell-calc",
    기준연도: rates.set.year,
    기준일: rates.asOf,
    버전: c.env.ASSET_VERSION ?? "dev",
    DB_연결: c.env.HYPERDRIVE ? "Hyperdrive" : "없음",
    파일_저장: c.env.FILES ? "R2" : "없음",
  };
  if (c.env.HYPERDRIVE) {
    try {
      await Promise.race([withSql(c.env, ctxOf(c), (sql) => sql`select 1`), new Promise((_, rej) => setTimeout(() => rej(new Error("시간 초과")), 3000))]);
      out.DB_응답 = "정상";
    } catch (e) {
      out.DB_응답 = `오류: ${e instanceof Error ? e.message.replace(/\/\/[^@\s]*@/g, "//****@").slice(0, 120) : "알 수 없음"}`;
      out.상태 = "일부 기능 제한";
    }
  }
  c.header("Cache-Control", "no-store");
  return c.json(out);
});

app.get("/robots.txt", (c) => {
  c.header("Cache-Control", "public, max-age=3600");
  return c.text(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /r/\n\nSitemap: ${origin(c.env)}/sitemap.xml\n`);
});

app.get("/sitemap.xml", (c) => {
  const o = origin(c.env);
  const urls = ["/", ...CALC_KEYS.map((k) => CALCS[k].path), "/salary/table", ...tableRows().map((r) => `/salary/table/${r.man}`), "/basis"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${o}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(xml);
});

app.notFound((c) => html(c, notFoundPage(pageCtx(c)), "static", 404));
app.onError((err, c) => {
  console.error("unhandled", err instanceof Error ? err.message : err);
  return c.text("잠시 후 다시 시도해 주세요.", 500);
});

// ---------------- 예약 작업 ----------------

export async function runScheduled(env: Env, ctx: Pick<ExecutionContext, "waitUntil">): Promise<void> {
  if (env.HYPERDRIVE) {
    const r = await withSql(env, ctx, (sql) => purgeExpired(sql)).catch((e) => {
      console.error("purge failed", e instanceof Error ? e.message : e);
      return null;
    });
    if (r) console.log("purge", JSON.stringify(r));
  }
  if (env.FILES) {
    const cutoff = Date.now() - 7 * 86400_000;
    let cursor: string | undefined;
    let deleted = 0;
    do {
      const list = await env.FILES.list({ prefix: "exports/", ...(cursor ? { cursor } : {}) });
      const old = list.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
      if (old.length) {
        await env.FILES.delete(old);
        deleted += old.length;
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    if (deleted) console.log("exports purged", deleted);
  }
}
