import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  createFolder,
  createNote,
  deleteEntry,
  listTree,
  moveEntry,
  QUICK_MEMO,
  renameEntry,
  restoreEntry,
  searchNotes,
  TODO_VIEW,
} from "./api";
import type { SearchHit, TreeNode } from "./api";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import TodoList from "./components/TodoList";

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function remapPath(current: string, oldPath: string, newPath: string): string {
  if (current === oldPath) return newPath;
  if (current.startsWith(oldPath + "/")) return newPath + current.slice(oldPath.length);
  return current;
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
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const refreshTree = useCallback(() => {
    listTree()
      .then(setTree)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refreshTree, [refreshTree]);

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

  // 키보드: Ctrl+N 새 메모, Ctrl+Shift+N 새 폴더, F2 이름 바꾸기, Ctrl+F 검색
  const actionsRef = useRef({ selected: "", newNote: () => {}, newFolder: () => {} });
  useEffect(() => {
    actionsRef.current = {
      selected,
      newNote: () => void handleNewNote(),
      newFolder: () => void handleNewFolder(),
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
    <div className="app">
      <Sidebar
        tree={tree}
        selected={selected}
        targetDir={targetDir}
        collapsed={collapsed}
        renamingPath={renamingPath}
        query={query}
        hits={hits}
        searchInputRef={searchRef}
        onQueryChange={setQuery}
        onSelectNote={selectNote}
        onSelectFolder={selectFolder}
        onToggle={toggleFolder}
        onNewNote={() => void handleNewNote()}
        onNewFolder={() => void handleNewFolder()}
        onRename={handleRename}
        onStartRename={setRenamingPath}
        onEndRename={() => setRenamingPath(null)}
        onMove={handleMove}
        onDelete={handleDelete}
        onNewNoteIn={(dir) => void handleNewNote(dir)}
        onContextMenu={openCtxMenu}
        onDragStart={setDragging}
        onDragEnd={() => setDragging(null)}
      />
      <main className="main">
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {selected === TODO_VIEW ? (
          <TodoList />
        ) : (
          <Editor path={selected} onRename={(name) => handleRename(selected, name)} />
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
