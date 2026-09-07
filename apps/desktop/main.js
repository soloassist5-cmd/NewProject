/*
 * Настольное приложение «ГимРум» для Windows.
 *
 * Это окно с сайтом, а не отдельная копия мессенджера: приложение открывает тот
 * же адрес, что и браузер, и ходит в тот же API. Поэтому переписка, аккаунты и
 * группы общие — что отправлено с телефона, сразу видно здесь.
 *
 * Прямого доступа к базе у приложения нет и быть не должно: строка подключения
 * лежала бы внутри exe, а его распакует любой desktop-архиватор. Это был бы
 * пароль ко всей переписке гимназии, розданный вместе с программой.
 */

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');

// Адрес сайта. Можно переопределить переменной GIMROOM_URL — удобно, если
// гимназия переедет на свой домен.
const SITE_URL = process.env.GIMROOM_URL || 'https://gimroom.vercel.app';
const SITE_ORIGIN = new URL(SITE_URL).origin;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 380,
    minHeight: 520,
    title: 'ГимРум',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#eef3f8',
    autoHideMenuBar: true,
    webPreferences: {
      // Страница — обычный сайт, доступ к Node ей не нужен и опасен.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.loadURL(SITE_URL);

  // Ссылки из сообщений открываются в системном браузере, а не подменяют
  // окно мессенджера. Внутренние переходы остаются внутри.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== SITE_ORIGIN) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Без сети окно не должно оставаться пустым.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 — отменённая загрузка, это не ошибка
    console.error('Не удалось открыть', failedUrl, code, description);
    mainWindow?.loadFile(path.join(__dirname, 'offline.html'));
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Меню оставляем минимальным: перезагрузка, масштаб и выход — то, что
// действительно нужно, без «Файл → Создать».
function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'ГимРум',
      submenu: [
        { label: 'Обновить', accelerator: 'F5', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { label: 'Крупнее', role: 'zoomIn' },
        { label: 'Мельче', role: 'zoomOut' },
        { label: 'Обычный размер', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Во весь экран', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Повторить', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// Второй запуск не открывает второе окно, а поднимает существующее.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
