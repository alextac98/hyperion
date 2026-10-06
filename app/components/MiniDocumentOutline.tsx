import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { EditorStore } from "../editor/editor-client";
import { revealHeading } from "../editor/document-outline";
import { useDocumentOutline } from "../hooks/useDocumentOutline";

export function MiniDocumentOutline({
  store,
  editorRef,
  active,
}: {
  store: EditorStore | null;
  editorRef: RefObject<HTMLElement | null>;
  active: boolean;
}) {
  const headings = useDocumentOutline(store);
  const [open, setOpen] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const navigation = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const outlineId = useId();

  if (previousActive !== active) {
    setPreviousActive(active);
    setOpen(false);
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !active || headings.length < 2) return;
    let scroller: HTMLElement | null = editor.parentElement;
    while (
      scroller &&
      !/(auto|scroll)/.test(window.getComputedStyle(scroller).overflowY)
    )
      scroller = scroller.parentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      navigation.current?.style.setProperty(
        "--mini-outline-list-height",
        `${Math.max(44, (scroller?.clientHeight ?? window.innerHeight) - 72)}px`,
      );
      const top = (scroller?.getBoundingClientRect().top ?? 0) + 80;
      const ids = new Set(headings.map((heading) => heading.id));
      const blocks = Array.from(
        editor.querySelectorAll<HTMLElement>("[data-block-id]"),
      ).filter((block) => ids.has(block.dataset.blockId!));
      let current = headings[0].id;
      for (const block of blocks) {
        if (block.getBoundingClientRect().top > top) break;
        current = block.dataset.blockId!;
      }
      if (
        scroller &&
        scroller.scrollTop > 0 &&
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2
      )
        current = headings[headings.length - 1].id;
      setCurrentId(current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    schedule();
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const observer = new window.ResizeObserver(schedule);
    observer.observe(editor);
    if (scroller) observer.observe(scroller);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [active, editorRef, headings]);

  useEffect(() => {
    if (!open) return;
    const element = navigation.current;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !navigation.current?.contains(event.target)
      )
        setOpen(false);
    };
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        trigger.current?.focus({ preventScroll: true });
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    element?.addEventListener("keydown", dismissKey);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      element?.removeEventListener("keydown", dismissKey);
    };
  }, [open]);

  if (headings.length < 2) return null;
  const current =
    currentId && headings.some((heading) => heading.id === currentId)
      ? currentId
      : headings[0].id;

  return (
    <nav
      ref={navigation}
      className="mini-document-outline"
      aria-label="Mini page outline"
      data-open={open}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setOpen(true);
      }}
      onPointerLeave={() => {
        if (!navigation.current?.contains(document.activeElement))
          setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="mini-outline-trigger"
        aria-label="Show page outline"
        aria-expanded={open}
        aria-controls={outlineId}
        onClick={() => setOpen(true)}
      >
        <span
          className="mini-outline-marks"
          aria-hidden="true"
          style={{ "--mini-outline-count": headings.length } as CSSProperties}
        >
          {headings.map((heading) => (
            <span
              key={heading.id}
              className="mini-outline-mark"
              data-level={heading.level}
              data-current={heading.id === current}
              style={{ "--outline-level": heading.level } as CSSProperties}
            />
          ))}
        </span>
      </button>
      <div id={outlineId} className="mini-outline-popover" hidden={!open}>
        <div className="mini-outline-title">On this page</div>
        <ol className="mini-outline-list">
          {headings.map((heading) => (
            <li key={heading.id}>
              <button
                type="button"
                data-level={heading.level}
                aria-label={`${heading.title}, heading level ${heading.level}`}
                aria-current={heading.id === current ? "location" : undefined}
                style={{ "--outline-level": heading.level } as CSSProperties}
                onClick={() => {
                  if (editorRef.current)
                    revealHeading(editorRef.current, heading.id, "auto");
                  setCurrentId(heading.id);
                  setOpen(false);
                }}
              >
                {heading.title}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
