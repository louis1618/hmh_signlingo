import os
import json
import pickle
import numpy as np
from tqdm import tqdm

def main():
    backend_dir = os.path.dirname(__file__)
    cache_path = os.path.join(backend_dir, 'dataset_cache.pkl')
    bin_path = os.path.join(backend_dir, 'dataset_features.bin')
    curr_path = os.path.join(backend_dir, 'curriculum.json')

    print("Loading cache...")
    with open(cache_path, 'rb') as f:
        cache = pickle.load(f)
    
    samples = cache['samples']
    total_sequences = cache['total_sequences']
    word_to_idx = cache['word_to_idx']
    
    print("Loading curriculum...")
    with open(curr_path, 'r', encoding='utf-8') as f:
        curriculum = json.load(f)

    # Find one representative sequence for each word
    word_to_sample_idx = {}
    for i, s in enumerate(samples):
        w = s['word']
        if w not in word_to_sample_idx:
            word_to_sample_idx[w] = i

    print("Loading features memmap...")
    features_mmap = np.memmap(
        bin_path, 
        dtype=np.float32, 
        mode='r', 
        shape=(total_sequences, 60, 100)
    )

    print("Converting and populating curriculum...")
    for item in tqdm(curriculum):
        word = item['targetSign']
        if word in word_to_sample_idx:
            seq_idx = word_to_sample_idx[word]
            feat_seq = features_mmap[seq_idx] # shape (60, 100)
            
            sequence_data = []
            for frame in feat_seq:
                # Reconstruct pseudo-MediaPipe format
                # Features: 0-15: 8 pose joints (x,y)
                # 16-57: left hand 21 joints (x,y)
                # 58-99: right hand 21 joints (x,y)
                
                # Check if frame is empty
                if np.sum(np.abs(frame)) < 1e-5:
                    continue

                pose_landmarks = [{"x": 0, "y": 0, "z": 0, "visibility": 0} for _ in range(33)]
                
                def set_pose(mp_idx, op_idx):
                    # In dataset_features.bin, coords are centered around neck and scaled
                    # MediaPipe coords are usually 0..1 in screen space
                    # We'll just map them directly with a rough offset
                    x = float(frame[op_idx*2]) * 0.5 + 0.5
                    y = float(frame[op_idx*2 + 1]) * 0.5 + 0.5
                    pose_landmarks[mp_idx] = {"x": x, "y": y, "z": 0, "visibility": 1.0}

                set_pose(0, 0) # Nose
                set_pose(12, 2) # RShoulder
                set_pose(14, 3) # RElbow
                set_pose(16, 4) # RWrist
                set_pose(11, 5) # LShoulder
                set_pose(13, 6) # LElbow
                set_pose(15, 7) # LWrist

                left_hand_landmarks = []
                for i in range(21):
                    x = float(frame[16 + i*2]) * 0.5 + 0.5
                    y = float(frame[16 + i*2 + 1]) * 0.5 + 0.5
                    left_hand_landmarks.append({"x": x, "y": y, "z": 0, "visibility": 1.0})

                right_hand_landmarks = []
                for i in range(21):
                    x = float(frame[58 + i*2]) * 0.5 + 0.5
                    y = float(frame[58 + i*2 + 1]) * 0.5 + 0.5
                    right_hand_landmarks.append({"x": x, "y": y, "z": 0, "visibility": 1.0})

                # Need to synthesize Hips because Kalidokit relies on Hips for root position
                # Neck is (0,0) in our feature space, mapped to (0.5, 0.5).
                # Hips are roughly below neck. Let's say y + 0.2
                pose_landmarks[23] = {"x": 0.4, "y": 0.7, "z": 0, "visibility": 1.0} # LHip
                pose_landmarks[24] = {"x": 0.6, "y": 0.7, "z": 0, "visibility": 1.0} # RHip

                sequence_data.append({
                    "hasData": True,
                    "videoWidth": 640,
                    "videoHeight": 480,
                    "poseLandmarks": pose_landmarks,
                    "poseWorldLandmarks": pose_landmarks, # Just pass the same for 3D
                    "leftHandLandmarks": left_hand_landmarks,
                    "rightHandLandmarks": right_hand_landmarks
                })
            
            # Store variant
            item['variants'] = [{
                "id": f"var_dataset_{word}",
                "lessonId": item['id'],
                "sequenceData": sequence_data,
                "created_at": "2026-06-09T00:00:00Z"
            }]

    print("Saving updated curriculum...")
    with open(curr_path, 'w', encoding='utf-8') as f:
        json.dump(curriculum, f, ensure_ascii=False, indent=2)
    
    print("Done!")

if __name__ == "__main__":
    main()
