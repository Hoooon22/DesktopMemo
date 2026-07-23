use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

pub const QUICK_MEMO: &str = "QuickMemo.md";

const TODO_FILE: &str = ".todos.json";
const FAVORITES_FILE: &str = ".favorites.json";
const ORDER_FILE: &str = ".order.json";
const SEARCH_LIMIT: usize = 50;

pub struct NotesRoot(pub PathBuf);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<TreeNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    name: String,
    snippet: String,
}

#[derive(Serialize, Deserialize)]
pub struct Todo {
    id: String,
    text: String,
    done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    end: Option<String>,
}

/// 노트 루트 기준 상대 경로만 허용한다 (".."·절대 경로 거부).
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("절대 경로는 사용할 수 없습니다".into());
    }
    for comp in rel_path.components() {
        if !matches!(comp, Component::Normal(_)) {
            return Err(format!("잘못된 경로입니다: {rel}"));
        }
    }
    Ok(root.join(rel_path))
}

fn ensure_not_quick_memo(path: &str) -> Result<(), String> {
    if path == QUICK_MEMO {
        return Err("빠른 메모는 이동·삭제·이름 변경할 수 없습니다".into());
    }
    Ok(())
}

/// "새 메모 2" < "새 메모 10" 처럼 숫자 구간을 수로 비교한다.
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let mut na: u128 = 0;
                    while let Some(c) = ai.peek().copied().filter(|c| c.is_ascii_digit()) {
                        na = na.saturating_mul(10).saturating_add(c.to_digit(10).unwrap() as u128);
                        ai.next();
                    }
                    let mut nb: u128 = 0;
                    while let Some(c) = bi.peek().copied().filter(|c| c.is_ascii_digit()) {
                        nb = nb.saturating_mul(10).saturating_add(c.to_digit(10).unwrap() as u128);
                        bi.next();
                    }
                    match na.cmp(&nb) {
                        Ordering::Equal => {}
                        o => return o,
                    }
                } else {
                    match ca.cmp(&cb) {
                        Ordering::Equal => {
                            ai.next();
                            bi.next();
                        }
                        o => return o,
                    }
                }
            }
        }
    }
}

/// 폴더의 수동 표시 순서(.order.json). 없거나 깨졌으면 빈 목록.
fn read_order(dir: &Path) -> Vec<String> {
    fs::read_to_string(dir.join(ORDER_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_order(dir: &Path, order: &[String]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(order).map_err(|e| e.to_string())?;
    fs::write(dir.join(ORDER_FILE), text).map_err(|e| e.to_string())
}

/// 폴더의 자식 이름을 화면 표시 순서대로 나열한다 (build_tree와 같은 규칙:
/// 수동 순서 우선, 나머지는 폴더 먼저 이름순).
fn display_names(dir: &Path, at_root: bool) -> Result<Vec<String>, String> {
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            dirs.push(name);
        } else if name.to_lowercase().ends_with(".md") {
            if at_root && name == QUICK_MEMO {
                continue;
            }
            files.push(name);
        }
    }
    dirs.sort_by(|a, b| natural_cmp(a, b));
    files.sort_by(|a, b| natural_cmp(a, b));
    let mut rest = dirs;
    rest.append(&mut files);

    let order = read_order(dir);
    let mut out = Vec::with_capacity(rest.len());
    for n in &order {
        if let Some(i) = rest.iter().position(|x| x == n) {
            out.push(rest.remove(i));
        }
    }
    out.append(&mut rest);
    Ok(out)
}

fn build_tree(dir: &Path, rel_prefix: &str) -> Result<Vec<TreeNode>, String> {
    let mut dirs: Vec<TreeNode> = Vec::new();
    let mut files: Vec<TreeNode> = Vec::new();

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{rel_prefix}/{name}")
        };
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            let children = build_tree(&entry.path(), &rel)?;
            dirs.push(TreeNode {
                name,
                path: rel,
                is_dir: true,
                children: Some(children),
            });
        } else if name.to_lowercase().ends_with(".md") {
            // 빠른 메모는 사이드바 고정 항목으로만 노출한다
            if rel_prefix.is_empty() && name == QUICK_MEMO {
                continue;
            }
            files.push(TreeNode {
                name,
                path: rel,
                is_dir: false,
                children: None,
            });
        }
    }

    dirs.sort_by(|x, y| natural_cmp(&x.name, &y.name));
    files.sort_by(|x, y| natural_cmp(&x.name, &y.name));
    dirs.append(&mut files);

    // .order.json의 수동 순서를 먼저 적용하고, 목록에 없는 항목은 기본 정렬로 뒤에 붙인다
    let order = read_order(dir);
    if order.is_empty() {
        return Ok(dirs);
    }
    let mut rest = dirs;
    let mut out = Vec::with_capacity(rest.len());
    for n in &order {
        if let Some(i) = rest.iter().position(|x| x.name == *n) {
            out.push(rest.remove(i));
        }
    }
    out.append(&mut rest);
    Ok(out)
}

