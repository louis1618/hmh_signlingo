import React, { useState, useEffect } from 'react';
import { Home, Camera, Trophy, User, Bot, Wrench, Loader2 } from 'lucide-react';

import { SidebarItem, Header, ComingSoon, IconButton } from './components/ui';
import { LearningMap } from './pages/Home/LearningMap';
import { Translator } from './pages/Translator/Translator';
import { LessonRoom } from './pages/LessonRoom/LessonRoom';
import { CMSAdmin } from './pages/Admin/CMSAdmin';
import { getFullCurriculum } from './services/dbService';

export default function App() {
    const [currentTab, setCurrentTab] = useState('home');
    const [activeLesson, setActiveLesson] = useState(null);
    const [curriculum, setCurriculum] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ streak: 12, hearts: 5, xp: 1450 });

    const loadCurriculum = async () => {
        setLoading(true);
        const data = await getFullCurriculum();
        setCurriculum(data);
        setLoading(false);
    };

    useEffect(() => {
        loadCurriculum();
    }, [currentTab]); // 탭이 바뀔 때마다 (특히 CMS에서 Home으로 돌아올 때) DB 최신화

    const completeLesson = (lessonId) => {
        // 실제 운영 시 DB 업데이트 (완료 상태 등) 고려. 현재는 state만 업데이트
        setStats(prev => ({ ...prev, xp: prev.xp + 50 }));
        setActiveLesson(null);
    };

    const renderContent = () => {
        if (activeLesson) {
            return <LessonRoom key={activeLesson.id} lesson={activeLesson} onClose={() => setActiveLesson(null)} onComplete={() => completeLesson(activeLesson.id)} />;
        }
        
        if (loading && currentTab === 'home') {
            return <div className="flex-1 flex items-center justify-center h-full"><Loader2 className="animate-spin text-[#58cc02]" size={40} /></div>;
        }

        switch (currentTab) {
            case 'home': return <LearningMap curriculum={curriculum} onSelectLesson={setActiveLesson} />;
            case 'translator': return <Translator />;
            case 'authoring': return <CMSAdmin />;
            case 'leaderboard': return <ComingSoon title="리더보드" />;
            case 'profile': return <ComingSoon title="프로필" />;
            default: return <LearningMap curriculum={curriculum} onSelectLesson={setActiveLesson} />;
        }
    };

    return (
        <div className="flex h-screen bg-white font-sans text-[#4b4b4b] overflow-hidden select-none">
            <nav className="hidden md:flex flex-col w-64 border-r-2 border-gray-200 bg-white p-4 h-full shrink-0 z-10">
                <div className="text-2xl font-black text-[#58cc02] tracking-wider mb-8 ml-4 flex items-center gap-2 mt-4 cursor-pointer" onClick={() => setCurrentTab('home')}>
                    <Bot size={32} /> SignLingo
                </div>
                <div className="flex-1 flex flex-col gap-2">
                    <SidebarItem icon={Home} label="학습하기" active={currentTab === 'home'} onClick={() => setCurrentTab('home')} />
                    <SidebarItem icon={Camera} label="번역기" active={currentTab === 'translator'} onClick={() => setCurrentTab('translator')} />
                    <SidebarItem icon={Wrench} label="저작도구(CMS)" active={currentTab === 'authoring'} onClick={() => setCurrentTab('authoring')} />
                    <SidebarItem icon={Trophy} label="리더보드" active={currentTab === 'leaderboard'} onClick={() => setCurrentTab('leaderboard')} />
                    <SidebarItem icon={User} label="프로필" active={currentTab === 'profile'} onClick={() => setCurrentTab('profile')} />
                </div>
            </nav>

            <main className="flex-1 flex flex-col h-full relative w-full pb-16 md:pb-0 overflow-y-auto bg-gray-50/50">
                {!activeLesson && currentTab !== 'authoring' && <Header stats={stats} />}
                <div className="flex-1 overflow-x-hidden">{renderContent()}</div>
            </main>

            {!activeLesson && (
                <nav className="md:hidden absolute bottom-0 w-full h-16 bg-white border-t-2 border-gray-200 flex justify-around items-center z-50">
                    <IconButton icon={Home} active={currentTab === 'home'} onClick={() => setCurrentTab('home')} label="Home" />
                    <IconButton icon={Camera} active={currentTab === 'translator'} onClick={() => setCurrentTab('translator')} label="Translate" />
                    <IconButton icon={Wrench} active={currentTab === 'authoring'} onClick={() => setCurrentTab('authoring')} label="CMS" />
                    <IconButton icon={Trophy} active={currentTab === 'leaderboard'} onClick={() => setCurrentTab('leaderboard')} label="Rank" />
                </nav>
            )}
        </div>
    );
}