
export interface Word {
  id: string;
  pl: string;
  en: string;
  emoji?: string;
}

export type MainCategory = 'words' | 'phrases';
export type GameMode = 'translation' | 'listening' | 'spelling';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type PlayerRole = 'teacher' | 'student' | 'single';

export interface GameState {
  mainCategory: MainCategory;
  currentCategory: string | null;
  difficulty: Difficulty;
  mode: GameMode;
  currentQuestionIndex: number;
  score: number;
  isGameActive: boolean;
  history: Array<{
    word: Word;
    selected: string;
    correct: string;
    isCorrect: boolean;
  }>;
}

export interface PlayerData {
  id: string;
  nick: string;
  score: number;
  progress: number;
  status: 'playing' | 'restart' | 'finished';
}

export enum PeerMessageType {
  JOIN = 'JOIN',
  START_GAME = 'START_GAME',
  UPDATE_SCORE = 'UPDATE_SCORE',
  GAME_OVER = 'GAME_OVER'
}

export interface PeerMessage {
  type: PeerMessageType;
  payload?: any;
}
