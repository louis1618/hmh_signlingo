const apiKey = ""; // The execution environment provides the key at runtime
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";

export const callGeminiAPI = async (payload, retries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
            );
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delays[i]));
        }
    }
};

/**
 * 평가를 위해 시퀀스(프레임 배열)를 전송하고 0~100점 사이의 점수와 피드백을 받습니다.
 */
export const evaluateSignSequence = async (framesBase64, targetSignWord) => {
    try {
        const parts = [
            { text: `제공된 이미지들은 사용자가 웹캠을 통해 수어 단어/문장인 '${targetSignWord}'(을)를 표현하는 동작을 시간 순서대로 캡처한 프레임입니다. 동작의 정확도, 방향, 표정 등을 종합적으로 분석하여 이 동작이 얼마나 정확한지 0에서 100 사이의 점수로 평가하고, 교정해야 할 부분이나 칭찬할 부분을 짧고 명확하게 피드백해주세요. 응답은 반드시 JSON 형식으로 {"score": 점수숫자, "feedback": "피드백내용"} 형태로만 반환해야 합니다.` }
        ];

        framesBase64.forEach(frame => {
            parts.push({ inlineData: { mimeType: "image/jpeg", data: frame } });
        });

        const payload = {
            contents: [{ parts: parts }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: { 
                    type: "OBJECT", 
                    properties: { 
                        score: { type: "INTEGER" },
                        feedback: { type: "STRING" }
                    } 
                }
            }
        };

        const data = await callGeminiAPI(payload);
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (resultText) {
            return JSON.parse(resultText);
        }
        return { score: 0, feedback: "AI 응답을 파싱할 수 없습니다." };
    } catch (error) {
        console.error("Evaluation Error:", error);
        return { score: 0, feedback: "평가 중 오류가 발생했습니다. 다시 시도해주세요." };
    }
};
