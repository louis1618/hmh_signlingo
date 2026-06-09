import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Loader2, Hand } from 'lucide-react';
import { DuoButton } from '../../components/ui';
import { FilesetResolver, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { extractAndNormalize } from '../../services/mediapipeEngine';

const MAX_FRAMES = 60;
const MIN_CONFIDENCE = 0.30; // Slightly higher confidence for continuous translator to avoid noise
const CONFIRM_COUNT = 3;
const WINDOW_STRIDE = 15;
const BUFFER_SIZE = 124;

export const Translator = () => {
    const [isTranslating, setIsTranslating] = useState(false);
    const [text, setText] = useState("");
    const [detectedWord, setDetectedWord] = useState(null);
    const [isModelLoaded, setIsModelLoaded] = useState(false);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const isComponentMounted = useRef(true);

    const poseLandmarkerRef = useRef(null);
    const handLandmarkerRef = useRef(null);
    
    const slidingWindowRef = useRef([]);
    const cooldownRef = useRef(false);
    const consecutiveRef = useRef({ word: null, count: 0 });
    const requestRef = useRef(null);

    const wsRef = useRef(null);
    const pendingRequestRef = useRef(false);
    const pendingQueueRef = useRef(null);
    const lastVideoTimeRef = useRef(-1);

    // ========== MediaPipe Init ==========
    useEffect(() => {
        isComponentMounted.current = true;
        const initModels = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
                poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" },
                    runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
                });
                handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
                    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
                    runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
                });
                if (isComponentMounted.current) setIsModelLoaded(true);
            } catch (err) {
                console.error("Failed to load models:", err);
            }
        };
        initModels();

        wsRef.current = new WebSocket('ws://localhost:8000/ws/recognize');
        wsRef.current.binaryType = "arraybuffer";

        wsRef.current.onopen = () => console.log("Translator WS Connected");
        wsRef.current.onmessage = (event) => {
            if (!isComponentMounted.current) return;
            pendingRequestRef.current = false;
            try {
                const textData = new TextDecoder("utf-8").decode(event.data);
                const data = JSON.parse(textData);
                handleRecognitionResult(data);
            } catch(e) { console.error("WS Parse Error", e); }
        };
        wsRef.current.onerror = (err) => {
            console.error("WS Error", err);
            pendingRequestRef.current = false;
        };
        wsRef.current.onclose = () => console.log("Translator WS Closed");

        return () => {
            isComponentMounted.current = false;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    const sendToBackend = (frames) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const flatFrames = new Float32Array(frames.flat());
        wsRef.current.send(flatFrames.buffer);
        pendingRequestRef.current = true;
    };

    const handleRecognitionResult = useCallback((data) => {
        if (!isComponentMounted.current) return; // if translation stopped
        // We only append if translating
        if (!cooldownRef.current) {
            if (data.confidence >= MIN_CONFIDENCE && data.word !== '알 수 없음' && data.word !== '오류') {
                if (data.word === consecutiveRef.current.word) {
                    consecutiveRef.current.count += 1;
                } else {
                    consecutiveRef.current = { word: data.word, count: 1 };
                }
                const cur = consecutiveRef.current;
                setDetectedWord({ word: data.word, confidence: data.confidence, count: cur.count });
                
                if (cur.count >= CONFIRM_COUNT) {
                    // 단어가 충분히 인식되었으므로 문장에 추가
                    setText(prev => {
                        const lastWord = prev.trim().split(' ').pop();
                        if (lastWord !== data.word) {
                            return prev + (prev ? " " : "") + data.word;
                        }
                        return prev;
                    });
                    
                    // 연속 인식 쿨다운 및 초기화
                    consecutiveRef.current = { word: null, count: 0 };
                    slidingWindowRef.current = [];
                    cooldownRef.current = true;
                    setTimeout(() => { cooldownRef.current = false; }, 1200); // 1.2초 동안 새 입력 방지
                    setDetectedWord(null);
                }
            } else {
                consecutiveRef.current = { word: null, count: 0 };
                setDetectedWord(null);
            }
        }

        if (pendingQueueRef.current) {
            const queued = pendingQueueRef.current;
            pendingQueueRef.current = null;
            sendToBackend(queued);
        }
    }, []);

    const computeAdaptiveStride = (window) => {
        return WINDOW_STRIDE;
    };

    const predictWebcam = async () => {
        if (!videoRef.current || !isModelLoaded) {
            if (isComponentMounted.current) {
                requestRef.current = requestAnimationFrame(predictWebcam);
            }
            return;
        }

        const video = videoRef.current;
        if (video.videoWidth === 0) {
            requestRef.current = requestAnimationFrame(predictWebcam);
            return;
        }

        const now = Date.now();
        try {
            if (lastVideoTimeRef.current !== video.currentTime) {
                lastVideoTimeRef.current = video.currentTime;

                const poseResult = poseLandmarkerRef.current.detectForVideo(video, now);
                const handResult = handLandmarkerRef.current.detectForVideo(video, now);
                
                const features = extractAndNormalize(poseResult, handResult);
                if (features) {
                    slidingWindowRef.current.push(features);
                    
                    const bufLen = slidingWindowRef.current.length;
                    if (bufLen >= BUFFER_SIZE) {
                        const sampledFrames = [];
                        for (let i = 0; i < MAX_FRAMES; i++) {
                            const idx = Math.floor(i * (BUFFER_SIZE - 1) / (MAX_FRAMES - 1));
                            sampledFrames.push(slidingWindowRef.current[idx]);
                        }
                        
                        if (!cooldownRef.current) {
                            if (pendingRequestRef.current) {
                                pendingQueueRef.current = sampledFrames;
                            } else {
                                sendToBackend(sampledFrames);
                            }
                        }

                        const adaptiveStride = computeAdaptiveStride(slidingWindowRef.current);
                        slidingWindowRef.current = slidingWindowRef.current.slice(adaptiveStride);
                    }
                }
            }
        } catch (err) {
            console.error("Tracking Error:", err);
        }

        if (isComponentMounted.current) {
            requestRef.current = requestAnimationFrame(predictWebcam);
        }
    };

    useEffect(() => {
        if (isTranslating && isModelLoaded) {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
                .then(stream => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        videoRef.current.onloadeddata = () => {
                            predictWebcam();
                        };
                    }
                })
                .catch(err => console.log("Camera access denied", err));
        } else {
            if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(t => t.stop());
            }
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            slidingWindowRef.current = [];
            consecutiveRef.current = { word: null, count: 0 };
        }

        return () => {
            if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(t => t.stop());
            }
        };
    }, [isTranslating, isModelLoaded]);

    return (
        <div className="flex flex-col h-full bg-[#111b21]">
            <div className="px-6 py-4 flex justify-between items-center bg-[#111b21] text-white border-b border-gray-800">
                <h2 className="text-xl font-black tracking-wide flex items-center gap-2">
                    <Sparkles className="text-[#1cb0f6]" /> 실시간 AI 수어 연속 번역기
                </h2>
                {!isModelLoaded && (
                    <div className="text-xs font-bold text-gray-400 flex items-center gap-1">
                        <Loader2 size={14} className="animate-spin" /> 엔진 로딩중...
                    </div>
                )}
            </div>

            <div className="flex-1 relative">
                <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 opacity-60" />

                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center pt-10">
                    <div className={`w-[80%] max-w-[400px] h-[50%] max-h-[300px] border-4 rounded-3xl transition-colors duration-700 ${isTranslating ? 'border-[#58cc02] opacity-80' : 'border-white opacity-20'}`}>
                        {isTranslating && <div className="w-full h-[2px] bg-[#58cc02] animate-bounce mt-4 shadow-[0_0_15px_#58cc02]"></div>}
                    </div>
                </div>

                {/* 실시간 감지 단어 표시 */}
                {isTranslating && (
                    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md rounded-2xl px-4 py-2 flex flex-col items-center border border-white/10 z-10">
                        <span className="text-white font-bold text-xs mb-1 uppercase tracking-wider">현재 인식 상태</span>
                        {detectedWord ? (
                            <span className="text-2xl font-black text-white flex items-center gap-2">
                                <Hand size={18} /> {detectedWord.word}
                                <span className="text-sm font-normal opacity-70">{(detectedWord.confidence*100).toFixed(1)}%</span>
                            </span>
                        ) : (
                            <span className="text-sm font-bold text-gray-400">동작 대기중...</span>
                        )}
                    </div>
                )}

                <div className="absolute bottom-24 md:bottom-8 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:max-w-2xl">
                    <div className="bg-black/60 backdrop-blur-md border border-white/20 rounded-3xl p-6 shadow-2xl min-h-[140px] flex flex-col justify-end relative overflow-hidden">
                        <p className="text-white text-2xl md:text-4xl font-black leading-tight drop-shadow-md break-words">
                            {text || (isTranslating ? "수어를 시작해주세요..." : "하단의 시작 버튼을 누르세요.")}
                            {isTranslating && <span className="inline-block w-3 h-8 bg-[#1cb0f6] ml-2 animate-pulse align-middle" />}
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-[#1a262e] p-4 flex justify-center gap-4 shrink-0 pb-20 md:pb-4 border-t border-gray-800">
                <button onClick={() => setText("")} className="px-6 py-3 rounded-2xl font-bold text-gray-400 bg-white/5 hover:bg-white/10 transition-colors uppercase">
                    문장 초기화
                </button>
                <DuoButton 
                    variant={isTranslating ? 'danger' : 'primary'} 
                    className="w-auto px-12" 
                    onClick={() => setIsTranslating(!isTranslating)}
                    disabled={!isModelLoaded}
                >
                    {isTranslating ? '번역 중지' : '실시간 번역 시작하기'}
                </DuoButton>
            </div>
        </div>
    );
};
