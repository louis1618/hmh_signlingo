import { useState } from 'react';
import { Star, Lock, CheckCircle, Settings, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { DuoButton } from '../../components/ui';

export const LearningMap = ({ curriculum, onSelectLesson }) => {
    if (!curriculum || curriculum.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50/50">
                <Settings className="text-[#1cb0f6] w-24 h-24 mb-6 opacity-80" />
                <h2 className="text-3xl font-black text-gray-700 mb-4">커리큘럼이 비어있습니다</h2>
                <p className="text-gray-500 mb-8 max-w-md text-lg">
                    아직 데이터베이스에 수어 학습 데이터가 등록되지 않았습니다.<br/>
                    좌측 메뉴의 <strong>저작도구(CMS)</strong> 탭으로 이동하여 챕터와 단어를 생성해보세요.
                </p>
                <div className="bg-white p-6 rounded-3xl border-2 border-gray-100 shadow-sm text-left max-w-md w-full">
                    <h3 className="font-bold text-gray-700 mb-2 border-b pb-2">시작 가이드</h3>
                    <ul className="text-sm text-gray-600 flex flex-col gap-2 list-decimal pl-4">
                        <li>저작도구에서 [+] 버튼을 눌러 새 챕터 생성</li>
                        <li>생성된 챕터 우측의 [+] 버튼으로 단어 레슨 생성</li>
                        <li>단어 클릭 후 제목, 설명, 영상 URL 저장</li>
                        <li>녹화 스튜디오에서 3~5회 반복 녹화하여 데이터 누적</li>
                    </ul>
                </div>
            </div>
        );
    }

    const [currentPage, setCurrentPage] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const isDebugMode = true; // 우선은 모든 단어 잠금 해제

    const activeChapters = searchQuery.trim() !== ''
        ? curriculum.filter(ch => 
            ch.title.includes(searchQuery) || 
            (ch.lessons && ch.lessons.some(l => l.title.includes(searchQuery)))
          )
        : curriculum.slice(currentPage, currentPage + 1);

    const handleNext = () => setCurrentPage(p => Math.min(p + 1, curriculum.length - 1));
    const handlePrev = () => setCurrentPage(p => Math.max(p - 1, 0));

    return (
        <div className="p-4 md:p-8 max-w-2xl mx-auto flex flex-col items-center pb-24 md:pb-8 min-h-screen">
            {/* Search Bar */}
            <div className="w-full max-w-md mx-auto mb-8 relative">
                <input 
                    type="text"
                    placeholder="단어 또는 챕터 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full p-4 pl-12 rounded-2xl border-2 border-gray-200 focus:border-[#1cb0f6] outline-none font-bold text-gray-700"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>

            {/* Pagination Top */}
            {!searchQuery && (
                <div className="flex justify-between items-center w-full mb-8 bg-white p-4 rounded-2xl border-2 border-gray-100 shadow-sm">
                    <button 
                        onClick={handlePrev} 
                        disabled={currentPage === 0}
                        className={`flex items-center gap-2 font-bold px-4 py-2 rounded-xl transition-colors ${currentPage === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-[#1cb0f6] hover:bg-blue-50'}`}
                    >
                        <ChevronLeft /> 이전 챕터
                    </button>
                    <span className="font-black text-gray-500 bg-gray-100 px-4 py-1 rounded-full">{currentPage + 1} / {curriculum.length}</span>
                    <button 
                        onClick={handleNext} 
                        disabled={currentPage === curriculum.length - 1}
                        className={`flex items-center gap-2 font-bold px-4 py-2 rounded-xl transition-colors ${currentPage === curriculum.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-[#1cb0f6] hover:bg-blue-50'}`}
                    >
                        다음 챕터 <ChevronRight />
                    </button>
                </div>
            )}

            {activeChapters.length === 0 && searchQuery.trim() !== '' && (
                <div className="text-gray-500 font-bold text-lg mt-8">검색 결과가 없습니다.</div>
            )}

            {activeChapters.map((chapter) => (
                <div key={chapter.id} className="w-full flex flex-col items-center relative mb-12">
                    {/* Chapter Header */}
                    <div className="w-full bg-[#58cc02] text-white p-4 rounded-2xl font-bold mb-8 shadow-sm flex justify-between items-center relative z-10">
                        <div>
                            <div className="text-xl font-black">{chapter.title}</div>
                        </div>
                        <DuoButton variant="secondary" className="scale-90 opacity-90 hover:opacity-100">
                            {chapter.lessons?.length || 0} 단어
                        </DuoButton>
                    </div>

                    {/* Lesson Path */}
                    <div className="flex flex-col items-center gap-6 md:gap-8 relative w-full px-8">
                        {/* Connecting Line */}
                        <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-4 bg-gray-200 z-0 rounded-full"></div>

                        {chapter.lessons && chapter.lessons.map((lesson, index) => {
                            const isCompleted = lesson.completed;
                            const isLocked = !isDebugMode && (!isCompleted && index > 0 && !chapter.lessons[index-1]?.completed && lesson.id !== 'demo');
                            const position = index % 2 === 0 ? 'left' : 'right';

                            // If searching, highlight the matching lesson
                            const isMatch = searchQuery.trim() !== '' && lesson.title.includes(searchQuery);

                            return (
                                <div key={lesson.id} className={`relative z-10 flex w-full ${position === 'left' ? 'justify-start' : 'justify-end'}`}>
                                    <div 
                                        className={`group relative flex flex-col items-center cursor-pointer transition-transform hover:scale-110 active:scale-95 ${position === 'left' ? 'ml-8' : 'mr-8'}`}
                                        onClick={() => {
                                            if (!isLocked) onSelectLesson(lesson);
                                        }}
                                    >
                                        {/* Popup tooltip (Removed in favor of visible text) */}

                                        <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-3xl md:text-4xl shadow-[0_6px_0_0_rgba(0,0,0,0.1)] border-4 transition-colors z-10 ${
                                            isMatch ? 'bg-yellow-100 border-yellow-400 text-yellow-600 shadow-yellow-500' :
                                            isCompleted ? 'bg-[#58cc02] border-[#46a302] text-white shadow-[#46a302]' : 
                                            isLocked ? 'bg-gray-200 border-gray-300 text-gray-400 shadow-gray-300' : 
                                            'bg-white border-[#1cb0f6] text-[#1cb0f6] shadow-[#1899d6]'
                                        }`}>
                                            {isCompleted ? <CheckCircle className="text-white w-10 h-10" strokeWidth={3} /> : 
                                             isLocked ? <Lock className="w-8 h-8 opacity-50" strokeWidth={2.5} /> : 
                                             <span className="drop-shadow-sm">{lesson.icon}</span>}
                                        </div>
                                        
                                        {/* Visible Title Below Icon */}
                                        <div className={`mt-3 font-black text-lg tracking-tight drop-shadow-sm transition-colors ${
                                            isMatch ? 'text-yellow-600' :
                                            isCompleted ? 'text-[#58cc02]' : 
                                            isLocked ? 'text-gray-400' : 
                                            'text-gray-700'
                                        }`}>
                                            {lesson.title}
                                        </div>

                                        {/* Stars indicator for completed lessons */}
                                        {isCompleted && (
                                            <div className="absolute -bottom-2 -right-2 bg-yellow-400 p-1.5 rounded-full border-2 border-white text-white shadow-sm">
                                                <Star className="w-4 h-4 fill-current" />
                                            </div>
                                        )}
                                        {/* Variants count indicator */}
                                        {lesson.variants?.length > 0 && !isLocked && !isCompleted && (
                                            <div className="absolute -top-2 -right-2 bg-[#1cb0f6] text-white text-xs font-bold px-2 py-1 rounded-full border-2 border-white shadow-sm">
                                                {lesson.variants.length}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Pagination Bottom */}
            {!searchQuery && (
                <div className="flex justify-between items-center w-full mt-4 bg-white p-4 rounded-2xl border-2 border-gray-100 shadow-sm">
                    <button 
                        onClick={handlePrev} 
                        disabled={currentPage === 0}
                        className={`flex items-center gap-2 font-bold px-4 py-2 rounded-xl transition-colors ${currentPage === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-[#1cb0f6] hover:bg-blue-50'}`}
                    >
                        <ChevronLeft /> 이전 챕터
                    </button>
                    <button 
                        onClick={handleNext} 
                        disabled={currentPage === curriculum.length - 1}
                        className={`flex items-center gap-2 font-bold px-4 py-2 rounded-xl transition-colors ${currentPage === curriculum.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-[#1cb0f6] hover:bg-blue-50'}`}
                    >
                        다음 챕터 <ChevronRight />
                    </button>
                </div>
            )}
        </div>
    );
};
