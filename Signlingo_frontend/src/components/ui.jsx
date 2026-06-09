import React from 'react';
import { Settings, Zap, Heart, Diamond, Bot } from 'lucide-react';

export const DuoButton = ({ children, variant = 'primary', className = '', onClick, disabled }) => {
    const baseStyle = "relative w-full rounded-2xl font-bold text-lg tracking-wide transition-all active:top-[4px] active:border-b-0 border-b-4 flex justify-center items-center gap-2";
    const variants = {
        primary: "bg-[#58cc02] hover:bg-[#46a302] text-white border-[#58a700]",
        secondary: "bg-white hover:bg-gray-50 text-[#1cb0f6] border-gray-200",
        danger: "bg-[#ff4b4b] hover:bg-[#ff2f2f] text-white border-[#ea2b2b]",
        disabled: "bg-[#e5e5e5] text-[#afafaf] border-[#c4c4c4] active:top-0 cursor-not-allowed"
    };
    return (
        <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${disabled ? variants.disabled : variants[variant]} ${className} py-3 px-6`}>
            {children}
        </button>
    );
};

export const IconButton = ({ icon: Icon, active, onClick, label }) => (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-full h-full p-2 transition-colors ${active ? 'text-[#1cb0f6]' : 'text-gray-400 hover:text-gray-300'}`}>
        <div className={`p-2 rounded-xl ${active ? 'bg-blue-50/50' : 'bg-transparent'}`}><Icon size={28} strokeWidth={active ? 2.5 : 2} /></div>
        <span className="text-[10px] font-bold mt-1 uppercase hidden md:block">{label}</span>
    </button>
);

export const SidebarItem = ({ icon: Icon, label, active, onClick }) => (
    <button onClick={onClick} className={`flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${active ? 'bg-blue-50/50 text-[#1cb0f6] border-2 border-blue-100' : 'text-gray-500 hover:bg-gray-100 border-2 border-transparent'}`}>
        <Icon size={28} strokeWidth={active ? 2.5 : 2} />
        <span className="font-bold text-lg uppercase tracking-wide">{label}</span>
    </button>
);

export const Header = ({ stats }) => (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md px-4 py-3 flex justify-between md:justify-end items-center gap-4 border-b-2 border-gray-100 shrink-0">
        <div className="md:hidden text-xl font-black text-[#58cc02] flex items-center gap-1"><Bot size={24} /> SignLingo</div>
        <div className="flex items-center gap-4 md:gap-6 font-bold text-base md:text-lg">
            <div className="flex items-center gap-1.5 text-orange-500"><Zap size={22} fill="currentColor" /> <span>{stats.streak}</span></div>
            <div className="flex items-center gap-1.5 text-[#ff4b4b]"><Heart size={22} fill="currentColor" /> <span>{stats.hearts}</span></div>
            <div className="flex items-center gap-1.5 text-[#1cb0f6]"><Diamond size={22} fill="currentColor" /> <span>{stats.xp}</span></div>
        </div>
    </header>
);

export const ComingSoon = ({ title }) => (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center h-full">
        <div className="bg-gray-100 p-8 rounded-full mb-6">
            <Settings size={48} className="text-gray-400 animate-spin-slow" />
        </div>
        <h2 className="text-2xl font-black text-gray-700 mb-2">{title}</h2>
        <p className="text-gray-500 font-bold">다음 업데이트에 추가될 기능입니다!</p>
    </div>
);
