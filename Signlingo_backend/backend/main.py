import os
import json
import torch
import numpy as np
import pickle
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv

from train import SignLanguageModel
from dataset import FEATURE_DIM

# Phase 1-B-1: Debug mode flag — disable disk I/O and stats in production
DEBUG_MODE = os.environ.get("DEBUG_MODE", "false").lower() == "true"

app = FastAPI(title="Signlingo API", description="Sign Language Recognition & Sentence Generation API")

# Load Vocabulary
VOCAB_PATH = os.path.join(os.path.dirname(__file__), "vocab.json")
try:
    with open(VOCAB_PATH, "r", encoding="utf-8") as f:
        idx_to_word = json.load(f)
    num_classes = len(idx_to_word)
    print(f"Loaded vocab with {num_classes} classes.")
except Exception as e:
    print(f"Warning: Could not load vocab.json: {e}")
    idx_to_word = {}
    num_classes = 2

# Load Model — must match train.py architecture exactly
INPUT_SIZE = FEATURE_DIM  # 100 (normalized)
HIDDEN_SIZE = 512
MAX_FRAMES = 60
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = SignLanguageModel(INPUT_SIZE, HIDDEN_SIZE, num_classes).to(device)

# Motion Dataset Global Cache
motion_cache = None
features_mmap = None

# Initialize Dataset cache
cache_path = os.path.join(os.path.dirname(__file__), "dataset_cache.pkl")
bin_path = os.path.join(os.path.dirname(__file__), "dataset_features.bin")
if os.path.exists(cache_path):
    with open(cache_path, "rb") as f:
        motion_cache = pickle.load(f)
        motion_cache['word_to_sample_idx'] = {}
        for i, s in enumerate(motion_cache['samples']):
            if s['word'] not in motion_cache['word_to_sample_idx']:
                motion_cache['word_to_sample_idx'][s['word']] = i
        
        if os.path.exists(bin_path):
            features_mmap = np.memmap(
                bin_path, 
                dtype=np.float32, 
                mode='r', 
                shape=(motion_cache['total_sequences'], 60, 100)
            )
            print(f"Loaded dataset features memmap for {motion_cache['total_sequences']} sequences.")

# Prefer best model, fall back to last checkpoint
MODEL_PATH = os.path.join(os.path.dirname(__file__), "sign_model_best.pth")
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = os.path.join(os.path.dirname(__file__), "sign_model.pth")
try:
    ckpt = torch.load(MODEL_PATH, map_location=device)
    model.load_state_dict(ckpt['model_state_dict'])
    model.eval()
    print(f"Model loaded from {os.path.basename(MODEL_PATH)} (epoch {ckpt.get('epoch', '?')}).")
except Exception as e:
    print(f"Warning: Could not load model: {e}")

# Phase 1-B-2: Pre-allocated input tensor buffer (avoids per-request GPU alloc)
_input_buffer = torch.zeros(1, MAX_FRAMES, FEATURE_DIM, dtype=torch.float32, device=device)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RecognitionRequest(BaseModel):
    keypoints: List[float]


class RecognitionResponse(BaseModel):
    word: str
    confidence: float
    top5: list = []  # Top 5 predictions for debugging


class WordEntry(BaseModel):
    word: str
    confidence: float


class SentenceRequest(BaseModel):
    words: List[WordEntry]


class SentenceResponse(BaseModel):
    sentence: str


@app.get("/")
def read_root():
    return {"message": "Welcome to Signlingo API"}

@app.get("/api/curriculum")
def get_curriculum():
    """Phase 2-B: Serve large curriculum.json efficiently with FileResponse (supports ETag caching)."""
    curriculum_path = os.path.join(os.path.dirname(__file__), "curriculum.json")
    if not os.path.exists(curriculum_path):
        raise HTTPException(status_code=404, detail="Curriculum file not found")
    # FileResponse automatically sets caching headers like ETag and Last-Modified
    return FileResponse(curriculum_path, media_type="application/json")


