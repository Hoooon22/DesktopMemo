use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::State;

pub const QUICK_MEMO: &str = "QuickMemo.md";

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

    dirs.sort_by_key(|n| n.name.to_lowercase());
    files.sort_by_key(|n| n.name.to_lowercase());
    dirs.append(&mut files);
    Ok(dirs)
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
    Ok(rel)
}

#[tauri::command]
pub fn move_note(root: State<NotesRoot>, path: String, dir: String) -> Result<String, String> {
    let src = resolve(&root.0, &path)?;
    if !src.is_file() {
        return Err(format!("메모를 찾을 수 없습니다: {path}"));
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
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = src
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "md".into());
    let (dest, rel) = unique_name(&parent, &dir, &stem, Some(&ext))?;
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    Ok(rel)
}

#[tauri::command]
pub fn delete_entry(root: State<NotesRoot>, path: String) -> Result<(), String> {
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
