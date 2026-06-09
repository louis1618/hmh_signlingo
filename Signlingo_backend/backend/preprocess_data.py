"""Pre-process: compile all keypoint JSONs into a single fast binary file."""
import os
import json
import pickle
import numpy as np
from tqdm import tqdm
from dataset import extract_and_normalize_openpose, FEATURE_DIM


def main():
    cache_path = os.path.join(os.path.dirname(__file__), 'dataset_cache.pkl')
    if not os.path.exists(cache_path):
        print("dataset_cache.pkl not found! Generating cache...")
        from dataset import SignLanguageDataset
        keypoints_dir = r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\keypoints"
        morpheme_dir = r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\morpheme"
        ds = SignLanguageDataset(keypoints_dir, morpheme_dir)

    print("Loading dataset metadata...")
    with open(cache_path, 'rb') as f:
        samples = pickle.load(f)['samples']

    num_samples = len(samples)
    max_frames = 60
    print(f"Sequences to compile: {num_samples}, Feature dim: {FEATURE_DIM}")

    data_file = os.path.join(os.path.dirname(__file__), 'dataset_features.npy')
    labels_file = os.path.join(os.path.dirname(__file__), 'dataset_labels.npy')

    feat_mmap = np.memmap(data_file, dtype='float32', mode='w+',
                          shape=(num_samples, max_frames, FEATURE_DIM))
    lbl_mmap = np.memmap(labels_file, dtype='int64', mode='w+',
                         shape=(num_samples,))

    kp_dir = r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\keypoints"

    print("Compiling (one-time)...")
    for i, s in enumerate(tqdm(samples, desc="Processing")):
        sequence = []
        for fi in range(s['start_frame'], s['end_frame'] + 1):
            if len(sequence) >= max_frames:
                break
            fp = os.path.join(kp_dir, s['folder_num'], s['base_filename'],
                              f"{s['base_filename']}_{fi:012d}_keypoints.json")
            try:
                with open(fp, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                person = data.get('people', None)
                if person is None:
                    sequence.append(np.zeros(FEATURE_DIM, dtype=np.float32))
                    continue
                if isinstance(person, list):
                    person = person[0] if person else None
                    if person is None:
                        sequence.append(np.zeros(FEATURE_DIM, dtype=np.float32))
                        continue
                sequence.append(extract_and_normalize_openpose(person))
            except Exception:
                sequence.append(np.zeros(FEATURE_DIM, dtype=np.float32))

        if len(sequence) == 0:
            arr = np.zeros((max_frames, FEATURE_DIM), dtype=np.float32)
        elif len(sequence) < max_frames:
            arr = np.vstack([np.array(sequence),
                             np.zeros((max_frames - len(sequence), FEATURE_DIM), dtype=np.float32)])
        else:
            arr = np.array(sequence, dtype=np.float32)

        feat_mmap[i] = arr
        lbl_mmap[i] = s['label_idx']
        if i % 2000 == 0:
            feat_mmap.flush()
            lbl_mmap.flush()

    feat_mmap.flush()
    lbl_mmap.flush()
    print(f"Done! {data_file} ({os.path.getsize(data_file) / 1e6:.0f} MB)")


if __name__ == '__main__':
    main()
