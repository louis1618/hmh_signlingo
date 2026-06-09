import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOCAB_PATH = 'C:/Users/louis/Documents/.dev/.Surnin/HMH/Signlingo/backend/vocab.json';
const OUTPUT_PATH = path.join(__dirname, '../src/data/curriculum.js');

try {
    const rawData = fs.readFileSync(VOCAB_PATH, 'utf-8');
    const vocabDict = JSON.parse(rawData);
    const words = Object.values(vocabDict);
    
    // There are 3022 words. Let's group them by 20 words per chapter.
    const WORDS_PER_CHAPTER = 20;
    const curriculum = [];

    let currentChapterId = 1;
    let wordCountInChapter = 0;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        
        // Some words might be bad or empty
        if (!word || word.trim() === '') continue;

        if (wordCountInChapter >= WORDS_PER_CHAPTER) {
            currentChapterId++;
            wordCountInChapter = 0;
        }

        const chapterName = `Chapter ${currentChapterId}: 단어 ${((currentChapterId - 1) * WORDS_PER_CHAPTER) + 1} ~ ${Math.min(currentChapterId * WORDS_PER_CHAPTER, words.length)}`;

        curriculum.push({
            id: `word_${i}`,
            chapter: chapterName,
            title: word,
            targetSign: word,
            icon: "✋",
            type: "word",
            videoUrl: null, // User can add later in CMS
            description: `화면에 나타나는 가이드에 따라 '${word}' 수어 동작을 수행하세요.`,
            completed: false,
            variants: []
        });

        wordCountInChapter++;
    }

    const fileContent = `// 이 파일은 자동 생성되었습니다.\nexport const INITIAL_CURRICULUM = ${JSON.stringify(curriculum, null, 4)};\n`;
    
    fs.writeFileSync(OUTPUT_PATH, fileContent, 'utf-8');
    console.log(`Successfully generated curriculum with ${curriculum.length} words across ${currentChapterId} chapters.`);
} catch (error) {
    console.error("Error generating curriculum:", error);
}
