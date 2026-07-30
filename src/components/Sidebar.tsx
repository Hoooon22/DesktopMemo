import { useRef, useState } from "react";
import { QUICK_MEMO, TODO_VIEW } from "../api";
import type { Todo, TreeNode } from "../api";
import Tree from "./Tree";
import Favorites from "./Favorites";
import TodoPanel from "./TodoPanel";

type Props = {
  tree: TreeNode[];
  dragging: string | null;
  selected: string;
  targetDir: string;
  collapsed: Set<string>;
  renamingPath: string | null;
  favorites: string[];
  todos: Todo[];
  onToggleTodo: (id: string) => void;
  onQuickAddTodo: () => void;
  onSelectNote: (path: string) => void;
  onUnfavorite: (path: string) => void;
  onReorderFavorite: (dragged: string, target: string, pos: "before" | "after") => void;
  onSelectFolder: (dir: string) => void;
  onToggle: (path: string) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onRename: (path: string, newName: string) => Promise<boolean>;
  onStartRename: (path: string) => void;
  onEndRename: () => void;
  onMove: (path: string, dir: string) => void;
  onReorder: (path: string, dir: string, index: number) => void;
  onDelete: (path: string) => void;
  onNewNoteIn: (dir: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
};

export default function Sidebar({
  tree,
  dragging,
  selected,
  targetDir,
  collapsed,
  renamingPath,
  favorites,
  todos,
  onToggleTodo,
  onQuickAddTodo,
  onSelectNote,
  onUnfavorite,
  onReorderFavorite,
  onSelectFolder,
  onToggle,
  onNewNote,
  onNewFolder,
  onRename,
  onStartRename,
  onEndRename,
  onMove,
  onReorder,
  onDelete,
  onNewNoteIn,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: Props) {
  const [rootOver, setRootOver] = useState(false);
  const rootEnter = useRef(0);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="app-title">DesktopMemo</span>
        <div className="sidebar-actions">
          <button title="새 폴더 (Ctrl+Shift+N)" onClick={onNewFolder}>
            + 폴더
          </button>
          <button title="새 메모 (Ctrl+N)" onClick={onNewNote}>
            + 메모
          </button>
        </div>
      </div>
      <div className="pinned">
        <button
          className={"quick-memo" + (selected === QUICK_MEMO ? " selected" : "")}
          onClick={() => onSelectNote(QUICK_MEMO)}
          title="Ctrl+Alt+M: 어디서든 빠른 메모 열기"
        >
          <span className="pinned-icon">⚡</span>빠른 메모
        </button>
      </div>
      {favorites.length > 0 && (
        <Favorites
          favorites={favorites}
          selected={selected}
          onSelect={onSelectNote}
          onUnfavorite={onUnfavorite}
          onReorder={onReorderFavorite}
        />
      )}
      <nav
        className={"tree" + (rootOver ? " drop-over" : "")}
        onDragEnter={() => {
          rootEnter.current++;
          setRootOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={() => {
          rootEnter.current--;
          if (rootEnter.current <= 0) {
            rootEnter.current = 0;
            setRootOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          rootEnter.current = 0;
          setRootOver(false);
          // 트리 빈 영역에 드롭 = 루트 최하단으로
          const dragged = e.dataTransfer.getData("text/plain");
          if (!dragged) return;
          onReorder(dragged, "", tree.filter((n) => n.path !== dragged).length);
        }}
      >
        <Tree
          nodes={tree}
          parentDir=""
          dragging={dragging}
          selected={selected}
          targetDir={targetDir}
          collapsed={collapsed}
          renamingPath={renamingPath}
          onSelectNote={onSelectNote}
          onSelectFolder={onSelectFolder}
          onToggle={onToggle}
          onRename={onRename}
          onStartRename={onStartRename}
          onEndRename={onEndRename}
          onMove={onMove}
          onReorder={onReorder}
          onDelete={onDelete}
          onNewNoteIn={onNewNoteIn}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </nav>
      <TodoPanel
        todos={todos}
        active={selected === TODO_VIEW}
        onToggleDone={onToggleTodo}
        onOpenView={() => onSelectNote(TODO_VIEW)}
        onQuickAdd={onQuickAddTodo}
      />
    </aside>
  );
}