@app.get("/api/motion/{word}")
def get_motion(word: str):
    """Fetch pre-recorded motion sequence for a specific word, mapped to MediaPipe landmarks."""
    if not motion_cache or features_mmap is None:
        raise HTTPException(status_code=500, detail="Motion dataset not loaded")
        
    if word not in motion_cache['word_to_sample_idx']:
        raise HTTPException(status_code=404, detail=f"Motion for '{word}' not found in dataset")
        
    seq_idx = motion_cache['word_to_sample_idx'][word]
    feat_seq = features_mmap[seq_idx]
    
    sequence_data = []
    for frame in feat_seq:
        if np.sum(np.abs(frame)) < 1e-5:
            continue
            
        pose_landmarks = [{"x": 0, "y": 0, "z": 0, "visibility": 0} for _ in range(33)]
        
        def set_pose(mp_idx, op_idx):
            x = float(frame[op_idx*2]) * 0.5 + 0.5
            y = float(frame[op_idx*2 + 1]) * 0.5 + 0.5
            if not (np.isnan(x) or np.isnan(y)):
                pose_landmarks[mp_idx] = {"x": x, "y": y, "z": 0, "visibility": 1.0}

        set_pose(0, 0)
        set_pose(12, 2)
        set_pose(14, 3)
        set_pose(16, 4)
        set_pose(11, 5)
        set_pose(13, 6)
        set_pose(15, 7)

        left_hand_landmarks = []
        for i in range(21):
            x = float(frame[16 + i*2]) * 0.5 + 0.5
            y = float(frame[16 + i*2 + 1]) * 0.5 + 0.5
            if np.isnan(x) or np.isnan(y): x, y = 0, 0
            left_hand_landmarks.append({"x": x, "y": y, "z": 0, "visibility": 1.0})

        right_hand_landmarks = []
        for i in range(21):
            x = float(frame[58 + i*2]) * 0.5 + 0.5
            y = float(frame[58 + i*2 + 1]) * 0.5 + 0.5
            if np.isnan(x) or np.isnan(y): x, y = 0, 0
            right_hand_landmarks.append({"x": x, "y": y, "z": 0, "visibility": 1.0})

        pose_landmarks[23] = {"x": 0.4, "y": 0.7, "z": 0, "visibility": 1.0}
        pose_landmarks[24] = {"x": 0.6, "y": 0.7, "z": 0, "visibility": 1.0}

        sequence_data.append({
            "hasData": True,
            "videoWidth": 640,
            "videoHeight": 480,
            "poseLandmarks": pose_landmarks,
            "poseWorldLandmarks": pose_landmarks,
            "leftHandLandmarks": left_hand_landmarks,
            "rightHandLandmarks": right_hand_landmarks
        })
        
    return JSONResponse(content={"id": f"var_dataset_{word}", "sequenceData": sequence_data})


@app.post("/api/recognize", response_model=RecognitionResponse)
async def recognize_sign(request: RecognitionRequest):
    """Phase 1-B-3: async endpoint. Inference is fast enough to run inline."""
    if not idx_to_word:
        return RecognitionResponse(word="모델 학습 중...", confidence=0.0)

    try:
        raw = request.keypoints
        expected_len = MAX_FRAMES * FEATURE_DIM  # 60 * 100 = 6000

        # Pad or truncate to expected length
        if len(raw) < expected_len:
            raw = raw + [0.0] * (expected_len - len(raw))
        elif len(raw) > expected_len:
            raw = raw[:expected_len]

        # Phase 1-B-2: Copy into pre-allocated buffer instead of creating new tensors
        _input_buffer.copy_(
            torch.tensor(raw, dtype=torch.float32).reshape(1, MAX_FRAMES, FEATURE_DIM)
        )

        # Phase 1-B-1: Debug code only runs when DEBUG_MODE=true
        if DEBUG_MODE:
            try:
                np.save("frontend_dump.npy", _input_buffer.cpu().numpy()[0])
            except Exception:
                pass
            f_np = _input_buffer.cpu().numpy()[0]
            non_zero_frames = np.any(f_np != 0, axis=1).sum()
            hand_features = f_np[:, 16:]
            hand_nonzero = np.any(hand_features != 0, axis=1).sum()
            print(f"[DEBUG] Received {len(request.keypoints)} floats, "
                  f"non-zero frames: {non_zero_frames}/60, "
                  f"hand-active frames: {hand_nonzero}/60, "
                  f"value range: [{f_np.min():.3f}, {f_np.max():.3f}]")

        with torch.no_grad():
            outputs = model(_input_buffer)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)
            top5_conf, top5_idx = torch.topk(probabilities, min(5, probabilities.size(1)), dim=1)

        top5 = []
        for i in range(top5_conf.size(1)):
            w = idx_to_word.get(str(top5_idx[0, i].item()), "?")
            c = top5_conf[0, i].item()
            top5.append({"word": w, "confidence": round(c, 4)})

        best_word = top5[0]["word"]
        best_conf = top5[0]["confidence"]

        if DEBUG_MODE:
            print(f"[DEBUG] Top-5: {[(t['word'], t['confidence']) for t in top5]}")

        return RecognitionResponse(word=best_word, confidence=best_conf, top5=top5)
    except Exception as e:
        print(f"Recognition Error: {e}")
        import traceback
        traceback.print_exc()
        return RecognitionResponse(word="오류", confidence=0.0)


