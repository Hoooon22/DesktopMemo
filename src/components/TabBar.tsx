import { useState } from "react";
import { QUICK_MEMO, TODO_VIEW } from "../api";

type Props = {
  tabs: string[];
  selected: string;
  pinned: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
  onCloseOthers: (path: string) => void;
  onCloseRight: (path: string) => void;
  onReorder: (dragged: string, target: string, before: boolean) => void;
  onTogglePin: () => void;
};

// path === null이면 빈 영역 우클릭 (전체 닫기만 표시)
type Menu = { x: number; y: number; path: string | null };

function tabLabel(path: string): string {
  if (path === QUICK_MEMO) return "⚡ 빠른 메모";
  if (path === TODO_VIEW) return "☑️ Todo";
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

export default function TabBar({
  tabs,
  selected,
  pinned,
  onSelect,
  onClose,
  onCloseAll,
  onCloseOthers,
  onCloseRight,
  onReorder,
  onTogglePin,
}: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ path: string; before: boolean } | null>(null);

  const openMenu = (e: React.MouseEvent, path: string | null) => {
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 160),
      path,
    });
  };

  const closeMenuAnd = (action: () => void) => {
    action();
    setMenu(null);
  };

  return (
    <div
      className="tab-bar"
      onContextMenu={(e) => {
        // 탭 위 우클릭은 탭 자체 메뉴가 처리한다
        if ((e.target as HTMLElement).closest(".tab")) return;
        openMenu(e, null);
      }}
    >
      {tabs.map((p) => (
        <div
          key={p}
          className={
            "tab" +
            (p === selected ? " selected" : "") +
            (dropAt?.path === p ? (dropAt.before ? " drop-before" : " drop-after") : "")
          }
          title={p === QUICK_MEMO || p === TODO_VIEW ? undefined : p}
          draggable
          onClick={() => onSelect(p)}
          onContextMenu={(e) => openMenu(e, p)}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault(); // 휠 클릭 자동 스크롤 방지
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(p); // 휠 클릭으로 탭 닫기
          }}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/desktopmemo-tab", p);
            setDragTab(p);
          }}
          onDragOver={(e) => {
            if (!dragTab || dragTab === p) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const r = e.currentTarget.getBoundingClientRect();
            setDropAt({ path: p, before: e.clientX < r.left + r.width / 2 });
          }}
          onDragLeave={() => setDropAt((d) => (d?.path === p ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragTab && dragTab !== p && dropAt?.path === p)
              onReorder(dragTab, p, dropAt.before);
            setDragTab(null);
            setDropAt(null);
          }}
          onDragEnd={() => {
            setDragTab(null);
            setDropAt(null);
          }}
        >
          <span className="tab-label">{tabLabel(p)}</span>
          <button
            className="tab-close"
            title="탭 닫기 (Ctrl+W)"
            aria-label="탭 닫기"
            onClick={(e) => {
              e.stopPropagation();
              onClose(p);
            }}
          >
            ×
          </button>
        </div>
      ))}

      <button
        className={"pin-toggle" + (pinned ? " on" : "")}
        title={pinned ? "항상 위에 고정 해제" : "항상 위에 고정"}
        aria-label={pinned ? "항상 위에 고정 해제" : "항상 위에 고정"}
        onClick={onTogglePin}
      >
        📌
      </button>

      {menu && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            {menu.path !== null && (
              <>
                <button onClick={() => closeMenuAnd(() => onClose(menu.path!))}>탭 닫기</button>
                {tabs.length > 1 && (
                  <button onClick={() => closeMenuAnd(() => onCloseOthers(menu.path!))}>
                    다른 탭 모두 닫기
                  </button>
                )}
                {tabs.indexOf(menu.path) < tabs.length - 1 && (
                  <button onClick={() => closeMenuAnd(() => onCloseRight(menu.path!))}>
                    오른쪽 탭 모두 닫기
                  </button>
                )}
              </>
            )}
            <button onClick={() => closeMenuAnd(onCloseAll)}>전체 닫기</button>
          </div>
        </>
      )}
    </div>
  );
}
