import os
import glob
import json
import zipfile
import shutil
import numpy as np
import pickle
from tqdm import tqdm
from collections import defaultdict

workspace = r"C:\Users\louis\Documents\.dev\HMH\Signlingo"
backend_dir = os.path.join(workspace, "backend")

MAX_FRAMES = 60
FEATURE_DIM = 100
def extract_features_from_json(data):
    person = data.get('people', None)
    if person is None: return np.zeros(FEATURE_DIM, dtype=np.float32)
    if isinstance(person, list):
        person = person[0] if person else None
        if person is None: return np.zeros(FEATURE_DIM, dtype=np.float32)

    lm = person.get('pose_keypoints_2d', [])
    left_hand = person.get('hand_left_keypoints_2d', [])
    right_hand = person.get('hand_right_keypoints_2d', [])
    if len(lm) < 75: return np.zeros(FEATURE_DIM, dtype=np.float32)

    def get_pt(idx, arr):
        return [arr[idx * 3], arr[idx * 3 + 1]]

    joints = [
        get_pt(0, lm), # Nose
        get_pt(2, lm), # RShoulder
        get_pt(3, lm), # RElbow
        get_pt(4, lm), # RWrist
        get_pt(5, lm), # LShoulder
        get_pt(6, lm), # LElbow
        get_pt(7, lm), # LWrist
    ]

    neck = [
        (joints[1][0] + joints[4][0]) / 2.0,
        (joints[1][1] + joints[4][1]) / 2.0,
    ]
    joints.insert(1, neck)

    lh_pts = []
    rh_pts = []
    for i in range(21):
        if len(left_hand) >= 63 and left_hand[i * 3] != 0:
            lh_pts.append([left_hand[i * 3], left_hand[i * 3 + 1]])
        else:
            lh_pts.append(joints[7]) # Fallback to LWrist
            
        if len(right_hand) >= 63 and right_hand[i * 3] != 0:
            rh_pts.append([right_hand[i * 3], right_hand[i * 3 + 1]])
        else:
            rh_pts.append(joints[4]) # Fallback to RWrist

    midHip = get_pt(8, lm) # OpenPose MidHip is 8
    
    torso_size = np.sqrt((neck[0] - midHip[0]) ** 2 + (neck[1] - midHip[1]) ** 2)
    if torso_size < 1e-6:
        torso_size = np.sqrt((joints[2][0] - joints[5][0]) ** 2 + (joints[2][1] - joints[5][1]) ** 2)
    if torso_size < 1e-6:
        torso_size = 1.0

    all_joints = joints + lh_pts + rh_pts
    features = []
    for x, y in all_joints:
        features.append((x - neck[0]) / torso_size)
        features.append((y - neck[1]) / torso_size)
        
    return np.array(features, dtype=np.float32)

def merge_parts(base_zip_name):
    if os.path.exists(base_zip_name):
        return base_zip_name
    part_files = glob.glob(f"{base_zip_name}.part*")
    part_files.sort(key=lambda x: int(x.split('.part')[-1]))
    if not part_files: return None
        
    print(f"\nMerging parts into {os.path.basename(base_zip_name)} ...")
    with open(base_zip_name, 'wb') as outfile:
        for part in tqdm(part_files, desc="Merging"):
            with open(part, 'rb') as infile:
                shutil.copyfileobj(infile, outfile)
    return base_zip_name

def process_stream():
    mapping_path = os.path.join(backend_dir, 'word_mapping.json')
    with open(mapping_path, 'r', encoding='utf-8') as f:
        word_mapping = json.load(f)
        
    bin_path = os.path.join(backend_dir, 'dataset_features.bin')
    # Clear existing file
    if os.path.exists(bin_path): os.remove(bin_path)
    
    samples = []
    word_to_idx = {}
    idx_to_word = {}
    
    total_processed = 0

    for i in range(1, 17):
        folder_num = f"{i:02d}"
        base_zip = os.path.join(workspace, f"{folder_num}_real_word_keypoint.zip")
        
        merged_zip = merge_parts(base_zip)
        if not merged_zip:
            print(f"Skipping {folder_num} (no parts found)")
            continue
            
        print(f"\nProcessing {folder_num} directly from memory...")
        try:
            with zipfile.ZipFile(merged_zip, 'r') as z:
                # Group files by sequence (directory name)
                print("Scanning zip directory tree...")
                sequences = defaultdict(list)
                for filename in z.namelist():
                    if filename.endswith('.json'):
                        seq_name = os.path.dirname(filename)
                        sequences[seq_name].append(filename)
                        
                print(f"Found {len(sequences)} sequences in {folder_num}. Parsing JSONs...")
                
                with open(bin_path, 'ab') as bin_file:
                    for seq_name, files in tqdm(sequences.items(), desc="Sequences"):
                        parts = os.path.basename(seq_name).split('_')
                        if len(parts) < 3 or not parts[2].startswith('WORD'):
                            continue
                        word_id = parts[2]
                        word = word_mapping.get(word_id, "")
                        if not word:
                            continue
                            
                        if word not in word_to_idx:
                            idx = len(word_to_idx)
                            word_to_idx[word] = idx
                            idx_to_word[idx] = word
                            
                        # Sort frames alphabetically to maintain order
                        files.sort()
                        
                        # Subsample or pad to MAX_FRAMES
                        # Calculate indices to pick
                        num_files = len(files)
                        if num_files == 0: continue
                        
                        indices = np.linspace(0, num_files - 1, min(num_files, MAX_FRAMES), dtype=int)
                        
                        seq_features = np.zeros((MAX_FRAMES, FEATURE_DIM), dtype=np.float32)
                        
                        for out_idx, in_idx in enumerate(indices):
                            with z.open(files[in_idx]) as f:
                                data = json.load(f)
                                feat = extract_features_from_json(data)
                                seq_features[out_idx] = feat
                                
                        bin_file.write(seq_features.tobytes())
                        
                        samples.append({
                            'word': word,
                            'label_idx': word_to_idx[word],
                            'seq_name': seq_name
                        })
                        total_processed += 1
                        
        except Exception as e:
            print(f"Error processing {folder_num}: {e}")
            
        # CRITICAL: Delete the merged zip to free up 12GB of space!
        print(f"Deleting {merged_zip} to free up space...")
        os.remove(merged_zip)
        
    print(f"\nFinished! Total sequences: {total_processed}")
    print(f"Total Vocabulary: {len(word_to_idx)}")
    
    # Save caches
    cache_path = os.path.join(backend_dir, 'dataset_cache.pkl')
    with open(cache_path, 'wb') as f:
        pickle.dump({
            'samples': samples,
            'word_to_idx': word_to_idx,
            'idx_to_word': idx_to_word,
            'total_sequences': total_processed
        }, f)
        
    vocab_path = os.path.join(backend_dir, 'vocab.json')
    with open(vocab_path, 'w', encoding='utf-8') as f:
        json.dump({str(k): v for k, v in idx_to_word.items()}, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    process_stream()
