import { AlertCircle, Loader2, RotateCw, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ResultShare } from "./components/ResultShare";
import { extractKanji, pickRandom, resolveKanjiResults } from "./lib/kanji";
import type { ShareResult } from "./lib/share";
import type { KanjiResult, RouletteCardState, WordCandidate } from "./types";

const INITIAL_NAME = "";
const SPIN_INTERVAL_MS = 72;
const STOP_GAP_MS = 620;

function App() {
  const [name, setName] = useState(INITIAL_NAME);
  const [resultName, setResultName] = useState("");
  const [cards, setCards] = useState<RouletteCardState[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const timersRef = useRef<number[]>([]);

  const shareResult = useMemo<ShareResult | null>(() => {
    if (isLoading || isSpinning || cards.length === 0 ||
        cards.some((card) => card.status !== "done" && card.status !== "missing")) {
      return null;
    }
    return {
      name: resultName,
      entries: cards.map(({ kanji, selectedWord }) => ({ kanji, selectedWord })),
    };
  }, [cards, resultName, isLoading, isSpinning]);

  const notices = useMemo(
    () => Array.from(new Set(cards.map((card) => card.notice).filter(Boolean))),
    [cards],
  );

  useEffect(() => {
    if (window.location.hash === "#name-input") {
      document.getElementById("name-input")?.focus();
    }
    return () => clearTimers(timersRef.current);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearTimers(timersRef.current);
    setError("");
    setIsLoading(true);
    setIsSpinning(false);

    const kanjiList = extractKanji(name);
    if (name.trim().length === 0) {
      setCards([]);
      setError("名前を入力してください。");
      setIsLoading(false);
      return;
    }

    if (kanjiList.length === 0) {
      setCards([]);
      setError("対象になる漢字が見つかりませんでした。漢字を含む名前を入力してください。");
      setIsLoading(false);
      return;
    }

    try {
      const results = await resolveKanjiResults(kanjiList);
      const nextCards = results.map(createInitialCard);
      setResultName(name.trim());
      setCards(nextCards);
      setIsLoading(false);
      startRoulette(nextCards);
    } catch (fetchError) {
      console.error("Failed to prepare roulette", fetchError);
      setCards([]);
      setError("候補の準備に失敗しました。時間をおいてもう一度お試しください。");
      setIsLoading(false);
    }
  }

  function startRoulette(nextCards: RouletteCardState[]) {
    clearTimers(timersRef.current);
    setIsSpinning(true);

    nextCards.forEach((card, index) => {
      if (card.candidates.length === 0) {
        const missingTimer = window.setTimeout(() => {
          setCards((current) =>
            current.map((item, cardIndex) =>
              cardIndex === index
                ? { ...item, status: "missing", displayWord: { word: "候補なし" } }
                : item,
            ),
          );
          if (index === nextCards.length - 1) {
            setIsSpinning(false);
          }
        }, index * STOP_GAP_MS);
        timersRef.current.push(missingTimer);
        return;
      }

      const interval = window.setInterval(() => {
        setCards((current) =>
          current.map((item, cardIndex) =>
            cardIndex === index
              ? { ...item, displayWord: pickRandom(item.candidates) ?? item.displayWord }
              : item,
          ),
        );
      }, SPIN_INTERVAL_MS);

      const stopTimer = window.setTimeout(
        () => {
          window.clearInterval(interval);
          const selectedWord = pickRandom(card.candidates) ?? card.candidates[0];

          setCards((current) =>
            current.map((item, cardIndex) =>
              cardIndex === index
                ? {
                    ...item,
                    selectedWord,
                    displayWord: selectedWord,
                    status: "done",
                  }
                : item,
            ),
          );

          if (index === nextCards.length - 1) {
            const finishTimer = window.setTimeout(() => setIsSpinning(false), 180);
            timersRef.current.push(finishTimer);
          }
        },
        980 + index * STOP_GAP_MS,
      );

      timersRef.current.push(interval, stopTimer);
    });
  }

  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">名前からひらく熟語の一文字</p>
        <h1 id="page-title">名前漢字ルーレット</h1>
        <p className="description">
          名前に含まれる漢字だけを拾い、その漢字が使われている熟語をルーレットで選びます。
        </p>

        <form className="name-form" onSubmit={handleSubmit}>
          <label htmlFor="name-input">名前</label>
          <div className="input-row">
            <input
              id="name-input"
              value={name}
              placeholder="例：山田太郎"
              onChange={(event) => setName(event.target.value)}
              disabled={isLoading || isSpinning}
            />
            <button type="submit" disabled={isLoading || isSpinning}>
              {isLoading ? <Loader2 className="spin-icon" size={18} /> : <RotateCw size={18} />}
              <span>{isLoading ? "準備中" : isSpinning ? "進行中" : "スタート"}</span>
            </button>
          </div>
        </form>

        {error && (
          <p className="error-message" role="alert">
            <AlertCircle size={18} />
            {error}
          </p>
        )}
      </section>

      {cards.length > 0 && (
        <section className="roulette-area" aria-label="漢字ごとのルーレット">
          <div className="cards-grid">
            {cards.map((card, index) => (
              <RouletteCard card={card} key={`${card.kanji}-${index}`} order={index + 1} />
            ))}
          </div>

          {notices.length > 0 && (
            <div className="notice-list" aria-label="候補取得の状態">
              {notices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
            </div>
          )}
        </section>
      )}

      {shareResult && (
        <section className="summary" aria-labelledby="summary-title">
          <div className="summary-title">
            <Sparkles size={20} />
            <h2 id="summary-title">まとめ結果</h2>
          </div>
          <ol>
            {cards.map((card, index) => (
              <li key={`${card.kanji}-result-${index}`}>
                {card.selectedWord
                  ? (
                    <>
                      <WordWithReading candidate={card.selectedWord} />
                      の『{card.kanji}』
                    </>
                  )
                  : (
                    `候補が見つかりませんでした：「${card.kanji}」`
                  )}
              </li>
            ))}
          </ol>
          <ResultShare result={shareResult} />
        </section>
      )}
    </main>
  );
}

function RouletteCard({ card, order }: { card: RouletteCardState; order: number }) {
  return (
    <article className={`roulette-card ${card.status}`}>
      <div className="card-topline">
        <span>{order}文字目</span>
      </div>
      <div className="kanji-mark">{card.kanji}</div>
      <div className="word-window" aria-live="polite">
        <WordWithReading candidate={card.displayWord} />
      </div>
      <p className="result-line">
        {card.selectedWord
          ? (
            <>
              <WordWithReading candidate={card.selectedWord} />
              の『{card.kanji}』
            </>
          )
          : card.status === "missing"
            ? `候補が見つかりませんでした：「${card.kanji}」`
            : "候補を選んでいます"}
      </p>
    </article>
  );
}

function createInitialCard(result: KanjiResult): RouletteCardState {
  return {
    ...result,
    displayWord: result.candidates[0] ?? { word: "候補なし" },
    status: result.candidates.length > 0 ? "spinning" : "missing",
  };
}

function WordWithReading({ candidate }: { candidate: WordCandidate }) {
  if (!candidate.reading) {
    return <>{candidate.word}</>;
  }

  return (
    <ruby>
      {candidate.word}
      <rt>{candidate.reading}</rt>
    </ruby>
  );
}

function clearTimers(timers: number[]) {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.length = 0;
}

export default App;