/// "새 메모.md", "새 메모 2.md"… 식으로 비어 있는 이름을 찾는다.
fn unique_name(
    parent: &Path,
    dir: &str,
    base: &str,
    ext: Option<&str>,
) -> Result<(PathBuf, String), String> {
    for i in 1u32..10_000 {
        let name = match (i, ext) {
            (1, Some(e)) => format!("{base}.{e}"),
            (1, None) => base.to_string(),
            (n, Some(e)) => format!("{base} {n}.{e}"),
            (n, None) => format!("{base} {n}"),
        };
        let candidate = parent.join(&name);
        if !candidate.exists() {
            let rel = if dir.is_empty() {
                name
            } else {
                format!("{dir}/{name}")
            };
            return Ok((candidate, rel));
        }
    }
    Err("사용 가능한 이름을 찾지 못했습니다".into())
}

/// 대소문자 무시 부분 문자열 검색. 문자 단위 인덱스를 돌려준다.
fn find_ci(hay: &[char], needle_lower: &[char]) -> Option<usize> {
    if needle_lower.is_empty() || hay.len() < needle_lower.len() {
        return None;
    }
    let hay_lower: Vec<char> = hay
        .iter()
        .map(|c| c.to_lowercase().next().unwrap_or(*c))
        .collect();
    hay_lower
        .windows(needle_lower.len())
        .position(|w| w == needle_lower)
}

