import { invoke } from "@tauri-apps/api/core";

export type TreeNode = {
  name: string;
  path: string; // 노트 루트 기준 상대 경로, "/" 구분
  isDir: boolean;
  children?: TreeNode[];
};

export const QUICK_MEMO = "QuickMemo.md";

export const listTree = () => invoke<TreeNode[]>("list_tree");
export const readNote = (path: string) => invoke<string>("read_note", { path });
export const writeNote = (path: string, content: string) =>
  invoke<void>("write_note", { path, content });
export const createNote = (dir: string) => invoke<string>("create_note", { dir });
export const createFolder = (dir: string) => invoke<string>("create_folder", { dir });
export const renameEntry = (path: string, newName: string) =>
  invoke<string>("rename_entry", { path, newName });
export const moveEntry = (path: string, dir: string) => invoke<string>("move_entry", { path, dir });
export const deleteEntry = (path: string) => invoke<void>("delete_entry", { path });
export const restoreEntry = (path: string) => invoke<void>("restore_entry", { path });

export type SearchHit = { path: string; name: string; snippet: string };
export const searchNotes = (query: string) => invoke<SearchHit[]>("search_notes", { query });
