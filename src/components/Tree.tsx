import { useRef, useState } from "react";
import type { TreeNode } from "../api";

type TreeProps = {
  nodes: TreeNode[];
  parentDir: string; // 이 트리 계층이 속한 폴더 (루트는 "")
  dragging: string | null;
  selected: string;
  targetDir: string;
  collapsed: Set<string>;
  renamingPath: string | null;
  onSelectNote: (path: string) => void;
  onSelectFolder: (dir: string) => void;
  onToggle: (path: string) => void;
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

export default function Tree({ nodes, ...rest }: TreeProps) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => (
        <TreeItem key={node.path} node={node} siblings={nodes} {...rest} />
      ))}
    </ul>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <input
      className="rename-input"
      value={value}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
      }}
      onBlur={commit}
    />
  );
}

type ItemProps = Omit<TreeProps, "nodes"> & { node: TreeNode; siblings: TreeNode[] };

// 행 안 세로 위치에 따른 드롭 동작: 위쪽 = 앞에 삽입, 아래쪽 = 뒤에 삽입,
// 폴더는 가운데(50%)가 "폴더 안으로"
type DropPos = "before" | "after" | "into";

function TreeItem({
  node,
  siblings,
  parentDir,
  dragging,
  selected,
  targetDir,
  collapsed,
  renamingPath,
  onSelectNote,
  onSelectFolder,
  onToggle,
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
}: ItemProps) {
  const [dropPos, setDropPos] = useState<DropPos | null>(null);

  const editing = renamingPath === node.path;
  const display = node.isDir ? node.name : node.name.replace(/\.md$/i, "");

  // 자기 자신·자기 하위로는 드롭 불가
  const isSelfOrChild = (dragged: string) =>
    dragged === node.path || node.path.startsWith(dragged + "/");

  const posFromEvent = (e: React.DragEvent): DropPos => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientY - r.top) / r.height;
    if (node.isDir) return rel < 0.25 ? "before" : rel > 0.75 ? "after" : "into";
    return rel < 0.5 ? "before" : "after";
  };

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDropPos(dragging !== null && isSelfOrChild(dragging) ? null : posFromEvent(e));
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropPos(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = posFromEvent(e);
      setDropPos(null);
      const dragged = e.dataTransfer.getData("text/plain");
      if (!dragged || isSelfOrChild(dragged)) return;
      if (pos === "into") {
        onMove(dragged, node.path);
      } else {
        const sibs = siblings.filter((s) => s.path !== dragged);
        const i = sibs.findIndex((s) => s.path === node.path);
        onReorder(dragged, parentDir, pos === "before" ? i : i + 1);
      }
    },
  };

  const commitRename = (value: string) => {
    onEndRename();
    const name = value.trim();
    if (name && name !== display) void onRename(node.path, name);
  };

  const rowActions = !editing && (
    <div className="row-actions">
      {node.isDir && (
        <button
          className="row-btn add"
          title="이 폴더에 새 메모"
          aria-label={`${node.name} 폴더에 새 메모`}
          onClick={(e) => {
            e.stopPropagation();
            onNewNoteIn(node.path);
          }}
        >
          +
        </button>
      )}
      <button
        className="row-btn edit"
        title="이름 바꾸기 (F2)"
        aria-label={`${display} 이름 바꾸기`}
        onClick={(e) => {
          e.stopPropagation();
          onStartRename(node.path);
        }}
      >
        ✎
      </button>
      <button
        className="row-btn delete"
        title="삭제 (휴지통으로 이동)"
        aria-label={`${display} 삭제`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(node.path);
        }}
      >
        ✕
      </button>
    </div>
  );

  const dragProps = {
    draggable: !editing,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", node.path);
      e.dataTransfer.effectAllowed = "move";
      onDragStart(node.path);
    },
    onDragEnd,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(node, e.clientX, e.clientY);
    },
  };

  if (node.isDir) {
    const open = !collapsed.has(node.path);
    return (
      <li>
        <div
          className={"row-wrap" + (dropPos ? ` drop-${dropPos}` : "")}
          {...dropHandlers}
        >
          {editing ? (
            <div className="tree-row folder">
              <span className="chevron">{open ? "▾" : "▸"}</span>
              <span className="type-icon">{open ? "📂" : "📁"}</span>
              <RenameInput initial={display} onCommit={commitRename} onCancel={onEndRename} />
            </div>
          ) : (
            <button
              className={"tree-row folder" + (targetDir === node.path ? " target" : "")}
              onClick={() => {
                onSelectFolder(node.path);
                onToggle(node.path);
              }}
              {...dragProps}
            >
              <span className="chevron">{open ? "▾" : "▸"}</span>
              <span className="type-icon">{open ? "📂" : "📁"}</span>
              <span className="label">{node.name}</span>
            </button>
          )}
          {rowActions}
        </div>
        {open && node.children && node.children.length > 0 && (
          <div className="tree-children">
            <Tree
              nodes={node.children}
              parentDir={node.path}
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
          </div>
        )}
      </li>
    );
  }

  return (
    <li>
      <div
        className={"row-wrap" + (dropPos ? ` drop-${dropPos}` : "")}
        {...dropHandlers}
      >
        {editing ? (
          <div className="tree-row note">
            <span className="chevron" />
            <span className="type-icon">📄</span>
            <RenameInput initial={display} onCommit={commitRename} onCancel={onEndRename} />
          </div>
        ) : (
          <button
            className={"tree-row note" + (selected === node.path ? " selected" : "")}
            onClick={() => onSelectNote(node.path)}
            {...dragProps}
          >
            <span className="chevron" />
            <span className="type-icon">📄</span>
            <span className="label">{display}</span>
          </button>
        )}
        {rowActions}
      </div>
    </li>
  );
}
