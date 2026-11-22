"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measures a container so charts draw in real pixels. A scaled viewBox would stretch the
 * text along with the plot, which is what made labels oversized on wide screens.
 */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Null until measured: the server cannot know the width, and a guess would overflow on phones.
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Round axis maximum and evenly spaced ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Number((i * step).toFixed(6)));
}
