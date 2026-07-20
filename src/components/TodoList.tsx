import { useEffect, useRef, useState } from "react";
import { readTodos, writeTodos } from "../api";
import type { Todo } from "../api";

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [trashOver, setTrashOver] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Todo[] | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    readTodos()
      .then((t) => {
        setTodos(t);
        loaded.current = true;
      })
      .catch(() => {
        loaded.current = true;
      });

    // 언마운트 시 대기 중인 저장을 즉시 반영
    return () => {
      if (saveTimer.current !== undefined) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
      }
      const p = pendingSave.current;
      pendingSave.current = null;
      if (p) writeTodos(p).catch(() => {});
    };
  }, []);

  const update = (next: Todo[]) => {
    setTodos(next);
    if (!loaded.current) return;
    pendingSave.current = next;
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined;
      const p = pendingSave.current;
      pendingSave.current = null;
      if (p) writeTodos(p).catch(() => {});
    }, 300);
  };

  const patch = (id: string, p: Partial<Todo>) =>
    update(todos.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const remove = (id: string) => {
    setDragging(null);
    setTrashOver(false);
    update(todos.filter((t) => t.id !== id));
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    update([...todos, { id: crypto.randomUUID(), text, done: false }]);
    setDraft("");
  };

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
        {todos.map((t) => (
          <li key={t.id} className={"todo-item" + (t.done ? " done" : "")}>
            <span
              className="todo-handle"
              title="드래그해서 휴지통으로 삭제"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", "todo:" + t.id);
                e.dataTransfer.effectAllowed = "move";
                setDragging(t.id);
              }}
              onDragEnd={() => setDragging(null)}
            >
              ⠿
            </span>
            <input
              type="checkbox"
              checked={t.done}
              onChange={(e) => patch(t.id, { done: e.target.checked })}
            />
            <input
              className="todo-text"
              value={t.text}
              spellCheck={false}
              onChange={(e) => patch(t.id, { text: e.target.value })}
            />
            <input
              className="todo-date"
              type="date"
              value={t.start ?? ""}
              title="시작일"
              onChange={(e) => patch(t.id, { start: e.target.value || undefined })}
            />
            <span className="todo-tilde">~</span>
            <input
              className="todo-date"
              type="date"
              value={t.end ?? ""}
              min={t.start}
              title="종료일 (선택)"
              onChange={(e) => patch(t.id, { end: e.target.value || undefined })}
            />
            <button className="todo-del" title="삭제" onClick={() => remove(t.id)}>
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
