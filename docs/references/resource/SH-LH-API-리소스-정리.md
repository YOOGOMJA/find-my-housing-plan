# SH/LH API 리소스 정리

작성일: 2026-03-07

## 1) 요약

- LH: 공고/상세/단지 정보를 조회할 수 있는 OpenAPI가 확인됨
- SH: 공고 조회 전용 OpenAPI는 명확히 확인되지 않았고, 파일데이터 중심으로 확인됨
- 권장 전략: LH는 OpenAPI 우선 연동, SH는 파일데이터 + 사이트 크롤링 보완

## 2) 실행/적용 방법 (바로 적용)

1. `n8n HTTP Request` 노드에서 LH 공고 조회 API를 1차 호출한다.
2. 공고 목록에서 식별자(공고 ID 등)를 추출해 상세 API를 2차 호출한다.
3. `filter.js` 입력 스키마를 공통 필드로 정규화(공고명/지역/접수기간/주택유형)한다.
4. SH는 파일데이터를 주기적으로 확인하고, 부족 필드는 i-sh.co.kr 크롤링으로 보완한다.
5. 배포 전 링크/응답 스키마/인증 상태를 다시 점검한다.

## 3) LH 관련 API (확인됨)

### 3-1. 분양임대공고 조회

- 데이터셋: 한국토지주택공사_임대주택 분양임대공고 조회 서비스
- 링크: https://www.data.go.kr/en/data/15058530/openapi.do
- 엔드포인트: `http://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1`
- 검증일: 2026-03-07
- 인증: 서비스키 필요
- 활용신청: 확인필요 (일반적으로 data.go.kr 활용신청 후 사용)

### 3-2. 분양임대공고 상세정보 조회

- 데이터셋: 한국토지주택공사_임대주택 분양임대공고별 상세정보 조회 서비스
- 링크: https://www.data.go.kr/data/15057999/openapi.do
- 엔드포인트: `http://apis.data.go.kr/B552555/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1`
- 검증일: 2026-03-07
- 인증: 서비스키 필요
- 활용신청: 확인필요 (일반적으로 data.go.kr 활용신청 후 사용)

### 3-3. 임대단지 조회

- 데이터셋: 한국토지주택공사_공공임대주택단지 조회 서비스
- 링크: https://www.data.go.kr/en/data/15058476/openapi.do
- 서비스 URL: `https://data.myhome.go.kr:443/rentalHouseList`
- 검증일: 2026-03-07
- 인증: 서비스키 필요
- 활용신청: 확인필요 (일반적으로 data.go.kr 활용신청 후 사용)

### 3-4. 사전청약 계열 API

- 사전청약 공고문 조회 서비스: https://www.data.go.kr/data/15124599/openapi.do
- 사전청약 공급정보 조회 서비스: https://www.data.go.kr/data/15124601/openapi.do
- 사전청약 상세정보 조회 서비스: https://www.data.go.kr/data/15124603/openapi.do
- 검증일: 2026-03-07
- 인증: 서비스키 필요
- 활용신청: 확인필요 (일반적으로 data.go.kr 활용신청 후 사용)

## 4) SH 관련 데이터 소스 (확인됨)

### 4-1. 공급계획 관련 파일데이터

- 데이터셋: 서울주택도시공사_공공주택 공급계획
- 링크: https://www.data.go.kr/data/15122124/fileData.do
- 비고: 파일데이터 기반(자동 API 변환 사용 가능 여부는 데이터포털 옵션 확인 필요)
- 검증일: 2026-03-07
- 인증: 데이터셋별 상이
- 활용신청: 데이터셋별 상이

### 4-2. 주택분양 관련 파일데이터

- 데이터셋: 서울주택도시공사_주택분양 정보
- 링크: https://www.data.go.kr/data/15008820/fileData.do
- 비고: 파일데이터 기반(공고 실시간 조회 API와는 성격이 다를 수 있음)
- 검증일: 2026-03-07
- 인증: 데이터셋별 상이
- 활용신청: 데이터셋별 상이

## 5) 세부 스펙/예외 메모

- n8n 수집 우선순위
  1. LH OpenAPI 호출
  2. SH 파일데이터 확인
  3. 필요 시 SH 사이트(i-sh.co.kr) 크롤링으로 보완
- 필드명은 API별로 다를 수 있으므로, 실제 응답 기준으로 `filter.js` 매핑을 분리 관리
- 링크/스펙은 변경될 수 있으므로 배포 전 재검증 권장

## 6) 참고 링크

- 공공데이터포털 메인: https://www.data.go.kr/
- SH 공식 사이트: https://www.i-sh.co.kr/
- LH 공식 사이트: https://www.lh.or.kr/
