import { useEffect, useMemo, useState } from "react";
import {
  buildShareLinks,
  buildShareText,
  canShareImage,
  createResultImage,
  getSiteUrl,
  isShareCancelled,
  SHARE_TITLE,
} from "../lib/share";
import type { ShareResult } from "../lib/share";

type ImageState =
  | { result: ShareResult; status: "loading" | "error" }
  | { result: ShareResult; status: "ready"; file: File; url: string };

export function ResultShare({ result }: { result: ShareResult }) {
  const siteUrl = useMemo(() => getSiteUrl(window.location.href), []);
  const text = useMemo(() => buildShareText(result), [result]);
  const links = useMemo(() => buildShareLinks(text, siteUrl), [text, siteUrl]);
  const fullText = `${text}\n${siteUrl}`;
  const [image, setImage] = useState<ImageState>({ result, status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [isSharing, setIsSharing] = useState(false);
  const [message, setMessage] = useState("");
  const [showCopyFallback, setShowCopyFallback] = useState(false);
  const currentImage = image.result === result ? image : null;
  const readyImage = currentImage?.status === "ready" ? currentImage : null;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setImage({ result, status: "loading" });
    createResultImage(result, siteUrl).then((file) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(file);
      setImage({ result, status: "ready", file, url: objectUrl });
    }).catch(() => {
      if (!cancelled) setImage({ result, status: "error" });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [result, siteUrl, attempt]);

  async function shareImage() {
    if (!readyImage || isSharing) return;
    setMessage("");
    setIsSharing(true);
    try {
      // Keep this call before any await so the browser retains user activation.
      await navigator.share({ files: [readyImage.file], title: SHARE_TITLE, text, url: siteUrl });
    } catch (error) {
      if (!isShareCancelled(error)) {
        setMessage("画像を共有できませんでした。画像を保存して、共有先で添付してください。");
      }
    } finally {
      setIsSharing(false);
    }
  }

  async function copyText() {
    setMessage("");
    try {
      await navigator.clipboard.writeText(fullText);
      setShowCopyFallback(false);
      setMessage("共有文をコピーしました。");
    } catch {
      setShowCopyFallback(true);
      setMessage("コピーできませんでした。下の共有文を選択してコピーしてください。");
    }
  }

  function saveImage() {
    if (!readyImage) return;
    const link = document.createElement("a");
    link.href = readyImage.url;
    link.download = readyImage.file.name;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <section className="result-share" aria-labelledby="share-title">
      <h3 id="share-title">結果をシェア</h3>
      <p className="share-caption">{result.name}さんの結果を、画像や文章で共有できます。</p>

      <div className="share-preview" aria-busy={!currentImage || currentImage.status === "loading"}>
        {readyImage ? (
          <img src={readyImage.url} alt={`${result.name}さんの結果画像。内容は上のまとめ結果をご覧ください。`} width={1080} />
        ) : currentImage?.status === "error" ? (
          <div className="share-placeholder">
            <p role="alert">画像を作成できませんでした。文章とリンクは共有できます。</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>画像を再生成</button>
          </div>
        ) : (
          <p className="share-placeholder" role="status">結果画像を作成中…</p>
        )}
      </div>

      <div className="share-actions">
        <a className="share-x" href={links.x} target="_blank" rel="noopener noreferrer">Xで共有</a>
        <a className="share-line" href={links.line} target="_blank" rel="noopener noreferrer">LINEで共有</a>
        {(!readyImage || canShareImage(readyImage.file)) && (
          <button type="button" onClick={shareImage} disabled={!readyImage || isSharing}>
            {isSharing ? "共有中…" : "画像を共有"}
          </button>
        )}
        <button type="button" onClick={saveImage} disabled={!readyImage}>画像を保存</button>
        <button type="button" onClick={copyText}>共有文をコピー</button>
      </div>
      <p className="share-help">
        X・LINEのボタンでは文章とリンクを共有します。画像は保存して添付するか、端末の共有メニューをご利用ください。
        共有先によって文章やリンクが添付されない場合は、共有文をコピーして追加できます。
      </p>
      {message && <p className="share-message" role="status">{message}</p>}
      {showCopyFallback && (
        <label className="share-copy-fallback">
          共有文
          <textarea readOnly value={fullText} rows={6} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
    </section>
  );
}
