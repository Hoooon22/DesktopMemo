import { useState } from "react";
import { QUICK_MEMO } from "../api";
import type { TreeNode } from "../api";
import Tree from "./Tree";

type Props = {
  tree: TreeNode[];
  selected: string;
  targetDir: string;
  collapsed: Set<string>;
  onSelectNote: (path: string) => void;
  onSelectFolder: (dir: string) => void;
  onToggle: (path: string) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onRename: (path: string, newName: string) => void;
  onMove: (path: string, dir: string) => void;
  onDelete: (path: string) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
};

export default function Sidebar({
  tree,
  selected,
  targetDir,
  collapsed,
  onSelectNote,
  onSelectFolder,
  onToggle,
  onNewNote,
  onNewFolder,
  onRename,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
}: Props) {
  const [rootOver, setRootOver] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="app-title">DesktopMemo</span>
        <div className="sidebar-actions">
          <button title="새 폴더" onClick={onNewFolder}>
            + 폴더
          </button>
          <button title="새 메모" onClick={onNewNote}>
            + 메모
          </button>
        </div>
      </div>
      <button
        className={"quick-memo" + (selected === QUICK_MEMO ? " selected" : "")}
        onClick={() => onSelectNote(QUICK_MEMO)}
      >
        ⚡ 빠른 메모
      </button>
      <nav
        className={"tree" + (rootOver ? " drop-over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setRootOver(true);
        }}
        onDragLeave={() => setRootOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setRootOver(false);
          onMove(e.dataTransfer.getData("text/plain"), "");
        }}
      >
        <Tree
          nodes={tree}
          selected={selected}
          targetDir={targetDir}
          collapsed={collapsed}
          onSelectNote={onSelectNote}
          onSelectFolder={onSelectFolder}
          onToggle={onToggle}
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </nav>
    </aside>
  );
}
