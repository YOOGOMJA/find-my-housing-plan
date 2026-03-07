# LH/SH 도메인 가이드 (사업, 공고, 청약)

작성일: 2026-03-07

## 1) 요약

- `사업`은 정책/공급 프로그램 단위, `공고`는 해당 사업의 회차별 모집 이벤트 단위다.
- LH는 전국 단위 사업 포트폴리오 + API 구조화가 비교적 강하고, SH는 서울 지역 특화 사업 + 공고문/사이트 의존이 상대적으로 크다.
- 자동 판정 정확도를 높이려면 `청약 용어`와 `자격 판단 기준일` 개념을 먼저 고정해야 한다.

## 1-1) 정의 원문 출처(우선순위)

아래는 용어/요건 해석 시 우선 참조할 1차 출처다.

1. 법령 원문: 주택공급에 관한 규칙(국가법령정보센터)
   - https://www.law.go.kr/LSW/lsStmdInfoP.do?lsiSeq=46188
2. 청약 절차/신청 시스템: 청약Home
   - https://applyhome.co.kr/
3. 제도 설명/자격 안내: 마이홈 포털
   - https://www.myhome.go.kr/hws/portal/cont/selectNHTQualificationView.do

주의: 본 문서의 운영 정의와 충돌하면 `법령/고시 원문 > 공고문 원문 > 포털 요약` 순으로 우선 적용한다.

## 2) 왜 이 도메인을 알아야 하나

주택 공고 알림은 "새 공고 감지"만으로 끝나지 않는다. 실제로는 아래를 판정해야 한다.

- 내가 신청 가능한 공고인가 (자격)
- 내가 원하는 주택 조건인가 (상품)
- 지금 행동해야 하는 시점인가 (접수 일정)

즉, 도메인 지식이 부족하면 API를 붙여도 오탐/누락이 크게 발생한다.

## 3) 정책/사업의 이유 (배경)

- LH는 "국민주거생활의 향상과 국토의 효율적 이용"을 위한 국가 단위 공급/개발 기능을 수행한다.
- SH는 "서울시민의 주거복지 향상" 중심의 지역 특화 공공주택/도시재생 기능을 수행한다.

출처:

- LH 기관 소개: https://www.lh.or.kr/
- 서울주거포털 SH 소개: https://housing.seoul.go.kr/site/main/content/sh05_060300

## 4) 사업 vs 공고 (도메인 구분)

### 4-1. 사업

- 장기적으로 반복되는 공급 제도/프로그램 단위
- 예: 공공임대, 공공분양, 장기전세 등
- 특성: 대상계층, 기본 자격구조, 운영 목적이 상대적으로 안정적

### 4-2. 공고

- 특정 시점에 열리는 모집 회차 단위
- 특성: 일정, 지역, 물량, 세부 자격, 제출서류가 회차마다 달라짐
- 중요: 공고일은 자격 판단 기준일로 쓰이는 경우가 많음

출처(공고일 기준일 예시):

- LH 공고문(입주자모집공고일 = 청약자격 판단기준일): https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=0000060987&ccrCnntSysDsCd=02&uppAisTpCd=05&aisTpCd=05&mi=1027

## 5) 청약 핵심 용어 (실무 기준)

아래 정의는 실무 자동화 관점의 운영 정의이며, 최종 판단은 각 공고문 원문이 우선이다.

### 5-1. 청약

- 입주자 모집 공고에 따라 신청 자격을 확인하고 신청하는 절차 전체

### 5-2. 사전청약

- 본청약(최종 분양 신청) 전에 수요를 먼저 접수하는 선행 모집 절차
- 실무적으로는 "사전청약 공고"와 "본청약 공고"를 별도 이벤트로 관리해야 함

참고:

- 마이홈(사전청약 제도/자격 설명 진입): https://www.myhome.go.kr/hws/portal/cont/selectNHTQualificationView.do
- LH 사전청약 공고 API(기술 연동용): https://www.data.go.kr/data/15124599/openapi.do

### 5-3. 입주자모집공고

- 신청 조건, 접수 일정, 제출 서류, 당첨/계약 일정을 담은 공식 공고 문서

### 5-4. 입주자저축(청약통장)

- 공고별 순위/자격 판정에 활용되는 핵심 조건 중 하나
- 실제 적용 방식(가입기간, 납입횟수, 지역/유형별 요건)은 공고문에 따라 달라질 수 있음

