import { useState } from "react";

type DropAt = { path: string; pos: "before" | "after" };

type Props = {
  favorites: string[]; // 순서대로, 실제로 존재하는 메모 경로만
  selected: string;
  onSelect: (path: string) => void;
  onUnfavorite: (path: string) => void;
  onReorder: (dragged: string, target: string, pos: "before" | "after") => void;
};

function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

export default function Favorites({
  favorites,
  selected,
  onSelect,
  onUnfavorite,
  onReorder,
}: Props) {
  // 트리 드래그와 섞이지 않도록 즐겨찾기 안에서만 쓰는 로컬 드래그 상태
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);

  const posFromEvent = (e: React.DragEvent): "before" | "after" => {
    const r = e.currentTarget.getBoundingClientRect();
    return (e.clientY - r.top) / r.height < 0.5 ? "before" : "after";
  };

  return (
    <div className="fav-section">
      <div className="fav-title">즐겨찾기</div>
      <ul className="fav-list">
        {favorites.map((path) => {
          const active = dropAt?.path === path && dragged !== path;
          return (
            <li
              key={path}
              className={"fav-item" + (active ? ` drop-${dropAt!.pos}` : "")}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                // 트리가 읽는 "text/plain" 대신 전용 타입만 실어 서로 간섭하지 않게 한다
                e.dataTransfer.setData("application/x-fav", path);
                setDragged(path);
              }}
              onDragEnd={() => {
                setDragged(null);
                setDropAt(null);
              }}
              onDragOver={(e) => {
                if (!dragged || dragged === path) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropAt({ path, pos: posFromEvent(e) });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const pos = posFromEvent(e);
                setDropAt(null);
                if (dragged && dragged !== path) onReorder(dragged, path, pos);
              }}
            >
              <button
                className={"fav-row" + (selected === path ? " selected" : "")}
                onClick={() => onSelect(path)}
                title={path}
              >
                <span className="pinned-icon">⭐</span>
                <span className="fav-label">{noteName(path)}</span>
              </button>
              <button
                className="fav-remove"
                title="즐겨찾기 해제"
                aria-label={`${noteName(path)} 즐겨찾기 해제`}
                onClick={() => onUnfavorite(path)}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
