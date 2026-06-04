"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";

export type EditorContextValue = {
  isComposing: () => boolean;
  setComposing: (value: boolean) => void;
  undo: () => void;
  redo: () => void;
  stickyTopOffset: number;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorContextProvider({
  children,
  composingRef,
  undo,
  redo,
  stickyTopOffset,
}: {
  children: ReactNode;
  composingRef: MutableRefObject<boolean>;
  undo: () => void;
  redo: () => void;
  stickyTopOffset: number;
}) {
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);

  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  }, [undo, redo]);

  // Stable forever so consumer effects (e.g. EditableHtml beforeinput) don't re-bind.
  const value = useMemo<EditorContextValue>(
    () => ({
      isComposing: () => composingRef.current,
      setComposing: (next) => {
        composingRef.current = next;
      },
      undo: () => undoRef.current(),
      redo: () => redoRef.current(),
      stickyTopOffset,
    }),
    [composingRef, stickyTopOffset],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

// Safe outside a provider — returns inert defaults so block components can call
// `isComposing()` in test fixtures without crashing.
export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (ctx) return ctx;
  return {
    isComposing: () => false,
    setComposing: () => {},
    undo: () => {},
    redo: () => {},
    stickyTopOffset: 0,
  };
}
