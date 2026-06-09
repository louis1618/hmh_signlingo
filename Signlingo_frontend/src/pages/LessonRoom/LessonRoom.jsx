import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, Loader2, Settings, CheckCircle, Hand } from 'lucide-react';
import { DuoButton } from '../../components/ui';
import { AvatarCanvas } from '../../components/AvatarCanvas';
import { FilesetResolver, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';

const MAX_FRAMES = 60;
const MIN_CONFIDENCE = 0.20; // Noise floor
const CONFIRM_COUNT = 3; // Require same word to be top-1 for 3 consecutive windows to prevent false positives
const BUFFER_SIZE = 124; // 4.1 seconds at 30fps

import { computeAdaptiveStride, extractAndNormalize } from '../../services/mediapipeEngine';

export const LessonRoom = ({ lesson, onClose, onComplete }) => {
    const [status, setStatus] = useState('loading_model'); // loading_model, waiting, tracking, success
    const [feedback, setFeedback] = useState("카메라 앞에서 수어 동작을 수행하세요.");
    const [detectedWord, setDetectedWord] = useState(null);
    const [bufferProgress, setBufferProgress] = useState(0);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const requestRef = useRef(null);
    const poseLandmarkerRef = useRef(null);
    const handLandmarkerRef = useRef(null);
    const poseDataRef = useRef({ hasData: false });
    
    // Playback refs
    const playbackDataRef = useRef(null);
    const playbackIndexRef = useRef(0);
    const playbackTimerRef = useRef(null);
    const [isPlaybackMode, setIsPlaybackMode] = useState(false);

    const isModelLoaded = useRef(false);
    const isComponentMounted = useRef(true);

    const consecutiveRef = useRef({ word: null, count: 0 });
    const slidingWindowRef = useRef([]);
    const cooldownRef = useRef(false);

    const wsRef = useRef(null);
    const pendingRequestRef = useRef(false);
    const pendingQueueRef = useRef(null);

    // ========== Playback Logic ==========
    useEffect(() => {
        if (lesson && lesson.targetSign) {
            setIsPlaybackMode(true);
            setFeedback("튜터의 시범을 보고 동작을 익혀보세요. (데이터 로딩 중...)");
            
            fetch(`http://localhost:8000/api/motion/${encodeURIComponent(lesson.targetSign)}`)
                .then(res => {
                    if(!res.ok) throw new Error("No motion found");
                    return res.json();
                })
                .then(data => {
                    if (data.sequenceData && data.sequenceData.length > 0 && isComponentMounted.current) {
                        playbackDataRef.current = data.sequenceData;
                        playbackIndexRef.current = 0;
                        setFeedback("튜터의 시범을 보고 동작을 익혀보세요.");

                        const totalFrames = data.sequenceData.length;
                        
                        if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
                        playbackTimerRef.current = setInterval(() => {
                            playbackIndexRef.current++;
                            if (playbackIndexRef.current >= totalFrames) {
                                // Loop playback
                                playbackIndexRef.current = 0;
                            }
                        }, 100); // 100ms per frame to match dataset sampling rate
                    } else {
                        stopPlayback();
                    }
                })
                .catch(err => {
                    console.log("No playback data available:", err);
                    if (isComponentMounted.current) stopPlayback();
                });
        }

        return () => {
            if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
        };
    }, [lesson]);

    const stopPlayback = () => {
        if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
        setIsPlaybackMode(false);
        playbackDataRef.current = null;
        setFeedback("카메라 앞에서 수어 동작을 수행하세요.");
        setStatus('waiting');
        if (!requestRef.current) predictWebcam();
    };

    // ========== MediaPipe Initialization ==========
    useEffect(() => {
        isComponentMounted.current = true;
        const initModels = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
                );

                poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                        delegate: "GPU"
                    },
                    runningMode: "VIDEO",
                    numPoses: 1
                });

                handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                        delegate: "GPU"
                    },
                    runningMode: "VIDEO",
                    numHands: 2,
                    minHandDetectionConfidence: 0.1,
                    minHandPresenceConfidence: 0.1,
                    minTrackingConfidence: 0.1,
                });

                isModelLoaded.current = true;
                if (isComponentMounted.current) setStatus('waiting');
            } catch (error) {
                console.error("MediaPipe load error:", error);
                if (isComponentMounted.current) setFeedback('AI 모델 로딩 실패');
            }
        };
        initModels();

        return () => {
            isComponentMounted.current = false;
        };
    }, []);

    // ========== WebSocket Connection ==========
    const handleRecognitionResult = useCallback((data) => {
        if (!isComponentMounted.current || status === 'success') return;

        if (data.confidence >= MIN_CONFIDENCE && data.word !== '알 수 없음' && data.word !== '오류') {
            const prev = consecutiveRef.current;
            if (prev.word === data.word) {
                prev.count += 1;
            } else {
                consecutiveRef.current = { word: data.word, count: 1 };
            }

            const cur = consecutiveRef.current;
            setDetectedWord({ word: data.word, confidence: data.confidence, count: cur.count });
            
            // Check if user correctly signed the target sign
            if (data.word === lesson.targetSign) {
                setFeedback(`좋습니다! ("${data.word}" 감지 중... ${cur.count}/${CONFIRM_COUNT})`);
                
                if (cur.count >= CONFIRM_COUNT) {
                    setStatus('success');
                    setFeedback(`🎉 완벽합니다! "${lesson.targetSign}"를 정확히 표현했습니다.`);
                    consecutiveRef.current = { word: null, count: 0 };
                    slidingWindowRef.current = [];
                    cooldownRef.current = true;
                    setTimeout(() => { cooldownRef.current = false; }, 300);
                }
            } else {
                setFeedback(`현재 인식된 동작: "${data.word}" (목표: "${lesson.targetSign}")`);
            }
        } else {
            consecutiveRef.current = { word: null, count: 0 };
            setDetectedWord(null);
            // Show what AI is seeing even if below confidence floor
            setFeedback(`현재 인식된 동작: ${data.word} (확신도: ${(data.confidence * 100).toFixed(0)}%) - 동작을 크게 해주세요.`);
        }

        // Fire queued request
        if (pendingQueueRef.current) {
            const queued = pendingQueueRef.current;
            pendingQueueRef.current = null;
            sendToBackend(queued);
        }
    }, [lesson, status]);

    const connectWebSocket = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket('ws://localhost:8000/ws/recognize');
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => console.log('[WS] Connected to recognition server');
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                pendingRequestRef.current = false;
                handleRecognitionResult(data);
            } catch (err) {
                console.error('[WS] Parse error:', err);
            }
        };
        ws.onclose = () => {
            console.log('[WS] Disconnected');
            wsRef.current = null;
        };

        wsRef.current = ws;
    }, [handleRecognitionResult]);

    const disconnectWebSocket = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    // ========== Camera & Processing Loop ==========
    const sendToBackend = (recordedFrames) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const flat = new Float32Array(recordedFrames.flat());
            pendingRequestRef.current = true;
            wsRef.current.send(flat.buffer);
        }
    };

    const drawLandmarks = (poseLm, leftHand, rightHand) => {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const drawPoints = (landmarks, color, radius = 3) => {
            if (!landmarks) return;
            ctx.fillStyle = color;
            for (const lm of landmarks) {
                ctx.beginPath();
                ctx.arc(lm.x * canvas.width, lm.y * canvas.height, radius, 0, 2 * Math.PI);
                ctx.fill();
            }
        };

        if (poseLm) {
            const upperIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24];
            ctx.fillStyle = '#6366f1';
            for (const i of upperIndices) {
                if (poseLm[i]) {
                    ctx.beginPath();
                    ctx.arc(poseLm[i].x * canvas.width, poseLm[i].y * canvas.height, 5, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
            const connections = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24]];
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
            ctx.lineWidth = 2;
            for (const [a, b] of connections) {
                if (poseLm[a] && poseLm[b]) {
                    ctx.beginPath();
                    ctx.moveTo(poseLm[a].x * canvas.width, poseLm[a].y * canvas.height);
                    ctx.lineTo(poseLm[b].x * canvas.width, poseLm[b].y * canvas.height);
                    ctx.stroke();
                }
            }
        }

        drawPoints(leftHand, '#22d3ee', 3);
        drawPoints(rightHand, '#f472b6', 3);
    };

    const lastVideoTimeRef = useRef(-1);

    const predictWebcam = async () => {
        // Only run live webcam processing if NOT in playback mode
        if (isPlaybackMode) {
            requestRef.current = requestAnimationFrame(predictWebcam);
            return;
        }

        if (!videoRef.current || !isModelLoaded.current || statusRef.current === 'success') {
            if (isComponentMounted.current && statusRef.current !== 'success') {
                requestRef.current = requestAnimationFrame(predictWebcam);
            }
            return;
        }

        const video = videoRef.current;
        if (video.videoWidth === 0) {
            requestRef.current = requestAnimationFrame(predictWebcam);
            return;
        }

        const now = performance.now();
        try {
            if (lastVideoTimeRef.current !== video.currentTime) {
                lastVideoTimeRef.current = video.currentTime;

                const poseResult = poseLandmarkerRef.current.detectForVideo(video, now);
                const handResult = handLandmarkerRef.current.detectForVideo(video, now);

                const poseLm = poseResult.landmarks?.[0] || null;
                let leftHandLm = null, rightHandLm = null;

                if (handResult.landmarks && poseLm) {
                    const hands = handResult.landmarks;
                    if (hands.length === 1) {
                        const pLWrist = poseLm[15]; // MP_LWRIST
                        const pRWrist = poseLm[16]; // MP_RWRIST
                        const hWrist = hands[0][0];
                        const distL = Math.hypot(hWrist.x - pLWrist.x, hWrist.y - pLWrist.y);
                        const distR = Math.hypot(hWrist.x - pRWrist.x, hWrist.y - pRWrist.y);
                        if (distL < distR) leftHandLm = hands[0];
                        else rightHandLm = hands[0];
                    } else if (hands.length >= 2) {
                        if (hands[0][0].x > hands[1][0].x) {
                            leftHandLm = hands[0];
                            rightHandLm = hands[1];
                        } else {
                            leftHandLm = hands[1];
                            rightHandLm = hands[0];
                        }
                    }
                }
                
                drawLandmarks(poseLm, leftHandLm, rightHandLm);

                // Update VRM pose data
                poseDataRef.current = {
                    hasData: true,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight,
                    poseLandmarks: poseResult.landmarks,
                    poseWorldLandmarks: poseResult.worldLandmarks,
                    leftHandLandmarks: leftHandLm ? [leftHandLm] : [],
                    rightHandLandmarks: rightHandLm ? [rightHandLm] : []
                };

                if (poseLm) {
                    const frame = extractAndNormalize(poseLm, leftHandLm, rightHandLm, video.videoWidth, video.videoHeight);
                    if (frame) {
                        slidingWindowRef.current.push(frame);
                        const bufLen = slidingWindowRef.current.length;
                        
                        if (bufLen % 5 === 0) {
                            setBufferProgress(Math.min(100, Math.round((bufLen / BUFFER_SIZE) * 100)));
                        }

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
            }
        } catch (e) {
            console.error("Prediction error:", e);
        }

        if (isComponentMounted.current && statusRef.current === 'tracking') {
            requestRef.current = requestAnimationFrame(predictWebcam);
        }
    };

    const statusRef = useRef(status);
    useEffect(() => { statusRef.current = status; }, [status]);

    const handleStartTracking = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setStatus('tracking');
                connectWebSocket();
                
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current.play().then(() => {
                        predictWebcam();
                    }).catch(e => console.error(e));
                };
            }
        } catch (err) {
            console.error(err);
            setFeedback('카메라 접근 권한이 필요합니다.');
        }
    };

    useEffect(() => {
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            disconnectWebSocket();
            if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(t => t.stop());
            }
        };
    }, [disconnectWebSocket]);

    return (
        <div className="absolute inset-0 bg-white z-50 flex flex-col h-full animate-in fade-in zoom-in-95 duration-200">
            <div className="px-4 py-4 flex items-center gap-4 border-b-2 border-gray-100 shrink-0">
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={32} strokeWidth={2.5} /></button>
                <div className="flex-1 bg-gray-200 h-4 rounded-full overflow-hidden">
                    <div className="bg-[#58cc02] h-full rounded-full transition-all duration-75" style={{ width: `${status === 'success' ? 100 : bufferProgress}%` }}></div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-6 max-w-5xl mx-auto w-full">
                <div className="flex-1 flex flex-col gap-4">
                    <h2 className="text-2xl md:text-3xl font-black text-gray-700 mb-2">
                        "{lesson.title}"<br />
                        <span className="text-xl text-gray-500 font-bold">
                            {isPlaybackMode ? "시범 영상을 먼저 확인하세요" : "수어를 따라해보세요!"}
                        </span>
                    </h2>
                    
                    <div className="bg-[#1a262e] border-2 border-blue-100 rounded-3xl overflow-hidden relative flex flex-col aspect-video shadow-inner">
                        <AvatarCanvas url="/models/avatar.vrm" poseDataRef={poseDataRef} playbackDataRef={playbackDataRef} playbackIndexRef={playbackIndexRef} />
                        
                        {isPlaybackMode && (
                            <div className="absolute top-4 left-4 bg-red-500/90 backdrop-blur-sm px-4 py-2 rounded-xl font-bold text-white shadow-sm flex items-center gap-2">
                                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                시범 동작 재생 중
                            </div>
                        )}
                        
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-xl font-bold text-gray-700 shadow-sm whitespace-nowrap flex gap-4">
                            <span>목표: {lesson.targetSign}</span>
                            {isPlaybackMode && (
                                <button onClick={stopPlayback} className="text-[#1cb0f6] hover:text-[#1899d6] underline">
                                    따라하기 시작
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="bg-gray-50 p-6 rounded-3xl border-2 border-gray-100 flex-1 min-h-[120px]">
                        <h3 className="font-bold text-gray-500 mb-2 uppercase tracking-wider text-sm">동작 설명</h3>
                        <p className="text-lg text-gray-700 leading-relaxed">{lesson.description}</p>
                    </div>
                </div>
                
                <div className="flex-1 flex flex-col">
                    <div className="flex-1 bg-black rounded-3xl overflow-hidden relative min-h-[300px] border-4 border-gray-100">
                        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover transform -scale-x-100" />
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 pointer-events-none" />
                        
                        {status === 'tracking' && (
                            <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md rounded-2xl px-4 py-2 flex flex-col items-center border border-white/10">
                                <span className="text-white font-bold text-xs mb-1 uppercase tracking-wider">AI 인식중</span>
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

                        {status === 'loading_model' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-8 text-white font-bold">
                                <Loader2 className="animate-spin mb-4" size={40} />AI 모델 로딩중...
                            </div>
                        )}
                        {status === 'waiting' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm p-8 text-center gap-4">
                                <DuoButton onClick={handleStartTracking}><Camera size={20} /> 카메라 켜고 학습 시작</DuoButton>
                            </div>
                        )}
                        {status === 'success' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-green-500/80 backdrop-blur-sm p-8 text-white">
                                <CheckCircle size={64} className="mb-4" />
                                <div className="text-3xl font-black">완벽합니다!</div>
                            </div>
                        )}
                    </div>
                    <div className="mt-4 p-5 rounded-2xl border-2 border-gray-100 bg-gray-50 flex flex-col gap-3 min-h-[140px]">
                        <div className="flex justify-between items-center text-sm font-bold text-gray-500 uppercase tracking-wide">
                            <span>실시간 피드백</span><Settings size={16} className="text-[#1cb0f6]" />
                        </div>
                        <p className={`font-bold text-center text-lg min-h-[30px] flex items-center justify-center ${status === 'success' ? 'text-[#58cc02]' : 'text-gray-700'}`}>
                            {feedback}
                        </p>
                    </div>
                </div>
            </div>
            <div className={`p-4 md:p-6 border-t-2 transition-colors ${status === 'success' ? 'bg-green-100/50 border-green-200' : 'bg-white border-gray-200'}`}>
                <div className="max-w-5xl mx-auto flex justify-between items-center gap-4">
                    <button onClick={onClose} className="uppercase font-bold text-gray-400 hover:text-gray-600 px-4 py-2">다음에 하기</button>
                    <DuoButton variant={status === 'success' ? 'primary' : 'disabled'} disabled={status !== 'success'} className="max-w-[250px]" onClick={onComplete}>
                        {status === 'success' ? '계속하기' : '미션 완료 필요'}
                    </DuoButton>
                </div>
            </div>
        </div>
    );
};
