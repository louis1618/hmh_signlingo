/**
 * MediaPipe 양손 정규화 및 다중 데이터(Variants) 기반 마일스톤 엔진
 */

export const normalizeHand = (landmarks, initialWrist) => {
    if (!landmarks || landmarks.length === 0) return null;
    
    const wrist = landmarks[0];
    const middleMCP = landmarks[9];
    
    const dx = middleMCP.x - wrist.x;
    const dy = middleMCP.y - wrist.y;
    const dz = middleMCP.z - wrist.z;
    const scale = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    // 이동 궤적 보존: 첫 프레임 손목 영점화. 객체 참조 방지를 위해 값만 사용.
    const refWrist = initialWrist ? { x: initialWrist.x, y: initialWrist.y, z: initialWrist.z } : wrist;

    return landmarks.map(lm => ({
        x: (lm.x - refWrist.x) / scale,
        y: (lm.y - refWrist.y) / scale,
        z: (lm.z - refWrist.z) / scale
    }));
};

export const extractPoseSnapshot = (multiHandLandmarks, multiHandedness, initialWrists = { left: null, right: null }) => {
    let leftHand = null;
    let rightHand = null;

    if (multiHandLandmarks && multiHandedness) {
        multiHandLandmarks.forEach((landmarks, index) => {
            const label = multiHandedness[index].label; 
            if (label === 'Left') {
                leftHand = normalizeHand(landmarks, initialWrists.left);
            }
            if (label === 'Right') {
                rightHand = normalizeHand(landmarks, initialWrists.right);
            }
        });
    }

    return { leftHand, rightHand };
};

const calculateHandDistance = (handA, handB) => {
    if (!handA && !handB) return { dist: 0, worstLandmark: -1 };
    if (!handA || !handB) return { dist: 999, worstLandmark: -1 };

    let sum = 0;
    let maxDist = 0;
    let worstLandmark = -1;

    for (let i = 0; i < 21; i++) {
        const dx = handA[i].x - handB[i].x;
        const dy = handA[i].y - handB[i].y;
        const dz = handA[i].z - handB[i].z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        sum += dist;
        if (dist > maxDist) {
            maxDist = dist;
            worstLandmark = i;
        }
    }
    return { dist: sum / 21, worstLandmark };
};

const getFingerName = (index) => {
    if (index >= 1 && index <= 4) return "엄지손가락";
    if (index >= 5 && index <= 8) return "검지손가락";
    if (index >= 9 && index <= 12) return "중지손가락";
    if (index >= 13 && index <= 16) return "약지손가락";
    if (index >= 17 && index <= 20) return "새끼손가락";
    return "손의 이동 궤적";
};

export const evaluateSequenceState = (currentState, targetState) => {
    if (!targetState) return { score: 0, feedback: "평가 규칙 없음" };

    const leftEval = calculateHandDistance(currentState.leftHand, targetState.leftHand);
    const rightEval = calculateHandDistance(currentState.rightHand, targetState.rightHand);

    if (leftEval.dist === 0 && rightEval.dist === 0 && !targetState.leftHand && !targetState.rightHand) {
        return { score: 0, feedback: "목표 동작을 찾을 수 없습니다." };
    }

    let validHandsCount = 0;
    let totalScore = 0;
    let worstIssues = [];

    // 허용 오차를 매우 넓게 잡아(2.5) 속도, 카메라 각도, 떨림 등 포용력을 극대화합니다.
    const distToScore = (dist) => Math.max(0, 100 - (dist / 2.5) * 100);

    // 타겟에 왼손이 요구되는 경우
    if (targetState.leftHand) {
        const score = distToScore(leftEval.dist);
        totalScore += score;
        validHandsCount++;
        if (score < 55 && leftEval.worstLandmark !== -1) {
            worstIssues.push(`왼손 ${getFingerName(leftEval.worstLandmark)}`);
        }
    } 

    // 타겟에 오른손이 요구되는 경우
    if (targetState.rightHand) {
        const score = distToScore(rightEval.dist);
        totalScore += score;
        validHandsCount++;
        if (score < 55 && rightEval.worstLandmark !== -1) {
            worstIssues.push(`오른손 ${getFingerName(rightEval.worstLandmark)}`);
        }
    }

    let finalScore = validHandsCount > 0 ? Math.round(totalScore / validHandsCount) : 0;
    finalScore = Math.max(0, Math.min(100, finalScore));

    let feedback = finalScore >= 55 ? "좋습니다! 계속 이어서 동작하세요." : 
        (worstIssues.length > 0 ? `${worstIssues[0]}의 위치나 모양이 엇나갔습니다.` : "시범 영상의 궤적을 똑같이 따라해보세요.");

    return { score: finalScore, feedback };
};

