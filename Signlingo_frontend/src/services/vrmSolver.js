import * as Kalidokit from 'kalidokit';
import * as THREE from 'three';

export const updateVRMWithMediaPipe = (vrm, results, videoWidth, videoHeight) => {
    if (!vrm || !vrm.humanoid) return;

    // We expect results to have { poseLandmarks, faceLandmarks, rightHandLandmarks, leftHandLandmarks }
    // These should be arrays of {x, y, z, visibility}

    // Expose for debugging
    window.__debugVRM = vrm;
    window.__debugResults = results;

    // 1. Pose
    if (results.poseLandmarks && results.poseLandmarks.length > 0) {
        const pose3DLandmarks = results.poseWorldLandmarks || results.poseLandmarks;
        const pose2DLandmarks = results.poseLandmarks;
        
        try {
            const riggedPose = Kalidokit.Pose.solve(pose3DLandmarks[0], pose2DLandmarks[0], {
                runtime: "mediapipe",
                video: { width: videoWidth, height: videoHeight }
            });

            window.__debugRiggedPose = riggedPose;

            if (riggedPose) {
                rigRotation("Hips", riggedPose.Hips.rotation, 0.7, vrm);
                rigPosition("Hips", {
                    x: riggedPose.Hips.position.x,
                    y: riggedPose.Hips.position.y + 1,
                    z: -riggedPose.Hips.position.z
                }, 1, vrm);

                rigRotation("Chest", riggedPose.Spine, 0.25, vrm);
                rigRotation("Spine", riggedPose.Spine, 0.45, vrm);

                rigRotation("RightUpperArm", riggedPose.RightUpperArm, 1, vrm);
                rigRotation("RightLowerArm", riggedPose.RightLowerArm, 1, vrm);
                rigRotation("LeftUpperArm", riggedPose.LeftUpperArm, 1, vrm);
                rigRotation("LeftLowerArm", riggedPose.LeftLowerArm, 1, vrm);

                rigRotation("LeftUpperLeg", riggedPose.LeftUpperLeg, 1, vrm);
                rigRotation("LeftLowerLeg", riggedPose.LeftLowerLeg, 1, vrm);
                rigRotation("RightUpperLeg", riggedPose.RightUpperLeg, 1, vrm);
                rigRotation("RightLowerLeg", riggedPose.RightLowerLeg, 1, vrm);
            }
        } catch(e) {
            console.error("Kalidokit Pose Error:", e);
        }
    }

    // 2. Hands
    if (results.rightHandLandmarks && results.rightHandLandmarks.length > 0) {
        try {
            const riggedRightHand = Kalidokit.Hand.solve(results.rightHandLandmarks[0], "Right");
            window.__debugRiggedRightHand = riggedRightHand;
            if (riggedRightHand) {
                rigRotation("RightHand", {
                    z: riggedRightHand.RightWrist.z,
                    y: riggedRightHand.RightWrist.y,
                    x: riggedRightHand.RightWrist.x
                }, 1, vrm);
                rigRotation("RightRingProximal", riggedRightHand.RightRingProximal, 1, vrm);
                rigRotation("RightRingIntermediate", riggedRightHand.RightRingIntermediate, 1, vrm);
                rigRotation("RightRingDistal", riggedRightHand.RightRingDistal, 1, vrm);
                rigRotation("RightIndexProximal", riggedRightHand.RightIndexProximal, 1, vrm);
                rigRotation("RightIndexIntermediate", riggedRightHand.RightIndexIntermediate, 1, vrm);
                rigRotation("RightIndexDistal", riggedRightHand.RightIndexDistal, 1, vrm);
                rigRotation("RightMiddleProximal", riggedRightHand.RightMiddleProximal, 1, vrm);
                rigRotation("RightMiddleIntermediate", riggedRightHand.RightMiddleIntermediate, 1, vrm);
                rigRotation("RightMiddleDistal", riggedRightHand.RightMiddleDistal, 1, vrm);
                rigRotation("RightThumbProximal", riggedRightHand.RightThumbProximal, 1, vrm);
                rigRotation("RightThumbIntermediate", riggedRightHand.RightThumbIntermediate, 1, vrm);
                rigRotation("RightThumbDistal", riggedRightHand.RightThumbDistal, 1, vrm);
                rigRotation("RightLittleProximal", riggedRightHand.RightLittleProximal, 1, vrm);
                rigRotation("RightLittleIntermediate", riggedRightHand.RightLittleIntermediate, 1, vrm);
                rigRotation("RightLittleDistal", riggedRightHand.RightLittleDistal, 1, vrm);
            }
        } catch (e) {
            console.error("Kalidokit Right Hand Error:", e);
        }
    }

    if (results.leftHandLandmarks && results.leftHandLandmarks.length > 0) {
        try {
            const riggedLeftHand = Kalidokit.Hand.solve(results.leftHandLandmarks[0], "Left");
            if (riggedLeftHand) {
                rigRotation("LeftHand", {
                    z: riggedLeftHand.LeftWrist.z,
                    y: riggedLeftHand.LeftWrist.y,
                    x: riggedLeftHand.LeftWrist.x
                }, 1, vrm);
                rigRotation("LeftRingProximal", riggedLeftHand.LeftRingProximal, 1, vrm);
                rigRotation("LeftRingIntermediate", riggedLeftHand.LeftRingIntermediate, 1, vrm);
                rigRotation("LeftRingDistal", riggedLeftHand.LeftRingDistal, 1, vrm);
                rigRotation("LeftIndexProximal", riggedLeftHand.LeftIndexProximal, 1, vrm);
                rigRotation("LeftIndexIntermediate", riggedLeftHand.LeftIndexIntermediate, 1, vrm);
                rigRotation("LeftIndexDistal", riggedLeftHand.LeftIndexDistal, 1, vrm);
                rigRotation("LeftMiddleProximal", riggedLeftHand.LeftMiddleProximal, 1, vrm);
                rigRotation("LeftMiddleIntermediate", riggedLeftHand.LeftMiddleIntermediate, 1, vrm);
                rigRotation("LeftMiddleDistal", riggedLeftHand.LeftMiddleDistal, 1, vrm);
                rigRotation("LeftThumbProximal", riggedLeftHand.LeftThumbProximal, 1, vrm);
                rigRotation("LeftThumbIntermediate", riggedLeftHand.LeftThumbIntermediate, 1, vrm);
                rigRotation("LeftThumbDistal", riggedLeftHand.LeftThumbDistal, 1, vrm);
                rigRotation("LeftLittleProximal", riggedLeftHand.LeftLittleProximal, 1, vrm);
                rigRotation("LeftLittleIntermediate", riggedLeftHand.LeftLittleIntermediate, 1, vrm);
                rigRotation("LeftLittleDistal", riggedLeftHand.LeftLittleDistal, 1, vrm);
            }
        } catch (e) {
            console.error("Kalidokit Left Hand Error:", e);
        }
    }

    // 3. Face (if implemented later)
};

const rigRotation = (boneName, rotation, dampener = 1, vrm) => {
    if (!vrm || !vrm.humanoid || !rotation) return;
    const normalizedBoneName = boneName.charAt(0).toLowerCase() + boneName.slice(1);
    const Part = vrm.humanoid.getNormalizedBoneNode(normalizedBoneName);
    if (!Part) return;

    let euler = new THREE.Euler(
        rotation.x * dampener,
        rotation.y * dampener,
        rotation.z * dampener
    );
    let quaternion = new THREE.Quaternion().setFromEuler(euler);
    Part.quaternion.slerp(quaternion, 0.5); // Slerp for smooth transition
};

const rigPosition = (boneName, position, dampener = 1, vrm) => {
    if (!vrm || !vrm.humanoid || !position) return;
    const normalizedBoneName = boneName.charAt(0).toLowerCase() + boneName.slice(1);
    const Part = vrm.humanoid.getNormalizedBoneNode(normalizedBoneName);
    if (!Part) return;

    const vector = new THREE.Vector3(
        position.x * dampener,
        position.y * dampener,
        position.z * dampener
    );
    Part.position.lerp(vector, 0.5); // Lerp for smooth transition
};
