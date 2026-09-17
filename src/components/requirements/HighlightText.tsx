import React, { useLayoutEffect, useRef, useState, useMemo } from "react";
import { splitByHighlight, computeTruncationWithHighlight } from "../../domain/textHighlight";

interface HighlightedTextProps {
  text: string;
  search?: string;
  className?: string;
}

/**
 * Renders text with matching substrings wrapped in a <mark className="search-highlight">.
 * Case-insensitive search match.
 */
export function HighlightedText({ text, search, className }: HighlightedTextProps) {
  if (!search || !search.trim() || !text) {
    return <span className={className}>{text}</span>;
  }

  const segments = splitByHighlight(text, search);

  return (
    <span className={className}>
      {segments.map((seg, idx) =>
        seg.isMatch ? (
          <mark key={idx} className="search-highlight">
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        )
      )}
    </span>
  );
}

interface HighlightedTitleProps {
  text: string;
  search?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  fallbackMaxChars?: number;
}

let sharedCanvas: HTMLCanvasElement | null = null;
function getTextWidth(text: string, font: string): number {
  if (typeof document === "undefined") return text.length * 8;
  if (!sharedCanvas) {
    sharedCanvas = document.createElement("canvas");
  }
  const ctx = sharedCanvas.getContext("2d");
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Renders a requirement title with search match highlighting.
 * If the title overflows the container, it truncates with an ellipsis.
 * If the match (or any part of the match) is in the truncated portion after the ellipsis,
 * the ellipsis itself is highlighted (<mark className="search-highlight search-highlight--ellipsis">...</mark>).
 */
export function HighlightedTitle({
  text,
  search,
  placeholder = "Untitled",
  className,
  style,
  fallbackMaxChars,
}: HighlightedTitleProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [computedFont, setComputedFont] = useState<string>("");

  const trimmedSearch = (search ?? "").trim();
  const displayText = text || "";

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateMeasurements = () => {
      const width = el.clientWidth;
      const style = window.getComputedStyle(el);
      const font = `${style.fontWeight || "normal"} ${style.fontSize || "14px"} ${style.fontFamily || "sans-serif"}`;
      setContainerWidth(width);
      setComputedFont(font);
    };

    updateMeasurements();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateMeasurements();
      });
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [displayText, trimmedSearch]);

  const truncationResult = useMemo(() => {
    if (!trimmedSearch) return null;

    if (containerWidth > 0 && computedFont) {
      return computeTruncationWithHighlight(
        displayText,
        trimmedSearch,
        containerWidth,
        (s) => getTextWidth(s, computedFont)
      );
    }

    if (fallbackMaxChars && fallbackMaxChars > 0 && displayText.length > fallbackMaxChars) {
      return computeTruncationWithHighlight(
        displayText,
        trimmedSearch,
        fallbackMaxChars,
        (s) => s.length
      );
    }

    return null;
  }, [displayText, trimmedSearch, containerWidth, computedFont, fallbackMaxChars]);

  if (!displayText) {
    return (
      <span ref={containerRef} className={className} style={style} title={placeholder}>
        {placeholder}
      </span>
    );
  }

  if (!trimmedSearch) {
    return (
      <span
        ref={containerRef}
        className={className}
        style={{
          ...style,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={displayText}
      >
        {displayText}
      </span>
    );
  }

  // If we have truncation result from DOM or fallback measurement
  if (truncationResult && truncationResult.isTruncated) {
    return (
      <span
        ref={containerRef}
        className={className}
        style={{
          ...style,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
        title={displayText}
      >
        <HighlightedText text={truncationResult.visibleText} search={trimmedSearch} />
        {truncationResult.hasMatchInTruncated ? (
          <mark className="search-highlight search-highlight--ellipsis">{truncationResult.ellipsis}</mark>
        ) : (
          <span className="search-ellipsis">{truncationResult.ellipsis}</span>
        )}
      </span>
    );
  }

  // Fits within container (or not measured yet)
  return (
    <span
      ref={containerRef}
      className={className}
      style={{
        ...style,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title={displayText}
    >
      <HighlightedText text={displayText} search={trimmedSearch} />
    </span>
  );
}
