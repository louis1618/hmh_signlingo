
/**
 * SignLingo Local Database Service (IndexedDB)
 * 수동 JSON 복사 없이 브라우저 내부에 데이터를 영구 저장합니다.
 */

const DB_NAME = 'SignLingoDB';
const DB_VERSION = 1;

export const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('chapters')) {
                db.createObjectStore('chapters', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('lessons')) {
                const lessonStore = db.createObjectStore('lessons', { keyPath: 'id' });
                lessonStore.createIndex('chapterId', 'chapterId', { unique: false });
            }
            if (!db.objectStoreNames.contains('variants')) {
                const variantStore = db.createObjectStore('variants', { keyPath: 'id' });
                variantStore.createIndex('lessonId', 'lessonId', { unique: false });
            }
        };
    });
};

export const putItem = async (storeName, item) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const putItems = async (storeName, items) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const item of items) {
            store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const deleteItem = async (storeName, id) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getAllItems = async (storeName) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const getVariantsByLesson = async (lessonId) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('variants', 'readonly');
        const index = tx.objectStore('variants').index('lessonId');
        const req = index.getAll(lessonId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const deleteVariantsByLesson = async (lessonId) => {
    const db = await initDB();
    const variants = await getVariantsByLesson(lessonId);
    if (variants.length === 0) return;
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction('variants', 'readwrite');
        const store = tx.objectStore('variants');
        variants.forEach(v => store.delete(v.id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const seedDatabase = async () => {
    const chapters = await getAllItems('chapters');
    if (chapters.length > 100) return; // Full curriculum already loaded

    console.log("Fetching curriculum from backend...");
    try {
        const response = await fetch('http://localhost:8000/api/curriculum');
        if (!response.ok) throw new Error('Failed to fetch curriculum from server');
        const initialCurriculum = await response.json();
        
        console.log("Seeding initial curriculum into DB...");
        const db = await initDB();
        
        // Clear existing data to ensure clean seed
        await new Promise((resolve) => {
            const tx = db.transaction(['chapters', 'lessons', 'variants'], 'readwrite');
            tx.objectStore('chapters').clear();
            tx.objectStore('lessons').clear();
            tx.objectStore('variants').clear();
            tx.oncomplete = () => resolve();
        });

        const chapterMap = new Map();
        let chapterOrder = 0;

        const newChapters = [];
        const newLessons = [];

        for (const item of initialCurriculum) {
            if (!chapterMap.has(item.chapter)) {
                const chId = `ch_${chapterOrder}`;
                chapterMap.set(item.chapter, chId);
                newChapters.push({ id: chId, title: item.chapter, order: chapterOrder, description: "" });
                chapterOrder++;
            }
            
            newLessons.push({
                ...item,
                chapterId: chapterMap.get(item.chapter)
            });
        }
        
        await putItems('chapters', newChapters);
        await putItems('lessons', newLessons);
        
        console.log("DB seeding complete.");
    } catch (err) {
        console.error("Error fetching or seeding curriculum:", err);
    }
};

// Full Curriculum Fetcher for the App
export const getFullCurriculum = async () => {
    await seedDatabase();

    const chapters = await getAllItems('chapters');
    const lessons = await getAllItems('lessons');
    const allVariants = await getAllItems('variants');

    // Sort chapters by order
    chapters.sort((a, b) => a.order - b.order);

    return chapters.map(ch => ({
        ...ch,
        lessons: lessons.filter(l => l.chapterId === ch.id).map(l => ({
            ...l,
            variants: allVariants.filter(v => v.lessonId === l.id)
        }))
    }));
};