/**
 * 유연한 마일스톤 점프 트래커 (Robust Milestone Jumper)
 */
export const createMultiVariantTracker = (variants) => {
    // 20프레임을 6개의 마일스톤으로 압축 (너무 적으면 궤적 확인 불가, 너무 많으면 통과 어려움)
    const extractMilestones = (sequence) => {
        if (sequence.length <= 6) return sequence;
        const milestones = [];
        const numMilestones = 6;
        for (let i = 0; i < numMilestones; i++) {
            const index = Math.floor((i / (numMilestones - 1)) * (sequence.length - 1));
            milestones.push(sequence[index]);
        }
        return milestones;
    };

    const trackers = variants.map(v => ({
        targetSequence: extractMilestones(v.sequenceData),
        currentIndex: 0,
        completed: false
    }));

    return {
        evaluateFrame: (currentState) => {
            let maxProgress = 0;
            let bestFeedback = "동작을 시작해주세요.";

            trackers.forEach(tracker => {
                if (tracker.completed || tracker.targetSequence.length === 0) return;
                
                // 유연성을 위해 현재 인덱스와 '다음, 다다음' 인덱스까지 열어두고 검사 (최대 2개 스킵 허용)
                // 이를 통해 학습자가 동작을 빠르게 수행하여 중간 프레임이 생략되더라도 통과를 인정합니다.
                let bestMatchIndex = -1;
                let bestMatchScore = 0;
                let bestMatchFeedback = "";

                for (let skip = 0; skip <= 2; skip++) {
                    const testIndex = tracker.currentIndex + skip;
                    if (testIndex >= tracker.targetSequence.length) break;
                    
                    const targetState = tracker.targetSequence[testIndex];
                    const evaluation = evaluateSequenceState(currentState, targetState);
                    
                    // 점수가 50점 이상이면 일단 매치 가능성으로 둠 (임계값 대폭 낮춤)
                    if (evaluation.score >= 50 && evaluation.score > bestMatchScore) {
                        bestMatchScore = evaluation.score;
                        bestMatchIndex = testIndex;
                        bestMatchFeedback = evaluation.feedback;
                    }
                }

                if (bestMatchIndex !== -1) {
                    tracker.currentIndex = bestMatchIndex + 1; // 매치된 마일스톤 다음 단계로 점프
                    if (tracker.currentIndex >= tracker.targetSequence.length) {
                        tracker.completed = true;
                    }
                    bestFeedback = bestMatchFeedback;
                } else {
                    // 현재 검사 중인 타겟에 대한 피드백을 보여줌
                    const currentEval = evaluateSequenceState(currentState, tracker.targetSequence[tracker.currentIndex]);
                    if (tracker.currentIndex / tracker.targetSequence.length >= maxProgress / 100) {
                        bestFeedback = currentEval.feedback;
                    }
                }

                const progress = Math.round((tracker.currentIndex / tracker.targetSequence.length) * 100);
                if (progress > maxProgress) maxProgress = progress;
            });

            return {
                progress: maxProgress,
                feedback: maxProgress >= 100 ? "완벽합니다! 훌륭해요! 🎉" : bestFeedback,
                isCompleted: maxProgress >= 100
            };
        }
    };
};

// ============================================================
// Joint mapping: MediaPipe → same normalized format as training
// ============================================================
const MP_NOSE = 0;
const MP_LSHOULDER = 11;
const MP_RSHOULDER = 12;
const MP_LELBOW = 13;
const MP_RELBOW = 14;
const MP_LWRIST = 15;
const MP_RWRIST = 16;
const MP_LHIP = 23;
const MP_RHIP = 24;

