# 백엔드 분석 (Backend Documentation)

본 문서는 **SignLingo** 백엔드(`Signlingo_backend`)의 디렉토리 구조, 동작 원리, API 엔드포인트 명세, 그리고 고성능 AI 추론을 위한 최적화 기법을 실제 코드 기준으로 분석하여 기술합니다.

---

## 1. 백엔드 디렉토리 구조

```
Signlingo_backend/
├── .data/                  # AI Hub 원본 대용량 파일 아카이브 임시 적재용 폴더
├── backend/                # 백엔드 실행 루트 폴더
│   ├── .env                # 환경변수 파일 (GEMINI_API_KEY, DEBUG_MODE 등 설정)
│   ├── curriculum.json     # 3,022개 수어 단어/레슨 기본 정보 캐시 메타데이터 (약 429KB)
│   ├── daily_vocab.json    # 일일 추천 단어 및 과제 매핑 정보
│   ├── dataset.py          # PyTorch SignLanguageDataset 정의 (np.memmap 활용)
│   ├── dataset_cache.pkl   # 대용량 바이너리 모션 레코드와 인코딩 레이블 매퍼 캐시 (11.24MB)
│   ├── dataset_features.bin # 5.08GB 규모의 전처리 완료된 학습/시동용 모션 궤적 이진 파일
│   ├── diagnose.py         # 훈련 데이터셋과 웹캠 입력 피처간 통계 수치(Mean, Std) 도메인 갭 분석기
│   ├── evaluate.py         # Stratified 80/20 Shuffle Split 기반 과적합 방지 모델 평가 툴
│   ├── main.py             # FastAPI API 라우터, WebSocket 핸들러, Pydantic 스키마 정의
│   ├── preprocess_data.py  # (구버전) 개별 JSON을 통합 .npy로 컴파일하는 오프라인 전처리 스크립트
│   ├── preprocess_sentence.py # AI Hub 문장 데이터 형태소를 단어 프레임 구간으로 파싱 및 누적 추출 툴
│   ├── preprocess_stream.py # AI Hub OpenPose 단어 ZIP 아카이브를 병합 파싱해 바이너리 훈련셋 추출 스크립트
│   ├── preprocess_vrm.py   # 이진 궤적 특징을 pseudo-MediaPipe JSON으로 변환하여 curriculum에 탑재하는 도구
│   ├── requirements.txt    # 백엔드 실행 종속성 라이브러리 목록
│   ├── sign_model.pth      # 가장 최근 에폭의 학습 체크포인트 가중치 파일 (26.9MB)
│   ├── sign_model_best.pth # 검증 세트 기준 최고 인식 성능 체크포인트 가중치 파일 (26.9MB)
│   ├── train.py            # AI 모델 훈련 루프 및 딥러닝 아키텍처 모델 정의
│   ├── verify_fix.py       # (디버깅용) curriculum.json 복구 및 상태 검증용 코드
│   ├── vocab.json          # 3,022개 단어의 레이블 인코딩 딕셔너리 캐시
│   └── word_mapping.json   # 수어 식별 키(예: NIA_SL_WORD0001)와 한국어 단어명(예: 가다) 대조표
└── extract_dataset.py      # 아카이브 데이터 추출 및 적합성 체크 스크립트
```

---

## 2. API 엔드포인트 세부 분석

백엔드는 FastAPI 프레임워크를 기반으로 하며, HTTP API 호출 및 저지연 실시간 양방향 WebSocket 엔드포인트를 노출합니다.

### A. HTTP API

* **`GET /`**
  * **설명:** 백엔드 API 서버의 정상 활성화 여부를 점검하는 핑용 테스트 엔드포인트입니다.
  * **반환:** `{"message": "Welcome to Signlingo API"}`

* **`GET /api/curriculum`**
  * **설명:** 3,022개의 수어 학습 챕터와 단어 메타데이터가 담긴 `curriculum.json` 파일을 스트리밍 응답합니다.
  * **최적화:** 파일 전송 시 FastAPI의 `FileResponse`를 활용하여 원격 브라우저의 HTTP ETag 헤더와 `Last-Modified` 헤더를 통해 브라우저가 변경 사항이 없을 경우 로컬 캐시를 재활용하도록 유도합니다.

* **`GET /api/motion/{word}`**
  * **설명:** 아바타 시연용 모션 데이터를 해당 단어(`word`)의 문자열 키값을 통해 가려내어 다운로드합니다.
  * **내부 설계:** `dataset_cache.pkl`에서 단어에 해당하는 시퀀스 인덱스 오프셋을 역추적한 뒤, 5.08GB의 `dataset_features.bin` 파일에 `np.memmap` 오프셋 바인딩으로 액세스하여 해당 모션 시퀀스를 획득합니다. 이후 [Frontend.md](FRONTEND.md)의 정규화 수식을 역산하여 어깨, 팔꿈치, 손가락 21개의 pseudo-MediaPipe JSON 좌표 배열로 재구성해 스트리밍합니다.

