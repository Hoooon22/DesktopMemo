mod notes;

use notes::NotesRoot;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_window_state::StateFlags;

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// GitHub 릴리즈의 latest.json을 확인해 새 버전이 있으면 내려받아 설치 후 재시작
fn check_for_updates(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use tauri_plugin_updater::UpdaterExt;

    std::thread::spawn(move || {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                app.dialog()
                    .message(format!("업데이터를 초기화하지 못했습니다:\n{e}"))
                    .title("DesktopMemo 업데이트")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
                return;
            }
        };
        match tauri::async_runtime::block_on(updater.check()) {
            Ok(Some(update)) => {
                let yes = app
                    .dialog()
                    .message(format!(
                        "새 버전 {}이(가) 있습니다. (현재 {})\n지금 업데이트할까요?",
                        update.version, update.current_version
                    ))
                    .title("DesktopMemo 업데이트")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "업데이트".into(),
                        "나중에".into(),
                    ))
                    .blocking_show();
                if !yes {
                    return;
                }
                match tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {}))
                {
                    // Windows에서는 설치가 시작되면 앱이 자동 종료되므로 보통 여기 도달하지 않음
                    Ok(()) => app.restart(),
                    Err(e) => {
                        app.dialog()
                            .message(format!("업데이트 설치에 실패했습니다:\n{e}"))
                            .title("DesktopMemo 업데이트")
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                    }
                }
            }
            Ok(None) => {
                app.dialog()
                    .message("이미 최신 버전입니다.")
                    .title("DesktopMemo 업데이트")
                    .kind(MessageDialogKind::Info)
                    .blocking_show();
            }
            Err(e) => {
                app.dialog()
                    .message(format!("업데이트 확인에 실패했습니다:\n{e}"))
                    .title("DesktopMemo 업데이트")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            // 창 크기·위치 기억 (표시 여부는 복원하지 않음 — 시작 시 항상 보이게)
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+alt+m"])
                .expect("invalid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        show_main(app);
                        let _ = app.emit("open-quick-memo", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let root = app.path().document_dir()?.join("DesktopMemo");
            std::fs::create_dir_all(&root)?;
            let quick = root.join(notes::QUICK_MEMO);
            if !quick.exists() {
                std::fs::write(&quick, "")?;
            }

            // 외부 변경 감지 → 프런트에 알림 (연속 이벤트는 300ms 잠잠해질 때까지 병합)
            let handle = app.handle().clone();
            let watch_root = root.clone();
            std::thread::spawn(move || {
                use notify::{recommended_watcher, RecursiveMode, Watcher};
                let (tx, rx) = std::sync::mpsc::channel();
                let mut watcher = match recommended_watcher(tx) {
                    Ok(w) => w,
                    Err(_) => return,
                };
                if watcher.watch(&watch_root, RecursiveMode::Recursive).is_err() {
                    return;
                }
                while rx.recv().is_ok() {
                    while rx
                        .recv_timeout(std::time::Duration::from_millis(300))
                        .is_ok()
                    {}
                    let _ = handle.emit("notes-changed", ());
                }
            });

            // 트레이: 좌클릭 = 열기, 메뉴 = 열기/업데이트 확인/종료
            let open_item = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let update_item =
                MenuItem::with_id(app, "update", "업데이트 확인", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &update_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("window icon").clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("DesktopMemo (Ctrl+Alt+M)")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "update" => check_for_updates(app.clone()),
                    "quit" => {
                        // 마지막 자동 저장(≤500ms 디바운스)이 기록될 시간을 주고 종료
                        let _ = app.emit("app-quitting", ());
                        let handle = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(700));
                            handle.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            app.manage(NotesRoot(root));
            Ok(())
        })
        .on_window_event(|window, event| {
            // 닫기 = 트레이로 숨김 (Ctrl+Alt+M 또는 트레이 클릭으로 즉시 복귀)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            notes::list_tree,
            notes::read_note,
            notes::write_note,
            notes::create_note,
            notes::create_folder,
            notes::rename_entry,
            notes::move_entry,
            notes::reorder_entry,
            notes::delete_entry,
            notes::restore_entry,
            notes::search_notes,
            notes::save_quick_memo,
            notes::read_todos,
            notes::write_todos
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
