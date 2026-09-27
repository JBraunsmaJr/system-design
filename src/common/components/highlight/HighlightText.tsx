import React, { useLayoutEffect, useRef, useState, useMemo } from 'react';
import {
  splitByHighlight,
  computeTruncationWithHighlight,
} from '../../../domain/requirements/textHighlight';

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
        ),
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
  if (typeof document === 'undefined') return text.length * 8;
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
  }
  const ctx = sharedCanvas.getContext('2d');
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Renders a requirement title with search match highlighting.
 * If the title overflows the container, it truncates with an ellipsis.
 * If the match is in a cut-off portion of the title, it reformats the text to render
 * the search match with surrounding context and leading/trailing ellipses as needed.
 */
export function HighlightedTitle({
  text,
  search,
  placeholder = 'Untitled',
  className,
  style,
  fallbackMaxChars,
}: HighlightedTitleProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [computedFont, setComputedFont] = useState<string>('');

  const trimmedSearch = (search ?? '').trim();
  const displayText = text || '';

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateMeasurements = () => {
      let width = el.clientWidth;
      if (width <= 0 && el.parentElement) {
        width = el.parentElement.clientWidth;
      }
      if (width <= 0) {
        const rect = el.getBoundingClientRect();
        width = rect.width;
      }
      const computedStyle = window.getComputedStyle(el);
      const font = `${computedStyle.fontWeight || 'normal'} ${computedStyle.fontSize || '14px'} ${computedStyle.fontFamily || 'sans-serif'}`;
      setContainerWidth(width);
      setComputedFont(font);
    };

    updateMeasurements();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateMeasurements();
      });
      observer.observe(el);
      if (el.parentElement) {
        observer.observe(el.parentElement);
      }
      return () => observer.disconnect();
    }
  }, [displayText, trimmedSearch]);

  const truncationResult = useMemo(() => {
    if (!displayText) return null;

    if (containerWidth > 0 && computedFont) {
      return computeTruncationWithHighlight(displayText, trimmedSearch, containerWidth, (s) =>
        getTextWidth(s, computedFont),
      );
    }

    if (fallbackMaxChars && fallbackMaxChars > 0) {
      return computeTruncationWithHighlight(
        displayText,
        trimmedSearch,
        fallbackMaxChars * 8,
        (s) => s.length * 8,
      );
    }

    return null;
  }, [displayText, trimmedSearch, containerWidth, computedFont, fallbackMaxChars]);

  if (!displayText) {
    return (
      <span
        ref={containerRef}
        className={`highlighted-title is-placeholder ${className || ''}`.trim()}
        style={style}
      >
        {placeholder}
      </span>
    );
  }

  if (truncationResult && truncationResult.isTruncated) {
    const hasHighlightInside = truncationResult.hasMatchInVisible;
    const isEllipsisHighlighted = truncationResult.hasMatchInTruncated && !hasHighlightInside;

    return (
      <span
        ref={containerRef}
        className={`highlighted-title is-truncated ${className || ''}`.trim()}
        style={style}
        title={displayText}
      >
        {truncationResult.leadingEllipsis && (
          <span
            className={`search-ellipsis${isEllipsisHighlighted ? ' search-highlight--ellipsis' : ''}`}
          >
            {truncationResult.ellipsis}
          </span>
        )}
        <HighlightedText text={truncationResult.visibleText} search={trimmedSearch} />
        {truncationResult.trailingEllipsis && (
          <span
            className={`search-ellipsis${isEllipsisHighlighted ? ' search-highlight--ellipsis' : ''}`}
          >
            {truncationResult.ellipsis}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      ref={containerRef}
      className={`highlighted-title ${className || ''}`.trim()}
      style={style}
      title={displayText}
    >
      <HighlightedText text={displayText} search={trimmedSearch} />
    </span>
  );
}
