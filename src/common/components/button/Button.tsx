import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant of the button */
  variant?: ButtonVariant;
  /** Size variant controlling padding, height, and typography */
  size?: ButtonSize;
  /** Optional prefix icon rendered before children */
  icon?: ReactNode;
  /** Optional suffix icon rendered after children */
  iconRight?: ReactNode;
  /** Compact square sizing for icon-only buttons */
  iconOnly?: boolean;
  /** Expands button to fill 100% of container width */
  fullWidth?: boolean;
  /** Shows a loading state and disables user interactions */
  loading?: boolean;
  /** Additional custom class names */
  className?: string;
  /** Additional inline style overrides */
  style?: CSSProperties;
  /** Button content */
  children?: ReactNode;
}

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: 'var(--accent, #5b7cfa)',
    color: 'var(--accent-text, #ffffff)',
    borderColor: 'var(--accent, #5b7cfa)',
  },
  secondary: {
    background: 'var(--chrome-bg, #14161c)',
    color: 'var(--chrome-text, #e7e9ee)',
    borderColor: 'var(--chrome-border, #2a2e3a)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--chrome-text-dim, #8b90a0)',
    borderColor: 'transparent',
  },
  danger: {
    background: 'var(--danger, #f0578c)',
    color: '#ffffff',
    borderColor: 'var(--danger, #f0578c)',
  },
  'danger-outline': {
    background: 'transparent',
    color: 'var(--danger, #f0578c)',
    borderColor: 'var(--danger, #f0578c)',
  },
};

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: {
    height: 26,
    padding: '3px 8px',
    fontSize: 12,
    gap: 4,
  },
  md: {
    height: 32,
    padding: '6px 12px',
    fontSize: 13,
    gap: 6,
  },
  lg: {
    height: 38,
    padding: '8px 16px',
    fontSize: 14,
    gap: 8,
  },
};

const iconOnlySizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: {
    width: 26,
    height: 26,
    padding: 0,
    justifyContent: 'center',
  },
  md: {
    width: 32,
    height: 32,
    padding: 0,
    justifyContent: 'center',
  },
  lg: {
    width: 38,
    height: 38,
    padding: 0,
    justifyContent: 'center',
  },
};

/**
 * Standardized reusable Button component.
 * Provides consistent variants, sizing, theming tokens, icon handling,
 * and keyboard accessibility across the entire application.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    iconOnly = false,
    fullWidth = false,
    loading = false,
    disabled = false,
    type = 'button',
    className = '',
    style,
    children,
    ...restProps
  },
  ref,
) {
  const isEffectivelyDisabled = disabled || loading;

  const baseClasses = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    iconOnly ? 'btn--icon-only' : '',
    fullWidth ? 'btn--full-width' : '',
    loading ? 'btn--loading' : '',
    variant === 'primary' ? 'primary' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const mergedStyles: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: iconOnly ? 'center' : 'center',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-sm, 6px)',
    borderWidth: 1,
    borderStyle: 'solid',
    fontWeight: 500,
    cursor: isEffectivelyDisabled ? 'not-allowed' : 'pointer',
    opacity: isEffectivelyDisabled ? 0.45 : 1,
    transition:
      'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    width: fullWidth ? '100%' : undefined,
    ...variantStyles[variant],
    ...sizeStyles[size],
    ...(iconOnly ? iconOnlySizeStyles[size] : null),
    ...style,
  };

  return (
    <button
      ref={ref}
      type={type}
      className={baseClasses}
      disabled={isEffectivelyDisabled}
      style={mergedStyles}
      {...restProps}
    >
      {icon && (
        <span
          className="btn__icon btn__icon--left"
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          {icon}
        </span>
      )}
      {children}
      {iconRight && (
        <span
          className="btn__icon btn__icon--right"
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          {iconRight}
        </span>
      )}
    </button>
  );
});
