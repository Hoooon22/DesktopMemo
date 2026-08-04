import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createFolder,
  createNote,
  deleteEntry,
  listTree,
  moveEntry,
  QUICK_MEMO,
  readFavorites,
  renameEntry,
  reorderEntry,
  restoreEntry,
  TODO_VIEW,
  writeFavorites,
} from "./api";
import type { TreeNode } from "./api";
import { useTodos } from "./useTodos";
import Sidebar from "./components/Sidebar";
import SearchModal from "./components/SearchModal";
import Editor from "./components/Editor";
import TodoList from "./components/TodoList";
import QuickAddTodo from "./components/QuickAddTodo";
import HelpModal from "./components/HelpModal";
import CommandPalette from "./components/CommandPalette";
import TabBar from "./components/TabBar";

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function remapPath(current: string, oldPath: string, newPath: string): string {
  if (current === oldPath) return newPath;
  if (current.startsWith(oldPath + "/")) return newPath + current.slice(oldPath.length);
  return current;
}

// 트리에 실제로 존재하는 메모(파일) 경로 집합. 즐겨찾기에서 삭제·외부 변경으로
// 사라진 항목을 표시에서 걸러내는 데 쓴다.
function collectNotePaths(nodes: TreeNode[], out: Set<string>): void {
  for (const n of nodes) {
    if (n.isDir) {
      if (n.children) collectNotePaths(n.children, out);
    } else {
      out.add(n.path);
    }
  }
}

// 입력창·에디터 본문에 포커스가 있으면 Delete는 텍스트 편집용이므로 노트 삭제로 가로채면 안 된다
function isEditableTarget(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  return n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable;
}

type CtxMenu = { x: number; y: number; path: string; isDir: boolean };
type Toast = { msg: string; undoPath?: string };
// 분할 뷰: 메모를 에디터 영역 가장자리에 드롭하면 그 방향에 두 번째 창이 열린다
type SplitDir = "left" | "right" | "top" | "bottom";
type Split = { path: string; dir: SplitDir };

const TABS_KEY = "open-tabs";
const ACTIVE_TAB_KEY = "active-tab";