판정 엔진 최소 입력 필드(권장):

- `subscription_type`: 통장 유형(예: 주택청약종합저축)
- `subscription_join_date`: 가입일
- `subscription_monthly_payment_count`: 월 납입횟수
- `subscription_total_paid_amount`: 누적 납입금액(선납 포함 여부 별도 저장)
- `subscription_rank`: 공고 기준 1순위/2순위 판정 결과
- `subscription_region`: 적용 지역(시/도 또는 공급권역)
- `subscription_account_status`: 정상/해지/휴면 상태
- `subscription_evidence_date`: 판정 기준일(공고일 기준으로 계산한 일자)

권장 스키마 형식(타입/단위):

- `subscription_type`: `string` (예: `주택청약종합저축`)
- `subscription_join_date`: `string(date)` (ISO 8601, `YYYY-MM-DD`)
- `subscription_monthly_payment_count`: `integer` (단위: 회, `>= 0`)
- `subscription_total_paid_amount`: `integer` (단위: KRW, `>= 0`)
- `subscription_rank`: `string(enum)` (`1순위`, `2순위`, `미달`, `판정불가`)
- `subscription_region`: `string` (예: `서울특별시`)
- `subscription_account_status`: `string(enum)` (`정상`, `해지`, `휴면`, `불명`)
- `subscription_evidence_date`: `string(date)` (기준일, 보통 공고일)

참고:

- 마이홈 자격 안내(입주자저축 요건 예시 포함): https://www.myhome.go.kr/hws/portal/cont/selectNHTQualificationView.do
- 청약Home(신청 시스템): https://applyhome.co.kr/

## 6) LH와 SH의 사업/공고 특성 차이

### 6-1. LH

- 전국 단위 공고 운영
- 목록/상세/사전청약 등 OpenAPI 분리도가 높아 기계 수집에 유리
- 예: 공고문 조회, 공고 상세, 사전청약 공고/공급/상세 API가 분리되어 있음

참고:

- LH 공고문 조회 API: https://www.data.go.kr/data/15058530/openapi.do
- LH 공고 상세 API: https://www.data.go.kr/data/15057999/openapi.do
- LH 사전청약 공고 API: https://www.data.go.kr/data/15124599/openapi.do
- LH 사전청약 공급 API: https://www.data.go.kr/data/15124601/openapi.do
- LH 사전청약 상세 API: https://www.data.go.kr/data/15124603/openapi.do

### 6-2. SH

- 서울 지역 특화 사업 비중이 큼
- 공고 운영은 인터넷청약/공고문 중심 흐름이 강해 문서 파싱 필요성이 큼 (`운영상 추론`)
- 파일데이터는 보조 지표로 유용하지만, 자격 판정 필드가 충분하지 않을 수 있음

참고:

- SH 메인(공고/공급계획/당첨자발표/온라인신청 진입): https://www.i-sh.co.kr/index.do
- SH 공급계획 파일데이터: https://www.data.go.kr/data/15122124/fileData.do
- SH 분양정보 파일데이터: https://www.data.go.kr/data/15008820/fileData.do
- 비교 근거(LH는 공고/상세/사전청약 OpenAPI 분리 제공):
  - https://www.data.go.kr/data/15058530/openapi.do
  - https://www.data.go.kr/data/15057999/openapi.do
  - https://www.data.go.kr/data/15124599/openapi.do

## 7) 주요 임대유형 상세 (구현용 도메인 지식)

아래는 SH/LH 공고에서 자주 마주치는 유형을 자동화 관점으로 정리한 것이다.

### 7-1. 영구임대주택

- 정책 목적: 최저소득 계층의 장기 주거안정
- 일반 특성: 장기 거주(통상 최장 50년), 소형 면적 중심, 낮은 임대료 수준
- 자격 포인트: 수급자/한부모/고령자 등 취약계층 중심, 무주택 요건이 핵심
- 구현 포인트: 일반공급/우선공급(취약계층) 분리를 데이터 모델에 반영

출처:

- 마이홈 임대주택 유형 설명: https://m.myhome.go.kr/hws/portal/cont/selectContRentalHouseView.do
- 서울주거포털 영구임대: https://housing.seoul.go.kr/site/main/content/sh01_030200

### 7-2. 국민임대주택

