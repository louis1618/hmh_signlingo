# 개발자 가이드 (Developer Guide)

본 문서는 **SignLingo** 프로젝트의 신규 참여 개발자를 위한 개발 환경 설정, 로컬 빌드 및 디버깅, 도메인 갭 자가 진단 및 데이터 파이프라인 운용 프로세스를 설명합니다.

---

## 1. 개발 환경 설치 및 구성

### A. 시스템 요구사항
* **OS:** Windows 10/11 (CUDA GPU 가속 환경 권장)
* **Python:** 3.10 이상 3.12 이하 버전
* **Node.js:** 18.x 이상 LTS 버전

### B. 백엔드 가상환경 및 종속성 구성
1. 백엔드 루트 `Signlingo_backend/backend`로 이동하여 가상환경 생성 및 활성화:
   ```bash
   cd Signlingo_backend/backend
   python -m venv venv
   .\venv\Scripts\activate
   ```
2. Core 패키지 설치:
   ```bash
   pip install -r requirements.txt
   ```
   * 설치되는 주요 패키지: `fastapi`, `uvicorn`, `torch`, `numpy`, `google-genai`, `python-dotenv`, `pydantic`
3. `.env` 환경변수 세팅:
   `Signlingo_backend/backend/.env` 파일 생성 후 아래 값 설정:
   ```env
   GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
   DEBUG_MODE=true
   ```

### C. 프론트엔드 종속성 구성
1. 프론트엔드 루트 `Signlingo_frontend`로 이동하여 패키지 설치:
   ```bash
   cd Signlingo_frontend
   npm install
   ```
2. Vite 개발 서버 실행:
   ```bash
   npm run dev
   ```
   * 서버가 성공적으로 열리면 브라우저에서 `http://localhost:5173`으로 접속할 수 있습니다.

---

## 2. 모션 궤적 전처리 및 모델 학습 파이프라인 구동

새로운 AI Hub 데이터가 축적되었거나 모델 가중치를 갱신해야 할 경우의 프로세스입니다.

### Step 1. 수어 단어(OpenPose) 전처리
AI Hub ZIP 데이터셋(01~16번 키포인트 ZIP 파트들)을 `Signlingo` 부모 폴더에 적재한 뒤 실행:
```bash
python preprocess_stream.py
```
* ZIP 파일들이 임시 병합된 후, `dataset_features.bin` 바이너리 특징 행렬과 `dataset_cache.pkl` 캐시 맵이 `backend` 폴더 내에 생성됩니다.

### Step 2. 수어 문장( 형태소 잘라내기 ) 전처리
추가 형태소 데이터를 슬라이싱하여 데이터 베이스를 보강하고자 할 경우 실행:
```bash
python preprocess_sentence.py
```
* 문장 형태소 태그의 타임스탬프 싱크를 분석하여 단어 프레임 블록만 슬라이싱해 바이너리 뒤에 동적으로 추가 결합합니다.

### Step 3. AI 모델 학습 구동
```bash
python train.py
```
* 가중치 감쇠(AdamW)와 사이클 스케줄러(OneCycleLR) 기반 학습이 30에폭 동안 수행됩니다.
* 검증 세트 정확도가 경신될 때마다 `sign_model_best.pth` 파일이 자동 업데이트됩니다.

---

## 3. 로컬 디버깅 및 도메인 갭(Domain Gap) 진단

웹캠 구동 시 실시간 분류 정확도가 과도하게 떨어지는 상황(도메인 갭 발생)을 추적하기 위한 가이드라인입니다.

### A. 백엔드 디버그 모드 활성화
`.env` 파일 내 `DEBUG_MODE=true`로 전환 후 백엔드를 구동합니다.
* 사용자가 실시간 웹캠 인식을 시도할 때마다 프론트엔드가 보낸 float32 프레임 시퀀스가 백엔드 서버 루트 폴더에 `frontend_dump.npy`로 실시간 기록됩니다.
* 콘솔창에 수신된 특징 프레임 분포 상태와 값의 영역대(min, max), 손가락 유효 상태 프레임 통계가 실시간으로 로깅됩니다.

### B. 심층 진단 진단기 실행 (`diagnose.py`)
```bash
python diagnose.py
```
* **동작 원리:** 훈련 데이터셋 내 특정 타겟 단어(`감사` 혹은 `좋다`)의 이진 특징값 분포(평균, 표준편차)와 웹캠 수신 덤프 파일(`frontend_dump.npy`)의 실시간 관절별 통계값을 격자로 일대일 비교 분석합니다.
* **진단 지표 분석법:**
  * **Mean & Std Mismatch:** Pose Joints나 Hands의 평균(Mean) 및 표준편차(Std) 값의 차이가 0.5 이상 크게 벌어지는 경우 프론트엔드 `mediapipeEngine.js` 내의 어깨폭 비율 척도(`torsoSize`) 정규화 코드가 백엔드의 `preprocess_stream.py` 공식과 틀어졌는지 검사해야 합니다.
  * **Prediction Comparison:** 동일 모델이 학습용 원본 모션 시퀀스를 예측한 결과(Top-5)와 실시간 웹캠 덤프 시퀀스를 예측한 결과를 동시에 출력하여, 모델 오작동이 특징값 차이에서 비롯되었는지 직관적으로 도출합니다.

### C. 모델 과적합 검증기 구동 (`evaluate.py`)
```bash
python evaluate.py
```
* 검증 데이터셋(20% 분량)에 대한 Top-1, Top-5, Top-10 정확도를 리포트하여, 학습 수어 모델의 과적합 수치(Generalization Gap)를 상시 점검합니다.
* 특정 클래스의 검증율 분포를 시각화하여 취약 모션을 진단합니다.
