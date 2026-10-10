// 브라우저 보강 스크립트. JS 가 없어도 서버가 같은 결과를 그려 주므로, 여기서는 "즉시 갱신"만 맡는다.
import { compute, isCalcKey, sanitizeInputs, type CalcKey } from "../render/calculators.ts";
import { allowanceRow } from "../render/forms.ts";
import { hangulWon } from "../render/html.ts";
import { calcSalary, parseSalaryInput } from "../core/salary.ts";
import { resolveRates } from "../core/rates.ts";

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];

const digits = (s: string) => s.replace(/[^\d]/g, "");
const commaFmt = (s: string) => (s === "" ? "" : Number(s).toLocaleString("ko-KR"));

function readHero(root: ParentNode): number | undefined {
  const t = $("[data-hero]", root)?.textContent;
  return t ? Number(digits(t)) : undefined;
}

/** 큰 숫자가 바뀔 때 0.35초 동안 부드럽게 따라가고, 끝에는 항상 정확한 값으로 맞춘다 */
function tweenHero(root: ParentNode, prev: number | undefined): void {
  const el = $("[data-hero]", root);
  if (!el || prev === undefined || reducedMotion()) return;
  const finalText = el.textContent ?? "";
  const next = Number(digits(finalText));
  if (!Number.isFinite(next) || Math.abs(next - prev) < 2) return;
  const start = performance.now();
  const dur = 350;
  const step = (now: number) => {
    const k = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = k >= 1 ? finalText : Math.round(prev + (next - prev) * eased).toLocaleString("ko-KR");
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = finalText;
  };
  requestAnimationFrame(step);
}

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.webdriver === true;