- 정책 목적: 중저소득 무주택 세대의 장기 임대 수요 대응
- 일반 특성: 장기 임대(통상 30년), 단지형 공급 비중이 높음
- 자격 포인트: 가구원수 연동 소득기준 + 자산/자동차 기준 + 무주택세대구성원 요건
- 구현 포인트: 소득 계산은 세대 범위를 공고문 기준으로 확정해야 함(세대원 포함 범위가 공고별 변동)

출처:

- 마이홈 임대주택 유형 설명: https://m.myhome.go.kr/hws/portal/cont/selectContRentalHouseView.do
- LH 국민임대 공고 예시(유형/공고 구조): https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=2015122300018996&ccrCnntSysDsCd=03&uppAisTpCd=06&aisTpCd=07&mi=1026

### 7-3. 행복주택

- 정책 목적: 청년/신혼부부/고령자 등 계층 맞춤형 주거 지원
- 일반 특성: 젊은 계층 비중이 높은 공급 구조(세부 비율은 연도별 공고 기준 확인)
- 자격 포인트: 계층별 소득/자산 기준이 다름(대학생/청년/신혼부부/고령자 분리)
- 구현 포인트: `applicant_group`(대학생/청년/신혼부부/고령자)를 필수 분기값으로 저장

출처:

- 마이홈 행복주택 자격 안내: https://www.myhome.go.kr/hws/portal/cont/selectHappyHouseView.do

### 7-4. 장기전세주택

- 정책 목적: 무주택자의 장기 거주 안정(서울권에서 SH 브랜드 인지도가 큼)
- 일반 특성: 보증금 중심(월임대료 구조가 일반 월세형 임대와 다름), 장기 거주 가능
- 자격 포인트: 무주택·소득·자산 요건과 지역/공급권역 요건을 함께 확인
- 구현 포인트: 가격 필드를 `deposit 중심`으로 모델링(월임대료 nullable 허용)

출처:

- 마이홈 임대주택 유형 설명: https://m.myhome.go.kr/hws/portal/cont/selectContRentalHouseView.do
- 서울주거포털 장기전세: https://housing.seoul.go.kr/site/main/content/sh01_030600

### 7-5. 기존주택 매입임대주택

- 정책 목적: 기존 주택을 매입해 신속 공급(신축 단지 대기 없이 생활권 유지 지원)
- 일반 특성: 다가구/원룸 등 비아파트 포함 비중이 상대적으로 큼
- 자격 포인트: 일반형/청년형/신혼형 등 트랙별 기준이 다르고 순위 체계가 존재
- 구현 포인트: 같은 "매입임대"라도 트랙(일반/청년/신혼/다자녀)별 룰셋을 분리 저장

출처:

- 마이홈 임대주택 유형 설명: https://m.myhome.go.kr/hws/portal/cont/selectContRentalHouseView.do
- 서울주거포털 기존주택 매입임대: https://housing.seoul.go.kr/site/main/content/sh01_030900

### 7-6. 전세임대주택

- 정책 목적: 입주자가 찾은 주택(전세/보증부월세)에 대해 공공이 지원하는 간접 공급
- 일반 특성: 단지 배정형이 아니라 "지원가능 주택 탐색 + 계약" 흐름이 포함됨
- 자격 포인트: 유형별(일반/청년/신혼/든든주택 등) 소득·자산 적용 여부가 상이할 수 있음
- 구현 포인트: 공고 단위 정보 외에 `지원가능 주택 조건`과 `지원금리/지원한도` 필드를 별도 관리

출처:

- 마이홈 임대주택 유형 설명: https://m.myhome.go.kr/hws/portal/cont/selectContRentalHouseView.do
- LH 전세임대 공고 예시(든든주택): https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=2015122300019143&ccrCnntSysDsCd=03&uppAisTpCd=13&aisTpCd=17&mi=1026

### 7-7. 재개발임대주택 (서울권에서 빈도 높음)

- 정책 목적: 재개발 과정의 세입자 주거안정 및 잔여 물량 일반공급
- 일반 특성: 서울권 사업에서 빈도 높고, 일반 임대와 다른 공급 배경을 가짐
- 자격 포인트: 철거세입자 우선공급과 일반공급 트랙을 구분해야 함
- 구현 포인트: `supply_track`(우선/일반), `redevelopment_flag` 필드 추가 권장

출처:

- 서울주거포털 재개발임대: https://housing.seoul.go.kr/site/main/content/sh01_030700

## 8) 사업별 정보로 반드시 수집해야 할 항목

### 8-1. 사업 메타 (정적)

