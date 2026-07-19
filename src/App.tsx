import { useCallback, useEffect, useState } from "react";
import {
  createFolder,
  createNote,
  deleteEntry,
  listTree,
  moveNote,
  QUICK_MEMO,
  renameEntry,
} from "./api";
import type { TreeNode } from "./api";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function remapPath(current: string, oldPath: string, newPath: string): string {
  if (current === oldPath) return newPath;
  if (current.startsWith(oldPath + "/")) return newPath + current.slice(oldPath.length);
  return current;
}

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<string>(QUICK_MEMO);
  const [targetDir, setTargetDir] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [trashOver, setTrashOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTree = useCallback(() => {
    listTree()
      .then(setTree)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refreshTree, [refreshTree]);

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
    setTargetDir(path === QUICK_MEMO ? "" : parentDir(path));
  };

  const selectFolder = (dir: string) => {
    setTargetDir(dir);
    expandTo(dir);
  };

  const handleNewNote = async () => {
    try {
      const path = await createNote(targetDir);
      refreshTree();
      expandTo(targetDir);
      setSelected(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleNewFolder = async () => {
    try {
      const path = await createFolder(targetDir);
      refreshTree();
      expandTo(targetDir);
      setTargetDir(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRename = async (path: string, newName: string) => {
    try {
      const newPath = await renameEntry(path, newName);
      refreshTree();
      setSelected((s) => remapPath(s, path, newPath));
      setTargetDir((d) => remapPath(d, path, newPath));
    } catch (e) {
      setError(String(e));
    }
  };

  const handleMove = async (path: string, dir: string) => {
    setDragging(null);
    if (!path || parentDir(path) === dir) return;
    try {
      const newPath = await moveNote(path, dir);
      refreshTree();
      expandTo(dir);
      setSelected((s) => (s === path ? newPath : s));
    } catch (e) {
      setError(String(e));
    }
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
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="app">
      <Sidebar
        tree={tree}
        selected={selected}
        targetDir={targetDir}
        collapsed={collapsed}
        onSelectNote={selectNote}
        onSelectFolder={selectFolder}
        onToggle={toggleFolder}
        onNewNote={handleNewNote}
        onNewFolder={handleNewFolder}
        onRename={handleRename}
        onMove={handleMove}
        onDelete={handleDelete}
        onDragStart={setDragging}
        onDragEnd={() => setDragging(null)}
      />
      <main className="main">
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        <Editor path={selected} onRename={(name) => handleRename(selected, name)} />
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
            handleDelete(e.dataTransfer.getData("text/plain"));
          }}
        >
          🗑️
        </div>
      )}
    </div>
  );
}
