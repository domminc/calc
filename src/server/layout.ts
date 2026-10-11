import { esc } from "../render/html.ts";
import { NAV, SITE_NAME } from "./meta.ts";

/** 웹 폰트: Pretendard 다이나믹 서브셋 (unicode-range 로 쓰는 글자의 조각만 내려받는다). public/fonts/pretendard.css */
export const FONT_CSS = "/fonts/pretendard.css";

export interface PageOpts {
  title: string;
  description: string;
  path: string;
  origin: string;
  version: string;
  body: string;
  /** 현재 내비 항목 */
  current?: string;
  noindex?: boolean;
  jsonld?: unknown[];
  /** 브라우저 스크립트 필요 여부 */
  script?: boolean;
  /** <body data-page> */
  page?: string;
}

/** 아이콘 스프라이트 (같은 문서 안 <use>라 CSP 에 걸리지 않는다) */
const SPRITE = `<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>
<symbol id="i-salary" viewBox="0 0 24 24"><path d="M3 8a3 3 0 0 1 3-3h11a2 2 0 0 1 2 2v1"/><path d="M3 8v9a3 3 0 0 0 3 3h12a2 2 0 0 0 2-2v-3"/><path d="M21 10v4h-4a2 2 0 1 1 0-4h4Z"/></symbol>
<symbol id="i-payroll" viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></symbol>
<symbol id="i-insurance" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></symbol>
<symbol id="i-freelancer" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19.5h20"/></symbol>
<symbol id="i-yearend" viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h4"/><path d="m13 17 2 2 3.5-4"/></symbol>
<symbol id="i-more" viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></symbol>
<symbol id="i-share" viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></symbol>
<symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></symbol>
<symbol id="i-sheet" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/></symbol>
<symbol id="i-pdf" viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5M9 15h6M9 18h4"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7L19 17Z"/></symbol>
<symbol id="i-flag" viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></symbol>
<symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z"/></symbol>
</defs></svg>`;

export const icon = (name: string, cls = ""): string => `<svg class="ico${cls ? ` ${cls}` : ""}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

const TAB_ITEMS: { href: string; label: string; ico: string }[] = [
  { href: "/salary", label: "연봉", ico: "salary" },
  { href: "/payroll", label: "급여", ico: "payroll" },
  { href: "/insurance", label: "4대보험", ico: "insurance" },
  { href: "/freelancer", label: "프리랜서", ico: "freelancer" },
  { href: "/yearend", label: "연말정산", ico: "yearend" },
  { href: "/basis", label: "기준", ico: "more" },
];

export function layout(o: PageOpts): string {
  const url = `${o.origin}${o.path}`;
  const nav = NAV.map((n) => `<a href="${n.href}"${o.current === n.href ? ' aria-current="page"' : ""}>${esc(n.label)}</a>`).join("");
  const tabs = TAB_ITEMS.map((t) => `<a href="${t.href}"${o.current === t.href ? ' aria-current="page"' : ""}>${icon(t.ico)}<span>${esc(t.label)}</span></a>`).join("");
  const ld = (o.jsonld ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replaceAll("<", "\\u003c")}</script>`).join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${esc(url)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f4f6f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#090b0a" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/js/theme.js?v=${esc(o.version)}"></script>
${FONT_CSS ? `<link rel="stylesheet" href="${FONT_CSS}">` : ""}
<link rel="stylesheet" href="/css/app.css?v=${esc(o.version)}">
${ld}
</head>
<body${o.page ? ` data-page="${esc(o.page)}"` : ""}>
${SPRITE}
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28"><span>homesell <b>계산기</b></span></a>
    <nav class="nav" aria-label="주 메뉴">${nav}</nav>
    <button type="button" class="icon-btn theme-btn" data-theme-toggle aria-label="화면 테마 바꾸기 (현재: 시스템)" title="화면 테마">${icon("sun", "i-sun")}${icon("moon", "i-moon")}</button>
  </div>
</header>
<main id="main">
${o.body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>${SITE_NAME}의 결과는 모의 계산이에요. 실제 급여·보험료·세금은 회사와 공단·국세청 기준으로 확정돼요.</p>
    <p class="links"><a href="/basis">계산 기준·출처</a><a href="/feedback">오류·불일치 신고</a><a href="https://www.homesell.co.kr/">homesell 홈</a></p>
    <p class="copy">© homesell</p>
  </div>
</footer>
<nav class="tabbar" aria-label="계산기 바로가기">${tabs}</nav>
${o.script === false ? "" : `<script type="module" src="/js/app.js?v=${esc(o.version)}"></script>`}
</body>
</html>`;
}
