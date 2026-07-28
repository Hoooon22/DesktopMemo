import { QUICK_MEMO, TODO_VIEW } from "../api";

type Props = {
  tabs: string[];
  selected: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

function tabLabel(path: string): string {
  if (path === QUICK_MEMO) return "⚡ 빠른 메모";
  if (path === TODO_VIEW) return "☑️ Todo";
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

export default function TabBar({ tabs, selected, onSelect, onClose }: Props) {
  return (
    <div className="tab-bar">
      {tabs.map((p) => (
        <div
          key={p}
          className={"tab" + (p === selected ? " selected" : "")}
          title={p === QUICK_MEMO || p === TODO_VIEW ? undefined : p}
          onClick={() => onSelect(p)}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault(); // 휠 클릭 자동 스크롤 방지
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(p); // 휠 클릭으로 탭 닫기
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
    </div>
  );
}
