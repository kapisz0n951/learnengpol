
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
    GameState, 
    PlayerRole, 
    GameMode, 
    Difficulty, 
    Word, 
    PlayerData,
    PeerMessageType,
    PeerMessage,
    MainCategory
} from './types';
import { CATEGORIES_DATA, TOTAL_QUESTIONS } from './constants';
import { getWordHint } from './services/geminiService';

// --- UI Components ---

const Button = ({ 
    children, 
    onClick, 
    className = "", 
    variant = "primary", 
    disabled = false 
}: { 
    children: React.ReactNode; 
    onClick?: () => void; 
    className?: string; 
    variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
    disabled?: boolean;
}) => {
    const base = "px-6 py-4 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 text-sm";
    const variants = {
        primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200",
        secondary: "bg-white text-gray-800 border-2 border-gray-100 hover:border-indigo-200 hover:bg-indigo-50",
        danger: "bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-200",
        success: "bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-200",
        ghost: "bg-transparent text-gray-500 hover:bg-gray-100"
    };
    return (
        <button 
            disabled={disabled}
            onClick={onClick} 
            className={`${base} ${variants[variant]} ${className}`}
        >
            {children}
        </button>
    );
};

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`glass-panel rounded-3xl p-6 shadow-xl ${className}`}>
        {children}
    </div>
);

// --- Helpers ---

const shuffle = <T,>(array: T[]): T[] => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

// --- Main App ---

