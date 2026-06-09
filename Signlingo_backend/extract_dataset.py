import os
import glob
import json
import zipfile
import shutil
from tqdm import tqdm

def merge_parts(base_zip_name):
    """Merges .part files into a single .zip file if the .zip doesn't exist yet."""
    if os.path.exists(base_zip_name):
        return base_zip_name
    
    part_files = glob.glob(f"{base_zip_name}.part*")
    part_files.sort(key=lambda x: int(x.split('.part')[-1]))
    if not part_files:
        return None
        
    print(f"Merging parts into {base_zip_name} ...")
    with open(base_zip_name, 'wb') as outfile:
        for part in part_files:
            with open(part, 'rb') as infile:
                shutil.copyfileobj(infile, outfile)
    return base_zip_name

def get_target_word_ids(word_mapping_path, daily_vocab_path):
    with open(daily_vocab_path, 'r', encoding='utf-8') as f:
        target_words = set(json.load(f).values())
        
    with open(word_mapping_path, 'r', encoding='utf-8') as f:
        word_mapping = json.load(f)
        
    word_ids = set()
    for wid, word in word_mapping.items():
        if word in target_words:
            word_ids.add(wid)
            
    return word_ids

def extract_target_words_from_zip(zip_path, target_word_ids, extract_to):
    """Extracts only files/folders matching the target WORD IDs from a zip."""
    if not os.path.exists(zip_path):
        return
        
    print(f"Scanning {zip_path} for targeted extraction...")
    with zipfile.ZipFile(zip_path, 'r') as z:
        # Filter files that contain any of the target WORD IDs
        target_files = []
        for info in z.infolist():
            if any(wid in info.filename for wid in target_word_ids):
                target_files.append(info)
                
        print(f"Found {len(target_files)} relevant files in {os.path.basename(zip_path)}. Extracting...")
        z.extractall(path=extract_to, members=target_files)

if __name__ == "__main__":
    workspace = r"C:\Users\louis\Documents\.dev\HMH\Signlingo"
    daily_vocab = os.path.join(workspace, "backend", "daily_vocab.json")
    word_mapping_path = os.path.join(workspace, "backend", "word_mapping.json")
    
    # 1. Get mapping
    target_word_ids = get_target_word_ids(word_mapping_path, daily_vocab)
    print(f"Found {len(target_word_ids)} matching WORD IDs for our daily words.")
    
    # 2. Process zips
    dataset_keypoints = os.path.join(workspace, "dataset", "keypoints")
    dataset_morpheme = os.path.join(workspace, "dataset", "morpheme")
    
    # We will process folders 02, 03, 04, etc.
    for folder_num in ['02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16']:
        kp_zip_name = os.path.join(workspace, f"{folder_num}_real_word_keypoint.zip")
        mp_zip_name = os.path.join(workspace, f"{folder_num}_real_word_morpheme.zip")
        
        merged_kp = merge_parts(kp_zip_name)
        if merged_kp:
            extract_target_words_from_zip(merged_kp, target_word_ids, dataset_keypoints)
            
        merged_mp = merge_parts(mp_zip_name)
        if merged_mp:
            extract_target_words_from_zip(merged_mp, target_word_ids, dataset_morpheme)
            
    print("Done! Only the targeted 59 words have been extracted.")
