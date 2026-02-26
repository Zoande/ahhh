/**
 * TransitionController
 * Handles fade-to-black transitions between scenes.
 * Uses a DOM overlay for GPU-efficient fading.
 */
export class TransitionController {
  private overlay: HTMLElement;

  constructor() {
    this.overlay = document.getElementById("fadeOverlay")!;
    // Start fully black for the initial load
    this.overlay.style.opacity = "1";
  }

  /**
   * Fade screen to black over `duration` seconds.
   */
  fadeOut(duration: number): Promise<void> {
    return this.animateOpacity(1, duration);
  }

  /**
   * Fade from black to transparent over `duration` seconds.
   */
  fadeIn(duration: number): Promise<void> {
    return this.animateOpacity(0, duration);
  }

  private animateOpacity(target: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const start = parseFloat(this.overlay.style.opacity || "0");
      const startTime = performance.now();
      const durationMs = duration * 1000;

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        // Smooth ease-in-out
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const current = start + (target - start) * eased;
        this.overlay.style.opacity = String(current);

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          this.overlay.style.opacity = String(target);
          resolve();
        }
      };

      requestAnimationFrame(step);
    });
  }
}