const HIGH_MOTION_THRESHOLD = 2.0;  // Fast hand movement → more frequent inference
const LOW_MOTION_THRESHOLD = 0.5;   // Slow/no movement → less frequent inference
const WINDOW_STRIDE = 15; // Slide window every 0.5 seconds

export function computeAdaptiveStride(buffer) {
    if (buffer.length < 2) return WINDOW_STRIDE;
    const last = buffer[buffer.length - 1];
    const prev = buffer[buffer.length - 2];
    let energy = 0;
    for (let i = 0; i < last.length; i++) {
        energy += (last[i] - prev[i]) ** 2;
    }
    energy = Math.sqrt(energy);
    if (energy > HIGH_MOTION_THRESHOLD) return 8;
    if (energy > LOW_MOTION_THRESHOLD) return WINDOW_STRIDE;
    return 25;
}

export function extractAndNormalize(poseLandmarks, leftHandLandmarks, rightHandLandmarks, vW, vH) {
    if (!poseLandmarks || poseLandmarks.length === 0) return null;

    const lm = poseLandmarks;

    const joints = [
        [lm[MP_NOSE].x * vW, lm[MP_NOSE].y * vH],
        [lm[MP_RSHOULDER].x * vW, lm[MP_RSHOULDER].y * vH],
        [lm[MP_RELBOW].x * vW, lm[MP_RELBOW].y * vH],
        [lm[MP_RWRIST].x * vW, lm[MP_RWRIST].y * vH],
        [lm[MP_LSHOULDER].x * vW, lm[MP_LSHOULDER].y * vH],
        [lm[MP_LELBOW].x * vW, lm[MP_LELBOW].y * vH],
        [lm[MP_LWRIST].x * vW, lm[MP_LWRIST].y * vH],
    ];

    const neck = [
        (joints[1][0] + joints[4][0]) / 2,
        (joints[1][1] + joints[4][1]) / 2,
    ];
    joints.splice(1, 0, neck); 

    const leftHand = [];
    const rightHand = [];
    for (let i = 0; i < 21; i++) {
        if (leftHandLandmarks && leftHandLandmarks[i]) {
            const hWristX = leftHandLandmarks[0].x * vW;
            const hWristY = leftHandLandmarks[0].y * vH;
            const offsetX = joints[7][0] - hWristX;
            const offsetY = joints[7][1] - hWristY;
            leftHand.push([
                (leftHandLandmarks[i].x * vW) + offsetX, 
                (leftHandLandmarks[i].y * vH) + offsetY
            ]);
        } else {
            leftHand.push([joints[7][0], joints[7][1]]);
        }
        if (rightHandLandmarks && rightHandLandmarks[i]) {
            const hWristX = rightHandLandmarks[0].x * vW;
            const hWristY = rightHandLandmarks[0].y * vH;
            const offsetX = joints[4][0] - hWristX;
            const offsetY = joints[4][1] - hWristY;
            rightHand.push([
                (rightHandLandmarks[i].x * vW) + offsetX, 
                (rightHandLandmarks[i].y * vH) + offsetY
            ]);
        } else {
            rightHand.push([joints[4][0], joints[4][1]]);
        }
    }

    const midHip = [
        (lm[MP_LHIP].x * vW + lm[MP_RHIP].x * vW) / 2,
        (lm[MP_LHIP].y * vH + lm[MP_RHIP].y * vH) / 2
    ];

    let torsoSize = Math.sqrt((neck[0] - midHip[0]) ** 2 + (neck[1] - midHip[1]) ** 2);
    if (torsoSize < 1e-6) {
        torsoSize = Math.sqrt((joints[2][0] - joints[5][0]) ** 2 + (joints[2][1] - joints[5][1]) ** 2);
    }
    if (torsoSize < 1e-6) torsoSize = 1.0;

    const allJoints = [...joints, ...leftHand, ...rightHand]; 
    const features = [];
    for (const [x, y] of allJoints) {
        features.push((x - neck[0]) / torsoSize);
        features.push((y - neck[1]) / torsoSize);
    }

    return features; 
}
