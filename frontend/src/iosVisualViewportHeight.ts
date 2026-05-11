/**
 * iOS Safari: после закрытия клавиатуры высота layout viewport часто «залипает»,
 * из‑за чего fixed‑док и flex‑хром чата съезжают. Обновляем CSS‑переменную
 * по window.visualViewport.height (см. --app-visual-vh в App.css).
 */
export function installIosVisualViewportHeightVar(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  const update = () => {
    const vv = window.visualViewport;
    const h = vv ? Math.max(0, Math.round(vv.height)) : Math.max(0, Math.round(window.innerHeight));
    root.style.setProperty('--app-visual-vh', `${h}px`);
  };

  update();

  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);

  const bump = () => {
    window.setTimeout(update, 0);
    window.setTimeout(update, 120);
    window.setTimeout(update, 320);
  };

  document.addEventListener('focusout', bump, true);
  window.addEventListener('orientationchange', bump);
}
