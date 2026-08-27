// Swipe-to-close for the two slide-in drawers.
//
// On a phone the drawers cover the whole screen, so the instinctive way to
// dismiss one is to shove it back off the edge it came from. Without a handler
// that gesture falls through to the browser, which reads a horizontal drag as
// back/forward navigation — you leave the site instead of closing the drawer.
//
// Lives in its own module for the same reason icons.js does: both panel modules
// need it and neither may import the other.

const DISTANCE = 60;  // px of travel before it counts as a swipe, not a tap
const SLOPE = 1.5;    // dx must beat dy by this much, or it's a scroll

/**
 * Close `el` when the user swipes it toward the edge it slid in from.
 * @param {HTMLElement} el       the panel
 * @param {'left'|'right'} away  direction that dismisses it
 * @param {() => void} close     the panel's own close function
 * @param {() => boolean} isOpen so a swipe on a hidden panel is ignored
 */
export function swipeToClose(el, away, close, isOpen) {
  let x0 = 0, y0 = 0, tracking = false;

  el.addEventListener('touchstart', (e) => {
    // Multi-touch is a pinch/zoom, not a dismiss.
    tracking = e.touches.length === 1 && isOpen();
    if (!tracking) return;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (Math.abs(dx) < DISTANCE) return;              // too short — a tap
    if (Math.abs(dx) < Math.abs(dy) * SLOPE) return;  // mostly vertical — a scroll
    if (away === 'right' ? dx > 0 : dx < 0) close();
  }, { passive: true });

  // A cancelled touch (system gesture took over) must not leave us armed.
  el.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
}
