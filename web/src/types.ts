export type Mode = "casual" | "analyst" | "zh";

export interface Player {
  id: string;
  name: string;
  team: "home" | "away";
  role: string;
  number: number;
  zh: string;
}

export interface FramePlayer {
  id: string;
  team: "home" | "away";
  number: number;
  x: number;
  y: number;
}

export interface Frame {
  index: number;
  t: number;
  match_t: number;
  source: string;
  ball: { x: number; y: number };
  players: FramePlayer[];
}

export interface XY {
  x: number;
  y: number;
}

export interface Option {
  id: string;
  kind: "pass" | "shot";
  player_id: string;
  receiver_id: string | null;
  taken: boolean;
  decision_score: number;
  label_text: string;
  start: XY;
  end: XY;
}

export interface Ghost {
  id: string;
  option_id: string;
  kind: "pass" | "shot";
  source: string;
  points: Array<{ t: number; x: number; y: number }>;
  probability: number;
  label: { text: string; source: string; name: string };
}

export interface CopyBlock {
  caption: string;
  reveal: string;
  quiz_prompt: string;
  verdict_right: string;
  verdict_wrong: string;
  options: Record<string, string>;
}

export interface Timeline {
  match: {
    id: string;
    fictional: boolean;
    seed: number;
    venue: string;
    minute: number;
    home: { id: string; name: string; short: string; color: string };
    away: { id: string; name: string; short: string; color: string };
    score: { home: number; away: number };
  };
  players: Player[];
  phase: { pitch: { length: number; width: number }; decision_t: number };
  decision_frame: number;
  decision_t: number;
  frames: Frame[];
  taken: Option;
  alternatives: Option[];
  ghosts: Ghost[];
  quiz: { correct_id: string; options: Array<{ id: string; kind: string; end: XY }> };
  copy: Record<Mode, CopyBlock>;
  legend: Array<{ source: string; label: string }>;
  fictional: boolean;
}

export interface TraceMessage {
  sender: string;
  receiver: string;
  intent: string;
  payload: {
    accepted?: boolean;
    reasons?: string[];
    captions?: Record<string, string>;
    text_source?: string;
    ask?: string;
    note?: string;
    attempt?: number;
  };
  evidence_ids: string[];
}

export interface TraceFile {
  seed: number;
  framework: string;
  qa_rejections: number;
  qa_passed: boolean;
  messages: TraceMessage[];
}
