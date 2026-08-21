import { useEffect } from "react";

type Props = { onClose: () => void };

type Row = [keys: string, desc: string];

// 단축키 목록은 App.tsx·Editor.tsx의 키 핸들러와 TipTap StarterKit의
// 기본 키맵에서 그대로 옮겨온 것이다. 키 처리를 고치면 여기도 같이 고친다.
const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "메모 관리",
    rows: [
      ["Ctrl + N", "새 메모"],
      ["Ctrl + Shift + N", "새 폴더"],
      ["F2", "이름 바꾸기"],
      ["Delete", "선택한 메모·폴더를 삭제 (본문을 편집하는 중에는 동작하지 않음)"],
    ],
  },
  {
    title: "이동과 검색",
    rows: [
      ["Ctrl + P", "빠른 이동 — 메모 이름을 입력해 바로 열기, 명령 실행"],
      ["Ctrl + F", "검색 — 제목뿐 아니라 본문 내용까지 찾기"],
      ["Ctrl + Tab", "다음 탭으로 (Ctrl + Shift + Tab은 이전 탭)"],
      ["Ctrl + W", "탭 닫기"],
    ],
  },
  {
    title: "어디서든 빠르게",
    rows: [
      ["Ctrl + Alt + M", "빠른 메모 열기 — 다른 프로그램을 쓰는 중이거나 창이 숨어 있어도 동작"],
      ["Ctrl + T", "할 일 빠른 추가 — Enter로 연달아 여러 개 입력"],
      ["Ctrl + Alt + P", "팝업 모드 켜고 끄기 — 항상 위에 뜨는 작은 빠른 메모 창"],
      ["F1", "이 도움말 열고 닫기"],
    ],
  },
  {
    title: "본문 편집",
    rows: [
      ["Ctrl + S", "즉시 저장 (평소에도 입력이 멈추면 0.5초 뒤 자동 저장됨)"],
      ["Ctrl + 마우스휠", "글자 크기 키우기·줄이기"],
      ["Ctrl + 0", "글자 크기를 기본값으로"],
      ["Ctrl + B / Ctrl + I", "굵게 / 기울임"],
      ["Ctrl + Shift + S / Ctrl + E", "취소선 / 인라인 코드"],
      ["Ctrl + Alt + 1 ~ 6", "제목 1~6단계"],
      ["Ctrl + Shift + 8 / Ctrl + Shift + 7", "글머리 목록 / 번호 목록"],
      ["Ctrl + Shift + B / Ctrl + Alt + C", "인용문 / 코드 블록"],
      ["Ctrl + Z / Ctrl + Shift + Z", "되돌리기 / 다시 실행"],
    ],
  },
];

const MOUSE: Row[] = [
  ["드래그", "메모·폴더를 다른 폴더로 옮기거나, 같은 폴더 안에서 순서 바꾸기"],
  ["🗑️ 위에 놓기", "드래그를 시작하면 나타나는 휴지통에 놓아 삭제"],
  ["우클릭", "즐겨찾기, 새 메모·폴더, 이름 바꾸기, 삭제 메뉴"],
  ["경계선 드래그", "사이드바와 본문 사이를 끌어 사이드바 너비 조절"],
  ["Ctrl + 클릭", "본문의 링크를 기본 브라우저에서 열기"],
];

const TIPS: string[] = [
  "메모는 문서\\DesktopMemo 폴더에 마크다운(.md) 파일로 저장됩니다. 다른 편집기로 열어 고쳐도 앱이 알아채고 화면을 다시 읽어옵니다.",
  '본문에 "# ", "- ", "1. ", "> ", "---"를 입력하면 제목·목록·인용문·구분선으로 즉시 바뀝니다.',
  '삭제한 메모는 Windows 휴지통으로 갑니다. 삭제 직후 아래에 뜨는 알림의 "실행 취소"를 누르면 바로 되돌릴 수 있습니다.',
  "창을 닫아도 프로그램은 종료되지 않고 트레이로 숨습니다. 완전히 끄려면 트레이 아이콘을 우클릭해 종료를 누르세요.",
  '빠른 메모는 아무 때나 적어두는 임시 공간입니다. "폴더로 저장"을 누르면 정식 메모로 옮겨지고 빠른 메모는 비워집니다.',
  '"이어서 붙이기"는 이미 있는 메모의 끝에 구분선과 오늘 날짜를 넣고 그 아래에 빠른 메모 내용을 덧붙입니다. 같은 메모에 계속 기록을 쌓을 때 쓰세요.',
  '"폴더로 저장"과 "이어서 붙이기" 모두, 본문에서 일부를 끌어 선택한 뒤 누르면 그 부분만 옮겨지고 나머지는 빠른 메모에 남습니다. 선택 없이 누르면 전체가 옮겨집니다.',
  "사이드바 아래 Todo 패널은 남은 할 일만 보여줍니다. 완료한 항목을 보거나 날짜를 넣으려면 패널의 Todo 제목을 눌러 전체 화면을 여세요.",
  "사이드바 오른쪽 위 \"팝업\" 버튼을 누르면 빠른 메모만 보이는 작은 창이 항상 다른 창 위에 뜹니다. 상단 바를 끌어 옮기고, 옆의 슬라이더로 창 투명도를 조절하며, 마우스를 창 위에 올리면 잠시 또렷해집니다. 팝업 창과 기본 창의 크기·위치는 각각 따로 기억됩니다.",
  "새 버전은 트레이 아이콘 우클릭 → 업데이트 확인에서 받을 수 있습니다.",
];

function KeyRows({ rows }: { rows: Row[] }) {
  return (
    <div className="help-rows">
      {rows.map(([keys, desc]) => (
        <div className="help-row" key={keys}>
          <div className="help-keys">
            {keys.split(" / ").map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </div>
          <div className="help-desc">{desc}</div>
        </div>
      ))}
    </div>
  );
}

export default function HelpModal({ onClose }: Props) {
  // Esc로 닫기. F1 토글은 App의 전역 키 핸들러가 처리한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="help-modal" role="dialog" aria-label="도움말">
        <header className="help-head">
          <span className="help-title">도움말</span>
          <button className="help-close" onClick={onClose} title="닫기 (Esc)" aria-label="도움말 닫기">
            ✕
          </button>
        </header>
        <div className="help-body">
          {SECTIONS.map((s) => (
            <section className="help-section" key={s.title}>
              <h3>{s.title}</h3>
              <KeyRows rows={s.rows} />
            </section>
          ))}
          <section className="help-section">
            <h3>마우스로 하는 것</h3>
            <KeyRows rows={MOUSE} />
          </section>
          <section className="help-section">
            <h3>알아두면 좋은 것</h3>
            <ul className="help-tips">
              {TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
