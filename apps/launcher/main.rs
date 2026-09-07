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

const SITE: &str = "https://gimroom.vercel.app";

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

/// Прямоугольник Windows. Объявлен здесь, чтобы не тянуть ради него крейт.
#[repr(C)]
#[derive(Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

const SPI_GETWORKAREA: u32 = 0x0030;

#[link(name = "user32")]
extern "system" {
    fn SystemParametersInfoW(action: u32, param: u32, data: *mut Rect, ini: u32) -> i32;
}

/// Размер и положение окна: по центру рабочей области, но не больше неё.
///
/// Раньше размер задавался вслепую (1180×820), и на ноутбуке с экраном 1366×768
/// нижняя часть окна уходила под панель задач — вместе с профилем в углу
/// боковой панели. Рабочая область — это экран уже без панели задач, поэтому
/// вписываемся в неё, оставляя небольшой отступ по краям.
fn window_geometry() -> Option<(i32, i32, i32, i32)> {
    let mut area = Rect::default();
    let ok = unsafe { SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut area, 0) };
    if ok == 0 {
        return None;
    }

    let available_width = area.right - area.left;
    let available_height = area.bottom - area.top;
    if available_width < 320 || available_height < 320 {
        return None; // Что-то странное с экраном — пусть браузер решает сам.
    }

    // На большом мониторе окно во весь экран неудобно, поэтому берём привычный
    // размер; на маленьком — всё, что есть, минус поля.
    let width = 1180.min(available_width - 80).max(360);
    let height = 820.min(available_height - 60).max(400);

    let left = area.left + (available_width - width) / 2;
    let top = area.top + (available_height - height) / 2;

    Some((width, height, left, top))
}

fn main() {
    let browser = BROWSERS.iter().map(PathBuf::from).find(|path| path.exists());

    match browser {
        Some(path) => {
            // --app открывает окно без адресной строки, вкладок и меню:
            // внешне это обычное приложение, а не браузер.
            let mut command = Command::new(path);
            command.arg(format!("--app={SITE}"));

            if let Some((width, height, left, top)) = window_geometry() {
                command.arg(format!("--window-size={width},{height}"));
                command.arg(format!("--window-position={left},{top}"));
            }

            let _ = command.spawn();
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
