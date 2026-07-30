import { useState } from "react";

type Props = {
  pending: number; // 남은 할 일 개수
  onAdd: (text: string) => void;
  onClose: () => void;
};

// 어디서든 Ctrl+T로 띄우는 할 일 추가 창. Enter로 연달아 여러 개를 넣을 수
// 있고, 빈 입력에서 Enter 또는 Esc로 닫는다.
export default function QuickAddTodo({ pending, onAdd, onClose }: Props) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState(0);

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="command-palette" role="dialog" aria-label="할 일 추가">
        <input
          className="palette-input"
          autoFocus
          spellCheck={false}
          placeholder="할 일 입력 후 Enter"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 창이 열려 있는 동안 전역 단축키로 이벤트가 새지 않게 격리
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              if (!text.trim()) {
                onClose();
                return;
              }
              onAdd(text);
              setText("");
              setAdded((n) => n + 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="quick-add-hint">
          {added > 0 && <span className="quick-add-added">{added}개 추가됨</span>}
          <span>남은 할 일 {pending}개</span>
          <span className="quick-add-keys">Enter 추가 · Esc 닫기</span>
        </div>
      </div>
    </>
  );
}
