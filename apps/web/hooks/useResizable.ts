import { useCallback, useEffect, useRef, useState } from "react";

export function useResizable(storageKey: string, initial: number, min = 120, max = 480) {
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) setWidth(Math.min(max, Math.max(min, parsed)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const currentWidth = useRef(width);
  currentWidth.current = width;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = currentWidth.current;
    e.preventDefault();
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const next = Math.min(max, Math.max(min, startWidth.current + e.clientX - startX.current));
      setWidth(next);
    }
    function onMouseUp() {
      if (dragging.current) {
        localStorage.setItem(storageKey, String(currentWidth.current));
      }
      dragging.current = false;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [min, max, storageKey]);

  return { width, onMouseDown };
}
