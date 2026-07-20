"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
  type UIEvent,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
} from "lucide-react";
import { MaterialView } from "./material-view";
import type { PublicQuestion, QuestionMaterial } from "./types";

export type MaterialQuestionItem = {
  question: PublicQuestion;
  index: number;
};

export function MaterialQuestionWorkspace({
  material,
  items,
  currentIndex,
  answered,
  disabled = false,
  onSelect,
  renderQuestion,
}: {
  material: QuestionMaterial;
  items: MaterialQuestionItem[];
  currentIndex: number;
  answered: (questionId: string) => boolean;
  disabled?: boolean;
  onSelect: (index: number) => void;
  renderQuestion: (item: MaterialQuestionItem, active: boolean) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const questionPaneRef = useRef<HTMLDivElement | null>(null);
  const questionRefs = useRef(new Map<number, HTMLElement>());
  const userScrolling = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const handledTouch = useRef(false);
  const activePosition = Math.max(
    0,
    items.findIndex((item) => item.index === currentIndex),
  );

  useEffect(() => {
    if (userScrolling.current) return;
    const section = questionRefs.current.get(currentIndex);
    section?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [currentIndex, material.id]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    },
    [],
  );

  const selectAndReveal = (item: MaterialQuestionItem) => {
    if (disabled) return;
    userScrolling.current = false;
    onSelect(item.index);
    questionRefs.current
      .get(item.index)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const syncVisibleQuestion = (event: UIEvent<HTMLDivElement>) => {
    if (disabled) return;
    userScrolling.current = true;
    if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      userScrolling.current = false;
    }, 180);
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    const pane = event.currentTarget;
    scrollFrame.current = requestAnimationFrame(() => {
      const targetLine = pane.getBoundingClientRect().top + 112;
      const closest = items
        .map((item) => ({
          item,
          distance: Math.abs(
            (questionRefs.current.get(item.index)?.getBoundingClientRect().top ||
              targetLine) - targetLine,
          ),
        }))
        .sort((left, right) => left.distance - right.distance)[0]?.item;
      if (closest && closest.index !== currentIndex) onSelect(closest.index);
    });
  };

  const handleTouchStart = (event: TouchEvent<HTMLButtonElement>) => {
    touchStartY.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLButtonElement>) => {
    const start = touchStartY.current;
    const end = event.changedTouches[0]?.clientY;
    touchStartY.current = null;
    handledTouch.current = true;
    if (start === null || end === undefined || Math.abs(end - start) < 36) {
      setExpanded((value) => !value);
      return;
    }
    setExpanded(end < start);
  };

  const toggleExpanded = () => {
    if (handledTouch.current) {
      handledTouch.current = false;
      return;
    }
    setExpanded((value) => !value);
  };

  return (
    <div
      className="material-question-workspace"
      data-testid="material-question-workspace"
    >
      <section className="material-source-pane" aria-label="题组材料">
        <MaterialView
          material={material}
          questionCount={items.length}
          variant="pane"
        />
      </section>
      <section
        className={`material-questions-pane ${expanded ? "is-expanded" : ""}`}
        aria-label="材料题组题目"
      >
        <div className="material-sheet-header">
          <button
            type="button"
            className="material-sheet-handle"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={toggleExpanded}
            aria-label={expanded ? "收起题目面板" : "展开题目面板"}
            title={expanded ? "收起题目面板" : "展开题目面板"}
          >
            <GripHorizontal size={24} aria-hidden="true" />
            {expanded ? (
              <ChevronDown size={16} aria-hidden="true" />
            ) : (
              <ChevronUp size={16} aria-hidden="true" />
            )}
          </button>
          <span className="material-sheet-progress">
            {activePosition + 1}/{items.length}
          </span>
        </div>
        <nav className="material-group-tabs" aria-label="本材料题号">
          {items.map((item, position) => {
            const active = item.index === currentIndex;
            const completed = answered(item.question.id);
            return (
              <button
                key={item.question.id}
                type="button"
                disabled={disabled}
                aria-current={active ? "step" : undefined}
                onClick={() => selectAndReveal(item)}
                className={`${active ? "is-active" : ""} ${completed ? "is-answered" : ""}`}
              >
                {position + 1}题
              </button>
            );
          })}
        </nav>
        <div
          ref={questionPaneRef}
          className="material-question-scroll"
          onScroll={syncVisibleQuestion}
        >
          {items.map((item) => (
            <article
              key={item.question.id}
              ref={(node) => {
                if (node) questionRefs.current.set(item.index, node);
                else questionRefs.current.delete(item.index);
              }}
              className={`material-group-question ${item.index === currentIndex ? "is-active" : ""}`}
              data-question-index={item.index}
            >
              {renderQuestion(item, item.index === currentIndex)}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
