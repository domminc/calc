# 플로우차트

> Mermaid 문법(GitHub에서 바로 렌더링). 계산 로직 상세는 [FORMULAS.md](FORMULAS.md).

## 1. 사용자 흐름 (전체)

```mermaid
flowchart TD
  A([방문: 검색·대문 카드·링크]) --> B{진입 경로}
  B -->|홈 /| C[계산기 4종 중 선택]
  B -->|검색 /salary/table/4000| D[연봉별 실수령액표]
  B -->|공유 링크 /r/id| E[읽기 전용 결과]
  D -->|이 연봉으로 계산| F
  C --> F[계산기 화면: 입력 폼]
  F --> G{입력 유효?}
  G -->|아니오| H[필드 오류 표시<br/>결과 유지/숨김]
  H --> F
  G -->|예| I[즉시 계산 · 300ms 디바운스]
  I --> J[결과: 실수령·공제표·근거]
  J --> K{다음 행동}
  K -->|입력 수정| F
  K -->|링크 만들기| L[POST /api/share]
  K -->|엑셀·PDF| M[GET /api/export]
  K -->|주소 복사| N[쿼리스트링 URL 복사]
  K -->|다른 계산기| C
  K -->|값이 다르다| O[/feedback 신고]
  L --> P[짧은 링크 표시 · 복사]
  E -->|이 입력으로 다시 계산| F
```

## 2. 연봉 계산기 로직

```mermaid
flowchart TD
  S([입력: 연봉, 퇴직금방식, 비과세, 가족수, 자녀수, 기준일]) --> V{검증}
  V -->|범위 밖/비과세>월급| X([오류 메시지])
  V -->|OK| M[월 총지급액 M = ⌊연봉÷12 또는 ÷13⌋]
  M --> T[T = M − 비과세]
  T --> I1[국민연금: 기준소득월액 clamp 후 4.75%]
  T --> I2[건강보험: clamp 후 3.595%]
  I2 --> I3[장기요양: 건강보험 × 0.9448/7.19]
  T --> I4[고용보험 0.9%]
  T --> W{T < 770천원?}
  W -->|예| W0[소득세 0]
  W -->|아니오| W1{T 구간}
  W1 -->|770~10,000천원 미만| W2[간이세액표 조회 가족수 열]
  W1 -->|10,000천원| W3[at10000 행]
  W1 -->|초과| W4[별표2 말미 계산식]
  W2 & W3 & W4 --> C1[자녀 세액공제 차감 최소 0]
  W0 --> L
  C1 --> L[지방소득세 = ⌊소득세×10%⌋₁₀]
  I1 & I2 & I3 & I4 & L --> R[공제 합계 · 월 실수령 = M − 공제]
  R --> O([결과: 월/연 실수령, 실효공제율, 사업주 부담])
```

## 3. 역산 (희망 월 실수령 → 연봉)

```mermaid
flowchart TD
  A([목표 월 실수령]) --> B[lo=1천만, hi=20억]
  B --> C{hi − lo > 1만원?}
  C -->|예| D[mid = 만원 단위 중간]
  D --> E{net mid ≥ 목표?}
  E -->|예| F[hi = mid]
  E -->|아니오| G[lo = mid]
  F --> C
  G --> C
  C -->|아니오| H([연봉 = hi, 그 연봉의 순방향 결과 표시])
```

## 4. 프리랜서 5월 정산 로직

```mermaid
flowchart TD
  A([수입·경비방식·인원·자녀·국민연금·기납부]) --> B{경비 방식}
  B -->|단순경비율| C[X = ⌊수입×경비율⌋]
  B -->|실제 경비| D[X = 입력값]
  C & D --> E[소득금액 I = 수입 − X]
  E --> F[소득공제 = 150만×인원 + 국민연금 + 기타]
  F --> G[과세표준 TB = max 0, I − 공제]
  G --> H[산출세액 S = ⌊TB×r − q⌋]
  H --> I[세액공제: 자녀 + 표준 7만]
  I --> J[결정세액 P = max 0, S − 공제]
  J --> K[지방소득세 PL = ⌊P×10%⌋₁₀]
  K --> L[정산 = P − 기납부3% + PL − 기납부지방세]
  L --> M{정산 < 0?}
  M -->|예| N([환급 예상액])
  M -->|아니오| O([추가 납부액])
  I -.탭C.-> Q[지역 건보료·국민연금 추정 → 월 실수령]
```

