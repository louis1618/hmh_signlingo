import os
import json
import torch
import numpy as np
import pickle
from torch.utils.data import Dataset

FEATURE_DIM = 100
MAX_FRAMES = 60

class SignLanguageDataset(Dataset):
    def __init__(self, backend_dir, augment=False):
        self.backend_dir = backend_dir
        self.augment = augment
        
        cache_path = os.path.join(backend_dir, 'dataset_cache.pkl')
        if not os.path.exists(cache_path):
            raise FileNotFoundError(f"Cache file not found: {cache_path}. Run preprocess_stream.py first.")
            
        with open(cache_path, 'rb') as f:
            cache = pickle.load(f)
            
        self.samples = cache['samples']
        self.total_sequences = cache['total_sequences']
        self.word_to_idx = cache['word_to_idx']
        self.idx_to_word = cache['idx_to_word']
        
        bin_path = os.path.join(backend_dir, 'dataset_features.bin')
        if not os.path.exists(bin_path):
            raise FileNotFoundError(f"Feature file not found: {bin_path}. Run preprocess_stream.py first.")
            
        # Use memmap to avoid loading the entire 1GB+ file into memory at once
        self.features_mmap = np.memmap(
            bin_path, 
            dtype=np.float32, 
            mode='r', 
            shape=(self.total_sequences, MAX_FRAMES, FEATURE_DIM)
        )
        
        print(f"Loaded dataset: {self.total_sequences} sequences, {len(self.word_to_idx)} unique words.")

    def __len__(self):
        return self.total_sequences

    def __getitem__(self, idx):
        # Read from memmap (fast disk read or memory cache)
        # We copy to create a fresh tensor unlinked from memmap
        features = np.copy(self.features_mmap[idx])
        label = self.samples[idx]['label_idx']
        
        if self.augment:
            # Simple augmentation: small random noise
            noise = np.random.normal(0, 0.01, features.shape).astype(np.float32)
            features += noise
            
        return torch.tensor(features), torch.tensor(label, dtype=torch.long)
