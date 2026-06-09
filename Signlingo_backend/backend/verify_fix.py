"""Verify normalization produces sensible values centered around 0."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from dataset import SignLanguageDataset, FEATURE_DIM

ds = SignLanguageDataset(
    r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\keypoints",
    r"C:\Users\louis\Documents\.dev\HMH\Signlingo\dataset\morpheme\morpheme",
    max_frames=60, fps=30, limit_samples=50)

print(f"Feature dim: {FEATURE_DIM} (expected: 100)")
print(f"Samples: {len(ds)}")

for i in range(min(3, len(ds))):
    feat, lbl = ds[i]
    s = ds.samples[i]
    arr = feat.numpy()
    non_pad = arr[np.any(arr != 0, axis=1)]  # Non-padding frames
    print(f"\n  [{s['word']}] shape={feat.shape}")
    print(f"    Active frames: {len(non_pad)}/{len(arr)}")
    print(f"    Value range: [{arr.min():.3f}, {arr.max():.3f}]")
    print(f"    Mean: {non_pad.mean():.4f}, Std: {non_pad.std():.4f}")
    print(f"    Neck (idx 2,3 = should be ~0,0): {arr[0, 2]:.4f}, {arr[0, 3]:.4f}")

    if -5 < arr.min() and arr.max() < 5:
        print("    ✅ Normalized! Values centered around 0")
    else:
        print("    ⚠️ Values still look like raw pixel coordinates")
