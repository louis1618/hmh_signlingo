import os
import json
import glob
from dataset import SignLanguageDataset

d = SignLanguageDataset(r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\keypoints", r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\morpheme\morpheme", max_frames=60, fps=30)
print(f"Loaded dataset cache. Total samples: {len(d)}")

zeros_count = 0
total_frames = 0

# Check first 100 samples
for i in range(min(100, len(d))):
    sample = d.samples[i]
    base_filename = sample['base_filename']
    folder_num = sample.get('folder_num', '')
    start_frame = sample['start_frame']
    end_frame = sample['end_frame']
    
    for frame_idx in range(start_frame, end_frame + 1):
        if total_frames > 1000: break
        
        frame_str = f"{frame_idx:012d}"
        keypoint_filename = f"{base_filename}_{frame_str}_keypoints.json"
        kp_path = os.path.join(d.keypoints_dir, folder_num, base_filename, keypoint_filename)
        
        if not os.path.exists(kp_path):
            zeros_count += 1
        total_frames += 1

print(f"Checked {total_frames} frames.")
print(f"Missing frames (would be zeros): {zeros_count}")