fn search_dir(
    dir: &Path,
    rel_prefix: &str,
    q: &[char],
    hits: &mut Vec<SearchHit>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        if hits.len() >= SEARCH_LIMIT {
            return Ok(());
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{rel_prefix}/{name}")
        };
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            search_dir(&entry.path(), &rel, q, hits)?;
        } else if name.to_lowercase().ends_with(".md") {
            let name_chars: Vec<char> = name.chars().collect();
            let content = fs::read_to_string(entry.path()).unwrap_or_default();
            let content_chars: Vec<char> = content.chars().collect();
            if find_ci(&name_chars, q).is_some() {
                let snippet: String = content_chars.iter().take(60).collect();
                hits.push(SearchHit {
                    path: rel,
                    name,
                    snippet: snippet.replace('\n', " "),
                });
            } else if let Some(i) = find_ci(&content_chars, q) {
                let start = i.saturating_sub(30);
                let end = (i + q.len() + 30).min(content_chars.len());
                let snippet: String = content_chars[start..end].iter().collect();
                hits.push(SearchHit {
                    path: rel,
                    name,
                    snippet: snippet.replace('\n', " "),
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_tree(root: State<NotesRoot>) -> Result<Vec<TreeNode>, String> {
    build_tree(&root.0, "")
}

#[tauri::command]
pub fn read_note(root: State<NotesRoot>, path: String) -> Result<String, String> {
    let p = resolve(&root.0, &path)?;
    fs::read_to_string(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_note(root: State<NotesRoot>, path: String, content: String) -> Result<(), String> {
    let p = resolve(&root.0, &path)?;
    // 이름 변경·삭제 직후 뒤늦게 도착한 자동 저장이 옛 경로에 파일을 되살리지 않도록
    if !p.is_file() {
        return Err(format!("메모가 존재하지 않습니다: {path}"));
    }
    fs::write(p, content).map_err(|e| e.to_string())
}

/// 새 메모 이름 검증: 공백 제거, 금지 문자 확인, .md 확장자 보장.
fn validate_note_name(name: &str) -> Result<String, String> {
    let mut name = name.trim().to_string();
    if name.is_empty() {
        return Err("이름이 비어 있습니다".into());
    }
    if name.starts_with('.')
        || name
            .chars()
            .any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err("사용할 수 없는 이름입니다".into());
    }
    if !name.to_lowercase().ends_with(".md") {
        name.push_str(".md");
    }
    Ok(name)
}

/// 빠른 메모 내용을 지정한 폴더에 새 메모로 저장하고, 빠른 메모를 비운다.
/// 내용은 디스크의 QuickMemo.md 대신 프런트가 들고 있는 최신본을 받는다
/// (자동 저장 디바운스로 디스크가 뒤처져 있을 수 있음).
#[tauri::command]
pub fn save_quick_memo(
    root: State<NotesRoot>,
    dir: String,
    name: String,
    content: String,
) -> Result<String, String> {
    let parent = resolve(&root.0, &dir)?;
    if !parent.is_dir() {
        return Err(format!("대상 폴더를 찾을 수 없습니다: {dir}"));
    }
    let name = validate_note_name(&name)?;
    let rel = if dir.is_empty() {
        name
    } else {
        format!("{dir}/{name}")
    };
    let dest = resolve(&root.0, &rel)?;
    if dest.exists() {
        return Err("이미 같은 이름이 있습니다".into());
    }
    fs::write(&dest, &content).map_err(|e| e.to_string())?;
    fs::write(root.0.join(QUICK_MEMO), "").map_err(|e| e.to_string())?;
    Ok(rel)
}

#[tauri::command]
pub fn create_note(root: State<NotesRoot>, dir: String) -> Result<String, String> {
    let parent = resolve(&root.0, &dir)?;
    let (path, rel) = unique_name(&parent, &dir, "새 메모", Some("md"))?;
    fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok(rel)
}

#[tauri::command]
pub fn create_folder(root: State<NotesRoot>, dir: String) -> Result<String, String> {
    let parent = resolve(&root.0, &dir)?;
    let (path, rel) = unique_name(&parent, &dir, "새 폴더", None)?;
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(rel)
}

#[tauri::command]
pub fn rename_entry(root: State<NotesRoot>, path: String, new_name: String) -> Result<String, String> {
    ensure_not_quick_memo(&path)?;
    let src = resolve(&root.0, &path)?;
    if !src.exists() {
        return Err(format!("대상을 찾을 수 없습니다: {path}"));
    }
    let mut name = new_name.trim().to_string();
    if name.is_empty() {
        return Err("이름이 비어 있습니다".into());
    }
    if name.starts_with('.')
        || name
            .chars()
            .any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err("사용할 수 없는 이름입니다".into());
    }
    if src.is_file() && !name.to_lowercase().ends_with(".md") {
        name.push_str(".md");
    }
    let parent_rel = match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    };
    let rel = if parent_rel.is_empty() {
        name
    } else {
        format!("{parent_rel}/{name}")
    };
    if rel == path {
        return Ok(path);
    }
    let dest = resolve(&root.0, &rel)?;
    // 대소문자만 바꾸는 경우는 Windows에서 dest가 이미 "존재"하므로 예외 허용
    if dest.exists() && rel.to_lowercase() != path.to_lowercase() {
        return Err("이미 같은 이름이 있습니다".into());
    }
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    // 수동 순서 목록에 있던 항목이면 새 이름으로 교체해 위치를 유지한다
    if let Ok(parent_abs) = resolve(&root.0, parent_rel) {
        let old_name = path.rsplit('/').next().unwrap_or(&path);
        let new_name = rel.rsplit('/').next().unwrap_or(&rel);
        let mut order = read_order(&parent_abs);
        if let Some(i) = order.iter().position(|n| n == old_name) {
            order[i] = new_name.to_string();
            let _ = write_order(&parent_abs, &order);
        }
    }
    Ok(rel)
}

#[tauri::command]
pub fn move_entry(root: State<NotesRoot>, path: String, dir: String) -> Result<String, String> {
    ensure_not_quick_memo(&path)?;
    let src = resolve(&root.0, &path)?;
    if !src.exists() {
        return Err(format!("대상을 찾을 수 없습니다: {path}"));
    }
    // 폴더를 자기 자신·하위로 옮기는 것 금지
    if dir == path || dir.starts_with(&format!("{path}/")) {
        return Err("폴더를 자기 안으로 옮길 수 없습니다".into());
    }
    let parent = resolve(&root.0, &dir)?;
    if !parent.is_dir() {
        return Err(format!("대상 폴더를 찾을 수 없습니다: {dir}"));
    }
    let src_parent = match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    };
    if src_parent == dir {
        return Ok(path);
    }
    let (dest, rel) = if src.is_dir() {
        let name = src
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        unique_name(&parent, &dir, &name, None)?
    } else {
        let stem = src
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let ext = src
            .extension()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "md".into());
        unique_name(&parent, &dir, &stem, Some(&ext))?
    };
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    // 원래 폴더의 수동 순서 목록에서 제거 (옮겨간 폴더에서는 기본 정렬 위치에 놓인다)
    if let Ok(old_parent_abs) = resolve(&root.0, src_parent) {
        let old_name = path.rsplit('/').next().unwrap_or(&path);
        let order = read_order(&old_parent_abs);
        if order.iter().any(|n| n == old_name) {
            let filtered: Vec<String> = order.into_iter().filter(|n| n != old_name).collect();
            let _ = write_order(&old_parent_abs, &filtered);
        }
    }
    Ok(rel)
}

/// 항목을 지정 폴더의 지정 위치로 옮긴다 (드래그 순서 변경).
/// index는 대상 폴더 표시 순서에서 "옮기는 항목을 뺀" 목록 기준 삽입 위치.
#[tauri::command]
pub fn reorder_entry(
    root: State<NotesRoot>,
    path: String,
    dir: String,
    index: usize,
) -> Result<String, String> {
    ensure_not_quick_memo(&path)?;
    if path.is_empty() {
        return Err("잘못된 경로입니다".into());
    }
    let src = resolve(&root.0, &path)?;
    if !src.exists() {
        return Err(format!("대상을 찾을 수 없습니다: {path}"));
    }
    if dir == path || dir.starts_with(&format!("{path}/")) {
        return Err("폴더를 자기 안으로 옮길 수 없습니다".into());
    }
    let parent = resolve(&root.0, &dir)?;
    if !parent.is_dir() {
        return Err(format!("대상 폴더를 찾을 수 없습니다: {dir}"));
    }
    let src_parent = match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    };

    // 다른 폴더로 가는 경우 실제 파일 이동 (이름 충돌 시 " 2" 접미사)
    let rel = if src_parent == dir {
        path.clone()
    } else {
        let (dest, rel) = if src.is_dir() {
            let name = src
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            unique_name(&parent, &dir, &name, None)?
        } else {
            let stem = src
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let ext = src
                .extension()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "md".into());
            unique_name(&parent, &dir, &stem, Some(&ext))?
        };
        fs::rename(&src, &dest).map_err(|e| e.to_string())?;
        // 원래 폴더의 순서 목록에서 제거
        if let Ok(old_parent) = resolve(&root.0, src_parent) {
            let old_name = path.rsplit('/').next().unwrap_or(&path);
            let order = read_order(&old_parent);
            if order.iter().any(|n| n == old_name) {
                let filtered: Vec<String> =
                    order.into_iter().filter(|n| n != old_name).collect();
                let _ = write_order(&old_parent, &filtered);
            }
        }
        rel
    };

    // 현재 표시 순서에서 자신을 뺀 뒤 원하는 위치에 삽입해 순서를 고정한다
    let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
    let mut names = display_names(&parent, dir.is_empty())?;
    names.retain(|n| *n != name);
    let i = index.min(names.len());
    names.insert(i, name);
    write_order(&parent, &names)?;
    Ok(rel)
}

