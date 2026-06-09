# 데이터셋 분석 (Dataset Documentation)

본 문서는 **SignLingo** 모델 학습 및 3D 아바타 시연용 모션 소스로 활용되는 AI Hub "수어 영상 데이터"의 파일 규격, 물리 구조, 전처리 변환 파이프라인 및 저장 체계를 코드 수준에서 상술합니다.

---

## 1. 데이터셋 개요 및 획득 출처
* **출처:** AI Hub (AI 허브) 공공데이터포털 - "수어 영상 데이터" 구축 과제
* **스케일:** 대용량 비디오 키포인트 데이터 (약 140GB 아카이브 규모)
* **단어 구성:** 2,771개의 한국어 수어 단어 및 수어 문장 프레임 keypoint 모음.
* **원본 데이터 형태:** 비디오의 프레임별 OpenPose `Body-25` 스켈레톤 추출 JSON 파일들을 폴더 트리 구조로 묶어놓은 Multipart ZIP 파일들 (`01_real_word_keypoint.zip.part*` 등).

---

## 2. 전처리 파이프라인 (Preprocessing Pipeline)

대용량 OpenPose ZIP 아카이브를 딥러닝 모델이 직접 실시간 처리할 수 없으므로, 백엔드의 `preprocess_stream.py`와 `preprocess_sentence.py`가 이를 고속 정밀 가공합니다.

```
                  [ AI Hub Multipart ZIP Files ]
                                │
                                v
                   [ ZipPart Merging & Stream ]
                                │
                                v
               [ OpenPose JSON Parsing in Memory ]
                                │
                                v
         [ 100-Dim Normalization (Relative to Neck/Torso) ]
                                │
                                v
            [ Interpolation & Downsampling to 60 Frames ]
                                │
                                v
         ┌──────────────────────┴──────────────────────┐
         v (Save Cache)                                v (Save Binary Features)
  [ dataset_cache.pkl ]                         [ dataset_features.bin ]
  - samples, word_to_idx,                       - Fast NumPy memmap shape
    idx_to_word, total_seq                        (total_seq, 60, 100)
```

### A. 특징 벡터(Feature Vector) 추출 공식
OpenPose JSON 내 `pose_keypoints_2d` (75개 실수), `hand_left_keypoints_2d` (63개 실수), `hand_right_keypoints_2d` (63개 실수) 배열에서 유효 특징을 추출합니다:
1. **대상 관절 (총 50개 조인트):**
   * **Pose 조인트 (8개):** Nose, Neck(RShoulder와 LShoulder의 가상 중간 좌표), RShoulder, RElbow, RWrist, LShoulder, LElbow, LWrist
   * **Left Hand 조인트 (21개):** 손바닥 손목 기준 21개 손가락 관절 좌표
   * **Right Hand 조인트 (21개):** 손바닥 손목 기준 21개 손가락 관절 좌표
2. **좌표 중심점 이동 (Centering):**
   $$\text{Centered } X_i = X_i - \text{Neck}_x, \quad \text{Centered } Y_i = Y_i - \text{Neck}_y$$
3. **체형 스케일 정규화 (Torso Scaling):**
   * 어깨폭(`shoulderDist`)을 Euclidean 거리 공식으로 계산합니다:
     $$\text{shoulderDist} = \sqrt{(\text{RShoulder}_x - \text{LShoulder}_x)^2 + (\text{RShoulder}_y - \text{LShoulder}_y)^2}$$
   * 상체 비례 척도(`torsoSize`)를 산출합니다 (OpenPose MidHip 인덱스 8번 좌표가 유효하지 않을 경우 대비):
     $$\text{torsoSize} = \frac{\text{shoulderDist}}{0.68}$$
   * 모든 50개 조인트(100개 X, Y 원소)를 `torsoSize`로 나누어 최종 정규화 특징 벡터를 생성합니다. X, Y 좌표가 부재(NaN 또는 0)할 경우 해당 손목 조인트 좌표값으로 붕괴(Collapse) 대체 처리합니다.

---

## 3. 물리적 스토리지 구조 및 파일 포맷

전처리 완료된 데이터는 서버 디렉토리 내부에서 아래와 같이 정형화된 이진 포맷으로 압축되어 디스크에 유지됩니다.

### A. `dataset_features.bin` (5.08 GB)
* **파일 타입:** RAW Float32 Binary File (헤더가 없는 순수 float 바이트 열)
* **논리적 Shape:** `(total_sequences, 60, 100)`
  * `total_sequences`: 전체 추출된 수어 동작 시퀀스 총합 (현재 약 21,180개 이상의 시퀀스 누적 저장)
  * `60`: 고정 보간 프레임 수
  * `100`: 50개 관절 x 2차원(X, Y) 특징 차원
* **액세스 방식:** 백엔드 구동 시 파이썬 `np.memmap` 함수를 통해 메모리에 적재하지 않고 파일 채널 디스크 섹터를 가상 행렬 주소로 다이렉트 맵핑하여 초고속 인덱싱 수행.

### B. `dataset_cache.pkl` (11.24 MB)
* **파일 타입:** Python Pickle 직렬화 파일
* **포함 데이터 딕셔너리:**
  * `samples`: 각 시퀀스별 메타데이터 리스트.
    ```python
    {
       'word': '가다',          # 한글 단어 레이블
       'label_idx': 1,        # 정수 인코딩 클래스 레이블 번호
       'seq_name': 'NIA_SL_...' # 원본 AI Hub 시퀀스 이름 식별 정보
    }
    ```
  * `word_to_idx`: 단어명 -> 정수 레이블 인코딩 딕셔너리
  * `idx_to_word`: 정수 레이블 -> 단어명 디코딩 딕셔너리
  * `total_sequences`: 빌드된 총 시퀀스 수

### C. `vocab.json` (76 KB)
* **파일 타입:** JSON Format
* **목적:** AI 모델 최종 분류 레이어의 차원 수(3,022개)와 클래스 인덱스를 디코딩하기 위한 사전 데이터셋 매퍼. 백엔드 `main.py` 기동 단계에서 파일 통째로 파싱되어 클래스 예측값을 한글 단어로 치환하는 데 사용됨.
