import { useState } from "react";
import { sortDoneLast } from "../useTodos";
import type { Todo } from "../api";

type Props = {
  todos: Todo[];
  onAdd: (text: string) => void;
  onPatch: (id: string, p: Partial<Todo>) => void;
  onRemove: (id: string) => void;
  onReorder: (dragged: string, target: string, before: boolean) => void;
};

// 날짜 편집·완료 항목 확인용 전체 화면. 일상적인 추가·체크는 사이드바
// 패널과 Ctrl+T 창에서 하고, 여기는 관리 화면 역할이다.
export default function TodoList({ todos, onAdd, onPatch, onRemove, onReorder }: Props) {
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [trashOver, setTrashOver] = useState(false);
  const [dropAt, setDropAt] = useState<{ id: string; before: boolean } | null>(null);

  const remove = (id: string) => {
    setDragging(null);
    setTrashOver(false);
    onRemove(id);
  };

  const add = () => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
  };

  const sorted = sortDoneLast(todos);

  return (
    <section className="todo-view">
      <header className="editor-header">
        <span className="todo-title">☑ Todo</span>
      </header>
      <div className="todo-add">
        <input
          value={draft}
          placeholder="할 일 입력 후 Enter"
          spellCheck={false}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
      </div>
      <ul className="todo-list">
        {sorted.map((t) => (
          <li
            key={t.id}
            className={
              "todo-item" +
              (t.done ? " done" : "") +
              (dropAt?.id === t.id ? (dropAt.before ? " drop-before" : " drop-after") : "")
            }
            onDragOver={(e) => {
              if (!dragging || dragging === t.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt({ id: t.id, before: e.clientY < r.top + r.height / 2 });
            }}
            onDragLeave={() => setDropAt((d) => (d?.id === t.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && dragging !== t.id && dropAt?.id === t.id)
                onReorder(dragging, t.id, dropAt.before);
              setDragging(null);
              setDropAt(null);
            }}
          >
            <span
              className="todo-handle"
              title="드래그해서 순서 변경, 휴지통에 놓으면 삭제"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", "todo:" + t.id);
                e.dataTransfer.effectAllowed = "move";
                setDragging(t.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDropAt(null);
              }}
            >
              ⠿
            </span>
            <input
              type="checkbox"
              checked={t.done}
              onChange={(e) => onPatch(t.id, { done: e.target.checked })}
            />
            <input
              className="todo-text"
              value={t.text}
              spellCheck={false}
              onChange={(e) => onPatch(t.id, { text: e.target.value })}
            />
            <input
              className="todo-date"
              type="date"
              value={t.start ?? ""}
              title="시작일"
              onChange={(e) => onPatch(t.id, { start: e.target.value || undefined })}
            />
            <span className="todo-tilde">~</span>
            <input
              className="todo-date"
              type="date"
              value={t.end ?? ""}
              min={t.start}
              title="종료일 (선택)"
              onChange={(e) => onPatch(t.id, { end: e.target.value || undefined })}
            />
            <button
              className="todo-del"
              title="삭제"
              aria-label={`할 일 삭제: ${t.text || "(제목 없음)"}`}
              onClick={() => remove(t.id)}
            >
              ✕
            </button>
          </li>
        ))}
        {todos.length === 0 && <li className="todo-empty">할 일이 없습니다</li>}
      </ul>
      {dragging && (
        <div
          className={"trash-target" + (trashOver ? " over" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setTrashOver(true);
          }}
          onDragLeave={() => setTrashOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            const d = e.dataTransfer.getData("text/plain");
            if (d.startsWith("todo:")) remove(d.slice(5));
          }}
        >
          🗑️
        </div>
      )}
    </section>
  );
}
