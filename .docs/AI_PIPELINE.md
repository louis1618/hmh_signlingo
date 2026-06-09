# AI 파이프라인 분석 (AI Pipeline Documentation)

본 문서는 **SignLingo**의 코어 인공지능 아키텍처, 학습 데이터 전처리 파이프라인, PyTorch 기반의 다층 신경망 모델 설계 및 모델 평가 방식을 소스 코드 기준으로 상세 분석하여 서술합니다.

---

## 1. 수어 인지 모델 아키텍처 (SignLanguageModel)

사용자의 60프레임 동적 관절 움직임을 판별하기 위해, SignLingo는 **Linear Projection + Bidirectional LSTM + Multi-head Self-Attention + Fully Connected Head**로 구성된 복합 신경망 아키텍처를 채택했습니다. (`train.py` 정의)

```
                       [ Input Tensor: (Batch, 60, 100) ]
                                      │
                                      v
                        [ Linear Projection (100 -> 512) ]
                                      │
                                      v
                        [ Layer Normalization & ReLU ]
                                      │
                                      v
                        [ Dropout (0.3) Reguralizer ]
                                      │
                                      v
                     [ 3-Layer Bi-LSTM (512 -> 256*2 = 512) ]
                                      │
                                      v
                        [ Layer Normalization (LSTM Out) ]
                                      │
                                      v
                 ┌────────────────────┴────────────────────┐
                 │                                         │
                 ▼ (Query, Key, Value)                     │
     [ Multi-head Self-Attention ]                         │
                 │                                         │
                 ▼ (Attention Output)                      │
                 └────────────────────┼────────────────────┘
                                      v
                     [ Residual Conn & Layer Norm (Add) ]
                                      │
                                      v
                      [ Temporal Average Pooling (dim 1) ]
                                      │
                                      v
                       [ FC Layer 1 (512 -> 256) & ReLU ]
                                      │
                                      v
                         [ Dropout (0.3) & FC Layer 2 ]
                                      │
                                      v
                     [ Output Logits (Batch, NumClasses) ]
```

### 아키텍처 세부 컴포넌트 동작
1. **Linear Projection:** 100차원의 랜드마크 스냅샷 입력을 512차원의 높은 표현 공간(Representation space)으로 사영합니다. 배치 전체의 편향을 잡기 위해 `LayerNorm`을 활용하고 과적합을 제약합니다.
2. **Bidirectional LSTM (3-Layer):** 3개 층으로 깊게 쌓인 양방향 LSTM이 동작의 시간적 순방향 흐름과 역방향 흐름을 상호 보존하며, 512차원 은닉 표현을 입력받아 각각 256차원(양방향 합산 512차원) 시계열 텐서를 도출합니다.
3. **Multihead Self-Attention:** 수어는 특정 손가락의 꼬임이나 신체 접촉이 일어나는 순간(Key Frames)이 분류의 결정적인 근거가 됩니다. 8개의 병렬 어텐션 헤드가 60프레임 시퀀스의 전체 전역 상관관계를 계산하여 가장 결정적인 프레임 구간에 가중치를 매깁니다.
4. **잔차 연결 (Residual Connection):** Self-Attention 결과물과 LSTM 결과물을 스킵 연결(`out = out + attn_out`)하고 `LayerNorm`을 한 번 더 수행하여, 깊은 신경망 층 통과 시 발생할 수 있는 경사 소실(Vanishing Gradient) 문제를 사전 해결했습니다.
5. **Temporal Average Pooling:** 시계열 전체 차원(dim 1, 60프레임)을 평균 풀링(`torch.mean(out, dim=1)`)하여 동작 속도 차이에 의한 프레임 길이 흔들림을 일원화된 512차원의 단일 꼬임 벡터로 압축합니다.
6. **Classification FC Head:** 512차원을 256차원으로 낮추고 최종 분류할 총 클래스 개수(3,022개 단어)의 로짓 값으로 변환시킵니다.

---

## 2. 대용량 데이터 전처리 및 컴파일 파이프라인

SignLingo는 AI Hub에서 분할 제공된 수십~수백 GB 분량의 다중 파트 압축 OpenPose JSON 파일들을 단 한 번의 파이프라인 작동으로 가볍고 고속인 학습용 이진 바이너리로 압축합니다.

