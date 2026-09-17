# NEXT

**여기까지 됨 (2026-09-17, v0.17.4)** — 움직이는 효과 넷이 OS 설정뿐 아니라 VS Code의 `workbench.reduceMotion`(`.monaco-reduce-motion` 클래스)에도 멈춤. 프리셋이 설정 26개를 쓰는 동안 state.json을 한 번만 씀. README 상태 표에 Insiders·포터블 행, 한국어 절 "셋 다" → "넷 다". `caretArcColor` 설정 화면 실기 확인 끝. 원자적 쓰기는 Windows `EPERM` 때문에 뺐음(CLAUDE.md `알아둘 것`).
**다음 할 것** — `workbench.reduceMotion: on`에서 효과가 멈추는지 실기 확인(0.17.4는 smoke만 보고 냈음). `brightness()` 숨쉬기 네 자리 측정, 이름 바꾸기 상자 숨쉬기의 컴포지터 이전 가능성.
**막힌 것** — macOS/Linux 실기 없음(macOS는 서명된 `.app`을 고친 뒤 Gatekeeper 반응이 미지수). 디버그 멈춘 줄·중단점 글로우는 화면으로 본 적 없음. 마켓 재시도 경로가 실제로 도는지 아직 모름.