/** 슬라이더 채움 비율 (CSSOM 이라 CSP 인라인 스타일 제한을 받지 않는다) */
function paintRange(r: HTMLInputElement): void {
  const min = Number(r.min);
  const max = Number(r.max);
  const v = Math.min(Math.max(Number(r.value), min), max);
  r.style.setProperty("--pct", `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
}

/** 입력 이름에 연결된 슬라이더를 현재 값에 맞춘다 */
function syncRange(root: ParentNode, name: string): void {
  const r = $<HTMLInputElement>(`input.range[data-range-for="${name}"]`, root);
  const t = $<HTMLInputElement>(`[name="${name}"]`, root);
  if (!r || !t) return;
  r.value = String(Number(digits(t.value)) || 0);
  paintRange(r);
}

/** 슬라이더를 움직이면 숫자 입력에 반영 */
function bindRanges(root: ParentNode, onChange: () => void): void {
  for (const r of $$<HTMLInputElement>("input.range[data-range-for]", root)) {
    paintRange(r);
    r.addEventListener("input", () => {
      const t = $<HTMLInputElement>(`[name="${r.dataset.rangeFor}"]`, root);
      if (!t) return;
      t.value = commaFmt(r.value);
      paintRange(r);
      onChange();
    });
  }
}

function formRaw(form: HTMLFormElement): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [k, v] of new FormData(form).entries()) if (typeof v === "string") raw[k] = v;
  return raw;
}

function valueOf(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name);
  if (!el) return "";
  if (el instanceof RadioNodeList) return el.value;
  return (el as HTMLInputElement).value;
}

function applyWhen(form: HTMLFormElement): void {
  for (const el of $$("[data-when]", form)) {
    const [name, vals] = (el.getAttribute("data-when") ?? "").split("=");
    if (!name || !vals) continue;
    el.hidden = !vals.split("|").includes(valueOf(form, name));
  }
}

function formatMoneyInput(input: HTMLInputElement): void {
  const before = input.value;
  const caret = input.selectionStart ?? before.length;
  const digitsBefore = digits(before.slice(0, caret)).length;
  const formatted = commaFmt(digits(before));
  if (formatted === before) return;
  input.value = formatted;
  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < digitsBefore) {
    if (/\d/.test(formatted[pos]!)) seen++;
    pos++;
  }
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    /* 일부 입력 형식에서는 무시 */
  }
}

function updateHangul(form: HTMLFormElement, input: HTMLInputElement): void {
  const out = $(`[data-hangul="${input.name}"]`, form);
  if (!out) return;
  const n = Number(digits(input.value));
  out.textContent = n > 0 ? hangulWon(n) : "";
}

function setErrors(form: HTMLFormElement, errors: Record<string, string>): void {
  for (const p of $$(".field-error", form)) {
    const name = p.id.replace(/^e-/, "");
    const msg = errors[name];
    p.textContent = msg ?? "";
    p.hidden = !msg;
    const field = p.closest(".field, .allow-amt");
    field?.classList.toggle("has-error", !!msg);
    const input = $(`[name="${name}"]`, form);
    if (input) {
      if (msg) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }
}

function queryOf(key: CalcKey, raw: Record<string, string>): string {
  const clean = sanitizeInputs(key, raw);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(clean)) if (v !== "") q.set(k, v);
  return q.toString();
}

function initCalc(root: HTMLElement): void {
  const key = root.dataset.calc ?? "";
  if (!isCalcKey(key)) return;
  const form = $<HTMLFormElement>("form[data-form]", root);
  const result = $("#result", root);
  if (!form || !result) return;
  const sticky = $("[data-sticky]");
  const shareOut = $("[data-share-out]", root);

  const refresh = () => {
    const raw = formRaw(form);
    const out = compute(key, raw);
    const prevHero = readHero(result);
    result.innerHTML = out.html;
    tweenHero(result, prevHero);
    setErrors(form, out.errors);
    const q = queryOf(key, raw);
    history.replaceState(null, "", q ? `${location.pathname}?${q}` : location.pathname);
    for (const a of $$<HTMLAnchorElement>("[data-export]", root)) a.href = `/api/export/${a.dataset.export}?c=${key}&${q}`;
    if (sticky) {
      const lb = $("[data-sb-label]", sticky);
      const vb = $("[data-sb-value]", sticky);
      if (lb && vb) {
        lb.textContent = out.summary?.label ?? "";
        vb.textContent = out.summary?.value ?? "";
      }
      updateSticky();
    }
    if (shareOut) shareOut.hidden = true;
  };
  const refreshSoon = debounce(refresh, 150);
  bindRanges(form, refreshSoon);

  form.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains("money")) {
      formatMoneyInput(t);
      updateHangul(form, t);
      syncRange(form, t.name);
    } else if (t.closest("[data-stepper]") && t.type === "text") {
      t.value = digits(t.value);
    }
    if (t.type === "radio" || t.tagName === "SELECT" || t.type === "checkbox" || t.type === "date") applyWhen(form);
    refreshSoon();
  });
  form.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.type === "radio" || t.tagName === "SELECT" || t.type === "checkbox" || t.type === "date") {
      applyWhen(form);
      refresh();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    refresh();
  });

  form.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-fill]");
    if (chip) {
      const input = $<HTMLInputElement>(`[name="${chip.dataset.fill}"]`, form);
      if (input) {
        input.value = commaFmt(chip.dataset.value ?? "");
        updateHangul(form, input);
        syncRange(form, input.name);
        refresh();
      }
      return;
    }
    const step = t.closest<HTMLElement>("[data-step]");
    if (step) {
      const wrap = step.closest("[data-stepper]");
      const input = wrap ? $<HTMLInputElement>("input", wrap) : null;
      if (!input) return;
      const min = Number(input.dataset.min ?? 0);
      const max = Number(input.dataset.max ?? 99);
      const next = Math.min(max, Math.max(min, (Number(digits(input.value)) || 0) + Number(step.dataset.step)));
      input.value = String(next);
      syncStepper(wrap!);
      refresh();
      return;
    }
    if (t.closest("[data-add-allow]")) return addAllowance(form, "", "", false, true, refresh);
    if (t.closest("[data-add-meal]")) return addAllowance(form, "식대", "200,000", true, false, refresh);
    const rm = t.closest("[data-remove-allow]");
    if (rm) {
      rm.closest("[data-allow-row]")?.remove();
      refresh();
    }
  });
  for (const w of $$("[data-stepper]", form)) syncStepper(w);
  form.addEventListener("input", (e) => {
    const w = (e.target as HTMLElement).closest("[data-stepper]");
    if (w) syncStepper(w);
  });

  // 공유·복사
  $("[data-share]", root)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const out = compute(key, formRaw(form));
    if (!out.ok || !shareOut) return;
    btn.disabled = true;
    try {
      const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ calculator: key, inputs: sanitizeInputs(key, formRaw(form)) }) });
      const data = (await res.json()) as { url?: string; message?: string };
      shareOut.hidden = false;
      if (res.ok && data.url) {
        shareOut.innerHTML = "";
        const a = document.createElement("a");
        a.href = data.url;
        a.textContent = data.url;
        shareOut.append("공유 링크(90일 보관): ", a, " ");
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "btn btn-small";
        copy.textContent = "복사";
        copy.addEventListener("click", () => copyText(data.url!, copy));
        shareOut.append(copy);
        copyText(data.url, copy);
      } else {
        shareOut.textContent = data.message ?? "링크를 만들지 못했어요.";
      }
    } catch {
      shareOut.hidden = false;
      shareOut.textContent = "네트워크 오류로 링크를 만들지 못했어요.";
    } finally {
      btn.disabled = false;
    }
  });
  $("[data-copy-url]", root)?.addEventListener("click", (e) => copyText(location.href, e.currentTarget as HTMLElement));

  applyWhen(form);
  $$<HTMLInputElement>("input.money", form).forEach((i) => updateHangul(form, i));
  refresh();
}

function syncStepper(wrap: Element): void {
  const input = $<HTMLInputElement>("input", wrap);
  if (!input) return;
  const v = Number(digits(input.value)) || 0;
  const min = Number(input.dataset.min ?? 0);
  const max = Number(input.dataset.max ?? 99);
  const [minus, plus] = $$<HTMLButtonElement>("[data-step]", wrap);
  if (minus) minus.disabled = v <= min;
  if (plus) plus.disabled = v >= max;
}

function addAllowance(form: HTMLFormElement, name: string, amount: string, nonTaxable: boolean, ordinary: boolean, refresh: () => void): void {
  const rows = $("[data-allow-rows]", form);
  const box = $("[data-allow]", form);
  if (!rows || !box) return;
  const max = Number(box.dataset.max ?? 10);
  const used = new Set($$("[data-allow-row] input[name$='_amount']", rows).map((i) => Number((i as HTMLInputElement).name.match(/^al(\d+)_/)?.[1])));
  let n = 0;
  while (used.has(n)) n++;
  if (used.size >= max) return;
  rows.insertAdjacentHTML("beforeend", allowanceRow(n, name, amount, nonTaxable, ordinary, {}));
  $<HTMLInputElement>(`[name="al${n}_${name ? "amount" : "name"}"]`, rows)?.focus();
  refresh();
}

async function copyText(text: string, btn: HTMLElement): Promise<void> {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "복사했어요";
  } catch {
    btn.textContent = "직접 복사해 주세요";
  }
  setTimeout(() => {
    btn.textContent = label;
  }, 1800);
}

let stickyObserverVisible = true;
function updateSticky(): void {
  const bar = $("[data-sticky]");
  if (!bar) return;
  const has = !!$("[data-sb-value]", bar)?.textContent;
  bar.hidden = stickyObserverVisible || !has || window.matchMedia("(min-width: 960px)").matches;
}

function initSticky(): void {
  const result = $("#result");
  if (!result || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(
    ([entry]) => {
      stickyObserverVisible = !!entry?.isIntersecting;
      updateSticky();
    },
    { threshold: 0.05 },
  ).observe(result);
  window.addEventListener("resize", debounce(updateSticky, 100));
}

function initFeedback(): void {
  const hidden = $<HTMLInputElement>("input[name=page_url]");
  if (hidden && document.referrer.startsWith(location.origin)) hidden.value = document.referrer.slice(0, 500);
}

function initTheme(): void {
  const btn = $("[data-theme-toggle]");
  if (!btn) return;
  const effective = (): "light" | "dark" => (document.documentElement.getAttribute("data-theme") as "light" | "dark" | null) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const label = () => btn.setAttribute("aria-label", `화면 테마 바꾸기 (현재: ${effective() === "dark" ? "다크" : "라이트"})`);
  label();
  btn.addEventListener("click", () => {
    const next = effective() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* 저장 불가 환경에서는 이번 방문에만 적용 */
    }
    label();
  });
}

/** 홈 빠른 계산기: 연봉만 넣으면 월 실수령액 */
function initQuick(): void {
  const q = $("[data-quick]");
  if (!q) return;
  const input = $<HTMLInputElement>("input.money", q);
  const range = $<HTMLInputElement>("input.range", q);
  const net = $("[data-q-net]", q);
  const sub = $("[data-q-sub]", q);
  const link = $<HTMLAnchorElement>("[data-q-link]", q);
  const han = $("[data-q-hangul]", q);
  if (!input || !net || !sub || !link) return;
  const meal = Number(q.dataset.meal ?? 0);
  const update = () => {
    const annual = Number(digits(input.value)) || 0;
    if (han) han.textContent = annual > 0 ? hangulWon(annual) : "";
    const p = parseSalaryInput({ annual, nonTaxable: meal, family: 1, children: 0 });
    if (Object.keys(p.errors).length) {
      sub.textContent = p.errors.annual ?? "입력값을 확인해 주세요.";
      return;
    }
    const r = calcSalary(p.value, resolveRates(p.value.asOf));
    const prev = Number(digits(net.textContent ?? ""));
    net.textContent = `${r.netMonthly.toLocaleString("ko-KR")}원`;
    sub.textContent = `공제 ${r.totalDeduction.toLocaleString("ko-KR")}원 · 공제율 ${(r.deductionRatio * 100).toFixed(1)}%`;
    link.href = `/salary?annual=${annual}`;
    if (!reducedMotion() && Number.isFinite(prev) && Math.abs(prev - r.netMonthly) > 1) {
      const el = net;
      const start = performance.now();
      const finalText = el.textContent ?? "";
      const step = (now: number) => {
        const k = Math.min((now - start) / 300, 1);
        el.textContent = k >= 1 ? finalText : `${Math.round(prev + (r.netMonthly - prev) * (1 - Math.pow(1 - k, 3))).toLocaleString("ko-KR")}원`;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  };
  input.addEventListener("input", () => {
    formatMoneyInput(input);
    if (range) {
      range.value = String(Number(digits(input.value)) || 0);
      paintRange(range);
    }
    update();
  });
  if (range) {
    paintRange(range);
    range.addEventListener("input", () => {
      input.value = commaFmt(range.value);
      paintRange(range);
      update();
    });
  }
  update();
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initQuick();
  for (const el of $$("[data-calc]")) initCalc(el);
  initSticky();
  initFeedback();
});
