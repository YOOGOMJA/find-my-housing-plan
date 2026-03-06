# SH/LH 주택 공고 알림 시스템 설계

Date: 2026-03-06

## 목표

SH(서울주택도시공사) / LH(한국토지주택공사) 주택 공고를 매일 자동으로 수집하고,
사용자의 조건에 맞는 공고가 있을 때 Slack으로 알림을 발송한다.

## 요구사항

- 매일 1회 아침 자동 실행
- 사용자 조건에 맞는 공고만 필터링
- 조건에 맞는 공고 있을 때만 Slack 알림 발송
- 조건 변경은 2개월~1년 주기 (자산/소득은 반년~1년, 지역/유형은 2개월 주기)
- 개인 + 가족/지인 소규모 사용
- 개인정보(자산, 소득) 외부 노출 금지

## 아키텍처

```
[n8n 스케줄러] 매일 아침 1회
  → [HTTP Request] SH/LH 공공API (실패 시 웹 크롤링 fallback)
  → [Code 노드] 조건 필터링
  → [IF 노드] 새 공고 있음?
      YES → [Slack 웹훅] 알림 발송
      NO  → 종료
```

## 기술 스택

| 항목 | 선택 |
|------|------|
| 워크플로우 엔진 | n8n |
| 로컬 실행 | Docker Compose |
| 배포 (추후) | Railway or Oracle Cloud Free Tier |
| 알림 | Slack Incoming Webhook |

## 데이터 소스

1. **1순위:** 공공데이터포털 LH/SH 공식 OpenAPI
2. **2순위:** SH(`i-sh.co.kr`), LH(`lh.or.kr`) 웹 크롤링 fallback

## 조건 관리

### 민감 정보 → n8n 환경변수 (서버 내부에만 저장)
- 자산 기준
- 소득 기준
- 세대원 수
- 청약 자격 관련 정보

### 일반 조건 → Code 노드 JSON (n8n UI에서 편집)
```json
{
  "regions": ["서울", "경기"],
  "districts": ["강동구", "송파구"],
  "types": ["전세임대", "공공임대", "행복주택"],
  "sources": ["LH", "SH"]
}
```

## Slack 알림 형식

```
[LH] 신혼부부 전세임대 II
분류: LH · 전세임대
위치: 서울특별시 강동구 천호동
면적: 전용 46m² / 공용 58m²
금액: 보증금 1,200만원 · 월세 12만원
신청기간: 2026.03.10 ~ 03.20
부가조건: 주차 1대 · 엘리베이터 · 근린생활시설  (데이터 있을 경우만 표시)
https://lh.or.kr/...
```

- 부가조건(주차, 생활시설 등)은 API/크롤링에서 데이터 확보 가능할 경우만 표시

## 멀티유저 지원

- 가족/지인별로 n8n 워크플로우 복사
- 각자 환경변수 세트(조건)만 다르게 설정
- Slack 웹훅 URL만 교체

## 실행 환경

### 로컬 개발 (Docker Compose)
```yaml
services:
  n8n:
    image: n8nio/n8n
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
    volumes:
      - n8n_data:/home/node/.n8n
```

### 배포 마이그레이션
1. 로컬 n8n에서 워크플로우 JSON export
2. 서버(Railway/Oracle) n8n에 import
3. 환경변수 재설정
4. Slack 웹훅 URL 확인

## 결정 사항

- 웹 대시보드 별도 구축 안 함 (오버엔지니어링)
- Google Drive/Sheets 연동 안 함 (불필요)
- 카카오 알림톡 사용 안 함 (설정 복잡)
- Discord 대신 Slack 사용 (사용자가 이미 Slack 사용 중)
