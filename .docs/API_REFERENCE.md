# API 레퍼런스 (API Reference)

본 문서는 **SignLingo** AI 백엔드 서버가 제공하는 HTTP REST API 및 WebSocket 엔드포인트 명세를 기술합니다. 모든 통신은 `http://localhost:8000` (WebSocket은 `ws://localhost:8000`)을 기준으로 작동합니다.

---

## 1. HTTP API 엔드포인트

### A. Root / Health Check
* **메서드 & 경로:** `GET /`
* **설명:** 백엔드 API 서비스 정상 작동 상태 점검.
* **응답 포맷:** `application/json`
* **응답 예시:**
  ```json
  {
    "message": "Welcome to Signlingo API"
  }
  ```

---

### B. Get Curriculum
* **메서드 & 경로:** `GET /api/curriculum`
* **설명:** 전체 수어 단어/레슨 기본 메타데이터 목록을 파일 스트리밍 형식으로 서빙.
* **응답 포맷:** `application/json`
* **응답 예시 (배열 구조):**
  ```json
  [
    {
      "id": "word_0",
      "type": "word",
      "chapter": "기본 단어",
      "targetSign": "가",
      "variants": []
    },
    {
      "id": "word_1",
      "type": "word",
      "chapter": "기본 단어",
      "targetSign": "가다",
      "variants": []
    }
  ]
  ```
* **동작 특징:** `FileResponse` 스트리밍을 통해 HTTP ETag 캐시 최적화 적용.

---

### C. Get Motion Sequence
* **메서드 & 경로:** `GET /api/motion/{word}`
* **설명:** 지정한 수어 단어(`word`)에 매핑된 3D 아바타 시연용 궤적 데이터(pseudo-MediaPipe 형태)를 동적 조회.
* **경로 파라미터:** `word` (String, URL-encoded 수어 단어명. 예: `가다`)
* **응답 포맷:** `application/json`
* **응답 구조:**
  * `id`: 모션 식별자 (`var_dataset_{word}`)
  * `sequenceData`: 각 프레임 객체들의 시계열 배열.
    * `hasData`: 데이터 유효 플래그 (`true`)
    * `videoWidth`, `videoHeight`: 영상 표준 해상도 (`640`, `480`)
    * `poseLandmarks`: 33개 관절의 정규화 좌표 목록 (`x`, `y`, `z`, `visibility`)
    * `poseWorldLandmarks`: 33개 관절의 3D 월드 좌표 목록
    * `leftHandLandmarks`: 21개 왼손 손가락 관절 좌표 목록
    * `rightHandLandmarks`: 21개 오른손 손가락 관절 좌표 목록
* **응답 예시:**
  ```json
  {
    "id": "var_dataset_가다",
    "sequenceData": [
      {
        "hasData": true,
        "videoWidth": 640,
        "videoHeight": 480,
        "poseLandmarks": [
          { "x": 0.5, "y": 0.5, "z": 0.0, "visibility": 1.0 },
          ... // 33 landmarks
        ],
        "leftHandLandmarks": [
          { "x": 0.25, "y": 0.3, "z": 0.0, "visibility": 1.0 },
          ... // 21 landmarks
        ],
        "rightHandLandmarks": [
          { "x": 0.75, "y": 0.3, "z": 0.0, "visibility": 1.0 },
          ... // 21 landmarks
        ]
      },
      ... // 60 frames
    ]
  }
  ```

---

### D. Single Sign Recognition (HTTP REST)
* **메서드 & 경로:** `POST /api/recognize`
* **설명:** 단발성 수어 동작 특징 시퀀스 판별 API.
* **요청 포맷:** `application/json`
* **요청 바디 (Pydantic: `RecognitionRequest`):**
  * `keypoints`: 6,000개의 float32 플랫 리스트 (60프레임 x 100차원 피처)
* **요청 예시:**
  ```json
  {
    "keypoints": [0.12, -0.45, 0.88, ... 6000 floats]
  }
  ```
* **응답 포맷:** `application/json`
* **응답 바디 (Pydantic: `RecognitionResponse`):**
  * `word`: 예측 성공률이 가장 높은 단어명
  * `confidence`: 예측 확신도 (0.0 ~ 1.0)
  * `top5`: 상위 5위권 예측 단어 및 확신도 세부 정보 배열
* **응답 예시:**
  ```json
  {
    "word": "감사",
    "confidence": 0.9452,
    "top5": [
      { "word": "감사", "confidence": 0.9452 },
      { "word": "고맙다", "confidence": 0.0321 },
      { "word": "안녕", "confidence": 0.0105 },
      { "word": "반갑다", "confidence": 0.0054 },
      { "word": "좋다", "confidence": 0.0021 }
    ]
  }
  ```

---

### E. AI Sentence Generation (LLM)
* **메서드 & 경로:** `POST /api/generate-sentence`
* **설명:** 인식된 수어 단어 흐름과 확신도 가중치를 종합하여 자연스러운 한글 문장 1개 생성. (Gemini 2.5 Flash 연동)
* **요청 포맷:** `application/json`
* **요청 바디 (Pydantic: `SentenceRequest`):**
  * `words`: `WordEntry` 객체들의 리스트
    * `word`: 인식된 개별 단어명 (String)
    * `confidence`: 해당 단어 인식의 확신도 (Float)
* **요청 예시:**
  ```json
  {
    "words": [
      { "word": "너", "confidence": 0.88 },
      { "word": "만나다", "confidence": 0.92 },
      { "word": "나", "confidence": 0.45 },
      { "word": "기쁘다", "confidence": 0.76 }
    ]
  }
  ```
* **응답 포맷:** `application/json`
* **응답 바디 (Pydantic: `SentenceResponse`):**
  * `sentence`: 완성된 한글 문장 (String)
* **응답 예시:**
  ```json
  {
    "sentence": "너를 만나서 나는 정말 기뻐."
  }
  ```

---

## 2. WebSocket 실시간 추론 프로토콜

### A. Real-time Sign Recognition WebSocket
* **경로:** `WS /ws/recognize`
* **설명:** 실시간 양방향 프레임 특징 분류용 고성능 웹소켓 연결.
* **프로토콜 워크플로우:**
  1. 클라이언트(브라우저)에서 백엔드 `ws://localhost:8000/ws/recognize`로 소켓 접속을 수립합니다.
  2. 클라이언트는 슬라이딩 윈도우 다운샘플링이 완료될 때마다 **6,000개의 float32** 단일 플랫 배열(24,000바이트 크기의 ArrayBuffer binary 데이터)을 바이너리 형식으로 송신합니다.
  3. 백엔드 서버는 수신 즉시 PyTorch 모델 추론을 수행하고, 결과를 JSON 문자열 형식으로 응답 송신합니다.
* **클라이언트 송신 규격:**
  * **Data Type:** `Binary (ArrayBuffer)`
  * **Size:** 24,000 Bytes (고정 크기)
  * **구조:** `60 frames * 100 features/frame * 4 bytes/float32`
* **서버 송신(응답) 규격:**
  * **Data Type:** `Text (JSON)`
  * **구조:**
    * `word`: 실시간 분류 결과 단어명 (String)
    * `confidence`: 분류 확률 스코어 (Float)
* **서버 응답 예시:**
  ```json
  {
    "word": "좋다",
    "confidence": 0.8245
  }
  ```
