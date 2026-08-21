import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { documentDir, join } from "@tauri-apps/api/path";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Extension, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import type { MarkdownSerializerState } from "@tiptap/pm/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  appendQuickMemo,
  listTree,
  QUICK_MEMO,
  readNote,
  saveImage,
  saveQuickMemo,
  writeNote,
} from "../api";
import type { TreeNode } from "../api";
import { todayStr } from "../useTodos";

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

// 목록·표 밖의 일반 문단에서도 Tab으로 들여쓸 수 있게 한다.
// 진짜 탭 문자는 줄 앞에 오면 마크다운이 코드 블록으로 읽어 버리므로,
// 다시 열어도 그대로 남는 줄바꿈 없는 공백(NBSP)을 넣는다.
// priority를 낮춰 목록 들여쓰기·표 셀 이동 같은 기존 Tab 동작이 먼저 처리되게 한다.
const TAB_INDENT = "\u00A0".repeat(4);

const TabIndent = Extension.create({
  name: "tabIndent",
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // 코드 블록 안은 마크다운이 펜스로 감싸 그대로 보존하므로 진짜 탭을 넣는다
        if (this.editor.isActive("codeBlock")) return this.editor.commands.insertContent("\t");
        return this.editor.commands.insertContent(TAB_INDENT);
      },
    };
  },
});

// 노트 루트 절대 경로 (붙여넣은 이미지 표시용). 앱 시작 시 미리 받아 둔다.
let notesRootAbs = "";
void (async () => {
  notesRootAbs = await join(await documentDir(), "DesktopMemo");
})().catch(() => {});

// 마크다운에는 ".assets/img-1.png" 같은 상대 경로를 저장하고,
// 화면에 그릴 때만 asset 프로토콜 절대 주소로 바꾼다.
function displaySrc(src: string): string {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // http:, data: 등은 그대로
  if (!notesRootAbs) return src;
  return convertFileSrc(`${notesRootAbs}/${src}`);
}

const LocalImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: displaySrc(HTMLAttributes.src as string),
      }),
    ];
  },
});

// 클립보드 MIME 타입 → 저장 확장자
const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

type Props = {
  path: string;
  onRename: (newName: string) => Promise<boolean>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose?: () => void; // 분할 창일 때만 전달됨 (헤더에 닫기 버튼 표시)
  compact?: boolean; // 팝업 모드: 헤더 없이 본문만 (저장 표시는 본문 위 작은 라벨)
};

type TreeOpt = { path: string; name: string; depth: number; isDir: boolean };

// 트리를 화면 순서 그대로 한 줄씩 펼친다 (폴더 선택은 isDir만 걸러 쓴다)
function flattenTree(nodes: TreeNode[], depth = 0, out: TreeOpt[] = []): TreeOpt[] {
  for (const n of nodes) {
    out.push({ path: n.path, name: n.name, depth, isDir: n.isDir });
    if (n.children) flattenTree(n.children, depth + 1, out);
  }
  return out;
}

