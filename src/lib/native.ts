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