# ========== Phase 2-A: WebSocket endpoint for binary inference ==========
@app.websocket("/ws/recognize")
async def websocket_recognize(websocket: WebSocket):
    """Persistent WebSocket connection for real-time sign recognition.
    Protocol:
      - Client sends: 24,000 bytes (6000 float32 = 60 frames × 100 features)
      - Server responds: JSON {"word": str, "confidence": float}
    """
    await websocket.accept()
    print("[WS] Client connected for real-time recognition")
    # Per-connection buffer to avoid contention with HTTP endpoint's _input_buffer
    ws_buffer = torch.zeros(1, MAX_FRAMES, FEATURE_DIM, dtype=torch.float32, device=device)
    try:
        while True:
            data = await websocket.receive_bytes()
            expected_bytes = MAX_FRAMES * FEATURE_DIM * 4  # 6000 × 4 = 24000 bytes
            if len(data) != expected_bytes:
                await websocket.send_json({"word": "오류", "confidence": 0.0, "error": f"Expected {expected_bytes} bytes, got {len(data)}"})
                continue

            # Near zero-copy: frombuffer → reshape → copy to GPU buffer
            raw_tensor = torch.frombuffer(bytearray(data), dtype=torch.float32).reshape(1, MAX_FRAMES, FEATURE_DIM)
            ws_buffer.copy_(raw_tensor)

            with torch.no_grad():
                outputs = model(ws_buffer)
                probabilities = torch.nn.functional.softmax(outputs, dim=1)
                conf, idx = torch.max(probabilities, dim=1)

            word = idx_to_word.get(str(idx.item()), "?")
            await websocket.send_json({"word": word, "confidence": round(conf.item(), 4)})
    except WebSocketDisconnect:
        print("[WS] Client disconnected")
    except Exception as e:
        print(f"[WS] Error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass


@app.post("/api/generate-sentence")
def generate_sentence(request: SentenceRequest):
    words = request.words
    if not words:
        raise HTTPException(status_code=400, detail="No words provided.")

    try:
        from google import genai
    except ImportError:
        raise HTTPException(status_code=500, detail="google-genai SDK is not correctly installed.")

    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured in .env")

        client = genai.Client(api_key=api_key)

        words_with_conf = ", ".join(
            [f"{w.word}({w.confidence * 100:.0f}%)" for w in words]
        )
        prompt = (
            f"다음은 수어 인식 AI가 감지한 단어 목록입니다. 각 단어 옆의 퍼센트는 AI의 확신도입니다.\n"
            f"확신도가 높은 단어(50% 이상)는 반드시 포함하고, "
            f"확신도가 낮은 단어(30% 미만)는 문맥에 맞지 않으면 무시하거나 비슷한 의미로 대체해도 됩니다.\n"
            f"이 단어들을 조합하여 자연스럽고 문법적으로 올바른 한국어 문장 1개만 만들어줘. "
            f"부가 설명 없이 문장만 출력해:\n"
            f"[단어 목록]: {words_with_conf}"
        )

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )

        sentence = response.text.strip()
        return SentenceResponse(sentence=sentence)
    except Exception as e:
        print(f"Generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