export default function Editor({
  path,
  onRename,
  isFavorite,
  onToggleFavorite,
  onClose,
  compact,
}: Props) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [titleDraft, setTitleDraft] = useState("");
  const [savePop, setSavePop] = useState(false);
  const [saveFolders, setSaveFolders] = useState<TreeOpt[]>([]);
  const [saveDir, setSaveDir] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [appendPop, setAppendPop] = useState(false);
  const [appendEntries, setAppendEntries] = useState<TreeOpt[]>([]);
  const [appendPath, setAppendPath] = useState("");
  // 버튼을 누른 순간 본문에서 끌어 놓은 범위. null이면 빠른 메모 전체를 옮긴다.
  const [moveSel, setMoveSel] = useState<{ from: number; to: number } | null>(null);
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
      LocalImage,
      Placeholder.configure({ placeholder: "메모를 입력하세요…" }),
      // 마크다운 표(| a | b |)를 실제 표로 그린다. 저장할 때는 tiptap-markdown이 다시 표 문법으로 직렬화.
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
      TabIndent,
    ],
    editorProps: {
      attributes: { spellcheck: "false" }, // 오타 빨간 밑줄 비활성화
      // Ctrl(맥은 Cmd) + 클릭으로 링크를 기본 브라우저에서 연다
      handleDOMEvents: {
        click: (_view, event) => {
          if (!event.ctrlKey && !event.metaKey) return false;
          const href = (event.target as HTMLElement | null)
            ?.closest("a")
            ?.getAttribute("href");
          if (!href) return false;
          event.preventDefault();
          void openUrl(href).catch(() => {});
          return true;
        },
      },
      // 클립보드 이미지 붙여넣기: 파일로 저장하고 그 자리에 이미지 노드 삽입
      handlePaste: (view, event) => {
        const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
          i.type.startsWith("image/"),
        );
        const file = item?.getAsFile();
        if (!file) {
          // URL만 붙여넣으면 바로 링크로 만든다(선택 영역이 있을 때는 Link 확장이 처리).
          const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
          if (!view.state.selection.empty || !/^https?:\/\/\S+$/.test(text)) return false;
          event.preventDefault();
          const { schema, tr } = view.state;
          const link = schema.text(text, [schema.marks.link.create({ href: text })]);
          view.dispatch(
            tr
              .replaceSelectionWith(link, false)
              .removeStoredMark(schema.marks.link)
              .setMeta("preventAutolink", true),
          );
          return true;
        }
        event.preventDefault();
        void (async () => {
          try {
            const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
            const rel = await saveImage(bytes, IMAGE_EXT[file.type] ?? "png");
            const node = view.state.schema.nodes.image.create({ src: rel });
            view.dispatch(view.state.tr.replaceSelectionWith(node));
          } catch {
            setSaveState("error");
          }
        })();
        return true;
      },
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

  // 버튼을 누르면 편집기에서 포커스가 빠지지만 ProseMirror는 선택 범위를 그대로
  // 들고 있어서, 팝오버를 열 때 읽어 두면 끌어 놓은 부분만 옮길 수 있다.
  const captureSelection = () => {
    const sel = editor?.state.selection;
    setMoveSel(sel && !sel.empty ? { from: sel.from, to: sel.to } : null);
  };

  // "폴더로 저장" 팝오버 열기 (폴더 목록은 열 때마다 새로 읽는다)
  const openSavePop = async () => {
    captureSelection();
    setSaveDir("");
    setSaveName("");
    setSaveErr(null);
    setAppendPop(false);
    setSavePop(true);
    try {
      setSaveFolders(flattenTree(await listTree()).filter((n) => n.isDir));
    } catch (e) {
      setSaveErr(String(e));
    }
  };

  // "이어서 붙이기" 팝오버 열기 (붙일 대상은 메모라서 폴더까지 함께 보여 준다)
  const openAppendPop = async () => {
    captureSelection();
    setAppendPath("");
    setSaveErr(null);
    setSavePop(false);
    setAppendPop(true);
    try {
      setAppendEntries(flattenTree(await listTree()));
    } catch (e) {
      setSaveErr(String(e));
    }
  };

  // 옮기기가 끝나면 QuickMemo.md는 비워지므로, 그 뒤에 옛 내용이 다시 쓰이지 않도록
  // 대기 중인 자동 저장을 버린다
  const dropPendingSave = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    pending.current = null;
  };

  // 옮길 조각과 빠른 메모에 남길 내용을 만든다. 선택 범위가 있으면 그 부분만
  // 떼어 내고 나머지를 남긴다. 아직 편집기는 건드리지 않고 결과 문서만 계산해
  // 두었다가, 파일 기록이 성공한 뒤에 finishMove로 화면에 반영한다.
  const sliceForMove = () => {
    const md = editor?.storage.markdown.serializer;
    if (!editor || !md || !moveSel) {
      return { sel: null, body: contentRef.current.trim(), rest: "" };
    }
    const { from, to } = moveSel;
    return {
      sel: moveSel,
      body: md.serialize(editor.state.doc.cut(from, to)).trim(),
      rest: md.serialize(editor.state.tr.delete(from, to).doc),
    };
  };

  const finishMove = (sel: { from: number; to: number } | null) => {
    if (sel) {
      // deleteRange가 onUpdate를 태워 contentRef와 자동 저장을 알아서 맞춘다
      editor?.commands.deleteRange(sel);
      setSaveState("saved");
    } else {
      contentRef.current = "";
      editor?.commands.setContent("", false);
      setSaveState("saved");
    }
  };

  const emptyMoveError = (sel: unknown) =>
    sel ? "선택한 부분이 비어 있습니다" : "빠른 메모가 비어 있습니다";

  const confirmSaveToFolder = async () => {
    const name = saveName.trim();
    if (!name) return;
    const { sel, body, rest } = sliceForMove();
    if (!body) {
      setSaveErr(emptyMoveError(sel));
      return;
    }
    dropPendingSave();
    try {
      await saveQuickMemo(saveDir, name, body, rest);
      finishMove(sel);
      setSavePop(false);
    } catch (e) {
      setSaveErr(String(e));
    }
  };

  const confirmAppend = async () => {
    if (!appendPath) return;
    const { sel, body, rest } = sliceForMove();
    if (!body) {
      setSaveErr(emptyMoveError(sel));
      return;
    }
    dropPendingSave();
    try {
      await appendQuickMemo(appendPath, `---\n\n${todayStr()}\n\n${body}`, rest);
      finishMove(sel);
      setAppendPop(false);
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
    <section className={"editor" + (compact ? " compact" : "")}>
      {compact ? (
        <span className="save-state floating">{SAVE_LABEL[saveState]}</span>
      ) : (
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
            <>
              <button
                className="save-to-folder-btn"
                title="빠른 메모를 기존 메모 끝에 구분선·날짜와 함께 이어 붙이기"
                onClick={() => void openAppendPop()}
              >
                이어서 붙이기
              </button>
              <button
                className="save-to-folder-btn"
                title="빠른 메모를 폴더에 새 메모로 저장"
                onClick={() => void openSavePop()}
              >
                폴더로 저장
              </button>
            </>
          )}
          {onClose && (
            <button
              className="split-close"
              title="분할 창 닫기"
              aria-label="분할 창 닫기"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </header>
      )}
      {isQuickMemo && savePop && (
        <>
          <div className="ctx-backdrop" onClick={() => setSavePop(false)} />
          <div className="save-pop">
            {moveSel && <div className="save-pop-hint">끌어 놓은 부분만 옮깁니다</div>}
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
      {isQuickMemo && appendPop && (
        <>
          <div className="ctx-backdrop" onClick={() => setAppendPop(false)} />
          <div className="save-pop">
            {moveSel && <div className="save-pop-hint">끌어 놓은 부분만 옮깁니다</div>}
            <label>
              이어 붙일 메모
              <select
                value={appendPath}
                autoFocus
                onChange={(e) => setAppendPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmAppend();
                  else if (e.key === "Escape") setAppendPop(false);
                }}
              >
                <option value="">메모 선택</option>
                {appendEntries.map((n) => (
                  <option key={n.path} value={n.isDir ? "" : n.path} disabled={n.isDir}>
                    {"  ".repeat(n.depth) + (n.isDir ? `${n.name}/` : n.name.replace(/\.md$/i, ""))}
                  </option>
                ))}
              </select>
            </label>
            {saveErr && <div className="save-pop-error">{saveErr}</div>}
            <div className="save-pop-actions">
              <button onClick={() => setAppendPop(false)}>취소</button>
              <button className="primary" disabled={!appendPath} onClick={() => void confirmAppend()}>
                붙이기
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
