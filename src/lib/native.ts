/**
 * Мост к приложению для Windows.
 *
 * Окно на WebView2 — это не браузер: веб-уведомления оно само не показывает,
 * их должна показать программа-хозяин. Поэтому там, где браузер показал бы
 * уведомление, мы отправляем сообщение наружу, а приложение мигает значком в
 * панели задач.
 *
 * В браузере ничего этого нет, и все функции просто отвечают «не здесь».
 */

interface WebViewBridge {
  postMessage: (message: string) => void;
}

interface NativeWindow extends Window {
  /** Ставится приложением при загрузке страницы. */
  __gimroomNative?: boolean;
  /** Канал WebView2 в программу-хозяина. */
  ipc?: WebViewBridge;
  chrome?: { webview?: WebViewBridge };
}

/** Открыт ли мессенджер внутри нашего приложения для Windows. */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as NativeWindow).__gimroomNative === true;
}

/**
 * Открыт ли мессенджер внутри приложения для Android.
 *
 * Приложение — это обёртка над сайтом (Trusted Web Activity), и страница
 * отличает её от обычного браузера по тому, кто её открыл: у обёртки это
 * ссылка вида `android-app://`.
 */
export function isAndroidApp(): boolean {
  if (typeof document === 'undefined') return false;
  return document.referrer.startsWith('android-app://');
}

/** Телефон или планшет на Android — в приложении или в браузере. */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

/**
 * Телефон или планшет.
 *
 * Нужно там, где вопрос имеет смысл только на компьютере. Телефон — вещь
 * личная: спрашивать у школьника, не чужое ли у него устройство, незачем.
 */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Где человек сейчас находится — чтобы подсказки вели туда, где настройка
 * действительно есть. «Разрешите в настройках браузера» в приложении, где
 * браузера нет, — тупик: сделать по такой подсказке нечего.
 */
export type Surface = 'windows-app' | 'android-app' | 'android-browser' | 'browser';

export function currentSurface(): Surface {
  if (isNativeApp()) return 'windows-app';
  if (isAndroidApp()) return 'android-app';
  if (isAndroid()) return 'android-browser';
  return 'browser';
}

function bridge(): WebViewBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as NativeWindow;
  // wry кладёт канал в window.ipc, сам WebView2 — в window.chrome.webview.
  return w.ipc ?? w.chrome?.webview ?? null;
}

/**
 * Просит приложение показать уведомление.
 *
 * Возвращает true, если сообщение ушло: тогда веб-уведомление показывать уже
 * не нужно, иначе о сообщении сказали бы дважды.
 */
export function notifyNativeHost(title: string, body: string, conversationId: number): boolean {
  if (!isNativeApp()) return false;

  const channel = bridge();
  if (!channel) return false;

  try {
    channel.postMessage(JSON.stringify({ type: 'notify', title, body, conversationId }));
    return true;
  } catch {
    return false;
  }
}
