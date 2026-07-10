import { getLocalCandidates } from "../data/localDictionary";
import type { ExternalKanjiResponse, KanjiResult, WordCandidate } from "../types";

const externalCache = new Map<string, WordCandidate[]>();

export function extractKanji(input: string): string[] {
  const normalized = input.replace(/\s+/g, "");
  return Array.from(normalized).filter(isKanji);
}

export function uniqueCharacters(characters: string[]): string[] {
  return Array.from(new Set(characters));
}

export function isKanji(character: string): boolean {
  return /\p{Script=Han}/u.test(character);
}

export async function resolveKanjiResults(kanjiList: string[]): Promise<KanjiResult[]> {
  const unique = uniqueCharacters(kanjiList);
  const resolved = new Map<string, KanjiResult>();

  await Promise.all(
    unique.map(async (kanji) => {
      resolved.set(kanji, await resolveKanjiResult(kanji));
    }),
  );

  return kanjiList.map((kanji) => resolved.get(kanji) ?? createNoneResult(kanji));
}

async function resolveKanjiResult(kanji: string): Promise<KanjiResult> {
  const localCandidates = getLocalCandidates(kanji);

  try {
    const externalCandidates = await fetchExternalCandidates(kanji);
    if (externalCandidates.length > 0) {
      return {
        kanji,
        candidates: externalCandidates,
        source: "external",
      };
    }
  } catch (error) {
    console.error(`External candidate fetch failed for ${kanji}`, error);
  }

  if (localCandidates.length > 0) {
    return {
      kanji,
      candidates: localCandidates,
      source: "local",
      notice: "候補取得に失敗したため、ローカル辞書を使用しました。",
    };
  }

  return createNoneResult(kanji);
}

async function fetchExternalCandidates(kanji: string): Promise<WordCandidate[]> {
  const cached = externalCache.get(kanji);
  if (cached) {
    return cached;
  }

  const response = await fetch(`/api/kanji?kanji=${encodeURIComponent(kanji)}`);
  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  const payload = (await response.json()) as ExternalKanjiResponse;
  const candidates = sanitizeCandidates(payload.candidates, kanji);
  externalCache.set(kanji, candidates);
  return candidates;
}

function sanitizeCandidates(candidates: WordCandidate[], kanji: string): WordCandidate[] {
  const unique = new Map<string, WordCandidate>();

  for (const candidate of candidates) {
    const word = candidate.word.trim();
    const reading = candidate.reading?.trim();

    if (word.includes(kanji) && word.length >= 2 && word.length <= 8 && !unique.has(word)) {
      unique.set(word, reading ? { word, reading } : { word });
    }
  }

  return Array.from(unique.values()).slice(0, 48);
}

function createNoneResult(kanji: string): KanjiResult {
  return {
    kanji,
    candidates: [],
    source: "none",
    notice: `候補が見つかりませんでした：「${kanji}」`,
  };
}

export function pickRandom(candidates: WordCandidate[]): WordCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}
