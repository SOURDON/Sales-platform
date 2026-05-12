/**
 * iOS Safari: после закрытия клавиатуры высота layout viewport часто «залипает»,
 * из‑за чего fixed‑док и flex‑хром чата съезжают. Обновляем CSS‑переменную
 * по window.visualViewport.height (см. --app-visual-vh в App.css).
 */
function readVisualViewportHeightPx(): number {
  const vv = window.visualViewport;
  const lh = window.innerHeight;
  if (!vv) {
    return Math.max(0, Math.round(lh));
  }
  const vh = vv.height;
  // После закрытия клавиатуры иногда vv.height отстаёт от innerHeight — берём максимум
  const merged = Math.max(vh, lh * 0.96);
  return Math.max(0, Math.round(merged));
}

export function scheduleIosVisualViewportBumps(): void {
  const delays = [0, 60, 140, 280, 520, 900, 1400];
  for (const ms of delays) {
    window.setTimeout(() => {
      const root = document.documentElement;
      root.style.setProperty('--app-visual-vh', `${readVisualViewportHeightPx()}px`);
    }, ms);
  }
}

export function installIosVisualViewportHeightVar(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  const update = () => {
    root.style.setProperty('--app-visual-vh', `${readVisualViewportHeightPx()}px`);
  };

  update();

  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);

  const bump = () => {
    scheduleIosVisualViewportBumps();
  };

  document.addEventListener('focusout', bump, true);
  window.addEventListener('orientationchange', bump);
}
