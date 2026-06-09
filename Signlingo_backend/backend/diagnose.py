"""
Deep Diagnostic: Compare training data features vs frontend webcam features.
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
import json
import torch
import numpy as np

FEATURE_DIM = 100

print("="*70)
print("  STEP 1: Load metadata and vocab")
print("="*70)

vocab_path = os.path.join(os.path.dirname(__file__), 'vocab.json')
with open(vocab_path, 'r', encoding='utf-8') as f:
    idx_to_word = json.load(f)
num_classes = len(idx_to_word)
print(f"  Vocab loaded: {num_classes} classes")

# Pick a target word index
target_words = ['감사', '좋다']
target_idx = None
target_word = None
for k, v in idx_to_word.items():
    if v in target_words:
        target_idx = int(k)
        target_word = v
        break

if target_idx is None:
    target_idx = 0
    target_word = idx_to_word['0']

print(f"  Target word for testing: '{target_word}' (idx: {target_idx})")

# Load training data
print("\n" + "="*70)
print("  STEP 2: Load one training sample for the target word")
print("="*70)

lbl_path = os.path.join(os.path.dirname(__file__), 'dataset_labels.npy')
feat_path = os.path.join(os.path.dirname(__file__), 'dataset_features.npy')

labels = np.memmap(lbl_path, dtype='int64', mode='r')
features = np.memmap(feat_path, dtype='float32', mode='r', shape=(len(labels), 60, FEATURE_DIM))

sample_idx = np.where(labels == target_idx)[0][0]
train_sample = np.array(features[sample_idx])

print(f"  Found sample at index {sample_idx}")
train_active = train_sample[np.any(train_sample != 0, axis=1)]
print(f"  Sequence shape: {train_sample.shape}")
print(f"  Active frames: {len(train_active)}")
print(f"  Value range: [{train_sample.min():.4f}, {train_sample.max():.4f}]")

print(f"\n  TRAINING first frame pose joints (16 values):")
print(f"    {train_active[0, :16].tolist()}")
print(f"  TRAINING left hand (first 10):")
print(f"    {train_active[0, 16:26].tolist()}")
print(f"  TRAINING right hand (first 10):")
print(f"    {train_active[0, 58:68].tolist()}")


print("\n" + "="*70)
print("  STEP 3: Load frontend dump and compare distributions")
print("="*70)

frontend_path = os.path.join(os.path.dirname(__file__), 'frontend_dump.npy')
if not os.path.exists(frontend_path):
    print("  ❌ frontend_dump.npy not found!")
    sys.exit(1)

frontend = np.load(frontend_path)
front_active = frontend[np.any(frontend != 0, axis=1)]

print(f"  Frontend shape: {frontend.shape}")
print(f"  Active frames: {len(front_active)}")
print(f"  Value range: [{frontend.min():.4f}, {frontend.max():.4f}]")

if len(front_active) > 0:
    print(f"\n  FRONTEND first frame pose joints (16 values):")
    print(f"    {front_active[0, :16].tolist()}")
    print(f"  FRONTEND left hand (first 10):")
    print(f"    {front_active[0, 16:26].tolist()}")
    print(f"  FRONTEND right hand (first 10):")
    print(f"    {front_active[0, 58:68].tolist()}")

    print(f"\n  {'Metric':<25} {'Training':>12} {'Frontend':>12}")
    print(f"  {'-'*25} {'-'*12} {'-'*12}")
    print(f"  {'Pose joints mean':<25} {train_active[:, :16].mean():>12.4f} {front_active[:, :16].mean():>12.4f}")
    print(f"  {'Pose joints std':<25} {train_active[:, :16].std():>12.4f} {front_active[:, :16].std():>12.4f}")
    print(f"  {'Left hand mean':<25} {train_active[:, 16:58].mean():>12.4f} {front_active[:, 16:58].mean():>12.4f}")
    print(f"  {'Left hand std':<25} {train_active[:, 16:58].std():>12.4f} {front_active[:, 16:58].std():>12.4f}")
    print(f"  {'Right hand mean':<25} {train_active[:, 58:].mean():>12.4f} {front_active[:, 58:].mean():>12.4f}")
    print(f"  {'Right hand std':<25} {train_active[:, 58:].std():>12.4f} {front_active[:, 58:].std():>12.4f}")


print("\n" + "="*70)
print("  STEP 4: Run model predictions")
print("="*70)

from train import SignLanguageModel
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = SignLanguageModel(FEATURE_DIM, 512, num_classes).to(device)

ckpt_path = 'sign_model_best.pth' if os.path.exists('sign_model_best.pth') else 'sign_model.pth'
ckpt = torch.load(ckpt_path, map_location=device)
model.load_state_dict(ckpt['model_state_dict'])
model.eval()

with torch.no_grad():
    t_tensor = torch.tensor(train_sample, dtype=torch.float32).unsqueeze(0).to(device)
    t_out = model(t_tensor)
    t_probs = torch.nn.functional.softmax(t_out, dim=1)
    t_top5_conf, t_top5_idx = torch.topk(t_probs, 5, dim=1)

    print(f"  Model prediction on TRAINING data ('{target_word}'):")
    for i in range(5):
        w = idx_to_word.get(str(t_top5_idx[0, i].item()), '?')
        c = t_top5_conf[0, i].item()
        print(f"    #{i+1}: {w} ({c*100:.1f}%)")

    f_tensor = torch.tensor(frontend, dtype=torch.float32).unsqueeze(0).to(device)
    f_out = model(f_tensor)
    f_probs = torch.nn.functional.softmax(f_out, dim=1)
    f_top5_conf, f_top5_idx = torch.topk(f_probs, 5, dim=1)

    print(f"\n  Model prediction on FRONTEND data:")
    for i in range(5):
        w = idx_to_word.get(str(f_top5_idx[0, i].item()), '?')
        c = f_top5_conf[0, i].item()
        print(f"    #{i+1}: {w} ({c*100:.1f}%)")

print("\n" + "="*70)
print("  DIAGNOSTIC COMPLETE")
print("="*70)
