import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The behaviour every stepped explainer on this site shares.
 *
 * Extracted because it is the fiddly half and there is now more than one of
 * them. What each explainer draws is different; how it advances, when it stops
 * and what it does for a reader who cannot see motion is not.
 *
 * The rules, in one place:
 *
 *   · it starts fully revealed, so the server-rendered markup is the complete
 *     first step rather than a box of invisible elements, and a reader without
 *     JavaScript keeps the content
 *   · autoplay waits until the thing is on screen, so it does not run its
 *     course while the reader is still three sections above it
 *   · any deliberate action stops autoplay for good, and so does a pointer or
 *     the keyboard arriving anywhere inside it
 *   · `prefers-reduced-motion` turns off both the advancing and the revealing,
 *     leaving every step reachable by the same controls
 */

export interface WalkthroughOptions {
  /** How many steps there are. */
  stepCount: number;
  /**
   * How many pieces a given step reveals one at a time.
   *
   * A function rather than a number because the count is usually a property of
   * the step, and the step index lives in here.
   */
  beatsFor: (step: number) => number;
  /** How long a step holds before autoplay advances, in milliseconds. */
  stageMs?: number;
  /** How long between the pieces of one step arriving, in milliseconds. */
  beatMs?: number;
  /**
   * Changes when the content changes underneath a step that has not moved.
   *
   * The pipeline walkthrough needs this: switching example while already on
   * step one leaves the step index alone, so without a second signal the reveal
   * would never restart and the new content would stay hidden.
   */
  resetKey?: string | number;
}

export interface Walkthrough {
  step: number;
  /** How many of this step's pieces are showing yet. */
  revealed: number;
  playing: boolean;
  inView: boolean;
  reduced: boolean;
  /** Attach to the outermost element. Drives the in-view and pause handling. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  goTo: (next: number) => void;
  /** Runs an action and stops autoplay, which is what a click should do. */
  takeOver: (next: () => void) => void;
  setPlaying: (playing: boolean) => void;
  /** True once the component is running in the browser. */
  mounted: boolean;
}

const DEFAULT_STAGE_MS = 5200;
const DEFAULT_BEAT_MS = 90;

export function useWalkthrough({
  stepCount,
  beatsFor,
  stageMs = DEFAULT_STAGE_MS,
  beatMs = DEFAULT_BEAT_MS,
  resetKey = 0,
}: WalkthroughOptions): Walkthrough {
  const [step, setStep] = useState(0);
  // Starts fully revealed so the server-rendered markup is the complete first
  // step rather than a box of invisible elements. The animation takes over on
  // mount; a reader without JavaScript keeps the content.
  const [revealed, setRevealed] = useState(() => beatsFor(0));
  const beats = beatsFor(step);
  const [playing, setPlaying] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (typeof IntersectionObserver !== "function") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Pause the moment the reader is anywhere near it. A step changing out from
  // under someone who is reading it is worse than one that never moves.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const pause = () => setPlaying(false);
    node.addEventListener("pointerenter", pause);
    node.addEventListener("focusin", pause);
    return () => {
      node.removeEventListener("pointerenter", pause);
      node.removeEventListener("focusin", pause);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (reduced) {
      setRevealed(beats);
      return;
    }
    setRevealed(0);
    let shown = 0;
    const timer = window.setInterval(() => {
      shown += 1;
      setRevealed(shown);
      if (shown >= beats) window.clearInterval(timer);
    }, beatMs);
    return () => window.clearInterval(timer);
  }, [beatMs, beats, mounted, reduced, resetKey, step]);

  useEffect(() => {
    if (!mounted || !playing || reduced || !inView) return;
    const timer = window.setTimeout(() => {
      setStep((current) => (current + 1) % stepCount);
      setRevealed(0);
    }, stageMs);
    return () => window.clearTimeout(timer);
  }, [inView, mounted, playing, reduced, resetKey, stageMs, step, stepCount]);

  const goTo = useCallback(
    (next: number) => {
      setStep(((next % stepCount) + stepCount) % stepCount);
      setRevealed(0);
    },
    [stepCount],
  );

  const takeOver = useCallback((next: () => void) => {
    setPlaying(false);
    next();
  }, []);

  return {
    step,
    revealed,
    playing,
    inView,
    reduced,
    rootRef,
    goTo,
    takeOver,
    setPlaying,
    mounted,
  };
}