#[tauri::command]
pub fn delete_entry(root: State<NotesRoot>, path: String) -> Result<(), String> {
    ensure_not_quick_memo(&path)?;
    // 빈 경로는 노트 루트 자체를 가리키므로 거부
    if path.is_empty() {
        return Err("잘못된 경로입니다".into());
    }
    let p = resolve(&root.0, &path)?;
    if !p.exists() {
        return Err(format!("대상을 찾을 수 없습니다: {path}"));
    }
    // 영구 삭제 대신 Windows 휴지통으로 이동 (폴더는 내용물 포함, 복원 가능)
    trash::delete(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_entry(root: State<NotesRoot>, path: String) -> Result<(), String> {
    let target = resolve(&root.0, &path)?;
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    let mut candidates: Vec<_> = items
        .into_iter()
        .filter(|i| i.original_path() == target)
        .collect();
    if candidates.is_empty() {
        return Err("휴지통에서 항목을 찾지 못했습니다".into());
    }
    candidates.sort_by_key(|i| i.time_deleted);
    let latest = candidates.pop().unwrap();
    trash::os_limited::restore_all([latest]).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_todos(root: State<NotesRoot>) -> Result<Vec<Todo>, String> {
    let p = root.0.join(TODO_FILE);
    if !p.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(p).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_todos(root: State<NotesRoot>, todos: Vec<Todo>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&todos).map_err(|e| e.to_string())?;
    fs::write(root.0.join(TODO_FILE), text).map_err(|e| e.to_string())
}

/// 즐겨찾기한 메모의 상대경로 목록. 배열 순서가 곧 표시 순서다.
#[tauri::command]
pub fn read_favorites(root: State<NotesRoot>) -> Result<Vec<String>, String> {
    let p = root.0.join(FAVORITES_FILE);
    if !p.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(p).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_favorites(root: State<NotesRoot>, favorites: Vec<String>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&favorites).map_err(|e| e.to_string())?;
    fs::write(root.0.join(FAVORITES_FILE), text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_notes(root: State<NotesRoot>, query: String) -> Result<Vec<SearchHit>, String> {
    let q: Vec<char> = query
        .trim()
        .chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let mut hits = Vec::new();
    search_dir(&root.0, "", &q, &mut hits)?;
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_rejects_escape() {
        let root = Path::new("C:\\notes-root");
        assert!(resolve(root, "..").is_err());
        assert!(resolve(root, "a/../b.md").is_err());
        assert!(resolve(root, "C:\\windows\\evil.md").is_err());
        assert!(resolve(root, "폴더/메모.md").is_ok());
        assert!(resolve(root, "").is_ok()); // 루트 자신 (list/create 용)
    }

    #[test]
    fn natural_sort_order() {
        assert_eq!(natural_cmp("새 메모 2", "새 메모 10"), Ordering::Less);
        assert_eq!(natural_cmp("새 메모 10", "새 메모 2"), Ordering::Greater);
        assert_eq!(natural_cmp("a2b", "a10b"), Ordering::Less);
        assert_eq!(natural_cmp("메모", "메모"), Ordering::Equal);
        assert_eq!(natural_cmp("B", "a"), Ordering::Greater); // 대소문자 무시
    }

    #[test]
    fn unique_name_appends_suffix() {
        let dir = std::env::temp_dir().join("desktopmemo-test-unique");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let (p1, r1) = unique_name(&dir, "", "새 메모", Some("md")).unwrap();
        assert_eq!(r1, "새 메모.md");
        fs::write(&p1, "").unwrap();

        let (p2, r2) = unique_name(&dir, "", "새 메모", Some("md")).unwrap();
        assert_eq!(r2, "새 메모 2.md");
        fs::write(&p2, "").unwrap();

        let (_, r3) = unique_name(&dir, "sub", "새 메모", Some("md")).unwrap();
        assert_eq!(r3, "sub/새 메모 3.md");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn order_file_controls_display_order() {
        let dir = std::env::temp_dir().join("desktopmemo-test-order");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("폴더C")).unwrap();
        fs::write(dir.join("a.md"), "").unwrap();
        fs::write(dir.join("b.md"), "").unwrap();
        fs::write(dir.join(QUICK_MEMO), "").unwrap();

        // 순서 파일 없음: 폴더 먼저, 이름순. 루트에서는 빠른 메모 제외
        assert_eq!(
            display_names(&dir, true).unwrap(),
            vec!["폴더C", "a.md", "b.md"]
        );

        // 순서 파일의 순서 우선, 없는 항목은 기본 정렬로 뒤에
        write_order(&dir, &["b.md".to_string(), "폴더C".to_string()]).unwrap();
        assert_eq!(
            display_names(&dir, true).unwrap(),
            vec!["b.md", "폴더C", "a.md"]
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_note_name_rules() {
        assert_eq!(validate_note_name(" 회의록 ").unwrap(), "회의록.md");
        assert_eq!(validate_note_name("memo.MD").unwrap(), "memo.MD");
        assert!(validate_note_name("").is_err());
        assert!(validate_note_name("   ").is_err());
        assert!(validate_note_name("a/b").is_err());
        assert!(validate_note_name(".hidden").is_err());
    }

    #[test]
    fn quick_memo_is_protected() {
        assert!(ensure_not_quick_memo(QUICK_MEMO).is_err());
        assert!(ensure_not_quick_memo("일반 메모.md").is_ok());
    }

    #[test]
    fn find_ci_matches_korean_and_case() {
        let hay: Vec<char> = "안녕 Hello World".chars().collect();
        let q1: Vec<char> = "hello".chars().collect();
        let q2: Vec<char> = "안녕".chars().collect();
        assert!(find_ci(&hay, &q1).is_some());
        assert_eq!(find_ci(&hay, &q2), Some(0));
    }
}