// 이전 세션에서 열려 있던 탭 목록 (없거나 깨졌으면 빠른 메모 하나)
function loadTabs(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? "");
    if (Array.isArray(v) && v.length > 0 && v.every((p): p is string => typeof p === "string"))
      return v;
  } catch {
    // 기본값 사용
  }
  return [QUICK_MEMO];
}

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [tabs, setTabs] = useState<string[]>(loadTabs);
  const [selected, setSelected] = useState<string>(() => {
    const t = loadTabs();
    const a = localStorage.getItem(ACTIVE_TAB_KEY);
    return a && t.includes(a) ? a : t[0];
  });
  const [targetDir, setTargetDir] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [trashOver, setTrashOver] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(localStorage.getItem("sidebar-width"));
    return v >= 160 && v <= 480 ? v : 240;
  });
  const [resizing, setResizing] = useState(false);
  const [pinned, setPinned] = useState(() => localStorage.getItem("always-on-top") === "1");
  const [split, setSplit] = useState<Split | null>(null);
  const [splitHint, setSplitHint] = useState<SplitDir | null>(null);

  const toastTimer = useRef<number | undefined>(undefined);

  // 할 일 목록은 사이드바 패널·전체 뷰·Ctrl+T 창이 공유한다
  const {
    todos,
    add: addTodo,
    patch: patchTodo,
    remove: removeTodo,
    reorder: reorderTodo,
  } = useTodos();
  const pendingTodos = todos.filter((t) => !t.done).length;
  const toggleTodo = useCallback(
    (id: string) => patchTodo(id, { done: true }),
    [patchTodo],
  );

  // 도움말은 다른 오버레이 위에 겹치지 않도록 열면서 나머지를 닫는다
  const openHelp = useCallback(() => {
    setPaletteOpen(false);
    setSearchOpen(false);
    setQuickAddOpen(false);
    setHelpOpen(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, selected);
  }, [selected]);

  // 항상 위에 고정: 창에 반영하고 다음 실행을 위해 저장
  useEffect(() => {
    localStorage.setItem("always-on-top", pinned ? "1" : "0");
    getCurrentWindow()
      .setAlwaysOnTop(pinned)
      .catch((e) => setError(String(e)));
  }, [pinned]);

  // 사이드바-본문 경계 드래그로 너비 조절
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(Math.min(480, Math.max(160, ev.clientX)));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const refreshTree = useCallback(() => {
    listTree()
      .then(setTree)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refreshTree, [refreshTree]);

  useEffect(() => {
    readFavorites()
      .then(setFavorites)
      .catch((e) => setError(String(e)));
  }, []);

  // 즐겨찾기 배열을 갱신하고 디스크에도 반영한다. updater가 이전 배열을
  // 그대로 돌려주면(변화 없음) 불필요한 파일 쓰기를 건너뛴다.
  const applyFavorites = useCallback((updater: (prev: string[]) => string[]) => {
    setFavorites((prev) => {
      const next = updater(prev);
      if (next !== prev) writeFavorites(next).catch((e) => setError(String(e)));
      return next;
    });
  }, []);

  const toggleFavorite = useCallback(
    (path: string) => {
      if (!path || path === QUICK_MEMO || path === TODO_VIEW) return;
      applyFavorites((prev) =>
        prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
      );
    },
    [applyFavorites],
  );

  // 이름 변경·이동으로 경로가 바뀐 탭을 새 경로로 따라가게 한다
  const remapTabs = useCallback((oldPath: string, newPath: string) => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        const r = remapPath(p, oldPath, newPath);
        if (r !== p) changed = true;
        return r;
      });
      return changed ? next : prev;
    });
  }, []);

  // 이름 변경·이동으로 경로가 바뀐 분할 창을 새 경로로 따라가게 한다
  const remapSplit = useCallback((oldPath: string, newPath: string) => {
    setSplit((s) => (s ? { ...s, path: remapPath(s.path, oldPath, newPath) } : s));
  }, []);

  // 이름 변경·이동으로 경로가 바뀐 즐겨찾기를 새 경로로 따라가게 한다
  const remapFavorites = useCallback(
    (oldPath: string, newPath: string) => {
      applyFavorites((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const r = remapPath(p, oldPath, newPath);
          if (r !== p) changed = true;
          return r;
        });
        return changed ? next : prev;
      });
    },
    [applyFavorites],
  );

  const reorderFavorite = useCallback(
    (dragged: string, target: string, pos: "before" | "after") => {
      applyFavorites((prev) => {
        if (dragged === target) return prev;
        const without = prev.filter((p) => p !== dragged);
        const ti = without.indexOf(target);
        if (ti === -1) return prev;
        without.splice(pos === "before" ? ti : ti + 1, 0, dragged);
        return without;
      });
    },
    [applyFavorites],
  );

  // 트리에 실제로 존재하는 메모 경로 집합
  const notePaths = useMemo(() => {
    const s = new Set<string>();
    collectNotePaths(tree, s);
    return s;
  }, [tree]);

  // 표시용: 트리에 실제로 존재하는 즐겨찾기만 (삭제/외부 변경분 제외)
  const visibleFavorites = useMemo(
    () => favorites.filter((p) => notePaths.has(p)),
    [notePaths, favorites],
  );

  // 백엔드 이벤트: 외부 파일 변경 → 트리 갱신, 전역 단축키 → 빠른 메모
  useEffect(() => {
    const unChanged = listen("notes-changed", () => refreshTree()).catch(() => () => {});
    const unQuick = listen("open-quick-memo", () => {
      setTabs((prev) => (prev.includes(QUICK_MEMO) ? prev : [...prev, QUICK_MEMO]));
      setSelected(QUICK_MEMO);
      setTargetDir("");
    }).catch(() => () => {});
    return () => {
      void unChanged.then((f) => f());
      void unQuick.then((f) => f());
    };
  }, [refreshTree]);

  // 오류 메시지는 6초 뒤 자동으로 사라진다 (클릭하면 즉시 닫힘)
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(t);
  }, [error]);

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandTo = (dir: string) => {
    if (!dir) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (let p = dir; p; p = parentDir(p)) next.delete(p);
      return next;
    });
  };

  // 탭 목록 변경 없이 활성 탭만 바꾼다
  const activate = useCallback((path: string) => {
    setSelected(path);
    setTargetDir(path === QUICK_MEMO || path === TODO_VIEW ? "" : parentDir(path));
  }, []);

  // 노트를 탭으로 연다 (이미 열려 있으면 그 탭을 활성화)
  const selectNote = (path: string) => {
    setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    activate(path);
  };

  const closeTab = (path: string) => {
    const i = tabs.indexOf(path);
    if (i === -1) return;
    const next = tabs.filter((p) => p !== path);
    if (next.length === 0) {
      setTabs([QUICK_MEMO]);
      activate(QUICK_MEMO);
      return;
    }
    setTabs(next);
    if (selected === path) activate(next[Math.min(i, next.length - 1)]);
  };

  // 모든 탭을 닫는다 (탭이 하나도 없으면 안 되므로 빠른 메모만 남긴다)
  const closeAllTabs = () => {
    setTabs([QUICK_MEMO]);
    activate(QUICK_MEMO);
  };

  const closeOtherTabs = (path: string) => {
    setTabs([path]);
    activate(path);
  };

  const closeRightTabs = (path: string) => {
    const i = tabs.indexOf(path);
    if (i === -1) return;
    const next = tabs.slice(0, i + 1);
    setTabs(next);
    if (!next.includes(selected)) activate(path);
  };

  // 탭 드래그로 순서 변경 (즐겨찾기 reorder와 같은 방식)
  const reorderTab = (dragged: string, target: string, before: boolean) => {
    setTabs((prev) => {
      if (dragged === target) return prev;
      const without = prev.filter((p) => p !== dragged);
      const ti = without.indexOf(target);
      if (ti === -1) return prev;
      without.splice(before ? ti : ti + 1, 0, dragged);
      return without;
    });
  };

  const cycleTab = (dir: 1 | -1) => {
    if (tabs.length < 2) return;
    const i = tabs.indexOf(selected);
    activate(tabs[(i + dir + tabs.length) % tabs.length]);
  };

  // 활성 탭이 목록에서 사라지면(삭제·외부 변경 등) 첫 탭으로 되돌린다
  useEffect(() => {
    if (!tabs.includes(selected)) activate(tabs[0]);
  }, [tabs, selected, activate]);

  // 트리에 더 이상 존재하지 않는 노트 탭 정리 (외부 삭제·이전 세션의 잔재)
  useEffect(() => {
    if (tree.length === 0) return; // 초기 로드 전에는 판단하지 않는다
    const existing = new Set<string>();
    collectNotePaths(tree, existing);
    const ok = (p: string) => p === QUICK_MEMO || p === TODO_VIEW || existing.has(p);
    setTabs((prev) => {
      if (prev.every(ok)) return prev;
      const next = prev.filter(ok);
      return next.length > 0 ? next : [QUICK_MEMO];
    });
    setSplit((s) => (s && !ok(s.path) ? null : s));
  }, [tree]);

  const selectFolder = (dir: string) => {
    setTargetDir(dir);
  };

  const handleNewNote = async (dir?: string) => {
    const target = dir ?? targetDir;
    try {
      const path = await createNote(target);
      refreshTree();
      expandTo(target);
      selectNote(path); // 새 메모는 탭으로 연다
      setRenamingPath(path); // 만들자마자 이름부터 입력
    } catch (e) {
      setError(String(e));
    }
  };

  const handleNewFolder = async (dir?: string) => {
    const target = dir ?? targetDir;
    try {
      const path = await createFolder(target);
      refreshTree();
      expandTo(target);
      setTargetDir(path);
      setRenamingPath(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRename = async (path: string, newName: string): Promise<boolean> => {
    try {
      const newPath = await renameEntry(path, newName);
      refreshTree();
      setSelected((s) => remapPath(s, path, newPath));
      setTargetDir((d) => remapPath(d, path, newPath));
      remapTabs(path, newPath);
      remapFavorites(path, newPath);
      remapSplit(path, newPath);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const handleMove = async (path: string, dir: string) => {
    setDragging(null);
    if (!path || parentDir(path) === dir) return;
    if (dir === path || dir.startsWith(path + "/")) return; // 자기 안으로 이동 금지
    try {
      const newPath = await moveEntry(path, dir);
      refreshTree();
      expandTo(dir);
      setSelected((s) => remapPath(s, path, newPath));
      setTargetDir((d) => remapPath(d, path, newPath));
      remapTabs(path, newPath);
      remapFavorites(path, newPath);
      remapSplit(path, newPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleReorder = async (path: string, dir: string, index: number) => {
    setDragging(null);
    if (!path) return;
    if (dir === path || dir.startsWith(path + "/")) return; // 자기 안으로 이동 금지
    try {
      const newPath = await reorderEntry(path, dir, index);
      refreshTree();
      expandTo(dir);
      setSelected((s) => remapPath(s, path, newPath));
      setTargetDir((d) => remapPath(d, path, newPath));
      remapTabs(path, newPath);
      remapFavorites(path, newPath);
      remapSplit(path, newPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const showToast = (t: Toast) => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };

  const handleDelete = async (path: string) => {
    setDragging(null);
    setTrashOver(false);
    if (!path) return;
    try {
      await deleteEntry(path);
      refreshTree();
      // 삭제된 노트(또는 폴더 하위)의 탭을 닫는다. 활성 탭이 닫히면
      // "활성 탭 사라짐" 이펙트가 첫 탭으로 되돌린다.
      setTabs((prev) => {
        const next = prev.filter((p) => p !== path && !p.startsWith(path + "/"));
        return next.length > 0 ? next : [QUICK_MEMO];
      });
      setSplit((s) =>
        s && (s.path === path || s.path.startsWith(path + "/")) ? null : s,
      );
      setTargetDir((d) => (d === path || d.startsWith(path + "/") ? parentDir(path) : d));
      const name = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
      showToast({ msg: `"${name}" 삭제됨`, undoPath: path });
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUndo = async () => {
    const path = toast?.undoPath;
    if (!path) return;
    setToast(null);
    try {
      await restoreEntry(path);
      refreshTree();
      expandTo(parentDir(path));
    } catch (e) {
      setError(String(e));
    }
  };

  // 키보드: Ctrl+N 새 메모, Ctrl+Shift+N 새 폴더, F2 이름 바꾸기, Ctrl+F 검색,
  // Ctrl+T 할 일 추가, Delete 삭제, Ctrl+W 탭 닫기, Ctrl+(Shift+)Tab 탭 전환
  const actionsRef = useRef({
    selected: "",
    renaming: false,
    newNote: () => {},
    newFolder: () => {},
    del: () => {},
    closeTab: () => {},
    cycleTab: (() => {}) as (dir: 1 | -1) => void,
    toggleHelp: () => {},
  });
  useEffect(() => {
    actionsRef.current = {
      selected,
      renaming: renamingPath !== null,
      newNote: () => void handleNewNote(),
      newFolder: () => void handleNewFolder(),
      del: () => void handleDelete(selected),
      closeTab: () => closeTab(selected),
      cycleTab,
      toggleHelp: () => (helpOpen ? setHelpOpen(false) : openHelp()),
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        a.newNote();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        a.newFolder();
      } else if (e.key === "F1") {
        e.preventDefault();
        a.toggleHelp();
      } else if (e.key === "F2") {
        if (a.selected && a.selected !== QUICK_MEMO && a.selected !== TODO_VIEW) {
          e.preventDefault();
          setRenamingPath(a.selected);
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setQuickAddOpen((v) => !v);
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        a.closeTab();
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        a.cycleTab(e.shiftKey ? -1 : 1);
      } else if (e.key === "Delete" && !isEditableTarget(e.target)) {
        // 트리·폴더에 포커스가 있을 때만 동작(에디터 편집 중에는 위 가드가 막는다)
        if (a.selected && a.selected !== QUICK_MEMO && a.selected !== TODO_VIEW && !a.renaming) {
          e.preventDefault();
          a.del();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 분할로 열 수 있는 대상: 실제 메모 파일과 빠른 메모 (Todo 뷰·폴더 제외)
  const canSplitPath = (p: string) => p === QUICK_MEMO || notePaths.has(p);

  // 에디터 영역 가장자리 20~25% 안쪽이면 해당 방향, 가운데면 null
  const splitZone = (e: React.DragEvent<HTMLElement>): SplitDir | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx < 0.2) return "left";
    if (fx > 0.8) return "right";
    if (fy < 0.25) return "top";
    if (fy > 0.75) return "bottom";
    return null;
  };

  const openCtxMenu = (node: TreeNode, x: number, y: number) => {
    setCtxMenu({
      x: Math.min(x, window.innerWidth - 180),
      y: Math.min(y, window.innerHeight - 170),
      path: node.path,
      isDir: node.isDir,
    });
  };

  return (
    <div className="app" style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}>
      <Sidebar
        tree={tree}
        dragging={dragging}
        selected={selected}
        targetDir={targetDir}
        collapsed={collapsed}
        renamingPath={renamingPath}
        favorites={visibleFavorites}
        todos={todos}
        onToggleTodo={toggleTodo}
        onReorderTodo={reorderTodo}
        onQuickAddTodo={() => setQuickAddOpen(true)}
        onHelp={openHelp}
        onSelectNote={selectNote}
        onUnfavorite={toggleFavorite}
        onReorderFavorite={reorderFavorite}
        onSelectFolder={selectFolder}
        onToggle={toggleFolder}
        onNewNote={() => void handleNewNote()}
        onNewFolder={() => void handleNewFolder()}
        onRename={handleRename}
        onStartRename={setRenamingPath}
        onEndRename={() => setRenamingPath(null)}
        onMove={handleMove}
        onReorder={(p, d, i) => void handleReorder(p, d, i)}
        onDelete={handleDelete}
        onNewNoteIn={(dir) => void handleNewNote(dir)}
        onContextMenu={openCtxMenu}
        onDragStart={setDragging}
        onDragEnd={() => setDragging(null)}
      />
      <div
        className={"resizer" + (resizing ? " active" : "")}
        style={{ left: sidebarWidth }}
        onMouseDown={startResize}
        title="드래그하여 사이드바 너비 조절"
      />
      {resizing && <div className="resize-overlay" />}
      <main
        className="main"
        onDragOverCapture={(e) => {
          // 탭 드래그 또는 트리 메모 드래그일 때만 분할 힌트를 보여준다
          const isTab = e.dataTransfer.types.includes("text/desktopmemo-tab");
          const isNote = dragging !== null && canSplitPath(dragging);
          if (!isTab && !isNote) return;
          if ((e.target as HTMLElement).closest(".tab-bar")) {
            setSplitHint(null); // 탭 바 위에서는 탭 순서 변경이 우선
            return;
          }
          // 캡처 단계에서 가로챈다 — 에디터(ProseMirror)가 드롭을 받아
          // 본문에 경로를 텍스트/링크로 삽입해 버리는 것을 막는다
          e.preventDefault();
          e.stopPropagation();
          const dir = splitZone(e);
          setSplitHint(dir);
          // 소스가 effectAllowed="move"로 시작하므로 반드시 move여야 드롭이 발화한다
          e.dataTransfer.dropEffect = dir ? "move" : "none";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setSplitHint(null);
        }}
        onDropCapture={(e) => {
          const isTab = e.dataTransfer.types.includes("text/desktopmemo-tab");
          const isNote = dragging !== null && canSplitPath(dragging);
          if (!isTab && !isNote) return;
          if ((e.target as HTMLElement).closest(".tab-bar")) return;
          e.preventDefault();
          e.stopPropagation();
          const dir = splitHint;
          setSplitHint(null);
          if (!dir) return;
          const path =
            e.dataTransfer.getData("text/desktopmemo-tab") ||
            e.dataTransfer.getData("text/plain");
          if (!path || !canSplitPath(path)) return;
          setSplit({ path, dir });
        }}
      >
        <TabBar
          tabs={tabs}
          selected={selected}
          pinned={pinned}
          onSelect={selectNote}
          onClose={closeTab}
          onCloseAll={closeAllTabs}
          onCloseOthers={closeOtherTabs}
          onCloseRight={closeRightTabs}
          onReorder={reorderTab}
          onTogglePin={() => setPinned((v) => !v)}
        />
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        <div className={"panes" + (split ? " split-" + split.dir : "")}>
          <div className="pane">
            {selected === TODO_VIEW ? (
              <TodoList
                todos={todos}
                onAdd={addTodo}
                onPatch={patchTodo}
                onRemove={removeTodo}
                onReorder={reorderTodo}
              />
            ) : (
              <Editor
                path={selected}
                onRename={(name) => handleRename(selected, name)}
                isFavorite={favorites.includes(selected)}
                onToggleFavorite={() => toggleFavorite(selected)}
              />
            )}
          </div>
          {split && (
            <div className="pane split-pane">
              <Editor
                path={split.path}
                onRename={(name) => handleRename(split.path, name)}
                isFavorite={favorites.includes(split.path)}
                onToggleFavorite={() => toggleFavorite(split.path)}
                onClose={() => setSplit(null)}
              />
            </div>
          )}
        </div>
        {splitHint && <div className={"split-hint " + splitHint} />}
      </main>

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
            void handleDelete(e.dataTransfer.getData("text/plain"));
          }}
        >
          🗑️
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast.msg}</span>
          {toast.undoPath && (
            <button onClick={() => void handleUndo()}>실행 취소</button>
          )}
        </div>
      )}

      {quickAddOpen && (
        <QuickAddTodo
          pending={pendingTodos}
          onAdd={addTodo}
          onClose={() => setQuickAddOpen(false)}
        />
      )}

      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onSelectNote={selectNote}
          onError={setError}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          tree={tree}
          onClose={() => setPaletteOpen(false)}
          onSelectNote={selectNote}
          onNewNote={() => void handleNewNote()}
          onNewFolder={() => void handleNewFolder()}
          onHelp={openHelp}
        />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {ctxMenu && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            {!ctxMenu.isDir && (
              <button
                onClick={() => {
                  toggleFavorite(ctxMenu.path);
                  setCtxMenu(null);
                }}
              >
                {favorites.includes(ctxMenu.path) ? "즐겨찾기 해제" : "⭐ 즐겨찾기 추가"}
              </button>
            )}
            {ctxMenu.isDir && (
              <button
                onClick={() => {
                  void handleNewNote(ctxMenu.path);
                  setCtxMenu(null);
                }}
              >
                새 메모
              </button>
            )}
            {ctxMenu.isDir && (
              <button
                onClick={() => {
                  void handleNewFolder(ctxMenu.path);
                  setCtxMenu(null);
                }}
              >
                새 폴더
              </button>
            )}
            <button
              onClick={() => {
                setRenamingPath(ctxMenu.path);
                setCtxMenu(null);
              }}
            >
              이름 바꾸기 (F2)
            </button>
            <button
              className="danger"
              onClick={() => {
                void handleDelete(ctxMenu.path);
                setCtxMenu(null);
              }}
            >
              삭제
            </button>
          </div>
        </>
      )}
    </div>
  );
}
