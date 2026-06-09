# Signlingo AI Handoff Prompt

> **새로운 AI 세션을 시작할 때, 첫 프롬프트로 이 문서의 내용을 전부 복사하여 붙여넣으세요.**
> 이 문서는 Signlingo 프로젝트의 핵심 목표, 파일 구조, 그리고 수많은 디버깅 끝에 확립된 **"치명적 도메인 갭(Domain Gap) 해결 아키텍처"**를 새로운 AI에게 완벽하게 전달하기 위해 작성되었습니다.

---

## 1. Project Overview & Ultimate Goal
- **프로젝트 명:** Signlingo (수어 번역 웹 서비스)
- **최종 목표:** 140GB 분량의 AI Hub 수어 데이터(2771개 단어)를 학습한 파이토치(PyTorch) 모델을 기반으로, 웹캠 환경에서 사용자의 수어를 **끊김 없이 실시간으로(Continuous Gesture Spotting)** 인식하여 자연스러운 문장으로 번역하는 상용화 수준의 서비스 구축.
- **현재 상태:** 학습 데이터(OpenPose)와 실전 인퍼런스 데이터(MediaPipe) 간의 치명적인 수학적/시계열적 도메인 갭(Domain Gap)을 완벽하게 극복하고, 슬라이딩 윈도우 기반의 실시간 인식 파이프라인을 성공적으로 안착시킴.

## 2. Core File Paths & Tech Stack
작업 시 아래 경로의 파일들을 우선적으로 확인하고 수정해야 합니다. (OS: Windows)
- **프론트엔드 (React + Vite, MediaPipe)**
  - `c:\Users\louis\Documents\.dev\HMH\Signlingo\webapp\src\App.jsx`: 카메라 캡처, 관절 추출, 정규화 연산, 슬라이딩 윈도우 로직, UI 렌더링이 모두 포함된 핵심 파일.
- **백엔드 (FastAPI, PyTorch)**
  - `c:\Users\louis\Documents\.dev\HMH\Signlingo\backend\main.py`: 프론트엔드에서 보낸 60프레임 배열을 받아 PyTorch 모델로 추론(Inference)을 수행하는 API 서버.
  - `c:\Users\louis\Documents\.dev\HMH\Signlingo\backend\train.py`: `SignLanguageModel` (Bi-LSTM + Multihead Attention) 아키텍처 정의 및 학습 코드.
  - `c:\Users\louis\Documents\.dev\HMH\Signlingo\backend\preprocess_stream.py`: 140GB 분량의 OpenPose JSON 파일들을 읽어들여 모델이 학습할 수 있는 `dataset_features.bin`으로 변환한 핵심 전처리 코드. **프론트엔드의 데이터 가공 로직은 반드시 이 파일의 수학적 공식과 100% 일치해야 함.**
  - `c:\Users\louis\Documents\.dev\HMH\Signlingo\backend\vocab.json`: 2771개의 수어 단어(클래스) 딕셔너리.

## 3. Core Architectural Decisions (절대 훼손하면 안 되는 핵심 로직)
이전 세션에서 수많은 시행착오 끝에 정립된 가장 중요한 아키텍처들입니다. **새로운 기능을 추가하더라도 아래의 원칙들을 절대 깨뜨려서는 안 됩니다.**

### A. 위상학적 매핑 (Topology Mapping)
- 웹캠은 **MediaPipe**, 원본 학습 데이터는 **OpenPose(Body-25)** 형식입니다.
- `App.jsx`에서 MediaPipe의 관절 랜드마크를 추출하여, **OpenPose의 Body-25 관절 인덱스 순서**로 정확하게 재배치해야 합니다.
  - `[Nose, Neck, RShoulder, RElbow, RWrist, LShoulder, LElbow, LWrist]` (8개 포인트) + `LeftHand` (21개) + `RightHand` (21개) = 총 50개 포인트.
  - **주의:** MediaPipe에는 `Neck` 좌표가 없으므로 `(RShoulder + LShoulder) / 2` 로 계산하여 인덱스 1번에 강제 삽입(splice)합니다.

