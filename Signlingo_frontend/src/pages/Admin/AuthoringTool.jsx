import React, { useState, useEffect, useRef } from 'react';
import { Camera, Copy, Check, Loader2, Video } from 'lucide-react';
import { DuoButton } from '../../components/ui';
import { extractPoseSnapshot } from '../../services/mediapipeEngine';

const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
});

export const AuthoringTool = () => {
    const [snapshot, setSnapshot] = useState(null);
    const [status, setStatus] = useState('loading_model'); // loading_model, ready, countdown, recording
    const [countdown, setCountdown] = useState(3);
    const [copied, setCopied] = useState(false);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const handsRef = useRef(null);
    const cameraRef = useRef(null);
    
    const currentMultiHandLandmarksRef = useRef(null);
    const currentMultiHandednessRef = useRef(null);
    
    // 시퀀스 저장을 위한 버퍼
    const sequenceBufferRef = useRef([]);

    const drawLandmarks = (ctx, landmarks) => {
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [5, 9], [9, 10], [10, 11], [11, 12],
            [9, 13], [13, 14], [14, 15], [15, 16],
            [13, 17], [17, 18], [18, 19], [19, 20],
            [0, 17]
        ];

        ctx.strokeStyle = '#58cc02'; ctx.lineWidth = 4;
        connections.forEach(([i, j]) => {
            ctx.beginPath();
            ctx.moveTo(landmarks[i].x * ctx.canvas.width, landmarks[i].y * ctx.canvas.height);
            ctx.lineTo(landmarks[j].x * ctx.canvas.width, landmarks[j].y * ctx.canvas.height);
            ctx.stroke();
        });
        ctx.fillStyle = '#1cb0f6';
        landmarks.forEach((point) => {
            ctx.beginPath();
            ctx.arc(point.x * ctx.canvas.width, point.y * ctx.canvas.height, 5, 0, 2 * Math.PI);
            ctx.fill();
        });
    };

    useEffect(() => {
        let isComponentMounted = true;
        const initMediaPipe = async () => {
            try {
                await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
                await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
                if (!isComponentMounted) return;

                const hands = new window.Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
                // 양손 추적을 위해 maxNumHands: 2 로 설정
                hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });

                hands.onResults((results) => {
                    if (!isComponentMounted) return;
                    if (canvasRef.current && videoRef.current) {
                        const ctx = canvasRef.current.getContext('2d');
                        ctx.canvas.width = videoRef.current.videoWidth;
                        ctx.canvas.height = videoRef.current.videoHeight;
                        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

                        currentMultiHandLandmarksRef.current = results.multiHandLandmarks;
                        currentMultiHandednessRef.current = results.multiHandedness;

                        if (results.multiHandLandmarks) {
                            results.multiHandLandmarks.forEach(landmarks => drawLandmarks(ctx, landmarks));
                        }
                    }
                });

                handsRef.current = hands;
                setStatus('ready');

                navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }).then((stream) => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        cameraRef.current = new window.Camera(videoRef.current, {
                            onFrame: async () => {
                                if (handsRef.current && isComponentMounted) {
                                    await handsRef.current.send({ image: videoRef.current });
                                }
                            }, width: 640, height: 480
                        });
                        cameraRef.current.start();
                    }
                });
            } catch (err) {
                console.error(err);
            }
        };
        initMediaPipe();

        return () => {
            isComponentMounted = false;
            if (cameraRef.current) cameraRef.current.stop();
            if (handsRef.current) handsRef.current.close();
            if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
        };
    }, []);

    // 시퀀스 녹화 로직
    useEffect(() => {
        let cdInterval;
        let recordInterval;

        if (status === 'countdown') {
            setCountdown(3);
            sequenceBufferRef.current = [];
            cdInterval = setInterval(() => {
                setCountdown(prev => {
                    if (prev <= 1) {
                        clearInterval(cdInterval);
                        setStatus('recording');
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }

        if (status === 'recording') {
            let framesCaptured = 0;
            // 초당 10프레임씩 총 2초 (20프레임) 추출
            recordInterval = setInterval(() => {
                const snapshot = extractPoseSnapshot(currentMultiHandLandmarksRef.current, currentMultiHandednessRef.current);
                sequenceBufferRef.current.push(snapshot);
                framesCaptured++;

                if (framesCaptured >= 20) {
                    clearInterval(recordInterval);
                    setSnapshot(sequenceBufferRef.current);
                    setCopied(false);
                    setStatus('ready');
                }
            }, 100);
        }

        return () => {
            clearInterval(cdInterval);
            clearInterval(recordInterval);
        };
    }, [status]);

    const handleStartRecording = () => setStatus('countdown');

    const handleCopy = () => {
        if (snapshot) {
            navigator.clipboard.writeText(JSON.stringify(snapshot));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#111b21] overflow-y-auto">
            <div className="px-6 py-4 flex justify-between items-center bg-[#111b21] text-white border-b border-gray-800">
                <h2 className="text-xl font-black tracking-wide flex items-center gap-2">
                    <Video className="text-[#58cc02]" /> 수어 정답 데이터 생성기 (Authoring Tool)
                </h2>
            </div>

            <div className="flex-1 p-6 flex flex-col md:flex-row gap-6 max-w-6xl mx-auto w-full">
                
                <div className="flex-1 flex flex-col gap-4">
                    <div className="bg-black rounded-3xl overflow-hidden relative border-4 border-gray-800 aspect-video md:aspect-auto flex-1">
                        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 opacity-60" />
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 pointer-events-none" />
                        
                        {status === 'loading_model' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-8 text-white font-bold">
                                <Loader2 className="animate-spin mb-4 text-[#58cc02]" size={40} />MediaPipe 로딩중...
                            </div>
                        )}
                        
                        {status === 'countdown' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white font-black text-8xl animate-pulse">
                                {countdown}
                            </div>
                        )}

                        {status === 'recording' && (
                            <div className="absolute inset-0 border-8 border-red-500 bg-red-500/10 flex items-center justify-center">
                                <div className="absolute top-4 right-4 bg-red-500 text-white font-bold px-4 py-2 rounded-full animate-pulse flex items-center gap-2">
                                    <div className="w-3 h-3 bg-white rounded-full"></div> 녹화중...
                                </div>
                            </div>
                        )}

                        {(status === 'ready' || status === 'loading_model') && (
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                                <DuoButton onClick={handleStartRecording} disabled={status === 'loading_model'} className="px-8 shadow-xl">
                                    <Camera size={20} /> 3초 후 시퀀스 녹화 시작 (2초 분량)
                                </DuoButton>
                            </div>
                        )}
                    </div>
                </div>

                <div className="w-full md:w-96 flex flex-col gap-4">
                    <div className="bg-[#1a262e] border-2 border-gray-800 rounded-3xl p-6 flex-1 flex flex-col">
                        <h3 className="text-white font-black text-lg mb-4 flex justify-between items-center">
                            생성된 시퀀스 데이터 (JSON)
                            {snapshot && (
                                <button onClick={handleCopy} className={`p-2 rounded-xl transition-colors ${copied ? 'bg-[#58cc02] text-white' : 'bg-white/10 text-gray-400 hover:text-white'}`}>
                                    {copied ? <Check size={18} /> : <Copy size={18} />}
                                </button>
                            )}
                        </h3>
                        
                        <div className="flex-1 bg-black/50 rounded-2xl p-4 overflow-y-auto font-mono text-sm text-[#58cc02]">
                            {snapshot ? (
                                <div>
                                    <div className="text-white mb-2">Total Frames: {snapshot.length}</div>
                                    <pre>{JSON.stringify(snapshot, null, 2)}</pre>
                                </div>
                            ) : (
                                <div className="text-gray-500 h-full flex items-center justify-center text-center">
                                    카메라 앞에서 동작을 취한 뒤<br/>캡처 버튼을 누르세요.
                                </div>
                            )}
                        </div>

                        {snapshot && (
                            <p className="text-gray-400 text-sm mt-4 text-center">
                                이 JSON 데이터를 <br/><span className="text-white bg-white/10 px-2 py-1 rounded">curriculum.js</span>의 <span className="text-[#1cb0f6]">sequenceRules</span> 에 붙여넣으세요.
                            </p>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};
