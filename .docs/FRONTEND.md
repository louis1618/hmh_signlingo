# 프론트엔드 분석 (Frontend Documentation)

본 문서는 **SignLingo** 프론트엔드(`Signlingo_frontend`)의 디렉토리 구조, 동작 원리, 핵심 모듈 및 컴포넌트, 그리고 온디바이스 카메라 프로세싱과 3D 아바타 제어 기술을 실제 코드 기준으로 상세히 서술합니다.

---

## 1. 프론트엔드 디렉토리 구조

```
Signlingo_frontend/
├── dist/                   # Vite 빌드 아웃풋 디렉토리
├── public/                 # 정적 리소스 (models/avatar.vrm 등 아바타 및 환경 리소스 탑재)
├── src/
│   ├── assets/             # 정적 미디어 에셋
│   ├── components/         # 공유 UI 및 공통 컴포넌트
│   │   ├── AvatarCanvas.jsx # R3F 기반 3D VRM 렌더링 캔버스
│   │   └── ui.jsx          # 버튼, 사이드바 아이템 등 공통 UI 컴포넌트 모음
│   ├── data/               # 상수 및 로컬 사전 데이터셋
│   ├── hooks/              # 커스텀 훅
│   │   └── useVRM.js       # three-vrm을 이용한 아바타 모델 로더 훅
│   ├── pages/              # 서비스 개별 화면
│   │   ├── Admin/          # CMS 관리자 화면
│   │   │   └── CMSAdmin.jsx # 챕터/레슨 등록 및 커스텀 동작 녹화 도구
│   │   ├── Home/           # 메인 대시보드
│   │   │   └── LearningMap.jsx # 챕터/단어 로드맵 인터페이스
│   │   ├── LessonRoom/     # 3D 튜터 학습방
│   │   │   └── LessonRoom.jsx # 실시간 연습, 시범 재생 연동 핵심 화면
│   │   └── Translator/     # 실시간 수어 번역기
│   │       └── Translator.jsx # 실시간 연속 수어 번역 구동 페이지
│   ├── services/           # 브라우저 백그라운드 엔진 및 통신 모듈
│   │   ├── dbService.js    # IndexedDB 스키마 구성, 초기 시딩 제어
│   │   ├── geminiService.js # (미사용/개발중) Gemini 비전 이미지 평가 연동 모듈
│   │   ├── mediapipeEngine.js # 골격 매핑, 중심 좌표 이동 및 Torso 정규화 핵심 수학 로직
│   │   └── vrmSolver.js    # Kalidokit을 연동한 VRM 아바타 조인트 Rigging 회전 제어
│   ├── App.css             # 메인 전역 레이아웃 스타일
│   ├── App.jsx             # 앱 라우터, 상태 변동 제어
│   ├── index.css           # 전역 폰트 및 베이스 스타일
│   └── main.jsx            # React 엔트리 렌더
├── package.json            # npm 종속성 정의
└── vite.config.js          # Vite 번들러 세팅
```

---

## 2. 온디바이스 카메라 연동 및 추적 파이프라인

프론트엔드는 사용자의 웹캠 브라우저 미디어 스트림을 가져와 실시간 모션을 가공하는 핵심 시간축 루프를 구동합니다.

### A. MediaPipe 모델 로딩 및 초기화
`LessonRoom.jsx` 및 `Translator.jsx` 시동 시, WebAssembly 로더를 통해 MediaPipe CDN에서 필요한 가상 비전 태스크 모델을 다운로드합니다:
```javascript
const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
);
// PoseLandmarker(상체 뼈대 추적) 로드
poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1
});
// HandLandmarker(정밀 양손가락 관절 추적) 로드
handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.1, // 모션 블러 상황을 타개하기 위해 신뢰도 임계값 대폭 완화
    minHandPresenceConfidence: 0.1,
    minTrackingConfidence: 0.1
});
```

### B. 골격 랜드마크 추출 및 정규화 (`mediapipeEngine.js`)
1. **위상 정렬:** MediaPipe Pose 랜드마크 33개 중 `[Nose(0), RShoulder(12), RElbow(14), RWrist(16), LShoulder(11), LElbow(13), LWrist(15)]` 7개를 선별하고, `Neck` 좌표를 `(RShoulder + LShoulder) / 2`로 직접 보간하여 2번째(index 1) 원소로 강제 삽입하여 8개의 OpenPose 호환 포즈 포인트를 구축합니다.
2. **Wrist Offset 보정:** MediaPipe Hand의 손가락 좌표들은 자신의 로컬 손목 원점을 기준 삼으므로, 전신 포즈의 손목 좌표와 싱크를 맞추기 위해 손목 편차(`offsetX = poseWristX - handWristX`)를 계산하여 21개 손가락 관절 좌표에 일일이 더해 좌표 일치를 완성합니다.
3. **Neck 중심점 이동 및 Torso 스케일링:** 신체 크기 차이를 없애기 위해 모든 전신/손 50개 포인트의 절대 X, Y 좌표에서 `Neck` 좌표를 감산하여 Neck을 (0,0)으로 삼습니다. 이후 어깨 사이 거리 `shoulderDist`를 기준 척도(0.68로 나눈 값)인 `torsoSize`로 활용하여 모든 상대 좌표를 스케일링합니다:
   $$\text{Normalized } X = \frac{X - \text{Neck}_x}{\text{torsoSize}}, \quad \text{Normalized } Y = \frac{Y - \text{Neck}_y}{\text{torsoSize}}$$