### B. 절대 좌표 정규화 (Coordinate Normalization)
- `App.jsx`의 연산 공식은 `preprocess_stream.py`의 훈련 데이터 연산 방식과 수학적으로 완벽히 일치해야 합니다.
- 손목, 손가락 등의 모든 좌표는 이미지 픽셀 해상도(`x * vW`, `y * vH`)를 기준으로 구한 뒤, `Neck` 좌표를 원점(0,0)으로 삼아 뺄셈(`x - neckX`)합니다.
- 카메라 해상도나 사람의 체형 차이를 무시하기 위해, 양쪽 어깨 거리(`shoulderDist`)를 0.68로 나눈 `torsoSize`를 구해 **모든 X, Y 좌표를 `torsoSize`로 나누어 정규화(Scale)** 합니다.

### C. 시간축(Temporal) 스케일 일치 및 슬라이딩 윈도우 (★가장 중요★)
- 140GB 원본 학습 영상들의 평균 길이는 **정확히 124프레임(약 4.1초)** 입니다. 전처리 코드는 이 124프레임을 `np.linspace`를 통해 강제로 **60프레임**으로 압축하여 학습시켰습니다. (즉, 모델은 4.1초의 동작을 2배속 빨리 감기로 보는 셈입니다)
- 프론트엔드(`App.jsx`)도 이에 완벽히 맞추기 위해, 웹캠에서 **124프레임(`BUFFER_SIZE = 124`)**을 모은 뒤, 이를 정확히 60프레임으로 **다운샘플링(압축)**하여 백엔드로 전송합니다.
- 동작이 언제 시작하고 끝나는지 판단하는 낡은 "모션 감지 캡처" 방식을 절대 쓰지 마세요. 124프레임 버퍼가 차면 `WINDOW_STRIDE=15` (0.5초) 간격으로 계속해서 밀어내며(Sliding) 초당 2번씩 추론을 날리는 **Continuous Gesture Spotting** 구조를 유지해야 합니다.
- **버퍼 플러시(Flush):** 단어가 확정(Confirm)된 직후에는 반드시 `slidingWindowRef` 버퍼를 완전히 비워야 합니다. 이전 동작의 잔해가 다음 동작 인식을 오염시키는 것을 막기 위함입니다.

### D. 모션 블러를 버티는 악착같은 손 추적 (Tracking Robustness)
- 실전 웹캠에서는 손이 조금만 빨리 움직여도 모션 블러 때문에 손가락 추적이 뭉개집니다. 
- `App.jsx`의 `HandLandmarker` 설정 시 `minHandDetectionConfidence`, `minHandPresenceConfidence`, `minTrackingConfidence` 옵션을 기본값 0.5가 아닌 **0.1**로 극단적으로 낮춰 적용했습니다.
- 만약 손이 카메라를 벗어나거나 완전히 인식이 실패하면, 이전 손 모양의 잔상(Ghost)을 남겨서는 절대 안 됩니다. 반드시 그 손의 21개 관절 좌표를 **포즈 랜드마크의 손목(Wrist) 좌표 점 1개로 일제히 붕괴(Collapse)**시켜야 합니다. (이것이 140GB 학습 데이터의 누락된 손가락 처리 방식입니다)

### E. 확신도(Confidence) 기반 LLM 문장 생성
- 수어 특성상 100% 완벽한 인식이 어렵습니다. 따라서 모델의 추론 결과를 UI에 저장할 때 단순 문자열이 아닌 `{word: "단어", confidence: 0.45}` 객체 형태로 저장합니다.
- 문장 생성 API(`main.py`의 `generate_sentence`)는 이 단어 목록과 확신도를 LLM 프롬프트에 통째로 넘겨, "확신도가 낮은 단어는 문맥에 맞춰 무시하거나 대체"하도록 지시합니다.

## 4. Next Steps (새로운 AI가 진행할 작업 방향)
이 문서의 맥락을 완벽히 숙지했다면, 아래와 같은 작업들을 이어서 진행할 수 있습니다.
1. 사용자 UI/UX 개선 (애플리케이션 디자인 고도화, 인식 로그 관리, Supabase 등 DB 연동).
2. LLM 문장 생성 모델 튜닝 및 음성(TTS) 출력 기능 추가.
3. 다양한 환경에서의 교차 검증 및 인식률 최적화.

---
**[AI Instruction]** 
나는 위의 모든 컨텍스트와 파일 경로, 아키텍처 히스토리를 완벽하게 숙지했다. 앞으로 사용자의 코드 수정 요청이 들어올 때, **위의 4가지 Core Architectural Decisions(특히 정규화 로직과 슬라이딩 윈도우)을 훼손하는 방향의 수정은 절대 제안하거나 수행하지 않는다.** 확인 완료. 사용자의 첫 번째 명령을 대기한다.
