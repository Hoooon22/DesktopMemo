import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
  searchNotes,
  TODO_VIEW,
  writeFavorites,
} from "./api";
import type { SearchHit, TreeNode } from "./api";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import TodoList from "./components/TodoList";
import CommandPalette from "./components/CommandPalette";

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

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<string>(QUICK_MEMO);
  const [targetDir, setTargetDir] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [trashOver, setTrashOver] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(localStorage.getItem("sidebar-width"));
    return v >= 160 && v <= 480 ? v : 240;
  });
  const [resizing, setResizing] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    localStorage.setItem("sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

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

  // 표시용: 트리에 실제로 존재하는 즐겨찾기만 (삭제/외부 변경분 제외)
  const visibleFavorites = useMemo(() => {
    const existing = new Set<string>();
    collectNotePaths(tree, existing);
    return favorites.filter((p) => existing.has(p));
  }, [tree, favorites]);

  // 백엔드 이벤트: 외부 파일 변경 → 트리 갱신, 전역 단축키 → 빠른 메모
  useEffect(() => {
    const unChanged = listen("notes-changed", () => refreshTree()).catch(() => () => {});
    const unQuick = listen("open-quick-memo", () => {
      setSelected(QUICK_MEMO);
      setTargetDir("");
    }).catch(() => () => {});
    return () => {
      void unChanged.then((f) => f());
      void unQuick.then((f) => f());
    };
  }, [refreshTree]);

  // 검색 (200ms 디바운스)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      searchNotes(q)
        .then(setHits)
        .catch((e) => setError(String(e)));
    }, 200);
    return () => window.clearTimeout(t);
  }, [query]);

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

  const selectNote = (path: string) => {
    setSelected(path);
    setTargetDir(path === QUICK_MEMO || path === TODO_VIEW ? "" : parentDir(path));
  };

  const selectFolder = (dir: string) => {
    setTargetDir(dir);
  };

  const handleNewNote = async (dir?: string) => {
    const target = dir ?? targetDir;
    try {
      const path = await createNote(target);
      refreshTree();
      expandTo(target);
      setSelected(path);
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
      remapFavorites(path, newPath);
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
      remapFavorites(path, newPath);
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
      remapFavorites(path, newPath);
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
      setSelected((s) => (s === path || s.startsWith(path + "/") ? QUICK_MEMO : s));
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

  // 키보드: Ctrl+N 새 메모, Ctrl+Shift+N 새 폴더, F2 이름 바꾸기, Ctrl+F 검색, Delete 삭제
  const actionsRef = useRef({
    selected: "",
    renaming: false,
    newNote: () => {},
    newFolder: () => {},
    del: () => {},
  });
  useEffect(() => {
    actionsRef.current = {
      selected,
      renaming: renamingPath !== null,
      newNote: () => void handleNewNote(),
      newFolder: () => void handleNewFolder(),
      del: () => void handleDelete(selected),
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
      } else if (e.key === "F2") {
        if (a.selected && a.selected !== QUICK_MEMO && a.selected !== TODO_VIEW) {
          e.preventDefault();
          setRenamingPath(a.selected);
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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
        query={query}
        hits={hits}
        favorites={visibleFavorites}
        searchInputRef={searchRef}
        onQueryChange={setQuery}
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
      <main className="main">
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {selected === TODO_VIEW ? (
          <TodoList />
        ) : (
          <Editor
            path={selected}
            onRename={(name) => handleRename(selected, name)}
            isFavorite={favorites.includes(selected)}
            onToggleFavorite={() => toggleFavorite(selected)}
          />
        )}
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

      {paletteOpen && (
        <CommandPalette
          tree={tree}
          onClose={() => setPaletteOpen(false)}
          onSelectNote={selectNote}
          onNewNote={() => void handleNewNote()}
          onNewFolder={() => void handleNewFolder()}
        />
      )}

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
