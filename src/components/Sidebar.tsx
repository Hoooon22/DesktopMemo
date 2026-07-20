import { useRef, useState } from "react";
import type { RefObject } from "react";
import { QUICK_MEMO, TODO_VIEW } from "../api";
import type { SearchHit, TreeNode } from "../api";
import Tree from "./Tree";

type Props = {
  tree: TreeNode[];
  selected: string;
  targetDir: string;
  collapsed: Set<string>;
  renamingPath: string | null;
  query: string;
  hits: SearchHit[];
  searchInputRef: RefObject<HTMLInputElement>;
  onQueryChange: (q: string) => void;
  onSelectNote: (path: string) => void;
  onSelectFolder: (dir: string) => void;
  onToggle: (path: string) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onRename: (path: string, newName: string) => Promise<boolean>;
  onStartRename: (path: string) => void;
  onEndRename: () => void;
  onMove: (path: string, dir: string) => void;
  onDelete: (path: string) => void;
  onNewNoteIn: (dir: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
};

export default function Sidebar({
  tree,
  selected,
  targetDir,
  collapsed,
  renamingPath,
  query,
  hits,
  searchInputRef,
  onQueryChange,
  onSelectNote,
  onSelectFolder,
  onToggle,
  onNewNote,
  onNewFolder,
  onRename,
  onStartRename,
  onEndRename,
  onMove,
  onDelete,
  onNewNoteIn,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: Props) {
  const [rootOver, setRootOver] = useState(false);
  const rootEnter = useRef(0);

  const searching = query.trim().length > 0;

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
          className={"quick-memo" + (selected === TODO_VIEW ? " selected" : "")}
          onClick={() => onSelectNote(TODO_VIEW)}
        >
          ☑ Todo
        </button>
        <button
          className={"quick-memo" + (selected === QUICK_MEMO ? " selected" : "")}
          onClick={() => onSelectNote(QUICK_MEMO)}
          title="Ctrl+Alt+M: 어디서든 빠른 메모 열기"
        >
          ⚡ 빠른 메모
        </button>
      </div>
      <div className="search-box">
        <input
          ref={searchInputRef}
          className="search-input"
          placeholder="검색 (Ctrl+F)"
          value={query}
          spellCheck={false}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onQueryChange("");
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      {searching ? (
        <div className="search-results">
          {hits.length === 0 && <div className="search-empty">결과 없음</div>}
          {hits.map((h) => (
            <button
              key={h.path}
              className={"search-hit" + (selected === h.path ? " selected" : "")}
              onClick={() => onSelectNote(h.path)}
            >
              <span className="hit-name">
                {h.path === QUICK_MEMO ? "⚡ 빠른 메모" : h.name.replace(/\.md$/i, "")}
              </span>
              {h.snippet && <span className="hit-snippet">{h.snippet}</span>}
            </button>
          ))}
        </div>
      ) : (
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
            onMove(e.dataTransfer.getData("text/plain"), "");
          }}
        >
          <Tree
            nodes={tree}
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
            onDelete={onDelete}
            onNewNoteIn={onNewNoteIn}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </nav>
      )}
    </aside>
  );
}
