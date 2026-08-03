import { useCallback, useEffect, useRef, useState } from "react";
import { readTodos, writeTodos } from "./api";
import type { Todo } from "./api";

// 로컬 시간대 기준 오늘. input[type=date]와 같은 YYYY-MM-DD 형식이라
// 마감일 문자열과 그대로 비교할 수 있다.
export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 마감일은 종료일이 있으면 종료일, 없으면 시작일
export const deadline = (t: Todo) => t.end ?? t.start;

// 표시 순서: 배열 순서(드래그로 수동 변경) 그대로, 완료 항목만 뒤로.
// stable sort라 같은 그룹 안에서는 수동 순서가 유지된다.
export function sortDoneLast(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => Number(a.done) - Number(b.done));
}

export type TodosApi = {
  todos: Todo[];
  add: (text: string) => void;
  patch: (id: string, p: Partial<Todo>) => void;
  remove: (id: string) => void;
  reorder: (dragged: string, target: string, before: boolean) => void;
};

// 할 일 목록의 단일 소유자. 사이드바 패널·전체 뷰·퀵 추가 모달이 모두
// 이 훅의 상태를 공유하므로 앱 최상단에서 한 번만 호출한다.
export function useTodos(): TodosApi {
  const [todos, setTodos] = useState<Todo[]>([]);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Todo[] | null>(null);
  const loaded = useRef(false);

  const flush = useCallback(() => {
    if (saveTimer.current !== undefined) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }
    const p = pendingSave.current;
    pendingSave.current = null;
    if (p) writeTodos(p).catch(() => {});
  }, []);

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
    return flush;
  }, [flush]);

  // 상태를 바꾸고 300ms 뒤 디스크에 반영한다. 로드 전 변경은 저장하지 않는다
  // (빈 목록으로 파일을 덮어쓰는 것을 막기 위함).
  const apply = useCallback((fn: (prev: Todo[]) => Todo[]) => {
    setTodos((prev) => {
      const next = fn(prev);
      if (next === prev || !loaded.current) return next;
      pendingSave.current = next;
      if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined;
        const p = pendingSave.current;
        pendingSave.current = null;
        if (p) writeTodos(p).catch(() => {});
      }, 300);
      return next;
    });
  }, []);

  const add = useCallback(
    (text: string) => {
      const s = text.trim();
      if (!s) return;
      apply((prev) => [...prev, { id: crypto.randomUUID(), text: s, done: false }]);
    },
    [apply],
  );

  const patch = useCallback(
    (id: string, p: Partial<Todo>) => {
      apply((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
    },
    [apply],
  );

  const remove = useCallback(
    (id: string) => {
      apply((prev) => prev.filter((t) => t.id !== id));
    },
    [apply],
  );

  // 드래그 순서 변경: dragged를 target 앞/뒤로 옮긴다 (즐겨찾기와 같은 방식)
  const reorder = useCallback(
    (dragged: string, target: string, before: boolean) => {
      apply((prev) => {
        if (dragged === target) return prev;
        const item = prev.find((t) => t.id === dragged);
        if (!item) return prev;
        const without = prev.filter((t) => t.id !== dragged);
        const ti = without.findIndex((t) => t.id === target);
        if (ti === -1) return prev;
        without.splice(before ? ti : ti + 1, 0, item);
        return without;
      });
    },
    [apply],
  );

  return { todos, add, patch, remove, reorder };
}