## 5. 공유 링크 생성 (시퀀스)

```mermaid
sequenceDiagram
  participant U as 브라우저
  participant W as Worker
  participant DB as Neon (Hyperdrive)
  U->>W: POST /api/share {calculator, inputs}
  W->>W: zod 스키마 검증 · 크기 ≤ 8KB
  W->>DB: rate_limits 확인/증가 (IP 일 솔트 해시)
  alt 한도 초과
    W-->>U: 429 {error: too_many_requests}
  else 허용
    W->>DB: INSERT shared_results (id 8자리, expires_at=+90일)
    W->>DB: usage_daily share_count +1
    W-->>U: 201 {id, url}
  end
  Note over U,W: 이후 GET /r/{id} 는 저장된 입력+기준연도로 재계산해 렌더
```

## 6. 엑셀·PDF 내려받기 (R2 캐시)

```mermaid
sequenceDiagram
  participant U as 브라우저
  participant W as Worker
  participant R as R2
  U->>W: GET /api/export/xlsx?c=salary&annual=…
  W->>W: 입력 검증 · 계산 · key = sha256(계산기+입력+기준연도)
  W->>R: HEAD exports/{key}.xlsx
  alt 캐시 있음
    R-->>W: 객체
  else 없음
    W->>W: 파일 생성 (xlsx / pdf-lib + Pretendard 서브셋)
    W->>R: PUT exports/{key}.xlsx (7일 수명주기)
  end
  W-->>U: 200 파일 (Content-Disposition)
  Note over W: DB 장애여도 내보내기는 동작. 통계만 건너뜀
```

## 7. 요율 갱신 (운영 절차, 연 2회)

```mermaid
flowchart TD
  A([공고: 1월 요율 · 7월 국민연금 상·하한 · 3월 간이세액표]) --> B[data/source/연도 에 원문 PDF 보관]
  B --> C[scripts/build-withholding.mjs 로 표 JSON 생성<br/>무결성 검사 자동 실행]
  C --> D[rates.json 수정: 값 · 시행일 · 출처 · verified]
  D --> E[테스트: 공식 벡터 · 골든 · 해시 고정 갱신]
  E --> F{CI 통과?}
  F -->|아니오| D
  F -->|예| G[main 병합 → 자동 배포]
  G --> H[배포 시 rate_sets 이력 기록 · /basis 개정 이력 갱신]
  H --> I[R2 sources/ 에 원문 업로드]
```

## 8. 예외·오류 처리 표

| 상황 | 감지 | 사용자 화면 | 서버 처리 |
|---|---|---|---|
| 숫자 아님/음수 | 클라이언트·서버 둘 다 | 필드 아래 붉은 문구, 결과 영역 유지 | 400 + fields |
| 연봉 범위 밖(<1천만·>20억) | 검증 | "1,000만원~20억원 사이로 입력" | 400 |
| 비과세 > 월 급여 | 검증 | "비과세액이 월 급여보다 큽니다" | 400 |
| 가족 수 < 1 또는 자녀 > 가족−1 | 검증 | 자동 보정 + 안내문 | 보정된 값으로 계산, 응답에 `adjusted` 표기 |
| 월 과세급여 < 770천원 | 계산 | "소득세 0원 구간" 배지 | 정상 |
| 국민연금 상·하한 적용 | 계산 | "상한(하한) 적용" 배지 | 정상 |
| DB 연결 실패 | 공유/통계 호출 | 공유 버튼 비활성 + "잠시 후 다시" | 계산·내보내기는 정상, 오류 로그(입력 미기록) |
| R2 실패 | 내보내기 | "파일을 만들지 못했어요. 다시 시도" | 500, 캐시 건너뛰고 직접 생성 시도 |
| 공유 ID 없음/만료 | `/r/{id}` | 404 안내 + 계산기 이동 버튼 | 404 |
| 속도 제한 | 공유·신고 | "잠시 뒤에 다시 시도해 주세요" | 429 + Retry-After |
| JS 비활성/실패 | — | 폼 제출(GET)로 서버 렌더 결과 | 같은 코어로 계산 |
