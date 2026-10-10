import { esc } from "../render/html.ts";
import { NAV, SITE_NAME } from "./meta.ts";

/** 웹 폰트 스타일시트. 마지막 단계에서 Pretendard 다이나믹 서브셋으로 전환한다. */
export const FONT_CSS = "";

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

export function layout(o: PageOpts): string {
  const url = `${o.origin}${o.path}`;
  const nav = NAV.map((n) => `<a href="${n.href}"${o.current === n.href ? ' aria-current="page"' : ""}>${esc(n.label)}</a>`).join("");
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
<meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d0e10" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${FONT_CSS ? `<link rel="stylesheet" href="${FONT_CSS}">` : ""}
<link rel="stylesheet" href="/css/app.css?v=${esc(o.version)}">
${ld}
</head>
<body${o.page ? ` data-page="${esc(o.page)}"` : ""}>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/"><img src="/favicon.svg" alt="" width="26" height="26">homesell <span>계산기</span></a>
    <nav class="nav" aria-label="주 메뉴">${nav}</nav>
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
${o.script === false ? "" : `<script type="module" src="/js/app.js?v=${esc(o.version)}"></script>`}
</body>
</html>`;
}