### A. 형태소 및 동작 구간 파싱 (`preprocess_sentence.py` & `preprocess_stream.py`)
1. **분할 압축 자동 병합:** 디스크 공간 확보 및 스트리밍 해제를 위해 `*.zip.part0`, `*.zip.part1` 등으로 쪼개진 압축 파트를 탐색하여 `shutil.copyfileobj` 기법으로 하나의 통합 ZIP으로 동적 결합한 뒤, 처리 즉시 병합본을 삭제하여 디스크 자원을 보존합니다.
2. **단어 형태소 분할 연동:** 수어 문장 데이터셋(`preprocess_sentence.py`)의 경우 형태소 별 시작 시간(`start`)과 종료 시간(`end`) 메타데이터를 파싱합니다. 전체 영상 프레임 수 대비 영상 총 재생 시간을 나누어 가상의 `fps`를 산출하고, 형태소 시작/종료 시간에 곱해 전체 프레임 시퀀스 속에서 정확한 단어 표현 구간(Frame Indices)만 슬라이싱해 특징을 모읍니다.

### B. 시계열 선형 보간 (Temporal Interpolation)
각기 다른 수어 연기자와 단어의 특성에 따라 동작 영상의 길이는 30프레임에서 150프레임까지 파편화되어 있습니다:
* **보간 방식:** 모은 랜드마크 프레임 배열의 실제 길이를 $N$이라 할 때, `np.linspace(0, N - 1, 60, dtype=int)` 수식을 사용하여 60개의 균일하게 등분된 시간축 인덱스를 계산해 프레임을 샘플링합니다.
* **패딩 전략:** 만약 원본 시퀀스 프레임이 극히 짧아 60개 미만일 경우 부족한 프레임 공간을 `0` 텐서(Zero-padding)로 채워 60프레임 규격을 확보합니다.

### C. NP.Memmap 이진 컴파일화
샘플들의 60프레임 정규화 특징(100차원)이 완성되면, 모든 부동 소수점을 바이트열(`seq_features.tobytes()`)로 변환하여 `dataset_features.bin` 바이너리 파일 끝에 직렬적으로 누적 저장(Append)합니다. 최종 컴파일된 바이너리는 PyTorch 데이터로더에서 `np.memmap` 구조를 취해 파일 입출력 오버헤드를 근절합니다.

---

## 3. 학습 및 과적합 평가 체계

* **손실 함수 및 레이블 스무딩:** 분류 클래스 개수(3,022개)가 매우 조밀하여 학습 데이터셋에 과적합되기 쉽습니다. 이를 막기 위해 크로스엔트로피 손실 함수에 `label_smoothing=0.1` 옵션을 적용해 모델이 특정 오답에 극단적으로 높은 확신값을 내는 경향을 방지했습니다.
* **가중치 감쇠 및 스케줄러:** AdamW 옵티마이저(`weight_decay=0.01`)와 OneCycleLR 스케줄러를 탑재하여, 훈련 세션 초반에는 학습률을 빠르게 올렸다가 후반부에는 코사인 어닐링 기법으로 세밀하게 수렴시킵니다.
* **Stratified 80/20 검증 분할 (`evaluate.py`):**
  * 각 클래스(단어)별 분포 불균형이 극심합니다. 이를 위해 데이터 분포 비를 유지하며 학습/검증 데이터를 나누는 `StratifiedShuffleSplit`를 도입했습니다.
  * 단, 샘플 개수가 1개뿐인 희귀 단어 클래스는 검증 셋과 학습 셋에 균등 배분할 수 없으므로, 사전 분석기(`Counter`)가 2개 미만 샘플 클래스를 자동 선별 필터링해 `Stratified` 분할 연산의 붕괴를 예방합니다.
  * 학습 세트(80%) 정확도와 검증 세트(20%) 정확도의 차이(`Gap = Train_Acc - Val_Acc`)를 산출하여 격차가 10% 미만이면 일반화 성공(✅), 25% 미만이면 주의(⚠️), 25% 이상이면 경고(🚨)를 도출하는 과적합 모니터링 시스템을 탑재했습니다.
