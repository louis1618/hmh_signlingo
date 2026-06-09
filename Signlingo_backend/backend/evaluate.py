"""
Model Evaluation & Overfitting Check
- Splits data 80/20 stratified and evaluates on the held-out 20%
- Reports Top-1, Top-5, Top-10 accuracy
- Per-class accuracy distribution
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import os
import torch
import numpy as np
from torch.utils.data import DataLoader, Subset
from sklearn.model_selection import StratifiedShuffleSplit
from collections import Counter, defaultdict
from dataset import SignLanguageDataset, FEATURE_DIM
from train import SignLanguageModel

# ─── Load dataset ───
KEYPOINTS_DIR = r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\keypoints"
MORPHEME_DIR = r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\morpheme\morpheme"

dataset = SignLanguageDataset(KEYPOINTS_DIR, MORPHEME_DIR, max_frames=60, fps=30, augment=False)
NUM_CLASSES = len(dataset.word_to_idx)

# ─── Load model ───
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = SignLanguageModel(FEATURE_DIM, 512, NUM_CLASSES).to(device)

# Use the best model
ckpt_path = 'sign_model_best.pth' if os.path.exists('sign_model_best.pth') else 'sign_model.pth'
ckpt = torch.load(ckpt_path, map_location=device)
model.load_state_dict(ckpt['model_state_dict'])
model.eval()
print(f"Loaded {ckpt_path} (epoch {ckpt.get('epoch', '?')})")

# ─── Stratified 80/20 split ───
all_labels = np.array([s['label_idx'] for s in dataset.samples])

# Filter out classes with fewer than 2 samples (can't stratify with 1)
label_counts = Counter(all_labels)
valid_mask = np.array([label_counts[l] >= 2 for l in all_labels])
valid_indices = np.where(valid_mask)[0]
valid_labels = all_labels[valid_indices]

splitter = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
train_rel_idx, val_rel_idx = next(splitter.split(valid_indices, valid_labels))
train_idx = valid_indices[train_rel_idx]
val_idx = valid_indices[val_rel_idx]

print(f"\nDataset split: Train={len(train_idx)}, Val={len(val_idx)}, "
      f"Excluded(single-sample classes)={len(all_labels) - len(valid_indices)}")

train_loader = DataLoader(Subset(dataset, train_idx), batch_size=64, shuffle=False)
val_loader = DataLoader(Subset(dataset, val_idx), batch_size=64, shuffle=False)


def evaluate(loader, name):
    correct_1 = 0
    correct_5 = 0
    correct_10 = 0
    total = 0
    per_class_correct = defaultdict(int)
    per_class_total = defaultdict(int)

    with torch.no_grad():
        for inputs, labels in loader:
            inputs, labels = inputs.to(device), labels.to(device)
            outputs = model(inputs)

            # Top-1
            _, pred1 = torch.max(outputs, 1)
            correct_1 += (pred1 == labels).sum().item()

            # Top-5
            _, pred5 = torch.topk(outputs, min(5, outputs.size(1)), dim=1)
            for j in range(labels.size(0)):
                if labels[j] in pred5[j]:
                    correct_5 += 1

            # Top-10
            _, pred10 = torch.topk(outputs, min(10, outputs.size(1)), dim=1)
            for j in range(labels.size(0)):
                if labels[j] in pred10[j]:
                    correct_10 += 1

            total += labels.size(0)

            for j in range(labels.size(0)):
                lbl = labels[j].item()
                per_class_total[lbl] += 1
                if pred1[j].item() == lbl:
                    per_class_correct[lbl] += 1

    acc1 = 100 * correct_1 / total
    acc5 = 100 * correct_5 / total
    acc10 = 100 * correct_10 / total

    print(f"\n{'='*50}")
    print(f"  {name} Results ({total} samples)")
    print(f"{'='*50}")
    print(f"  Top-1  Accuracy: {acc1:.2f}%")
    print(f"  Top-5  Accuracy: {acc5:.2f}%")
    print(f"  Top-10 Accuracy: {acc10:.2f}%")

    # Per-class accuracy distribution
    class_accs = []
    for cls in per_class_total:
        if per_class_total[cls] > 0:
            class_accs.append(100 * per_class_correct[cls] / per_class_total[cls])

    if class_accs:
        class_accs = np.array(class_accs)
        print(f"\n  Per-class accuracy distribution:")
        print(f"    Mean:   {class_accs.mean():.1f}%")
        print(f"    Median: {np.median(class_accs):.1f}%")
        print(f"    Min:    {class_accs.min():.1f}%")
        print(f"    Max:    {class_accs.max():.1f}%")
        print(f"    Classes with 0% acc: {(class_accs == 0).sum()}/{len(class_accs)}")
        print(f"    Classes with >50% acc: {(class_accs > 50).sum()}/{len(class_accs)}")
        print(f"    Classes with 100% acc: {(class_accs == 100).sum()}/{len(class_accs)}")

    return acc1


# ─── Evaluate ───
print("\n" + "="*60)
print("  OVERFITTING CHECK: Train vs Validation Accuracy")
print("="*60)

train_acc = evaluate(train_loader, "TRAIN SET (80%)")
val_acc = evaluate(val_loader, "VALIDATION SET (20%)")

gap = train_acc - val_acc
print(f"\n{'='*50}")
print(f"  OVERFITTING ANALYSIS")
print(f"{'='*50}")
print(f"  Train Accuracy: {train_acc:.2f}%")
print(f"  Val Accuracy:   {val_acc:.2f}%")
print(f"  Gap:            {gap:.2f}%")

if gap < 10:
    print(f"\n  ✅ 과적합 없음! 모델이 잘 일반화되고 있습니다.")
elif gap < 25:
    print(f"\n  ⚠️ 약간의 과적합이 있지만, 데이터를 더 추가(02~16)하면 해결됩니다.")
else:
    print(f"\n  🚨 심각한 과적합! 데이터 추가(02~16) 또는 정규화 강화가 필요합니다.")
