import os
import glob
import json
import zipfile
import shutil
import numpy as np
import pickle
from tqdm import tqdm
from collections import defaultdict
from preprocess_stream import extract_features_from_json, MAX_FRAMES, FEATURE_DIM

# We will use the same merge logic
def merge_parts(base_zip_name):
    if os.path.exists(base_zip_name):
        return base_zip_name
    part_files = glob.glob(f"{base_zip_name}.part*")
    # Sort parts by the byte offset in the extension, part0, part1073741824, etc.
    part_files.sort(key=lambda x: int(x.split('.part')[-1]))
    if not part_files: return None
        
    print(f"\nMerging parts into {os.path.basename(base_zip_name)} ...")
    with open(base_zip_name, 'wb') as outfile:
        for part in tqdm(part_files, desc="Merging"):
            with open(part, 'rb') as infile:
                shutil.copyfileobj(infile, outfile)
    return base_zip_name

def process_sentence_data():
    workspace = r"C:\Users\louis\Documents\.dev\HMH\Signlingo"
    data_dir = os.path.join(workspace, ".data")
    backend_dir = os.path.join(workspace, "backend")
    
    bin_path = os.path.join(backend_dir, 'dataset_features.bin')
    cache_path = os.path.join(backend_dir, 'dataset_cache.pkl')
    
    # Load existing cache
    if os.path.exists(cache_path):
        with open(cache_path, 'rb') as f:
            cache = pickle.load(f)
            samples = cache['samples']
            word_to_idx = cache['word_to_idx']
            idx_to_word = {int(k): v for k, v in cache['idx_to_word'].items()}
            total_processed = cache['total_sequences']
    else:
        print("Existing dataset cache not found. Please run preprocess_stream.py first.")
        return

    added_count = 0

    # Process 01 to 02 folders (you can expand this later)
    for i in range(1, 3):
        folder_num = f"{i:02d}"
        base_morph_zip = os.path.join(data_dir, f"{folder_num}_real_sen_morpheme.zip")
        base_kp_zip = os.path.join(data_dir, f"{folder_num}_real_sen_keypoint.zip")
        
        merged_morph = merge_parts(base_morph_zip)
        merged_kp = merge_parts(base_kp_zip)
        
        if not merged_morph or not merged_kp:
            print(f"Skipping {folder_num} (parts not found)")
            continue
            
        print(f"\nProcessing {folder_num}...")
        
        # 1. Parse Morpheme data
        video_morphemes = defaultdict(list)
        try:
            with zipfile.ZipFile(merged_morph, 'r') as mz:
                json_files = [f for f in mz.namelist() if f.endswith('.json')]
                for f_name in tqdm(json_files, desc="Parsing Morphemes"):
                    raw_data = mz.read(f_name)
                    try:
                        data = json.loads(raw_data.decode('utf-8', errors='replace'))
                        meta = data.get("metaData", {})
                        video_name = meta.get("name")
                        if not video_name: continue
                        
                        duration = meta.get("duration", 0.0)
                        video_name = video_name.replace(".mp4", "") # Normalize video name
                        
                        for item in data.get("data", []):
                            word = item.get("attributes", [{}])[0].get("name", "")
                            # Ignore garbage words or invalid characters
                            if not word or word == "": continue
                            
                            start = item.get("start", 0.0)
                            end = item.get("end", 0.0)
                            
                            video_morphemes[video_name].append({
                                "word": word,
                                "start": start,
                                "end": end,
                                "duration": duration
                            })
                    except:
                        pass
        except Exception as e:
            print(f"Error reading morpheme zip: {e}")
            
        print(f"Found {len(video_morphemes)} videos with morpheme data.")
        
        # 2. Extract Keypoints
        try:
            with zipfile.ZipFile(merged_kp, 'r') as kz:
                # Group keypoint JSONs by video sequence
                kp_files = [f for f in kz.namelist() if f.endswith('.json')]
                sequences = defaultdict(list)
                for f_name in kp_files:
                    # Usually keypoint files are grouped in a directory with the video name
                    # e.g. keypoint/01/NIA_SL_SEN0001_REAL01_D/NIA_SL_SEN0001_REAL01_D_000000_keypoints.json
                    seq_name = os.path.basename(os.path.dirname(f_name))
                    sequences[seq_name].append(f_name)
                    
                # Process each video
                with open(bin_path, 'ab') as bin_file:
                    for seq_name, files in tqdm(sequences.items(), desc="Extracting Keypoints"):
                        if seq_name not in video_morphemes:
                            continue
                            
                        # Sort frames chronologically
                        files.sort()
                        num_frames = len(files)
                        if num_frames == 0: continue
                        
                        morphemes = video_morphemes[seq_name]
                        if not morphemes: continue
                        
                        # Assuming duration matches num_frames (calculate dynamic FPS)
                        duration = morphemes[0]["duration"]
                        if duration <= 0: continue
                        fps = num_frames / duration
                        
                        for morph in morphemes:
                            word = morph["word"]
                            start_idx = int(morph["start"] * fps)
                            end_idx = int(morph["end"] * fps)
                            
                            # Safety bounds
                            start_idx = max(0, start_idx)
                            end_idx = min(num_frames - 1, end_idx)
                            
                            if start_idx >= end_idx: continue
                            
                            morph_files = files[start_idx:end_idx+1]
                            morph_num_files = len(morph_files)
                            
                            if morph_num_files == 0: continue
                            
                            # Add word to vocab if not exists
                            if word not in word_to_idx:
                                idx = len(word_to_idx)
                                word_to_idx[word] = idx
                                idx_to_word[idx] = word
                                
                            # Sample / Pad to MAX_FRAMES
                            indices = np.linspace(0, morph_num_files - 1, min(morph_num_files, MAX_FRAMES), dtype=int)
                            seq_features = np.zeros((MAX_FRAMES, FEATURE_DIM), dtype=np.float32)
                            
                            for out_idx, in_idx in enumerate(indices):
                                with kz.open(morph_files[in_idx]) as f:
                                    data = json.load(f)
                                    feat = extract_features_from_json(data)
                                    seq_features[out_idx] = feat
                                    
                            bin_file.write(seq_features.tobytes())
                            
                            samples.append({
                                'word': word,
                                'label_idx': word_to_idx[word],
                                'seq_name': f"{seq_name}_sentence_slice_{start_idx}_{end_idx}"
                            })
                            total_processed += 1
                            added_count += 1
                            
        except Exception as e:
            print(f"Error reading keypoint zip: {e}")
            
        print(f"Cleaning up merged zips for {folder_num}...")
        os.remove(merged_morph)
        os.remove(merged_kp)

    print(f"\nFinished! Extracted {added_count} new morpheme sequences.")
    print(f"Total vocabulary size: {len(word_to_idx)}")
    
    # Save updated caches
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
    process_sentence_data()
