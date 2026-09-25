import React from 'react';
import { RotateCcw, Check } from 'lucide-react';

export interface ColorPickerPanelProps {
  /** Current override color, if any. */
  value?: string;
  /** Fallback default color when no override is set. */
  defaultValue?: string;
  /** Callback fired when a color is selected or reset (undefined = reset). */
  onChange: (color: string | undefined) => void;
  /** Optional callback to close the panel after selection. */
  onClose?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export const PRESET_COLORS = [
  '#5B7CFA', // Primary Blue
  '#9061F9', // Purple
  '#22B8CF', // Cyan
  '#0FA36B', // Green
  '#F2994A', // Orange
  '#F0578C', // Pink
  '#FF6B6B', // Red
  '#0EA5E9', // Sky Blue
  '#F59F00', // Amber
  '#7C8598', // Slate / Gray
  '#495057', // Charcoal
  '#FFFFFF', // White
];

function isLightColor(hex: string): boolean {
  if (!hex || !hex.startsWith('#')) return false;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  }
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 160;
}

export function ColorPickerPanel({
  value,
  defaultValue,
  onChange,
  onClose,
  style,
  className,
}: ColorPickerPanelProps) {
  const resolved = value !== undefined ? value : defaultValue;

  const handleSelectColor = (color: string) => {
    onChange(color);
    onClose?.();
  };

  const handleReset = () => {
    onChange(undefined);
    onClose?.();
  };

  return (
    <div
      className={`color-picker-panel ${className ?? ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: 'var(--chrome-bg-raised, #1b1e27)',
        border: '1px solid var(--chrome-border, #2a2e3a)',
        borderRadius: 6,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
        width: 176,
        zIndex: 301,
        ...style,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="color-picker-panel__grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 6,
        }}
      >
        {PRESET_COLORS.map((color) => {
          const isSelected = resolved?.toLowerCase() === color.toLowerCase();
          const light = isLightColor(color);
          return (
            <button
              key={color}
              type="button"
              className={`color-picker-panel__swatch ${isSelected ? 'is-selected' : ''}`}
              title={color}
              aria-label={`Color swatch ${color}`}
              style={{
                width: 32,
                height: 32,
                borderRadius: 4,
                border: isSelected
                  ? '2px solid var(--accent, #5B7CFA)'
                  : '1px solid rgba(255, 255, 255, 0.12)',
                background: color,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
              onClick={() => handleSelectColor(color)}
            >
              {isSelected && <Check size={14} color={light ? '#000000' : '#ffffff'} />}
            </button>
          );
        })}
      </div>

      <div style={{ height: 1, background: 'var(--chrome-border, #2a2e3a)', margin: '2px 0' }} />

      <label
        className="color-picker-panel__custom"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 6px',
          borderRadius: 4,
          background: 'var(--chrome-bg, #14161d)',
          border: '1px solid var(--chrome-border, #2a2e3a)',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--chrome-text, #e7e9ee)',
        }}
      >
        <input
          type="color"
          aria-label="Custom color picker"
          value={
            resolved && resolved.startsWith('#') && (resolved.length === 7 || resolved.length === 4)
              ? resolved
              : '#5B7CFA'
          }
          onChange={(e) => {
            onChange(e.target.value);
            onClose?.();
          }}
          style={{
            width: 20,
            height: 20,
            padding: 0,
            border: 'none',
            borderRadius: 3,
            background: 'transparent',
            cursor: 'pointer',
          }}
        />
        <span>Custom color</span>
      </label>

      {value !== undefined && (
        <button
          type="button"
          className="color-picker-panel__reset"
          onClick={handleReset}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '5px 8px',
            borderRadius: 4,
            background: 'transparent',
            border: '1px dashed var(--chrome-border, #2a2e3a)',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--chrome-text-dim, #7c8598)',
            width: '100%',
          }}
        >
          <RotateCcw size={11} />
          <span>Reset to default</span>
        </button>
      )}
    </div>
  );
}
