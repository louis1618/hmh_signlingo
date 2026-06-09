import { useState, useEffect, useRef } from 'react';
import { Camera, Plus, Trash2, Edit2, Check, Video, Loader2, Save } from 'lucide-react';
import { DuoButton } from '../../components/ui';
import { putItem, deleteItem, getFullCurriculum, deleteVariantsByLesson } from '../../services/dbService';

import { FilesetResolver, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';

const generateId = () => Math.random().toString(36).substr(2, 9);



export const CMSAdmin = () => {
    const [curriculum, setCurriculum] = useState([]);
    const [selectedEntity, setSelectedEntity] = useState(null); // { type: 'chapter' | 'lesson', data: {} }
    const [loading, setLoading] = useState(true);
    const [expandedChapterId, setExpandedChapterId] = useState(null);

    const loadData = async () => {
        setLoading(true);
        const data = await getFullCurriculum();
        setCurriculum(data);
        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    const handleAddChapter = async () => {
        const newChapter = { id: `ch_${generateId()}`, title: "새로운 챕터", order: curriculum.length + 1 };
        await putItem('chapters', newChapter);
        await loadData();
        setSelectedEntity({ type: 'chapter', data: newChapter });
    };

    const handleAddLesson = async (chapterId) => {
        const newLesson = { 
            id: `ls_${generateId()}`, 
            chapterId, 
            title: "새로운 수어", 
            targetSign: "목표 동작", 
            icon: "👋", 
            type: "word", 
            videoUrl: "", 
            description: "" 
        };
        await putItem('lessons', newLesson);
        await loadData();
        setSelectedEntity({ type: 'lesson', data: newLesson });
    };

    const handleSaveEntity = async (updatedData) => {
        const storeName = selectedEntity.type === 'chapter' ? 'chapters' : 'lessons';
        await putItem(storeName, updatedData);
        await loadData();
        setSelectedEntity({ type: selectedEntity.type, data: updatedData });
    };

    const handleDeleteEntity = async () => {
        if (!window.confirm('정말 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) return;
        
        if (selectedEntity.type === 'chapter') {
            const lessons = curriculum.find(c => c.id === selectedEntity.data.id)?.lessons || [];
            for (const l of lessons) {
                await deleteVariantsByLesson(l.id);
                await deleteItem('lessons', l.id);
            }
            await deleteItem('chapters', selectedEntity.data.id);
        } else {
            await deleteVariantsByLesson(selectedEntity.data.id);
            await deleteItem('lessons', selectedEntity.data.id);
        }
        
        setSelectedEntity(null);
        await loadData();
    };

    const handleDeleteLessonItem = async (lessonId) => {
        if (!window.confirm('이 단어를 삭제하시겠습니까?')) return;
        await deleteVariantsByLesson(lessonId);
        await deleteItem('lessons', lessonId);
        await loadData();
    };

    return (
        <div className="flex h-full bg-[#111b21] text-white">
            {/* 왼쪽 사이드바 (커리큘럼 구조) */}
            <div className="w-80 border-r border-gray-800 flex flex-col bg-[#1a262e]">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#111b21]">
                    <h2 className="font-black text-lg">커리큘럼 관리 (CMS)</h2>
                    <button onClick={handleAddChapter} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-[#58cc02]" title="새 챕터 추가">
                        <Plus size={20} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin text-gray-500" /></div>
                    ) : curriculum.length === 0 ? (
                        <div className="text-gray-500 text-center text-sm">챕터가 없습니다. + 버튼을 눌러 추가하세요.</div>
                    ) : (
                        curriculum.map(ch => (
                            <div key={ch.id} className="shrink-0 bg-black/20 rounded-xl border border-gray-800 overflow-hidden mb-2">
                                <div 
                                    className={`p-3 flex justify-between items-center cursor-pointer hover:bg-gray-800/50 transition-colors ${selectedEntity?.data?.id === ch.id ? 'bg-gray-800 border-l-4 border-[#58cc02]' : ''}`}
                                    onClick={() => {
                                        setSelectedEntity({ type: 'chapter', data: ch });
                                        setExpandedChapterId(prev => prev === ch.id ? null : ch.id);
                                    }}
                                >
                                    <span className="font-bold text-sm truncate pr-2">{ch.title}</span>
                                <button onClick={(e) => { e.stopPropagation(); handleAddLesson(ch.id); }} className="text-gray-500 hover:text-[#1cb0f6]"><Plus size={16} /></button>
                                </div>
                                {expandedChapterId === ch.id && (
                                    <div className="flex flex-col border-t border-gray-800/50 max-h-80 overflow-y-auto">
                                        {ch.lessons.map(ls => (
                                            <div 
                                                key={ls.id} 
                                                className={`p-2 pl-6 text-sm flex justify-between items-center cursor-pointer hover:bg-gray-800/50 ${selectedEntity?.data?.id === ls.id ? 'bg-gray-800 border-l-2 border-[#1cb0f6] text-white font-bold' : 'text-gray-400'}`}
                                                onClick={() => setSelectedEntity({ type: 'lesson', data: ls })}
                                            >
                                                <span className="truncate pr-2">{ls.icon} {ls.title}</span>
                                                <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full">{ls.variants?.length || 0} variants</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* 오른쪽 에디터 */}
            <div className="flex-1 overflow-y-auto bg-[#111b21] flex flex-col">
                {!selectedEntity ? (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        좌측 메뉴에서 챕터나 레슨을 선택해주세요.
                    </div>
                ) : (
                    <div className="p-8 max-w-4xl mx-auto w-full flex flex-col gap-6">
                        <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-800">
                            <h2 className="text-2xl font-black text-white">
                                {selectedEntity.type === 'chapter' ? '챕터 설정' : '레슨(수어) 설정 및 녹화'}
                            </h2>
                            <button onClick={handleDeleteEntity} className="flex items-center gap-2 text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-xl transition-colors font-bold">
                                <Trash2 size={18} /> 삭제
                            </button>
                        </div>

                        {selectedEntity.type === 'chapter' ? (
                            <ChapterEditor 
                                chapter={curriculum.find(c => c.id === selectedEntity.data.id) || selectedEntity.data} 
                                onSave={handleSaveEntity} 
                                onAddLesson={handleAddLesson}
                                onEditLesson={(ls) => setSelectedEntity({ type: 'lesson', data: ls })}
                                onDeleteLesson={handleDeleteLessonItem}
                            />
                        ) : (
                            <LessonEditor lesson={selectedEntity.data} onSave={handleSaveEntity} onVariantSaved={loadData} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const ChapterEditor = ({ chapter, onSave, onAddLesson, onEditLesson, onDeleteLesson }) => {
    const [title, setTitle] = useState(chapter.title);
    const [order, setOrder] = useState(chapter.order);

    useEffect(() => { setTitle(chapter.title); setOrder(chapter.order); }, [chapter]);

    const handleSave = () => onSave({ ...chapter, title, order });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <label className="text-gray-400 text-sm font-bold">챕터명</label>
                <input value={title} onChange={e => setTitle(e.target.value)} className="bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl focus:border-[#1cb0f6] outline-none" />
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-gray-400 text-sm font-bold">정렬 순서</label>
                <input type="number" value={order} onChange={e => setOrder(Number(e.target.value))} className="bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl focus:border-[#1cb0f6] outline-none" />
            </div>
            <DuoButton onClick={handleSave} className="w-48 mt-4"><Save size={18} /> 저장하기</DuoButton>

            <div className="mt-8 border-t border-gray-800 pt-8">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white">이 챕터의 단어 목록 ({chapter.lessons?.length || 0}개)</h3>
                    <button onClick={() => onAddLesson(chapter.id)} className="flex items-center gap-2 bg-[#1cb0f6] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#1899d6] transition-colors">
                        <Plus size={16} /> 단어 추가
                    </button>
                </div>
                
                <div className="bg-[#1a262e] rounded-2xl border border-gray-800 overflow-hidden">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-gray-800 text-gray-300 font-bold">
                            <tr>
                                <th className="px-4 py-3">아이콘</th>
                                <th className="px-4 py-3">단어명 (표시용)</th>
                                <th className="px-4 py-3">타겟(엔진용)</th>
                                <th className="px-4 py-3">데이터</th>
                                <th className="px-4 py-3 text-right">관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            {chapter.lessons?.length === 0 ? (
                                <tr><td colSpan="5" className="px-4 py-8 text-center text-gray-500">단어가 없습니다.</td></tr>
                            ) : (
                                chapter.lessons?.map(ls => (
                                    <tr key={ls.id} className="border-t border-gray-800 hover:bg-gray-800/50 transition-colors">
                                        <td className="px-4 py-3 text-xl">{ls.icon}</td>
                                        <td className="px-4 py-3 font-bold text-white">{ls.title}</td>
                                        <td className="px-4 py-3 font-mono text-xs">{ls.targetSign}</td>
                                        <td className="px-4 py-3"><span className="bg-gray-800 px-2 py-1 rounded text-xs">{ls.variants?.length || 0} variants</span></td>
                                        <td className="px-4 py-3 flex justify-end gap-2">
                                            <button onClick={() => onEditLesson(ls)} className="p-2 text-[#1cb0f6] hover:bg-[#1cb0f6]/20 rounded-lg" title="수정"><Edit2 size={16} /></button>
                                            <button onClick={() => onDeleteLesson(ls.id)} className="p-2 text-red-500 hover:bg-red-500/20 rounded-lg" title="삭제"><Trash2 size={16} /></button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const LessonEditor = ({ lesson, onSave, onVariantSaved }) => {
    const [formData, setFormData] = useState({ ...lesson });

    useEffect(() => { setFormData({ ...lesson }); }, [lesson]);

    const handleSave = () => onSave(formData);

    return (
        <div className="flex flex-col gap-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#1a262e] p-6 rounded-3xl border border-gray-800">
                <div className="flex flex-col gap-2">
                    <label className="text-gray-400 text-sm font-bold">제목</label>
                    <input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl" />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-gray-400 text-sm font-bold">목표 기호 (표시용)</label>
                    <input value={formData.targetSign} onChange={e => setFormData({...formData, targetSign: e.target.value})} className="bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl" />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-gray-400 text-sm font-bold">아이콘 (이모지)</label>
                    <input value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} className="bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl" />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-gray-400 text-sm font-bold">시범 영상 URL (GIF/MP4)</label>
                    <input value={formData.videoUrl} onChange={e => setFormData({...formData, videoUrl: e.target.value})} placeholder="https://..." className="bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl" />
                </div>
                <div className="flex flex-col gap-2 md:col-span-2">
                    <label className="text-gray-400 text-sm font-bold">동작 설명 (이 데이터를 바탕으로 자동 피드백 제공)</label>
                    <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} rows={3} className="bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl resize-none" />
                </div>
                <div className="md:col-span-2 flex justify-end">
                    <DuoButton onClick={handleSave} className="w-48"><Save size={18} /> 레슨 정보 저장</DuoButton>
                </div>
            </div>

            {/* 다중 시퀀스 녹화 스튜디오 */}
            <VariantStudio lesson={lesson} onVariantSaved={onVariantSaved} />
        </div>
    );
};

const VariantStudio = ({ lesson, onVariantSaved }) => {
    const [status, setStatus] = useState('loading_model'); // loading_model, ready, countdown, recording
    const [countdown, setCountdown] = useState(3);
    
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const handsRef = useRef(null);
    const cameraRef = useRef(null);
    
    const currentMultiHandLandmarksRef = useRef(null);
    const currentMultiHandednessRef = useRef(null);
    const sequenceBufferRef = useRef([]);
    const initialWristsRef = useRef({ left: null, right: null }); // 이동 궤적 보존용 영점 좌표

    const poseLandmarkerRef = useRef(null);
    const handLandmarkerRef = useRef(null);
    const requestRef = useRef(null);
    const lastVideoTimeRef = useRef(-1);

    const drawLandmarks = (ctx, poseLm, leftHandLm, rightHandLm) => {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        const drawPoints = (landmarks, color, radius = 3) => {
            if (!landmarks) return;
            ctx.fillStyle = color;
            for (const lm of landmarks) {
                ctx.beginPath();
                ctx.arc(lm.x * ctx.canvas.width, lm.y * ctx.canvas.height, radius, 0, 2 * Math.PI);
                ctx.fill();
            }
        };

        if (poseLm) {
            const upperIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24];
            ctx.fillStyle = '#6366f1';
            for (const i of upperIndices) {
                if (poseLm[i]) {
                    ctx.beginPath();
                    ctx.arc(poseLm[i].x * ctx.canvas.width, poseLm[i].y * ctx.canvas.height, 5, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
            const connections = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24]];
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
            ctx.lineWidth = 2;
            for (const [a, b] of connections) {
                if (poseLm[a] && poseLm[b]) {
                    ctx.beginPath();
                    ctx.moveTo(poseLm[a].x * ctx.canvas.width, poseLm[a].y * ctx.canvas.height);
                    ctx.lineTo(poseLm[b].x * ctx.canvas.width, poseLm[b].y * ctx.canvas.height);
                    ctx.stroke();
                }
            }
        }

        drawPoints(leftHandLm, '#22d3ee', 3);
        drawPoints(rightHandLm, '#f472b6', 3);
    };

    const processFrame = () => {
        if (!videoRef.current || status === 'loading_model') {
            requestRef.current = requestAnimationFrame(processFrame);
            return;
        }

        const video = videoRef.current;
        if (video.videoWidth === 0) {
            requestRef.current = requestAnimationFrame(processFrame);
            return;
        }

        const now = performance.now();
        if (lastVideoTimeRef.current !== video.currentTime) {
            lastVideoTimeRef.current = video.currentTime;

            if (poseLandmarkerRef.current && handLandmarkerRef.current) {
                const poseResult = poseLandmarkerRef.current.detectForVideo(video, now);
                const handResult = handLandmarkerRef.current.detectForVideo(video, now);

                const poseLm = poseResult.landmarks?.[0] || null;
                let leftHandLm = null, rightHandLm = null;

                if (handResult.landmarks && poseLm) {
                    const hands = handResult.landmarks;
                    if (hands.length === 1) {
                        const pLWrist = poseLm[15];
                        const pRWrist = poseLm[16];
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

                if (canvasRef.current) {
                    const ctx = canvasRef.current.getContext('2d');
                    ctx.canvas.width = video.videoWidth;
                    ctx.canvas.height = video.videoHeight;
                    drawLandmarks(ctx, poseLm, leftHandLm, rightHandLm);
                }

                // If recording, push to buffer
                if (status === 'recording' && sequenceBufferRef.current) {
                    sequenceBufferRef.current.push({
                        hasData: true,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight,
                        poseLandmarks: poseResult.landmarks,
                        poseWorldLandmarks: poseResult.worldLandmarks,
                        leftHandLandmarks: leftHandLm ? [leftHandLm] : [],
                        rightHandLandmarks: rightHandLm ? [rightHandLm] : []
                    });
                }
            }
        }
        requestRef.current = requestAnimationFrame(processFrame);
    };

    useEffect(() => {
        let isComponentMounted = true;
        const initMediaPipe = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
                );

                if (!isComponentMounted) return;

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

                if (!isComponentMounted) return;
                setStatus('ready');

                navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }).then((stream) => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        videoRef.current.play();
                    }
                });

                requestRef.current = requestAnimationFrame(processFrame);

            } catch (err) {
                console.error(err);
            }
        };
        initMediaPipe();

        return () => {
            isComponentMounted = false;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
        };
    }, []);

    useEffect(() => {
        let cdInterval;
        let recordInterval;

        if (status === 'countdown') {
            setCountdown(3);
            sequenceBufferRef.current = [];
            initialWristsRef.current = { left: null, right: null };

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
            // 다중 데이터 수집 (최대 100프레임 혹은 수동 중지)
            // 여기서는 3초간 약 90프레임 수집
            setTimeout(async () => {
                setStatus('ready');
                
                // DB에 새 Variant 저장
                const newVariant = {
                    id: `var_${generateId()}`,
                    lessonId: lesson.id,
                    sequenceData: sequenceBufferRef.current,
                    created_at: new Date().toISOString()
                };
                await putItem('variants', newVariant);
                onVariantSaved(); // 상위 컴포넌트 데이터 갱신 요청
                alert("새로운 전신/손 동작 Variant 데이터가 성공적으로 누적 저장되었습니다!");
            }, 3000); // 3초간 녹화
        }

        return () => {
            clearInterval(cdInterval);
        };
    }, [status, lesson.id, onVariantSaved]);

    const handleStartRecording = () => setStatus('countdown');

    const handleDeleteVariant = async (variantId) => {
        if (!window.confirm("이 Variant 녹화본을 삭제하시겠습니까?")) return;
        await deleteItem('variants', variantId);
        onVariantSaved();
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-end border-b border-gray-800 pb-2">
                <div>
                    <h3 className="text-xl font-black text-white flex items-center gap-2">
                        <Video className="text-[#58cc02]" /> 다중 데이터(Variants) 녹화 스튜디오
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">이동 궤적이 보존됩니다. 동일한 동작을 3~5번 반복 녹화하여 인식률(Robustness)을 높이세요.</p>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 bg-black rounded-3xl overflow-hidden relative border-4 border-gray-800 aspect-video">
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
                                <div className="w-3 h-3 bg-white rounded-full"></div> 궤적 녹화중...
                            </div>
                        </div>
                    )}

                    {(status === 'ready' || status === 'loading_model') && (
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-3/4 max-w-sm">
                            <DuoButton onClick={handleStartRecording} disabled={status === 'loading_model'} className="w-full shadow-2xl border-white/20">
                                <Camera size={20} /> 3초 후 데이터 누적 녹화 시작
                            </DuoButton>
                        </div>
                    )}
                </div>

                <div className="w-full lg:w-80 flex flex-col gap-3">
                    <div className="bg-[#1a262e] border border-gray-800 rounded-2xl p-4 font-bold text-gray-300">
                        현재 누적된 데이터: <span className="text-[#1cb0f6] text-xl">{lesson.variants?.length || 0}</span> 개
                    </div>
                    <div className="flex-1 overflow-y-auto flex flex-col gap-2 max-h-[300px]">
                        {lesson.variants?.map((v, i) => (
                            <div key={v.id} className="bg-gray-800 rounded-xl p-3 flex justify-between items-center text-sm border border-gray-700">
                                <div>
                                    <div className="text-white font-bold">Variant #{i + 1}</div>
                                    <div className="text-gray-500 text-xs">{new Date(v.created_at).toLocaleTimeString()} ({v.sequenceData.length} frames)</div>
                                </div>
                                <button onClick={() => handleDeleteVariant(v.id)} className="text-red-500 hover:text-red-400 p-2"><Trash2 size={16} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
