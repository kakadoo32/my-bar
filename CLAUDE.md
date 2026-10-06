# My Bar — 칵테일 & 하이볼 레시피 관리 (PWA)

개인용(사용자 1명) 칵테일/하이볼 레시피 관리 앱. 아이폰 홈 화면에 추가해서 앱처럼 사용한다.

## 핵심 원칙
- **통신 기능 없음.** 서버, API 호출, 외부 CDN, 분석 도구, 폰트 로딩 모두 금지. 모든 데이터는 기기 안(IndexedDB)에만 저장한다.
- **빌드 도구 없음.** 순수 HTML/CSS/JavaScript(바닐라). npm 의존성을 추가하지 않는다. 파일을 그대로 GitHub Pages에 올리면 동작해야 한다.
- **아이폰(Safari, 홈 화면 PWA) 우선.** 모바일 레이아웃이 기본이고 PC 브라우저에서도 사용할 수 있어야 한다.
- UI 문구는 모두 한국어.

## 배포
- GitHub public 저장소 + GitHub Pages(HTTPS). URL이 `https://<id>.github.io/<repo>/` 같은 하위 경로이므로 **모든 경로는 상대 경로**(`./app.js`)로 쓴다.
- 공개 저장소이므로 **사용자 데이터(백업 JSON)는 절대 커밋하지 않는다.** `.gitignore`에 백업 파일 패턴이 들어 있다.

## 파일 구성
| 파일 | 역할 |
|---|---|
| `index.html` | 화면 마크업(탭, 목록, 다이얼로그) |
| `styles.css` | 스타일(라이트/다크, safe-area 대응) |
| `app.js` | 데이터 저장(IndexedDB), 렌더링, 상태 판정 로직 |
| `sw.js` | 서비스 워커(오프라인 캐시) |
| `manifest.webmanifest` | PWA 매니페스트 |
| `icons/` | 앱 아이콘(apple-touch-icon 포함) |

## 데이터 모델 (IndexedDB `my-bar`)
- `spirits` 스토어 — 재료(술, 믹서 등)
  `{ id, name, category, owned: boolean, memo, photo: dataURL|null, createdAt, updatedAt }`
- `recipes` 스토어 — 레시피
  `{ id, name, type: 'cocktail'|'highball', glass, steps, photo, ingredients: [{ spiritId, amount, optional, alternatives: [spiritId] }], createdAt, updatedAt }`
- 레시피의 재료와 대체 재료는 반드시 `spirits`에 등록된 항목의 id를 참조한다.
- 다른 레시피에서 쓰는 재료는 삭제할 수 없다(참조 무결성).
- 사진은 업로드 시 긴 변 800px JPEG로 축소해서 dataURL로 저장한다.

## 레시피 가능 여부 판정
각 재료 행 판정:
1. 주재료를 보유 → `ok`
2. 주재료는 없지만 보유한 대체 재료가 있음 → `sub`
3. 둘 다 없음 → `missing`

레시피 전체 판정(`optional` 재료는 판정에서 제외):
- 모든 행이 `ok` → **완성 가능**
- `missing` 없이 `sub`가 하나 이상 → **대체 시 가능**(어떤 재료를 무엇으로 대체하는지 표시)
- `missing`이 하나라도 있음 → **불가**(부족한 재료 표시)

## 백업
- 내보내기: 전체 데이터를 JSON 파일로 저장. 아이폰에서는 Web Share API로 공유 시트를 띄워 "파일에 저장"(iCloud Drive)을 쓰게 하고, 지원하지 않으면 다운로드로 대체한다.
- 가져오기: JSON 파일을 선택해서 기존 데이터를 **전체 교체**한다(확인 후).
- 백업 형식: `{ app: 'my-bar', version: 1, exportedAt, spirits, recipes }`

## 개발 시 주의
- 코드를 바꾸면 `sw.js`의 `CACHE_VERSION`을 올린다. 그래야 설치된 앱이 새 버전을 받는다.
- iOS 입력창 확대를 막기 위해 입력 요소의 글자 크기는 16px 이상으로 유지한다.
- 로컬 확인은 정적 서버로 한다(예: `python -m http.server 8000` 후 `http://localhost:8000`). 서비스 워커는 `file://`에서는 동작하지 않는다.
