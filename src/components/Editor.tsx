import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { QUICK_MEMO, readNote, writeNote } from "../api";

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "저장 중…",
  saved: "저장됨",
  error: "저장 실패",
};

type Props = {
  path: string;
  onRename: (newName: string) => Promise<boolean>;
};

export default function Editor({ path, onRename }: Props) {
  const [content, setContentState] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [titleDraft, setTitleDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<{ path: string; content: string } | null>(null);
  const cancelTitle = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pathRef = useRef(path);
  const contentRef = useRef("");

  const setContent = (v: string) => {
    contentRef.current = v;
    setContentState(v);
  };

  const isQuickMemo = path === QUICK_MEMO;
  const title = isQuickMemo ? "빠른 메모" : (path.split("/").pop() ?? path).replace(/\.md$/i, "");

  useEffect(() => {
    pathRef.current = path;
    let stale = false; // 빠른 노트 전환 시 늦게 도착한 응답이 화면을 덮지 않도록
    setSaveState("idle");
    readNote(path)
      .then((text) => {
        if (stale) return;
        setContent(text);
        textareaRef.current?.focus();
      })
      .catch(() => {
        if (!stale) setContent("");
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
  }, [path]);

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
    const unChanged = listen("notes-changed", () => {
      if (pending.current || timer.current !== undefined) return;
      readNote(pathRef.current)
        .then((text) => {
          if (text !== contentRef.current) setContent(text);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+E: 미리보기 토글
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setPreview((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleChange = (value: string) => {
    setContent(value);
    pending.current = { path, content: value };
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
  };

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

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

  const html = useMemo(() => {
    if (!preview) return "";
    const raw = marked.parse(content, { async: false });
    return DOMPurify.sanitize(raw);
  }, [preview, content]);

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
        <button
          className="preview-toggle"
          title="미리보기 전환 (Ctrl+E)"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "편집" : "미리보기"}
        </button>
        <span className="save-state">{SAVE_LABEL[saveState]}</span>
      </header>
      {preview ? (
        <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="메모를 입력하세요…"
          spellCheck={false}
          autoFocus
        />
      )}
    </section>
  );
}
