import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import type { MarkdownSerializerState } from "@tiptap/pm/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { listTree, QUICK_MEMO, readNote, saveQuickMemo, writeNote } from "../api";
import type { TreeNode } from "../api";

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "저장 중…",
  saved: "저장됨",
  error: "저장 실패",
};

const FONT_KEY = "editor-font-size";
const FONT_MIN = 10;
const FONT_MAX = 32;
const FONT_DEFAULT = 14;

// 마크다운은 빈 문단을 표현할 수 없어 그냥 두면 저장→다시 읽기에서 빈 줄이 사라진다.
// 빈 문단을 &nbsp;로 저장하고, 읽을 때 &nbsp;만 있는 문단을 빈 문단으로 되돌린다.
const KeepEmptyLineParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          if (node.childCount === 0) {
            state.write("&nbsp;");
          } else {
            state.renderInline(node);
          }
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            for (const p of element.querySelectorAll("p")) {
              if (p.textContent === "\u00A0") p.textContent = "";
            }
          },
        },
      },
    };
  },
});

type Props = {
  path: string;
  onRename: (newName: string) => Promise<boolean>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
};

type FolderOpt = { path: string; name: string; depth: number };

function flattenFolders(nodes: TreeNode[], depth = 0, out: FolderOpt[] = []): FolderOpt[] {
  for (const n of nodes) {
    if (n.isDir) {
      out.push({ path: n.path, name: n.name, depth });
      if (n.children) flattenFolders(n.children, depth + 1, out);
    }
  }
  return out;
}

