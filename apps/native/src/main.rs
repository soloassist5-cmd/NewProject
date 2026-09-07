//! «ГимРум» для Windows — собственное окно приложения.
//!
//! Страницу рисует WebView2 — тот самый движок, который уже стоит в Windows 10
//! и 11 вместе с Edge. Поэтому программа весит единицы мегабайт, а не сто с
//! лишним, как сборка со своим встроенным браузером, и при этом это настоящее
//! окно: свой значок в панели задач, своя иконка, никакой адресной строки.
//!
//! Прямого доступа к базе у приложения нет: оно открывает тот же адрес, что и
//! браузер, и ходит в тот же API. Поэтому переписка, аккаунты и группы общие.

#![windows_subsystem = "windows"]

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder};
use tao::window::{UserAttentionType, WindowBuilder};
use wry::{WebContext, WebViewBuilder};

const SITE: &str = "https://gimroom-wi-ls1ze.vercel.app";

/// Что страница может попросить у окна.
#[derive(Debug)]
enum AppEvent {
    /// Пришло сообщение, а окно не на виду.
    Notify,
}

/// Размер окна: привычный на большом мониторе, по месту — на маленьком.
///
/// Считаем от рабочей области, а не от всего экрана: иначе на ноутбуке с
/// экраном 1366×768 низ окна уезжает под панель задач вместе с профилем.
fn window_size(monitor: Option<tao::monitor::MonitorHandle>) -> LogicalSize<f64> {
    let (max_width, max_height) = match monitor {
        Some(handle) => {
            let size = handle.size().to_logical::<f64>(handle.scale_factor());
            // Небольшой запас: панель задач, рамки окна.
            ((size.width - 80.0).max(360.0), (size.height - 120.0).max(400.0))
        }
        None => (1180.0, 820.0),
    };

    LogicalSize::new(1180.0_f64.min(max_width), 820.0_f64.min(max_height))
}

/// Где WebView2 хранит куки и локальные данные.
///
/// По умолчанию он создаёт папку рядом с exe. Программу кладут куда угодно —
/// в Program Files, на флешку, в общую папку класса, — и там может не быть
/// прав на запись: тогда вход не сохранится и его будут спрашивать каждый
/// запуск. Поэтому данные храним в профиле пользователя Windows, где права
/// есть всегда, и у каждого они свои.
fn data_directory() -> Option<PathBuf> {
    let base = env::var_os("LOCALAPPDATA")?;
    let path = PathBuf::from(base).join("GimRoom");
    fs::create_dir_all(&path).ok()?;
    Some(path)
}

/// Запасной путь: открыть сайт тем, что есть в системе.
///
/// Нужен, если в Windows почему-то нет WebView2 — например, на старой сборке
/// Windows 10, с которой удалили Edge. Пусть лучше мессенджер откроется во
/// вкладке браузера, чем программа молча не запустится.
fn open_in_browser() {
    let _ = Command::new("cmd").args(["/C", "start", "", SITE]).spawn();
}

fn main() {
    let event_loop: EventLoop<AppEvent> = EventLoopBuilder::with_user_event().build();

    let window = match WindowBuilder::new()
        .with_title("ГимРум")
        .with_inner_size(window_size(event_loop.primary_monitor()))
        .with_min_inner_size(LogicalSize::new(360.0, 480.0))
        .build(&event_loop)
    {
        Ok(window) => window,
        Err(_) => {
            open_in_browser();
            return;
        }
    };

    // Мигать значком в панели задач можно только из потока событий, поэтому
    // страница шлёт сюда сообщение, а разбирает его цикл ниже.
    let proxy = event_loop.create_proxy();

    // Куки и локальное хранилище остаются между запусками: вход не должен
    // спрашиваться заново каждое утро.
    let mut context = WebContext::new(data_directory());
    let builder = WebViewBuilder::with_web_context(&mut context)
        .with_url(SITE)
        .with_incognito(false)
        // Метка для страницы: по ней мессенджер понимает, что он в нашем окне,
        // и отдаёт уведомления сюда, а не пытается показать их сам — WebView2
        // веб-уведомления не показывает.
        .with_initialization_script("window.__gimroomNative = true;")
        .with_ipc_handler(move |request| {
            if request.body().contains("\"type\":\"notify\"") {
                let _ = proxy.send_event(AppEvent::Notify);
            }
        });

    let webview = match builder.build(&window) {
        Ok(webview) => webview,
        Err(_) => {
            // Движка страниц нет — уходим в браузер и закрываемся.
            open_in_browser();
            return;
        }
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                // webview должен пережить окно, иначе Windows ругается при закрытии.
                let _ = &webview;
                *control_flow = ControlFlow::Exit;
            }
            // Пришло новое сообщение, а окно не на виду: мигаем значком в
            // панели задач. Windows сама подсветит его до тех пор, пока в окно
            // не заглянут, — привычное поведение для мессенджера.
            Event::UserEvent(AppEvent::Notify) => {
                if !window.is_focused() {
                    window.request_user_attention(Some(UserAttentionType::Informational));
                }
            }
            _ => {}
        }
    });
}
