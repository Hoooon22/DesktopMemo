import { useEffect, useState } from "react";
import { QUICK_MEMO, searchNotes } from "../api";
import type { ReactNode } from "react";
import type { SearchHit } from "../api";

type Props = {
  onClose: () => void;
  onSelectNote: (path: string) => void;
  onError: (msg: string) => void;
};

// 검색어와 일치하는 부분을 <mark>로 강조 (대소문자 무시)
function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${esc})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? <mark key={i}>{part}</mark> : part,
  );
}

export default function SearchModal({ onClose, onSelectNote, onError }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);

  // 검색 (200ms 디바운스). 언마운트·재입력 시 늦게 도착한 응답은 무시
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchNotes(q)
        .then((h) => {
          if (!cancelled) {
            setHits(h);
            setIndex(0);
          }
        })
        .catch((e) => {
          if (!cancelled) onError(String(e));
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, onError]);

  // 목록이 바뀌면 선택 인덱스가 범위를 벗어날 수 있으므로 보정
  const activeIndex = hits.length === 0 ? 0 : Math.min(index, hits.length - 1);

  const activate = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onSelectNote(hit.path);
    onClose();
  };

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="command-palette" role="dialog" aria-label="메모 검색">
        <input
          className="palette-input"
          autoFocus
          spellCheck={false}
          placeholder="메모 검색…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            // 모달이 열려 있는 동안 전역 단축키로 이벤트가 새지 않게 격리
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => (hits.length ? (Math.min(i, hits.length - 1) + 1) % hits.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => {
                const cur = Math.min(i, hits.length - 1);
                return hits.length ? (cur - 1 + hits.length) % hits.length : 0;
              });
            } else if (e.key === "Enter") {
              e.preventDefault();
              activate(hits[activeIndex]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="palette-list">
          {query.trim() !== "" && hits.length === 0 && (
            <li className="palette-empty">결과 없음</li>
          )}
          {hits.map((h, i) => (
            <li
              key={h.path}
              className={"palette-item search-hit" + (i === activeIndex ? " active" : "")}
              onMouseMove={() => setIndex(i)}
              onClick={() => activate(h)}
            >
              <span className="hit-name">
                {h.path === QUICK_MEMO
                  ? "⚡ 빠른 메모"
                  : highlight(h.name.replace(/\.md$/i, ""), query)}
              </span>
              {h.snippet && <span className="hit-snippet">{highlight(h.snippet, query)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
