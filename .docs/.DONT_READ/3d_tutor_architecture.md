# 프로젝트 개요

본 문서는 영상 시청 기반의 기존 수어 교육 방식이 지닌 한계(제작 비용, 단일 시점, 상호작용 부재)를 극복하기 위해 제안된 **"3D 수어 튜터(Sign Language 3D Tutor)" 시스템**의 기술 설계서입니다. 
사용자는 WebGL 기반의 3D 환경에서 아바타를 360도 회전, 확대/축소하며 수어의 디테일(특히 손가락 및 공간적 위치)을 명확히 학습할 수 있습니다. 또한 사용자의 웹캠 영상을 실시간으로 분석하여 3D 동작 데이터로 변환, AI가 튜터의 모션 데이터와 비교하여 정밀한 피드백을 제공하는 양방향 XR 학습 플랫폼을 목표로 합니다.

---

# 전체 시스템 아키텍처

```mermaid
graph TD
    subgraph Client [Client 브라우저 (React + R3F)]
        A[웹캠 영상] --> B[MediaPipe Holistic<br>웹 워커]
        B -->|Landmarks (2D/3D)| C[Kalidokit<br>Kinematics Solver]
        C -->|Euler / Quaternion<br>BlendShapes| D[3D 렌더링 엔진<br>React Three Fiber]
        D -->|VRM Avatar| E[화면 출력]
    end

    subgraph MotionData [동작 데이터베이스]
        F[(수어 모션 JSON)] -->|기준 데이터 제공| G[모션 재생 엔진]
        G --> D
    end

    subgraph AIEngine [AI 채점 엔진]
        C -->|사용자 모션 데이터| H[비교 분석 모듈<br>DTW & Cosine Similarity]
        G -->|기준 모션 데이터| H
        H -->|채점 결과| I[UI 피드백 (점수/교정)]
    end
```

---

# 기술 검토

## 1. 비전 처리 (Pose & Hand Tracking)
* **MediaPipe Holistic (권장):** 손(21개 관절), 얼굴(468개 랜드마크), 포즈(33개 관절)를 동시에 초당 30~60FPS로 추출 가능. 모바일 웹 호환성이 가장 뛰어남.
* **MediaPipe Hands:** 손만 정밀하게 추적할 때 유용하지만, 수어는 팔꿈치와 어깨 등 전체 포즈 정보가 필수적이므로 Holistic이 더 적합.
* **OpenPose / BlazePose:** OpenPose는 무겁고 서버 사이드 GPU가 필요해 실시간 웹 서비스에 부적합. BlazePose는 MediaPipe Pose의 근간이지만 손가락 디테일이 부족.

## 2. 3D 렌더링 엔진
* **React Three Fiber (R3F) (권장):** Three.js의 React 래퍼. React 상태(State)와 3D 씬(Scene)의 동기화가 뛰어나고, 생태계(Drei 등)가 매우 강력함.
* **Three.js / WebGL:** 너무 로우레벨(Low-level)이어서 컴포넌트 단위 관리가 어려움.

## 3. Kinematics Solver
* **Kalidokit (권장):** MediaPipe의 3D Landmark를 VRM 휴머노이드 본(Bone)의 회전값(Euler/Quaternion) 및 얼굴 BlendShape으로 완벽하게 변환해주는 라이브러리.

---

# Mixamo 적용 절차

수어 특성상 미세한 손가락 관절과 표정이 중요하지만, Mixamo 모델은 주로 '몸통 애니메이션'에 특화되어 있습니다. 따라서 Mixamo를 사용하더라도 **얼굴 표정(BlendShapes)과 손가락 본(Bone)이 완벽히 매핑된 모델**인지 확인하는 절차가 필수입니다.

