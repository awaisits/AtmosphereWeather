// Keeps frameless-widget pointer deltas out of the main-process IPC wiring.
function createWidgetDragController() {
  let drag = null;

  return {
    start(window, pointerX, pointerY) {
      if (!window || window.isDestroyed() || !Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return;
      const [windowX, windowY] = window.getPosition();
      drag = { windowX, windowY, pointerX, pointerY };
    },
    move(window, pointerX, pointerY) {
      if (!drag || !window || window.isDestroyed() || !Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return;
      window.setPosition(
        Math.round(drag.windowX + pointerX - drag.pointerX),
        Math.round(drag.windowY + pointerY - drag.pointerY),
      );
    },
    end() {
      drag = null;
    },
  };
}

module.exports = { createWidgetDragController };
