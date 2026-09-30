import { useRef, useEffect } from 'react';
import { fitHeightToContent } from '../../common/utils/autoSizeTextarea';

interface AutoResizeTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
}

/** A textarea that grows with its content. Moved unchanged from SrdPrintModal.tsx. */
export function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 44,
}: AutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    fitHeightToContent(el);
  }, [value, minHeight]);

  return (
    <textarea
      ref={textareaRef}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        const el = textareaRef.current;
        if (el) {
          fitHeightToContent(el);
        }
      }}
      style={{
        width: '100%',
        fontSize: '0.75rem',
        overflow: 'hidden',
        resize: 'vertical',
        minHeight: `${minHeight}px`,
        boxSizing: 'border-box',
        lineHeight: '1.45',
      }}
    />
  );
}
