mod notes;

use notes::NotesRoot;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().document_dir()?.join("DesktopMemo");
            std::fs::create_dir_all(&root)?;
            let quick = root.join(notes::QUICK_MEMO);
            if !quick.exists() {
                std::fs::write(&quick, "")?;
            }
            app.manage(NotesRoot(root));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            notes::list_tree,
            notes::read_note,
            notes::write_note,
            notes::create_note,
            notes::create_folder,
            notes::rename_entry,
            notes::move_note,
            notes::delete_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