4. **손의 붕괴(Hand Collapse):** 카메라 영역을 이탈하여 `leftHandLandmarks`가 검출되지 않는 경우, 해당 21개 관절의 X, Y 값을 포즈 랜드마크의 왼손목(`joints[7]`) 좌표로 일괄 통일(Collapse)시켜 결손 특징을 처리합니다.

---

## 3. 실시간 추론 스트리밍 및 슬라이딩 윈도우

프론트엔드는 동작의 시작/끝을 학습자가 명시적으로 트리거하지 않도록 슬라이딩 윈도우 버퍼링 기법을 구현했습니다.
* **버퍼 수집:** 실시간 랜드마크 특징(100차원)이 추출되면 `slidingWindowRef.current`에 차례로 밀어 넣어 최대 124프레임(`BUFFER_SIZE = 124`, 약 4.1초 분량)을 로컬에 모읍니다.
* **보간 및 압축:** 버퍼가 124프레임에 도달하면 `np.linspace`와 동일한 수식의 픽셀 보간법을 활용하여 시간축을 강제로 **60프레임**으로 축소하여 `[1, 60, 100]` 차원의 플랫 배열(6000 float32 원소)을 만듭니다.
* **WebSocket 스트리밍:** 보간된 배열을 24,000바이트의 이진 버퍼(Float32Array)로 포맷하여 백엔드 WebSocket (`/ws/recognize`)에 쏩니다.
* **가변 스트라이드 (Adaptive Stride):** 움직임 에너지를 감지하여 손의 변화가 급격할 경우 프레임 업데이트 간격을 좁히고(`stride = 8`), 정적인 대기 상태일 때는 업데이트 간격을 늘려(`stride = 25`) 서버 네트워크 부하를 줄입니다.
* **연속 번역 문장 조립:** 연속 번역 페이지(`Translator.jsx`)에서는 서버로부터 수신된 단어의 confidence가 0.30 이상이고, 동일한 단어가 3회 연속 최우선으로 검출되면 번역 문맥에 해당 단어를 한 칸 띄우고 추가합니다. 이후 1.2초 동안 강제로 인식을 지연(Cooldown)시켜 중복 입력을 사전에 제거합니다.

---

## 4. 3D 아바타 재생 및 릭 제어 (Kinematics Solver)

* **아바타 모델 로딩 (`useVRM.js`):** `@pixiv/three-vrm` 라이브러리를 standard GLTFLoader에 연동하여 `.vrm` 캐릭터를 로딩합니다. 로딩 직후 아바타 씬(Scene)의 로컬 Y축을 180도 회전(`Math.PI`)시켜 3D 카메라이 정면을 바라보게 유도합니다.
* **실시간 본(Bone) 업데이트 (`vrmSolver.js`):** `Kalidokit` 라이브러리를 호출해 3D/2D 랜드마크 데이터를 바인딩하여 뼈대 회전값을 역산합니다.
  ```javascript
  const riggedPose = Kalidokit.Pose.solve(pose3D, pose2D, { runtime: "mediapipe" });
  ```
  추출된 뼈대 회전 값은 Three.js의 `THREE.Euler`로 변환된 뒤, React의 리렌더링 오버헤드를 우회하기 위해 `vrm.humanoid.getNormalizedBoneNode('boneName')`에 직접 변이 주입(`Part.quaternion.slerp(quaternion, 0.5)`)을 가함으로써 지연 없는 실시간 관절 연동을 수행합니다.

---

## 5. IndexedDB 로컬 영구 캐시 (`dbService.js`)

* **목적:** 수동으로 대량의 JSON 커리큘럼을 하드코딩하거나 매 접속마다 3,000개 이상의 학습 단어 메타데이터를 백엔드 서버에서 긁어오는 네트워크 지연을 방지하기 위함입니다.
* **초기 시딩(Seed) 로직:** 앱 첫 기동 시 `dbService.js`가 로컬 IndexedDB에 `chapters`, `lessons`, `variants` 테이블이 존재하는지 진단하고, 데이터가 비어있으면 백엔드의 `GET /api/curriculum` API를 단 한 번만 조회하여 로컬 브라우저 샌드박스 내부 데이터베이스에 완전히 안착시킵니다.
* **데이터 격리:** `lessons` 테이블은 `chapterId`를 인덱스로 활용하고, CMS에서 개별적으로 추가 녹화한 전문가 궤적 데이터는 `variants` 테이블에 `lessonId` 인덱스로 일대다(1:N) 관계 매핑되어 로컬 캐시에서 독립적으로 관리 및 로딩됩니다.
