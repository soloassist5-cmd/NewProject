//! Лёгкий запуск «ГимРума» на Windows.
//!
//! Зачем он есть. Electron даёт настоящее окно, но тащит внутри себя целый
//! браузер — сто с лишним мегабайт, которые неудобно ни передать, ни хранить
//! на школьном компьютере. А в Windows 10 и 11 нужный движок уже установлен:
//! это Edge. Поэтому здесь всего пара сотен килобайт, которые открывают тот
//! же сайт в отдельном окне без адресной строки и вкладок.
//!
//! Профиль браузера берётся обычный, не отдельный: если человек уже вошёл в
//! мессенджер в браузере, приложение откроется сразу под его аккаунтом.

#![windows_subsystem = "windows"]

use std::path::PathBuf;
use std::process::Command;

const SITE: &str = "https://gimroom-wi-ls1ze.vercel.app";

/// Браузеры на движке Chromium в порядке предпочтения. Edge стоит первым:
/// он есть в Windows из коробки, доустанавливать ничего не нужно.
const BROWSERS: [&str; 6] = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Chromium\Application\chrome.exe",
    r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
];

fn main() {
    let browser = BROWSERS.iter().map(PathBuf::from).find(|path| path.exists());

    match browser {
        Some(path) => {
            // --app открывает окно без адресной строки, вкладок и меню:
            // внешне это обычное приложение, а не браузер.
            let _ = Command::new(path)
                .arg(format!("--app={SITE}"))
                .arg("--window-size=1180,820")
                .spawn();
        }
        None => {
            // Ни одного подходящего браузера — открываем сайт тем, что есть
            // в системе. Пусть лучше откроется во вкладке, чем ничего.
            let _ = Command::new("cmd")
                .args(["/C", "start", "", SITE])
                .spawn();
        }
    }
}
