# didimdol 폴더 구조

이 폴더는 내집마련 디딤돌대출을 서비스에서 사용하기 위한 자료 구조입니다.

## source
PDF 원본을 보관하는 위치입니다.
원본 PDF는 수정하지 않고 보관합니다.

## structured
계산과 자격 판단에 사용하는 JSON 데이터입니다.
서비스의 룰엔진과 계산엔진은 이 폴더의 JSON을 우선 사용합니다.

## rag
사용자에게 설명하거나 근거를 제시할 때 사용하는 Markdown 문서입니다.
RAG 적재 대상입니다.

## 사용 원칙
- 자격 판단과 비용 계산: structured JSON
- 사용자 설명과 근거 제시: rag Markdown
- 원본 근거 보관: source PDF