* **`POST /api/recognize`**
  * **설명:** HTTP REST 기반 단발성 수어 동작 분류 API입니다. Pydantic 스키마인 `RecognitionRequest`(`keypoints` 6000개 float32 리스트)를 수신합니다.
  * **동작:** 전용 GPU 텐서 입력 버퍼 복사 후 `SignLanguageModel` 포워드 연산을 거쳐, 탑-5 예측 리스트와 소프트맥스 신뢰도를 응답합니다.

* **`POST /api/generate-sentence`**
  * **설명:** 실시간 번역기에 축적된 단어들의 신뢰도 정보를 활용하여 자연스럽고 문법에 맞는 한글 문장을 생성합니다.
  * **LLM 파이프라인:** Pydantic 스키마 `SentenceRequest`를 통해 단어명과 확신도 리스트를 입력받습니다. 이후 `google-genai` SDK를 이용하여 `gemini-2.5-flash` 모델을 호출합니다.
  * **프롬프트 전략:** 확신도 50% 이상 단어는 무조건 포함하고 30% 이하 단어는 문맥에 부적합할 시 배제하도록 설계된 시스템 지시문을 Gemini에 제공하여 한국어 한 문장만을 도출합니다.

### B. WebSocket API

* **`WS /ws/recognize`**
  * **설명:** 저지연 연속 수어 인식을 담당하는 지속성 웹소켓 세션입니다.
  * **수신 규격:** 24,000 바이트 바이너리 데이터 (`60프레임 * 100피처 * 4바이트(Float32)`)
  * **송신 규격:** JSON `{"word": "예측단어", "confidence": 신뢰점수}`
  * **최적화:** 소켓 연결이 맺어지면, 커넥션마다 전용 CUDA/CPU 입력 메모리 `ws_buffer`를 사전 확보합니다. 데이터 수신 시 `torch.frombuffer`를 통해 가상 메모리 카피 수준의 극소 오버헤드로 텐서 버퍼에 바이너리를 바인딩해 즉시 추론을 실행하고 결과를 전송합니다.

---

## 3. 고성능 인퍼런스 최적화 기법

실시간 수어 추론은 프레임 레이트 저하 없이 웹소켓 통신 속도를 맞춰야 하므로 백엔드 단에서 강력한 하드웨어 가속 기법이 적용되어 있습니다.

### A. GPU pre-allocated tensor buffer (텐서 버퍼 사전 할당)
* **문제:** 일반적으로 딥러닝 API 서버들은 요청이 올 때마다 `torch.tensor(data).to(device)`를 호출하여 파이썬 리스트를 CPU 텐서로 만들고 GPU(CUDA) 물리 메모리로 데이터를 밀어 넣습니다. 이 작업은 매 초마다 수십 차례 이상 수행될 경우 PCI-Express 버스 대역폭 병목과 함께 GPU 메모리 단편화(Fragmentation)를 유발합니다.
* **해결:** `main.py`는 기동 단계에서 디바이스(`cuda` 혹은 `cpu`) 메모리에 `_input_buffer = torch.zeros(1, 60, 100)` 크기의 고정 텐서를 영구 할당합니다. 요청이 수신되면 해당 버퍼에 들어온 메모리 바이트만 즉시 복사(`_input_buffer.copy_(incoming)`)하여 GPU 내부의 재할당 작업을 0으로 억제했습니다.

### B. Zero-copy WebSocket array buffer binding (웹소켓 제로카피 바인딩)
WebSocket 추론용 엔드포인트 `/ws/recognize` 내부에서는 `numpy`나 파이썬 리스트 파싱을 거치지 않고, `torch.frombuffer(bytearray(data), dtype=torch.float32)`를 이용하여 들어온 이진 데이터(ArrayBuffer) 바이트 메모리 영역을 PyTorch 텐서에 1:1로 직접 뷰(View) 맵핑합니다. 이를 통해 파이썬 객체 생성 오버헤드와 시리얼라이즈 시간을 극한으로 압축했습니다.

### C. NumPy Memory Map (`np.memmap`) 아바타 재생 오프셋 맵핑
* **문제:** 3,000개가 넘는 한국어 표준 수어 아바타 모션 데이터(`dataset_features.bin`)는 파일 크기만 약 5.08GB에 달합니다. API 서버 기동 시 이 대량의 특징 맵을 RAM 메모리에 적재하면 서버 머신의 가용 메모리가 부족해집니다.
* **해결:** `np.memmap(bin_path, dtype=np.float32, mode='r', shape=(total_sequences, 60, 100))`을 채택하여 OS 레벨의 가상 메모리 파일 캐시 기능을 빌려왔습니다. 백엔드는 기동 시 0MB에 수렴하는 극소량의 RAM 만을 점유하며, 클라이언트가 특정 단어를 요청할 때 오프셋 오버헤드 없이 디스크의 정확한 모션 바이트만 블록 단위로 고속 접근(Random Access)하여 전송합니다.
