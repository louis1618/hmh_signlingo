import pickle
import json
import sys

import os

sys.stdout.reconfigure(encoding='utf-8')

backend_dir = os.path.dirname(os.path.abspath(__file__))
cache_file = os.path.join(backend_dir, "dataset_cache.pkl")

try:
    with open(cache_file, "rb") as f:
        data = pickle.load(f)
    
    unique_words = list(data['word_to_idx'].keys())
    print(f"Found {len(unique_words)} unique words.")
    
    curriculum = []
    
    words_per_chapter = 100
    for i, word in enumerate(unique_words):
        chapter_idx = (i // words_per_chapter) + 1
        
        curriculum.append({
            "id": f"word_{i}",
            "type": "word",
            "chapter": f"단어 학습 {chapter_idx}단계",
            "title": word,
            "targetSign": word,
            "icon": "📝",
            "description": f"'{word}' 수어를 배워봅시다.",
            "variants": []
        })
        
    out_file = os.path.join(backend_dir, "curriculum.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(curriculum, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(curriculum)} items to {out_file}")
    
except Exception as e:
    print("Error:", e)
