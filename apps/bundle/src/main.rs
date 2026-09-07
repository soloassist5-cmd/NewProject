//! «ГимРум» одним файлом.
//!
//! Само приложение — это окно на движке WebView2 (см. `apps/native`), и рядом
//! с ним обязана лежать `WebView2Loader.dll`: без неё Windows не запустит
//! программу вовсе. Носить два файла и объяснять, что их нельзя разделять, —
//! верный способ получить «у меня не работает» через неделю.
//!
//! Поэтому здесь оба файла вшиты внутрь. При запуске они разворачиваются в
//! папку пользователя и приложение стартует оттуда. Со стороны это один exe,
//! который просто открывается.
//!
//! Разворачивание идёт в `%LOCALAPPDATA%`, а не рядом с самим файлом: программу
//! кладут и в Program Files, и на флешку, и в общую папку класса, где прав на
//! запись может не быть. В профиле пользователя они есть всегда, и у каждого
//! свои — на общем компьютере ученики не мешают друг другу.

#![windows_subsystem = "windows"]

use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

const APP_EXE: &[u8] = include_bytes!("../../native/dist/gimroom.exe");
const WEBVIEW_LOADER: &[u8] = include_bytes!("../../native/dist/WebView2Loader.dll");

/// Меняется при каждой новой версии — по нему видно, что файлы пора обновить.
const VERSION: &str = env!("CARGO_PKG_VERSION");

const SITE: &str = "https://gimroom-wi-ls1ze.vercel.app";

fn app_directory() -> Option<PathBuf> {
    let base = env::var_os("LOCALAPPDATA")?;
    let path = PathBuf::from(base).join("GimRoom").join("app");
    fs::create_dir_all(&path).ok()?;
    Some(path)
}

/// Пишет файл, если его ещё нет или он отличается от вшитого.
fn ensure_file(path: &Path, bytes: &[u8]) -> bool {
    // Сравниваем содержимое, а не только длину: размер после пересборки часто
    // остаётся прежним до байта, и по нему новая версия сошла бы за старую.
    if let Ok(existing) = fs::read(path) {
        if existing == bytes {
            return true; // Тот же файл — перезаписывать нечего.
        }
    }

    // Запущенный exe перезаписать нельзя, поэтому старый сначала отодвигаем.
    if path.exists() {
        let _ = fs::rename(path, path.with_extension("old"));
    }

    match fs::File::create(path).and_then(|mut file| file.write_all(bytes)) {
        Ok(()) => true,
        Err(_) => false,
    }
}

/// Запасной путь: открыть сайт браузером, если развернуть приложение не вышло.
fn open_in_browser() {
    let _ = Command::new("cmd").args(["/C", "start", "", SITE]).spawn();
}

fn main() {
    let Some(directory) = app_directory() else {
        open_in_browser();
        return;
    };

    // Отметка версии: пока она совпадает, файлы считаются актуальными.
    let stamp = directory.join("version.txt");
    let same_version = fs::read_to_string(&stamp).map(|text| text.trim() == VERSION).unwrap_or(false);

    let exe = directory.join("ГимРум.exe");
    let loader = directory.join("WebView2Loader.dll");

    if !same_version || !exe.exists() || !loader.exists() {
        let written = ensure_file(&exe, APP_EXE) && ensure_file(&loader, WEBVIEW_LOADER);
        if !written {
            open_in_browser();
            return;
        }
        let _ = fs::write(&stamp, VERSION);
        // Прошлая версия больше не нужна.
        let _ = fs::remove_file(exe.with_extension("old"));
    }

    // Рабочая папка — та же: так Windows наверняка найдёт загрузчик рядом.
    if Command::new(&exe).current_dir(&directory).spawn().is_err() {
        open_in_browser();
    }
}
