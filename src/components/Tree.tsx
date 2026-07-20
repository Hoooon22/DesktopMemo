import { useRef, useState } from "react";
import type { TreeNode } from "../api";

type TreeProps = {
  nodes: TreeNode[];
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
        <TreeItem key={node.path} node={node} {...rest} />
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

type ItemProps = Omit<TreeProps, "nodes"> & { node: TreeNode };

function TreeItem({
  node,
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
  onDelete,
  onNewNoteIn,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: ItemProps) {
  const [dropOver, setDropOver] = useState(false);
  const enterCount = useRef(0);

  const editing = renamingPath === node.path;
  const display = node.isDir ? node.name : node.name.replace(/\.md$/i, "");

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
      <li
        className={dropOver ? "drop-over" : undefined}
        onDragEnter={(e) => {
          e.stopPropagation();
          enterCount.current++;
          setDropOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          enterCount.current--;
          if (enterCount.current <= 0) {
            enterCount.current = 0;
            setDropOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          enterCount.current = 0;
          setDropOver(false);
          onMove(e.dataTransfer.getData("text/plain"), node.path);
        }}
      >
        <div className="row-wrap">
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
          </div>
        )}
      </li>
    );
  }

  return (
    <li>
      <div className="row-wrap">
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