### 1. 모델 준비 및 캐릭터 선택
* 손가락 관절(마디별 3개씩 총 15개)이 개별 분리되어 있는 하이폴리곤 모델 선택.
* Mixamo에 `.obj` 또는 `.fbx` 업로드 후 **Auto Rigger**를 실행. (이때 Fingers 옵션을 반드시 Standard(5손가락)로 설정)

### 2. Bone Mapping (VRM 변환)
* Mixamo에서 추출한 FBX는 표준 Humanoid 규격과 이름이 다를 수 있음(ex: `mixamorig:RightHand`).
* **Blender + VRM Addon** 또는 **Unity + UniVRM**을 사용하여 FBX를 Import하고, 각 뼈대(Bone)를 VRM Humanoid 규격에 매핑.
* 수어에 필수적인 얼굴 BlendShape (A, I, U, E, O, Blink, Joy, Angry 등)을 Unity에서 추가 설정하여 VRM으로 Export.

### 3. 애니메이션 활용 여부
* **절대 사용하면 안 되는 것:** Mixamo의 손이나 팔이 크게 움직이는 애니메이션. (수어 데이터의 덮어쓰기 충돌 발생)
* **활용 가능한 것:** 하체 고정 시 자연스러운 대기 상태(Idle Breathing) 정도만 Base 레이어로 재생. 상체와 손은 100% 모션 데이터(JSON)로 Overwrite 처리.

---

# VRM vs GLTF 비교

| 비교 항목 | GLTF / GLB | VRM (권장) |
|---|---|---|
| **설명** | 범용 3D 포맷 | GLTF 기반의 **휴머노이드/아바타 전용** 포맷 |
| **Bone 구조** | 모델마다 본(Bone) 이름과 계층구조가 다름 | `VRM Humanoid` 표준화. 모든 아바타가 동일한 본 맵핑 보유 |
| **BlendShape** | 이름이 파편화되어 제어 까다로움 | Joy, Angry, Blink 등 표준 표정 프리셋 내장 |
| **Kalidokit 연동**| 불가능에 가까움 (커스텀 리타겟팅 필요) | **100% 완벽 호환 (VRM 표준 기반으로 설계됨)** |
| **시선 추적** | 직접 본(Bone)을 계산하여 회전해야 함 | VRM LookAt 컴포넌트로 카메라 추적 자동 지원 |

> **최종 추천 구조:** 반드시 **VRM**을 사용해야 합니다. MediaPipe의 데이터를 아바타에 매핑할 때 뼈대의 이름과 축(Axis) 정렬이 조금만 달라도 관절이 뒤틀립니다. VRM과 Kalidokit 조합은 이 문제를 표준화로 해결했습니다.

---

# 데이터 구조 설계

수어 영상은 픽셀 기반이라 무겁고 편집이 불가능하지만, 좌표 기반의 데이터셋(JSON)으로 저장하면 수 KB로 압축되며 즉시 렌더링 및 수정이 가능합니다.

```json
{
  "metadata": {
    "signWord": "안녕하세요",
    "fps": 30,
    "totalFrames": 120
  },
  "frames": [
    {
      "f": 0,
      "bones": {
        "rightUpperArm": { "x": 0.1, "y": -0.2, "z": 0.5, "w": 0.8 }, 
        "rightLowerArm": { "x": ... },
        "rightHand": { "x": ... },
        "rightThumbProximal": { "x": ... }
        // 쿼터니언(Quaternion) 형식 적용으로 짐벌락 방지
      },
      "blendshapes": {
        "Joy": 0.8,
        "A": 0.2
      },
      "position": { "x": 0, "y": 1.2, "z": 0 } // 골반(Hips) 글로벌 좌표
    }
  ]
}
```

---

# 실시간 파이프라인 (병목 분석 포함)