export default function Editor({ path, onRename, isFavorite, onToggleFavorite }: Props) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [titleDraft, setTitleDraft] = useState("");
  const [savePop, setSavePop] = useState(false);
  const [saveFolders, setSaveFolders] = useState<FolderOpt[]>([]);
  const [saveDir, setSaveDir] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    const v = Number(localStorage.getItem(FONT_KEY));
    return v >= FONT_MIN && v <= FONT_MAX ? v : FONT_DEFAULT;
  });
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<{ path: string; content: string } | null>(null);
  const cancelTitle = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef(path);
  const contentRef = useRef("");

  const isQuickMemo = path === QUICK_MEMO;
  const title = isQuickMemo ? "빠른 메모" : (path.split("/").pop() ?? path).replace(/\.md$/i, "");

  // 노션처럼 서식이 즉시 반영되는 WYSIWYG 편집기.
  // 파일은 계속 마크다운으로 저장한다(getMarkdown 직렬화).
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      KeepEmptyLineParagraph,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: "메모를 입력하세요…" }),
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    editorProps: {
      attributes: { spellcheck: "false" }, // 오타 빨간 밑줄 비활성화
    },
    onUpdate: ({ editor }) => {
      const md: string = editor.storage.markdown.getMarkdown();
      contentRef.current = md;
      pending.current = { path: pathRef.current, content: md };
      setSaveState("saving");
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        const p = pending.current;
        pending.current = null;
        if (!p) return;
        writeNote(p.path, p.content)
          .then(() => setSaveState("saved"))
          .catch(() => setSaveState("error"));
      }, 500);
    },
  });

  useEffect(() => {
    pathRef.current = path;
    if (!editor) return;
    let stale = false; // 빠른 노트 전환 시 늦게 도착한 응답이 화면을 덮지 않도록
    setSaveState("idle");
    readNote(path)
      .then((text) => {
        if (stale) return;
        contentRef.current = text;
        editor.commands.setContent(text, false);
        editor.commands.focus();
      })
      .catch(() => {
        if (stale) return;
        contentRef.current = "";
        editor.commands.setContent("", false);
      });

    // 노트 전환·언마운트 시 대기 중인 저장을 즉시 반영한다
    return () => {
      stale = true;
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
      }
      const p = pending.current;
      pending.current = null;
      if (p) writeNote(p.path, p.content).catch(() => {});
    };
  }, [path, editor]);

  const flushNow = async () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    const p = pending.current;
    pending.current = null;
    if (p) {
      try {
        await writeNote(p.path, p.content);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }
  };

  // 외부 변경 감지 시 편집 중이 아니면 내용 다시 읽기, 종료 직전 미저장분 기록
  useEffect(() => {
    if (!editor) return;
    const unChanged = listen("notes-changed", () => {
      // 편집 중(포커스·대기 저장·디바운스)에는 디스크로 화면을 덮지 않는다.
      // 자동 저장이 파일 워처를 통해 자기 변경 이벤트로 되돌아와 입력을 방해하는 걸 막는다.
      if (pending.current || timer.current !== undefined || editor.isFocused) return;
      readNote(pathRef.current)
        .then((text) => {
          // 비동기 읽기를 기다리는 사이 편집이 재개됐으면 덮지 않는다 (오래된 내용으로 클로버 방지)
          if (pending.current || timer.current !== undefined || editor.isFocused) return;
          if (text !== contentRef.current) {
            contentRef.current = text;
            editor.commands.setContent(text, false);
          }
        })
        .catch(() => {});
    }).catch(() => () => {});
    const unQuit = listen("app-quitting", () => {
      void flushNow();
    }).catch(() => () => {});
    return () => {
      void unChanged.then((f) => f());
      void unQuit.then((f) => f());
    };
  }, [editor]);

  // Ctrl+휠: 본문 글자 크기 확대/축소
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setFontSize((s) => Math.min(FONT_MAX, Math.max(FONT_MIN, s + (e.deltaY < 0 ? 1 : -1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    localStorage.setItem(FONT_KEY, String(fontSize));
  }, [fontSize]);

  // Ctrl+S: 대기 중인 변경 즉시 저장, Ctrl+0: 글자 크기 기본값 복귀
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (pending.current) void flushNow();
        else setSaveState("saved"); // 변경이 없어도 저장됨 피드백
      } else if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        setFontSize(FONT_DEFAULT);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // "저장됨" 표시는 3초 뒤 자동으로 사라진다 (저장 실패는 계속 표시)
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = window.setTimeout(() => setSaveState("idle"), 3000);
    return () => window.clearTimeout(t);
  }, [saveState]);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  // "폴더로 저장" 팝오버 열기 (폴더 목록은 열 때마다 새로 읽는다)
  const openSavePop = async () => {
    setSaveDir("");
    setSaveName("");
    setSaveErr(null);
    setSavePop(true);
    try {
      setSaveFolders(flattenFolders(await listTree()));
    } catch (e) {
      setSaveErr(String(e));
    }
  };

  const confirmSaveToFolder = async () => {
    const name = saveName.trim();
    if (!name) return;
    // 대기 중인 자동 저장을 취소한다 — 저장이 끝나면 빠른 메모는 비워지므로,
    // 그 뒤에 옛 내용이 QuickMemo.md에 다시 쓰이면 안 된다
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    pending.current = null;
    try {
      await saveQuickMemo(saveDir, name, contentRef.current);
      contentRef.current = "";
      editor?.commands.setContent("", false);
      setSavePop(false);
      setSaveState("saved");
    } catch (e) {
      setSaveErr(String(e));
    }
  };

  const commitTitle = async () => {
    if (cancelTitle.current) {
      cancelTitle.current = false;
      setTitleDraft(title);
      return;
    }
    const name = titleDraft.trim();
    if (isQuickMemo || !name || name === title) {
      setTitleDraft(title);
      return;
    }
    // 제목 변경 전에 미저장 본문을 먼저 기록해 내용 유실을 막는다
    await flushNow();
    const ok = await onRename(name);
    if (!ok) setTitleDraft(title);
  };

  return (
    <section className="editor">
      <header className="editor-header">
        <input
          className="title-input"
          value={titleDraft}
          readOnly={isQuickMemo}
          spellCheck={false}
          title={isQuickMemo ? undefined : "클릭해서 제목 수정"}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              cancelTitle.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={() => void commitTitle()}
        />
        {!isQuickMemo && (
          <button
            className={"fav-toggle" + (isFavorite ? " on" : "")}
            title={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            onClick={onToggleFavorite}
          >
            {isFavorite ? "★" : "☆"}
          </button>
        )}
        <span className="save-state">{SAVE_LABEL[saveState]}</span>
        {isQuickMemo && (
          <button
            className="save-to-folder-btn"
            title="빠른 메모를 폴더에 새 메모로 저장"
            onClick={() => void openSavePop()}
          >
            폴더로 저장
          </button>
        )}
      </header>
      {isQuickMemo && savePop && (
        <>
          <div className="ctx-backdrop" onClick={() => setSavePop(false)} />
          <div className="save-pop">
            <label>
              폴더
              <select value={saveDir} onChange={(e) => setSaveDir(e.target.value)}>
                <option value="">메모 루트</option>
                {saveFolders.map((f) => (
                  <option key={f.path} value={f.path}>
                    {"  ".repeat(f.depth) + f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              이름
              <input
                value={saveName}
                autoFocus
                spellCheck={false}
                placeholder="메모 이름"
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmSaveToFolder();
                  else if (e.key === "Escape") setSavePop(false);
                }}
              />
            </label>
            {saveErr && <div className="save-pop-error">{saveErr}</div>}
            <div className="save-pop-actions">
              <button onClick={() => setSavePop(false)}>취소</button>
              <button
                className="primary"
                disabled={!saveName.trim()}
                onClick={() => void confirmSaveToFolder()}
              >
                저장
              </button>
            </div>
          </div>
        </>
      )}
      <div className="editor-body" ref={bodyRef} style={{ fontSize: `${fontSize}px` }}>
        <EditorContent className="editor-content" editor={editor} />
      </div>
    </section>
  );
}
