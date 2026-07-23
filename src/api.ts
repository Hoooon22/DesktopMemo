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
// 드래그 순서 변경: dir의 표시 순서에서 (옮기는 항목 제외) index 위치로 삽입
export const reorderEntry = (path: string, dir: string, index: number) =>
  invoke<string>("reorder_entry", { path, dir, index });
export const deleteEntry = (path: string) => invoke<void>("delete_entry", { path });
export const restoreEntry = (path: string) => invoke<void>("restore_entry", { path });

export type SearchHit = { path: string; name: string; snippet: string };
export const searchNotes = (query: string) => invoke<SearchHit[]>("search_notes", { query });

// 빠른 메모 내용을 지정 폴더에 새 메모로 저장하고 빠른 메모를 비운다
export const saveQuickMemo = (dir: string, name: string, content: string) =>
  invoke<string>("save_quick_memo", { dir, name, content });

// 사이드바 고정 Todo 뷰를 나타내는 센티널 (실제 파일 경로 아님)
export const TODO_VIEW = "::todo";

export type Todo = { id: string; text: string; done: boolean; start?: string; end?: string };
export const readTodos = () => invoke<Todo[]>("read_todos");
export const writeTodos = (todos: Todo[]) => invoke<void>("write_todos", { todos });

// 즐겨찾기한 메모의 상대경로 목록 (배열 순서 = 표시 순서)
export const readFavorites = () => invoke<string[]>("read_favorites");
export const writeFavorites = (favorites: string[]) =>
  invoke<void>("write_favorites", { favorites });
