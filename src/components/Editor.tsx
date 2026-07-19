import { useEffect, useRef, useState } from "react";
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
  onRename: (newName: string) => void;
};

export default function Editor({ path, onRename }: Props) {
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [titleDraft, setTitleDraft] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<{ path: string; content: string } | null>(null);
  const cancelTitle = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isQuickMemo = path === QUICK_MEMO;
  const title = isQuickMemo ? "빠른 메모" : (path.split("/").pop() ?? path).replace(/\.md$/i, "");

  useEffect(() => {
    setSaveState("idle");
    readNote(path)
      .then((text) => {
        setContent(text);
        textareaRef.current?.focus();
      })
      .catch(() => setContent(""));

    // 노트 전환·언마운트 시 대기 중인 저장을 즉시 반영한다
    return () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
      }
      const p = pending.current;
      pending.current = null;
      if (p) writeNote(p.path, p.content).catch(() => {});
    };
  }, [path]);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

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

  // 제목 변경 전에 미저장 본문을 먼저 기록해 내용 유실을 막는다
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
    await flushNow();
    onRename(name);
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
          onBlur={commitTitle}
        />
        <span className="save-state">{SAVE_LABEL[saveState]}</span>
      </header>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="메모를 입력하세요…"
        spellCheck={false}
        autoFocus
      />
    </section>
  );
}
