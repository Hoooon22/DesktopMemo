import { getCurrentWindow } from "@tauri-apps/api/window";
import { QUICK_MEMO } from "../api";
import Editor from "./Editor";

type Props = {
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  onHoverChange: (hovering: boolean) => void;
  onExit: () => void;
};

// compact 모드에서는 에디터 헤더가 없어 제목·즐겨찾기 관련 props가 쓰이지 않는다
const unusedRename = async () => false;
const unusedToggleFavorite = () => {};

export default function PopupMemo({
  opacity,
  onOpacityChange,
  onHoverChange,
  onExit,
}: Props) {
  const percent = Math.round(opacity * 100);

  // 프레임이 없으므로 상단 바를 잡아 창을 옮긴다.
  // (data-tauri-drag-region은 더블클릭으로 최대화까지 해 버려서 직접 처리한다)
  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <div
      className="popup-app"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <header className="popup-bar" onMouseDown={startDrag}>
        <span className="popup-title">⚡ 빠른 메모</span>
        <input
          className="opacity-slider"
          type="range"
          min={30}
          max={100}
          step={5}
          value={percent}
          aria-label="투명도"
          title={`투명도 ${percent}% — 마우스를 창 위에 올리면 잠시 또렷해집니다`}
          onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
        />
        <button
          className="popup-btn"
          title="기본 모드로 돌아가기 (Ctrl+Alt+P)"
          aria-label="기본 모드로 돌아가기"
          onClick={onExit}
        >
          ❐
        </button>
        <button
          className="popup-btn"
          title="숨기기 (Ctrl+Alt+M으로 다시 열기)"
          aria-label="숨기기"
          onClick={() => void getCurrentWindow().hide()}
        >
          ×
        </button>
      </header>
      <Editor
        path={QUICK_MEMO}
        compact
        onRename={unusedRename}
        isFavorite={false}
        onToggleFavorite={unusedToggleFavorite}
      />
    </div>
  );
}
