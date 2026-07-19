import { useRef, useState } from "react";
import type { TreeNode } from "../api";

type TreeProps = {
  nodes: TreeNode[];
  selected: string;
  targetDir: string;
  collapsed: Set<string>;
  onSelectNote: (path: string) => void;
  onSelectFolder: (dir: string) => void;
  onToggle: (path: string) => void;
  onRename: (path: string, newName: string) => void;
  onMove: (path: string, dir: string) => void;
  onDelete: (path: string) => void;
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
  onSelectNote,
  onSelectFolder,
  onToggle,
  onRename,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
}: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [dropOver, setDropOver] = useState(false);

  const display = node.isDir ? node.name : node.name.replace(/\.md$/i, "");

  const commitRename = (value: string) => {
    setEditing(false);
    const name = value.trim();
    if (name && name !== display) onRename(node.path, name);
  };

  const deleteButton = !editing && (
    <button
      className="row-delete"
      title="삭제 (휴지통으로 이동)"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(node.path);
      }}
    >
      ✕
    </button>
  );

  if (node.isDir) {
    const open = !collapsed.has(node.path);
    return (
      <li
        className={dropOver ? "drop-over" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropOver(false);
          onMove(e.dataTransfer.getData("text/plain"), node.path);
        }}
      >
        <div className="row-wrap">
          {editing ? (
            <div className="tree-row folder">
              <span className="chevron">{open ? "▾" : "▸"}</span>
              <RenameInput
                initial={display}
                onCommit={commitRename}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : (
            <button
              className={"tree-row folder" + (targetDir === node.path ? " target" : "")}
              onClick={() => onSelectFolder(node.path)}
              onDoubleClick={() => setEditing(true)}
            >
              <span
                className="chevron"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node.path);
                }}
              >
                {open ? "▾" : "▸"}
              </span>
              <span className="label">{node.name}</span>
            </button>
          )}
          {deleteButton}
        </div>
        {open && node.children && node.children.length > 0 && (
          <div className="tree-children">
            <Tree
              nodes={node.children}
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
            <RenameInput
              initial={display}
              onCommit={commitRename}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <button
            className={"tree-row note" + (selected === node.path ? " selected" : "")}
            draggable
            onClick={() => onSelectNote(node.path)}
            onDoubleClick={() => setEditing(true)}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", node.path);
              e.dataTransfer.effectAllowed = "move";
              onDragStart(node.path);
            }}
            onDragEnd={onDragEnd}
          >
            <span className="label">{display}</span>
          </button>
        )}
        {deleteButton}
      </div>
    </li>
  );
}