1. **사용자 카메라 연동 (병목 지점 1 - 해상도):** 너무 높은 해상도는 프레임 드랍 유발. 640x480 또는 480x360으로 제한하여 추적 성능 확보.
2. **MediaPipe Inference (병목 지점 2 - 메인 스레드 차단):** JS 메인 스레드에서 돌아가면 UI(React)가 멈춤. 반드시 **Web Worker**로 분리.
3. **관절 추출 & Kalidokit 연산:** 상대적으로 매우 가벼운 수학적 연산(Euler/Quaternion 변환).
4. **VRM Avatar 실시간 렌더링:** R3F의 `useFrame` 훅 안에서 아바타의 본 회전값을 직접 덮어씌움 (돌연변이 연산으로 리렌더링 오버헤드 최소화).

---

# 모션 엔진 설계

자연스러운 3D 튜터 재생을 위한 핵심 고려사항입니다.

* **보간 (Interpolation):** 데이터가 30FPS이고 디스플레이가 60FPS일 경우 끊겨보입니다. 현재 프레임과 다음 프레임의 Quaternion 사이를 **Slerp(구면 선형 보간)** 하여 부드럽게 연결합니다.
* **IK (Inverse Kinematics) vs FK (Forward Kinematics):** 
  * 기본은 **FK** (어깨 -> 팔꿈치 -> 손목 회전)를 사용합니다. 데이터 자체가 각도를 담고 있기 때문입니다.
  * **IK 혼합 전략:** 손가락이 반대쪽 팔이나 얼굴을 터치해야 하는 특정 수어 동작(예: '아빠')에서는 FK만 쓰면 뼈대 길이 오차로 인해 몸을 관통할 수 있습니다. 양손이 맞닿을 때는 IK Target을 활용해 강제로 위치를 맞춥니다.
* **관절 꺾임 방지 (Constraint):** 팔꿈치가 뒤로 꺾이거나 손목이 360도 도는 현상을 막기 위해 Kalidokit 내부에서 설정하는 Clamp(Min/Max 각도) 제한을 엄격하게 적용합니다.

---

# AI 채점 시스템

단순히 "따라했다"가 아니라, 얼마나 완벽하게 동작을 수행했는지 정량적으로 분석합니다.

1. **DTW (Dynamic Time Warping) 적용:** 사람마다 수어를 수행하는 속도가 다릅니다. 기준 JSON과 사용자의 실시간 JSON 배열 길이를 동적으로 매칭하여 속도 차이를 무시하고 궤적의 유사도를 판별합니다.
2. **관절별 가중치 계산 (Cosine Similarity):** 
   * **손 모양 (50%):** 양 손목 및 손가락 관절의 Quaternion 코사인 유사도. 손가락이 틀리면 수어의 의미가 바뀌므로 가장 높게 배점.
   * **이동 경로 및 위치 (30%):** 손목의 상대적 3D 좌표(어깨/코 기준) 이동 궤적 유사도.
   * **얼굴 표정 (20%):** 수어의 비수지 기호(표정). MediaPipe Face Mesh의 눈썹, 입꼬리 Landmark 거리값을 비교.
3. **피드백 도출:** 점수가 낮게 나온 특정 관절(예: "오른쪽 검지 손가락")을 UI에 텍스트 또는 3D 아바타 관절 색상 변경(빨간색)으로 피드백.

---

# 성능 최적화

목표 성능 (저사양 모바일/노트북 기준 60FPS) 달성 전략:

1. **Web Worker Offloading:** MediaPipe Holistic 추론과 Kalidokit 변환 연산을 메인 스레드에서 분리. `postMessage`로 ArrayBuffer 전송.
2. **R3F 최적화:** 
   * 아바타의 본(Bone)을 업데이트할 때 `setState`를 절대 사용하지 않음. `scene.getObjectByName('BoneName').quaternion.slerp(...)`와 같이 Three.js의 `mutate` 방식을 사용하여 React 리렌더링을 0으로 만듦.
3. **Geometry 최적화:** 폴리곤 수가 너무 많은 VRM 모델은 피하고 (최대 30k 폴리곤 권장), 재질(Material)은 Unlit 또는 텍스처 베이킹을 사용하여 라이팅(Lighting) 연산 오버헤드 제거.

