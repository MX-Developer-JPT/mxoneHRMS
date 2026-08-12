import { Capacitor } from '@capacitor/core';

// Syncs the native status bar's icon color + background to the app's own
// light/dark theme toggle. Previously nothing did this at all, so the
// native status bar just sat at whatever the OS default was regardless of
// which theme the user picked in-app — most visible as dark status-bar
// icons on a dark background (unreadable) or vice versa.
export async function syncStatusBarTheme(resolvedTheme) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const isDark = resolvedTheme === 'dark';
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: isDark ? '#0b0b0d' : '#ffffff' }).catch(() => {});
    // The app already reserves space for the status bar itself via
    // safe-area-inset CSS — overlay:false keeps the two from double-counting.
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  } catch { /* plugin unavailable (web build) — no-op */ }
}

let keyboardListenersAttached = false;

// Scrolls the currently-focused input into view when the on-screen keyboard
// opens. There are dozens of forms across the app; without this, a field
// focused near the bottom of a long form can end up hidden behind the
// keyboard with nothing to compensate, since native keyboard-resize
// behavior isn't configured either.
export async function initKeyboardAvoidance() {
  if (!Capacitor.isNativePlatform() || keyboardListenersAttached) return;
  keyboardListenersAttached = true;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    Keyboard.addListener('keyboardWillShow', () => {
      const active = document.activeElement;
      const isTextInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (isTextInput && typeof active.scrollIntoView === 'function') {
        // Let the keyboard animation start before scrolling, or the target
        // position is measured against the pre-keyboard layout.
        setTimeout(() => active.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
      }
    });
  } catch { /* plugin unavailable (web build) — no-op */ }
}
