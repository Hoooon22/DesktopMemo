import { useState } from "react";
import { deadline, sortByUrgency, todayStr } from "../useTodos";
import type { Todo } from "../api";

const PANEL_KEY = "todo-panel-open";

type Props = {
  todos: Todo[];
  active: boolean; // 전체 Todo 뷰가 열려 있는지
  onToggleDone: (id: string) => void;
  onOpenView: () => void;
  onQuickAdd: () => void;
};

// "2026-08-03" → "8/3"
function dateLabel(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

export default function TodoPanel({ todos, active, onToggleDone, onOpenView, onQuickAdd }: Props) {
  const [open, setOpen] = useState(() => localStorage.getItem(PANEL_KEY) !== "0");

  const toggleOpen = () =>
    setOpen((v) => {
      localStorage.setItem(PANEL_KEY, v ? "0" : "1");
      return !v;
    });

  // 패널은 남은 할 일만 보여준다. 체크하면 목록에서 사라지고,
  // 완료 항목은 전체 Todo 뷰에서 확인·되돌릴 수 있다.
  const today = todayStr();
  const pending = sortByUrgency(todos.filter((t) => !t.done));

  return (
    <div className="todo-panel">
      <div className="todo-panel-head">
        <button
          className="todo-panel-fold"
          onClick={toggleOpen}
          title={open ? "접기" : "펼치기"}
          aria-label={open ? "Todo 목록 접기" : "Todo 목록 펼치기"}
        >
          {open ? "▾" : "▸"}
        </button>
        <button
          className={"todo-panel-title" + (active ? " selected" : "")}
          onClick={onOpenView}
          title="Todo 전체 보기 (날짜 편집)"
        >
          <span className="pinned-icon">☑️</span>Todo
        </button>
        {pending.length > 0 && <span className="todo-count">{pending.length}</span>}
        <button
          className="todo-panel-add"
          onClick={onQuickAdd}
          title="할 일 추가 (Ctrl+T)"
          aria-label="할 일 추가"
        >
          +
        </button>
      </div>
      {open && (
        <ul className="todo-panel-list">
          {pending.map((t) => {
            const d = deadline(t);
            const urgency = !d ? "" : d < today ? " overdue" : d === today ? " today" : "";
            return (
              <li key={t.id} className={"todo-panel-item" + urgency}>
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => onToggleDone(t.id)}
                  aria-label={`완료 처리: ${t.text || "(내용 없음)"}`}
                />
                <button className="todo-panel-label" onClick={onOpenView} title={t.text}>
                  {t.text || "(내용 없음)"}
                </button>
                {d && <span className="todo-panel-date">{dateLabel(d)}</span>}
              </li>
            );
          })}
          {pending.length === 0 && <li className="todo-panel-empty">남은 할 일 없음</li>}
        </ul>
      )}
    </div>
  );
}
