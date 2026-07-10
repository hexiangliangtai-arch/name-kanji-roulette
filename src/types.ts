export type CandidateSource = "external" | "local" | "none";

export type WordCandidate = {
  word: string;
  reading?: string;
};

export type KanjiResult = {
  kanji: string;
  candidates: WordCandidate[];
  selectedWord?: WordCandidate;
  source: CandidateSource;
  notice?: string;
};

export type RouletteStatus = "idle" | "spinning" | "done" | "missing";

export type RouletteCardState = KanjiResult & {
  displayWord: WordCandidate;
  status: RouletteStatus;
};

export type ExternalKanjiResponse = {
  kanji: string;
  candidates: WordCandidate[];
  source: "external";
  pageUrl?: string;
};