export default function App() {
    const [view, setView] = useState<'menu' | 'role' | 'teacher-lobby' | 'student-join' | 'student-wait' | 'teacher-dashboard' | 'teacher-results' | 'start' | 'game' | 'summary'>('menu');
    const [role, setRole] = useState<PlayerRole>('single');
    const [gameState, setGameState] = useState<GameState>({
        mainCategory: 'words',
        currentCategory: null,
        difficulty: 'normal',
        mode: 'translation',
        currentQuestionIndex: 0,
        score: 0,
        isGameActive: false,
        history: []
    });
    const [wordsQueue, setWordsQueue] = useState<Word[]>([]);
    const [roomCode, setRoomCode] = useState<string>('');
    const [nick, setNick] = useState<string>('');
    const [players, setPlayers] = useState<Record<string, PlayerData>>({});
    
    // Spelling mode specific state
    const [spellingLetters, setSpellingLetters] = useState<string[]>([]);
    const [placedLetters, setPlacedLetters] = useState<(string | null)[]>([]);

    const peerRef = useRef<any>(null);
    const connRef = useRef<any>(null);
    const connsRef = useRef<Record<string, any>>({});

    useEffect(() => {
        return () => { if (peerRef.current) peerRef.current.destroy(); };
    }, []);

    const playAudio = useCallback((text: string) => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'en-US';
            u.rate = 0.85;
            window.speechSynthesis.speak(u);
        }
    }, []);

    const startGame = useCallback((mainCat: MainCategory, subCat: string, diff: Difficulty = 'normal', mode: GameMode = 'translation') => {
        const sourceData = CATEGORIES_DATA[mainCat][subCat];
        if (!sourceData) return;
        const words = shuffle([...sourceData]).slice(0, TOTAL_QUESTIONS);
        setWordsQueue(words);
        setGameState({ mainCategory: mainCat, currentCategory: subCat, difficulty: diff, mode: mode, currentQuestionIndex: 0, score: 0, isGameActive: true, history: [] });
        setView('game');
    }, []);

    // Effect to setup spelling letters when question changes
    useEffect(() => {
        if (gameState.isGameActive && gameState.mode === 'spelling') {
            const currentWord = wordsQueue[gameState.currentQuestionIndex];
            if (currentWord) {
                const letters = currentWord.en.toUpperCase().split('').filter(char => char !== ' ');
                setSpellingLetters(shuffle(letters));
                setPlacedLetters(new Array(letters.length).fill(null));
                playAudio(currentWord.en);
            }
        }
    }, [gameState.currentQuestionIndex, gameState.isGameActive, gameState.mode, wordsQueue]);

    const handleAnswer = async (selected: string) => {
        if (!gameState.isGameActive) return;
        const currentWord = wordsQueue[gameState.currentQuestionIndex];
        
        // FIX: In translation and spelling modes, we check against the English word. 
        // In listening mode, we check against the Polish word.
        const correct = (gameState.mode === 'translation' || gameState.mode === 'spelling') ? currentWord.en : currentWord.pl;
        const isCorrect = selected.toLowerCase().trim() === correct.toLowerCase().trim();

        if (!isCorrect) {
            if (role === 'student' && connRef.current) {
                connRef.current.send({ type: PeerMessageType.UPDATE_SCORE, payload: { score: 0, progress: 0, status: 'restart' } });
            }
            // Start from the beginning as requested
            startGame(gameState.mainCategory, gameState.currentCategory!, gameState.difficulty, gameState.mode);
            return;
        }

        const nextScore = gameState.score + 1;
        const nextIndex = gameState.currentQuestionIndex + 1;

        setGameState(prev => ({
            ...prev, score: nextScore, currentQuestionIndex: nextIndex,
            history: [...prev.history, { word: currentWord, selected, correct: String(correct), isCorrect }]
        }));

        if (role === 'student' && connRef.current) {
            connRef.current.send({ 
                type: PeerMessageType.UPDATE_SCORE, 
                payload: { 
                    score: nextScore, 
                    progress: nextIndex, 
                    status: nextIndex >= TOTAL_QUESTIONS ? 'finished' : 'playing' 
                } 
            });
        }

        if (nextIndex >= TOTAL_QUESTIONS) { 
            setView('summary'); 
        }
    };

    // Spelling mode logic
    const handleLetterClick = (letter: string) => {
        const newPlaced = [...placedLetters];
        const emptyIndex = newPlaced.indexOf(null);
        if (emptyIndex !== -1) {
            newPlaced[emptyIndex] = letter;
            setPlacedLetters(newPlaced);
            
            // Check if full
            if (newPlaced.indexOf(null) === -1) {
                const formedWord = newPlaced.join('');
                const targetWord = wordsQueue[gameState.currentQuestionIndex].en.toUpperCase().replace(/\s/g, '');
                
                if (formedWord === targetWord) {
                    handleAnswer(targetWord);
                } else {
                    // Trigger incorrect answer immediately to restart game
                    handleAnswer(formedWord);
                }
            }
        }
    };

    const handlePlacedClick = (index: number) => {
        const newPlaced = [...placedLetters];
        newPlaced[index] = null;
        setPlacedLetters(newPlaced);
    };

    // --- Networking ---

    const broadcast = useCallback((message: PeerMessage) => {
        Object.values(connsRef.current).forEach((conn: any) => {
            if (conn && conn.open) conn.send(message);
        });
    }, []);

    const setupTeacher = () => {
        setPlayers({});
        connsRef.current = {};
        if (peerRef.current) peerRef.current.destroy();
        const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'.charAt(Math.floor(Math.random() * 24))).join('');
        setRoomCode(code);
        const peer = new (window as any).Peer(`vocab-game-${code}`);
        peerRef.current = peer;
        peer.on('open', () => setView('teacher-lobby'));
        peer.on('connection', (conn: any) => {
            conn.on('data', (data: PeerMessage) => {
                if (data.type === PeerMessageType.JOIN) {
                    setPlayers(prev => ({ ...prev, [conn.peer]: { id: conn.peer, nick: data.payload.nick, score: 0, progress: 0, status: 'playing' } }));
                    connsRef.current[conn.peer] = conn;
                }
                if (data.type === PeerMessageType.UPDATE_SCORE) {
                    setPlayers(prev => ({ ...prev, [conn.peer]: { ...prev[conn.peer], ...data.payload } }));
                }
            });
        });
    };

    const setupStudent = (code: string, nickname: string) => {
        if (peerRef.current) peerRef.current.destroy();
        const peer = new (window as any).Peer();
        peerRef.current = peer;
        peer.on('open', () => {
            const conn = peer.connect(`vocab-game-${code.toUpperCase()}`);
            connRef.current = conn;
            conn.on('open', () => {
                conn.send({ type: PeerMessageType.JOIN, payload: { nick: nickname } });
                setView('student-wait');
            });
            conn.on('data', (data: PeerMessage) => {
                if (data.type === PeerMessageType.START_GAME) {
                    const { mainCategory, category, difficulty, mode } = data.payload;
                    startGame(mainCategory, category, difficulty, mode);
                }
                if (data.type === PeerMessageType.GAME_OVER) { handleExitToMenu(); }
            });
        });
    };

    const handleExitToMenu = () => {
        if (peerRef.current) peerRef.current.destroy();
        connRef.current = null;
        connsRef.current = {};
        setPlayers({});
        setRoomCode('');
        setView('menu');
        setGameState(prev => ({ ...prev, score: 0, currentQuestionIndex: 0, isGameActive: false, history: [] }));
    };

    // --- Render Parts ---

    const renderGame = () => {
        const currentWord = wordsQueue[gameState.currentQuestionIndex];
        if (!currentWord) return null;

        if (gameState.mode === 'spelling') {
            return (
                <div className="flex flex-col h-full gap-6">
                    <div className="flex items-center justify-between">
                        <Button onClick={handleExitToMenu} variant="ghost" className="!px-3 !py-2 !text-xs">Wyjdź</Button>
                        <div className="flex-1 mx-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${(gameState.currentQuestionIndex / TOTAL_QUESTIONS) * 100}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-indigo-400">{gameState.currentQuestionIndex + 1} / {TOTAL_QUESTIONS}</span>
                    </div>

                    <div className="flex flex-col items-center gap-4 py-6">
                        <button 
                            onClick={() => playAudio(currentWord.en)}
                            className="w-20 h-20 bg-indigo-600 text-white rounded-full flex items-center justify-center text-3xl shadow-lg hover:scale-110 active:scale-95 transition-all"
                        >
                            🔊
                        </button>
                        <p className="text-xl font-bold text-gray-800 uppercase tracking-widest">{currentWord.pl}</p>
                    </div>

                    {/* Placed Letters slots */}
                    <div className="flex flex-wrap justify-center gap-2 mb-8 min-h-[60px]">
                        {placedLetters.map((letter, i) => (
                            <div 
                                key={i} 
                                onClick={() => letter && handlePlacedClick(i)}
                                className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-black transition-all ${letter ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-md cursor-pointer' : 'bg-gray-50 border-dashed border-gray-300'}`}
                            >
                                {letter}
                            </div>
                        ))}
                    </div>

                    {/* Shuffled Letters bank */}
                    <div className="mt-auto pb-6">
                        <p className="text-[10px] font-bold text-center text-gray-400 uppercase tracking-widest mb-4">Ułóż słowo klikając literki:</p>
                        <div className="flex flex-wrap justify-center gap-3">
                            {spellingLetters.map((letter, i) => (
                                <button
                                    key={i}
                                    onClick={() => handleLetterClick(letter)}
                                    className="w-14 h-14 bg-white border-2 border-gray-100 rounded-2xl flex items-center justify-center text-2xl font-black text-indigo-600 shadow-sm hover:border-indigo-200 hover:bg-indigo-50 active:scale-90 transition-all"
                                >
                                    {letter}
                                </button>
                            ))}
                        </div>
                        <div className="mt-6 flex justify-center">
                            <button onClick={() => setPlacedLetters(new Array(placedLetters.length).fill(null))} className="text-xs font-bold text-indigo-400 hover:text-indigo-600 underline">Wyczyść wszystko</button>
                        </div>
                    </div>
                </div>
            );
        }

        const otherWords = CATEGORIES_DATA[gameState.mainCategory][gameState.currentCategory!].filter(w => w.id !== currentWord.id);
        const distractorsCount = gameState.difficulty === 'easy' ? 1 : gameState.difficulty === 'hard' ? 5 : 3;
        const options = shuffle([
            gameState.mode === 'translation' ? currentWord.en : currentWord.pl, 
            ...shuffle(otherWords).slice(0, distractorsCount).map(w => gameState.mode === 'translation' ? w.en : w.pl)
        ]);

        return (
            <div className="flex flex-col h-full gap-8">
                <div className="flex items-center justify-between">
                    <Button onClick={handleExitToMenu} variant="ghost" className="!px-3 !py-2 !text-xs">Wyjdź</Button>
                    <div className="flex-1 mx-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${(gameState.currentQuestionIndex / TOTAL_QUESTIONS) * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-indigo-400">{gameState.currentQuestionIndex + 1} / {TOTAL_QUESTIONS}</span>
                </div>
                <div className="flex flex-col items-center justify-center flex-1 text-center py-4">
                    {gameState.mode === 'listening' ? <button onClick={() => playAudio(currentWord.en)} className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-4xl hover:scale-110 active:scale-95 shadow-inner border-2 border-indigo-100">🔊</button> : 
                    <h2 className={`${gameState.mainCategory === 'phrases' ? 'text-2xl' : 'text-4xl'} font-black text-indigo-900 mb-2 leading-tight px-4`}>{currentWord.pl}</h2>}
                </div>
                <div className="grid gap-3 w-full">
                    {options.map((opt: any, i) => (
                        <Button key={i} variant="secondary" className="h-16 text-lg justify-start hover:bg-indigo-600 hover:text-white" onClick={() => handleAnswer(opt)}>{opt}</Button>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4">
            <Card className="w-full max-w-lg min-h-[650px] flex flex-col justify-between overflow-hidden">
                {view === 'menu' && (
                    <div className="flex flex-col gap-6 items-center text-center">
                        <h1 className="text-5xl font-black text-indigo-700">Słówka Pro</h1>
                        <p className="text-gray-500">Wybierz tryb i baw się nauką!</p>
                        <div className="grid grid-cols-1 w-full gap-4">
                            <Button onClick={() => { setRole('single'); setView('start'); }} className="h-24 text-2xl">👤 Gra Solo</Button>
                            <Button onClick={() => setView('role')} className="h-24 text-2xl" variant="secondary">👥 Razem ze szkołą</Button>
                        </div>
                    </div>
                )}
                {view === 'role' && (
                    <div className="flex flex-col gap-6 items-center text-center">
                        <h2 className="text-3xl font-bold text-indigo-700">Multiplayer</h2>
                        <div className="grid grid-cols-1 w-full gap-4">
                            <Button onClick={() => { setRole('teacher'); setupTeacher(); }} className="h-20" variant="primary">🎓 Nauczyciel (Host)</Button>
                            <Button onClick={() => { setRole('student'); setView('student-join'); }} className="h-20" variant="secondary">🎒 Uczeń (Dołącz)</Button>
                        </div>
                        <Button onClick={() => setView('menu')} variant="ghost">Powrót</Button>
                    </div>
                )}
                {view === 'teacher-lobby' && (
                    <div className="flex flex-col gap-6 items-center">
                        <div className="text-center"><p className="text-xs font-bold text-indigo-500 uppercase mb-1">Kod:</p><div className="text-5xl font-black text-indigo-700 tracking-widest">{roomCode}</div></div>
                        <div className="w-full bg-indigo-50 p-4 rounded-xl border border-indigo-100 max-h-40 overflow-y-auto">
                            <h3 className="font-bold text-indigo-900 mb-2">Uczniowie ({Object.keys(players).length}):</h3>
                            <ul className="space-y-1">{Object.values(players).map(p => (<li key={p.id} className="bg-white px-3 py-1 rounded text-sm font-bold">{p.nick}</li>))}</ul>
                        </div>
                        <div className="w-full space-y-4">
                            <select className="w-full p-3 rounded-xl border-2 border-transparent bg-white shadow-sm font-bold text-sm" value={gameState.mode} onChange={(e) => setGameState(p => ({ ...p, mode: e.target.value as GameMode }))}>
                                <option value="translation">Tłumaczenie (Standard)</option>
                                <option value="listening">Słuchanie</option>
                                {gameState.mainCategory === 'words' && <option value="spelling">Układanie ze słuchu 🔠</option>}
                            </select>
                            <Button disabled={!gameState.currentCategory || Object.keys(players).length === 0} onClick={() => { broadcast({ type: PeerMessageType.START_GAME, payload: { mainCategory: gameState.mainCategory, category: gameState.currentCategory, difficulty: gameState.difficulty, mode: gameState.mode } }); setView('teacher-dashboard'); }} className="w-full h-16">Start</Button>
                        </div>
                    </div>
                )}
                {view === 'student-join' && (
                    <div className="flex flex-col gap-6 items-center">
                        <h2 className="text-3xl font-bold text-indigo-700">Dołącz</h2>
                        <input type="text" className="w-full p-4 rounded-xl border-2 font-bold" placeholder="Twój nick" onChange={(e) => setNick(e.target.value)} />
                        <input type="text" className="w-full p-4 rounded-xl border-2 font-bold uppercase" placeholder="Kod" maxLength={5} onChange={(e) => setRoomCode(e.target.value)} />
                        <Button disabled={!roomCode || !nick} onClick={() => setupStudent(roomCode, nick)} className="w-full h-16">Dołącz teraz</Button>
                    </div>
                )}
                {view === 'student-wait' && (
                    <div className="flex flex-col gap-6 items-center text-center justify-center flex-1">
                        <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center animate-bounce text-4xl">🎒</div>
                        <h2 className="text-2xl font-bold text-indigo-700">Oczekiwanie na nauczyciela...</h2>
                        <Button onClick={handleExitToMenu} variant="ghost">Wyjdź</Button>
                    </div>
                )}
                {view === 'teacher-dashboard' && (
                    <div className="flex flex-col gap-6 h-full">
                         <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold text-indigo-700">Panel Nauczyciela</h2>
                        </div>
                        <div className="flex-1 space-y-4 overflow-y-auto">
                            {Object.values(players).map(p => (
                                <div key={p.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
                                    <div>
                                        <p className="font-bold text-gray-800">{p.nick}</p>
                                        <div className="w-32 h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
                                            <div className="h-full bg-emerald-500" style={{ width: `${(p.progress / TOTAL_QUESTIONS) * 100}%` }} />
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xl font-black text-indigo-600">{p.score}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Button onClick={() => { broadcast({ type: PeerMessageType.GAME_OVER }); handleExitToMenu(); }} variant="danger">Zakończ grę</Button>
                    </div>
                )}
                {view === 'start' && (
                    <div className="flex flex-col gap-6">
                        <h2 className="text-3xl font-bold text-center text-indigo-700">Ustawienia</h2>
                        <div className="space-y-4">
                            <p className="text-xs font-bold text-gray-400 uppercase text-center">Typ i kategoria</p>
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant={gameState.mainCategory === 'words' ? 'primary' : 'secondary'} onClick={() => setGameState(p => ({ ...p, mainCategory: 'words', currentCategory: null }))}>Słowa</Button>
                                <Button variant={gameState.mainCategory === 'phrases' ? 'primary' : 'secondary'} onClick={() => setGameState(p => ({ ...p, mainCategory: 'phrases', currentCategory: null }))}>Zwroty</Button>
                            </div>
                            <div className="flex flex-wrap gap-2 justify-center max-h-40 overflow-y-auto">
                                {Object.keys(CATEGORIES_DATA[gameState.mainCategory]).map(cat => (
                                    <button key={cat} onClick={() => setGameState(p => ({ ...p, currentCategory: cat }))} className={`px-4 py-2 rounded-xl text-xs font-bold border ${gameState.currentCategory === cat ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'}`}>
                                        {cat.toUpperCase()}
                                    </button>
                                ))}
                            </div>
                            <select className="w-full p-3 rounded-xl border-2 border-transparent bg-white shadow-sm font-bold text-sm" value={gameState.mode} onChange={(e) => setGameState(p => ({ ...p, mode: e.target.value as GameMode }))}>
                                <option value="translation">Tłumaczenie</option>
                                <option value="listening">Słuchanie</option>
                                {gameState.mainCategory === 'words' && <option value="spelling">Układanie ze słuchu 🔠</option>}
                            </select>
                        </div>
                        <Button disabled={!gameState.currentCategory} onClick={() => startGame(gameState.mainCategory, gameState.currentCategory!, gameState.difficulty, gameState.mode)} className="w-full h-20 text-2xl">Start!</Button>
                        <Button onClick={handleExitToMenu} variant="ghost">Powrót</Button>
                    </div>
                )}
                {view === 'game' && renderGame()}
                {view === 'summary' && (
                    <div className="flex flex-col gap-8 text-center items-center justify-center flex-1">
                        <div className="text-8xl">🥇</div><h2 className="text-4xl font-black text-indigo-700">Brawo!</h2><p className="text-gray-500 font-bold">Zebrałeś {gameState.score} punktów!</p><Button onClick={handleExitToMenu} className="w-full h-16">Menu główne</Button>
                    </div>
                )}
            </Card>
        </div>
    );
}
