"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ZoomableQuestionImage({
  src,
  alt,
  className,
  inlineHint = false,
  forceInline = false,
}: {
  src: string;
  alt: string;
  className: string;
  inlineHint?: boolean;
  forceInline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [inline, setInline] = useState(forceInline || inlineHint);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (failed)
    return (
      <span className="question-image-error" role="status">
        题目图片加载失败
      </span>
    );

  const image = (
    <Image
      src={src}
      alt={alt}
      width={inline ? 320 : 1200}
      height={inline ? 64 : 720}
      unoptimized
      className={`${className} ${inline ? "inline-formula" : ""}`}
      onLoad={(event) => {
        const element = event.currentTarget;
        const naturallyInline =
          (element.naturalHeight <= 40 && element.naturalWidth <= 480) ||
          (element.naturalHeight <= 64 && element.naturalWidth <= 128);
        setInline(naturallyInline);
      }}
      onError={() => setFailed(true)}
    />
  );

  if (inline) return image;

  return (
    <>
      <span
        className="question-image-trigger"
        title="点击放大查看"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {image}
        <span className="question-image-hint" aria-hidden="true">
          点击放大
        </span>
      </span>
      {open &&
        createPortal(
          <div
            className="question-image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="题目图片大图预览"
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              className="question-image-close"
              aria-label="关闭图片预览"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            <div
              className="question-image-preview-scroll"
              onClick={(event) => event.stopPropagation()}
            >
              <Image
                src={src}
                alt={alt}
                width={1600}
                height={1000}
                unoptimized
                className="question-image-preview"
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