---

# 위험 요소 방지 아키텍처

| 위험 현상 | 발생 원인 | 아키텍처 레벨 방지책 |
|---|---|---|
| **손가락 뒤집힘** | 카메라에 손등만 보여 Z축 깊이 계산 실패 | 이전 프레임의 각도와 비교하는 **Low-pass Filter (Kalman Filter)** 적용하여 순간적인 튀는 값(Outlier) 제거. |
| **몸통 관통** | 체형 차이에 의한 FK(Forward Kinematics) 오차 | 아바타의 충돌체(Collider) 설정, 혹은 양손 거리가 특정 임계값 이하일 때 **IK(Inverse Kinematics)** 활성화. |
| **얼굴 찌그러짐** | 입을 너무 크게 벌렸을 때 BlendShape 오작동 | 각 BlendShape 값의 최대치를 0.0 ~ 1.0 사이로 강제 Clamp 처리. |

---

# 구현 로드맵

* **Phase 1 (코어 셋업):** React Three Fiber 환경 구축, VRM 아바타 로드, 기본 애니메이션 루프 생성.
* **Phase 2 (파이프라인 연결):** 웹캠 연동, Web Worker 내부에 MediaPipe Holistic 탑재, Kalidokit 연결 및 아바타 실시간 제어 확인.
* **Phase 3 (수어 데이터화):** 모션 캡처용 Admin 페이지 제작. 전문가의 동작을 JSON 포맷으로 실시간 녹화 및 저장하는 시스템 구축.
* **Phase 4 (AI 및 UI 완성):** DTW 기반 채점 알고리즘 적용. 360도 뷰어 UI, 재생 속도 조절, 관절 강조 UI 등 구현.

---

# MVP 설계

최초 MVP 모델은 복잡성을 줄이기 위해 다음과 같이 한정합니다.
1. **단어 단위 수어:** 문장이 아닌 짧은 수어 단어(예: 안녕하세요, 감사합니다) 10개만 구축.
2. **채점 기준 간소화:** 초기에는 손가락 모양(Quaternion)과 손의 상대적 위치(어깨 기준 XYZ) 2가지만을 합산하여 점수 산출. 표정 채점은 V2로 연기.
3. **아바타 단일화:** 최적화가 검증된 단일 VRM 아바타 1종류만 제공.

---

# 최종 권장 아키텍처 기술 스택

* **Frontend Framework:** React 18 + Vite (가장 빠른 빌드와 안정적인 상태 관리)
* **3D 렌더링:** React Three Fiber + @react-three/drei
* **아바타 포맷:** VRM (표준 휴머노이드 & Blendshape 완벽 지원)
* **비전 AI:** MediaPipe Holistic (WebAssembly 기반 브라우저 런타임)
* **모션 리타겟팅:** Kalidokit (MediaPipe -> VRM Solver)
* **데이터 포맷:** 커스텀 JSON (Frame별 Quaternion & 위치 좌표 저장)
* **상태 관리:** Zustand (수어 재생 상태, 프레임 위치 등 잦은 업데이트 처리에 최적)

---

# 결론

3D 수어 튜터 시스템은 기존 영상 기반 교육을 혁신할 수 있는 최고의 솔루션입니다. 
가장 중요한 점은 **VRM 포맷과 Kalidokit의 결합**을 통해, 복잡하고 파편화된 3D 뼈대 맵핑 지옥에서 벗어나 규격화된 수어 모션 데이터를 손쉽게 생성하고 렌더링할 수 있다는 것입니다. 또한, 성능의 핵심인 **Web Worker 분리 및 리렌더링 통제(Mutating)** 전략을 고수한다면, 모바일 환경에서도 끊김 없는 실시간 3D 교육과 AI 채점을 성공적으로 구현할 수 있습니다.