- 사업명/사업유형
- 공급대상 계층
- 기본 자격 프레임(소득/자산/무주택/통장)
- 지역 범위

### 8-2. 공고 메타 (동적)

- 공고 ID, 공고명, 공고일
- 접수 시작/마감, 당첨 발표, 계약 일정
- 공급 지역/단지/주택형/면적/가격

### 8-3. 자격 룰 (판정용)

- 소득 기준(가구원수 연동)
- 자산 기준
- 무주택 여부/기간
- 입주자저축(청약통장) 요건
- 특별공급/우선공급 조건

### 8-4. 사용자 프로필 정보 (직접 수집 항목)

아래 항목은 공공 API에서 안정적으로 일괄 조회하기 어렵기 때문에, 사용자 입력 + 증빙 확인 방식으로 수집하는 것을 기본으로 한다.

- `marital_status` (결혼 여부)
- `birth_date` (생년월일, 나이 계산용)
- `current_residence_region` (현재 거주지: 시/도, 시/군/구)
- `move_in_date` (전입일)
- `residence_duration` (거주기간, 파생값: `기준일 - 전입일`)
- `household_member_count` (총 세대원 수)
- `has_newborn_or_fetus` (신생아/태아 포함 여부)
- `household_members` (세대원 목록: 관계, 생년월일, 미성년 여부)

근거 포인트:

- 공고는 `공고일 현재` 자격을 요구하는 경우가 많아 기준일 저장이 필수다.
- 공고별 가점/자격에서 `해당 시·도 연속 거주기간`, `혼인기간`, `자녀(태아 포함)` 조건이 반복적으로 사용된다.
- 실제 공고 첨부에는 세대구성 확인서/개인정보 동의서 등 개인 프로필 검증 문서가 포함되는 경우가 많다.

출처:

- 마이홈 신혼부부 특별공급(혼인기간, 자녀/태아, 거주기간 가점): https://m.myhome.go.kr/hws/portal/cont/selectNewHomeShareTypeView.do
- 마이홈 공공임대 자격(무주택세대구성원, 입주자저축, 소득/자산): https://m.myhome.go.kr/hws/portal/cont/selectPubRentalHouseView.do
- LH 공고 예시(공고일 현재/전입일/직계비속·태아): https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=2015122300018145&ccrCnntSysDsCd=03&uppAisTpCd=13&aisTpCd=26&mi=1026
- LH 신혼·신생아 전세임대 공고(세대구성 확인서 등 첨부서류): https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=2015122300017959&ccrCnntSysDsCd=03&uppAisTpCd=13&aisTpCd=17&mi=1026

저장 위치 권장:

- 도메인 정의: `docs/domain/` 문서에 유지
- 실행 데이터: 애플리케이션 DB(프로필/세대원/증빙메타 분리 저장)
- 주의: `.env`에는 개인 자격정보를 저장하지 않는다(키/설정만 저장)

## 9) 구현 전에 추가로 알아야 할 것

1. 공고문 원문(PDF/HWP/HTML)에서 자격 필드 자동 추출 가능 범위
2. 사전청약 -> 본청약 연결 규칙(동일 단지/유형 매핑 키)
3. 공고 정정/재공고 시 동일 공고 식별 기준
4. 무주택기간/청약통장 판정에 필요한 개인 입력값 최소셋
5. 매입임대/전세임대의 세부 트랙(일반/청년/신혼/다자녀/든든주택 등) 분기 규칙
6. 지역 제한(서울 거주요건 등)과 공급권역 우선순위 규칙

## 10) 수집/판정 체크리스트

- 공고일을 기준일로 저장하고 있는가
- 사전청약/본청약을 별도 공고 이벤트로 관리하는가
- API 필드와 공고문 필드를 분리 저장하는가
- 필수 자격정보 누락 시 `판정불가` 상태를 반환하는가
- 근거 문장(원문 링크/필드)을 함께 저장하는가
- 매입임대/전세임대의 세부 트랙을 같은 타입으로 뭉개지 않았는가
- 보증금 중심 상품(장기전세/전세임대)을 월세형 모델로 잘못 계산하지 않는가

## 11) 주의

- 이 문서는 자동화 설계를 위한 도메인 가이드다.
- 법적 최종 판단 기준은 각 공고문 원문과 최신 제도 기준이 우선한다.
- 소득/자산 기준 수치는 연도별로 변동될 수 있으므로, 기준표는 별도 버전 관리가 필요하다.
