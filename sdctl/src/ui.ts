/**
 * Terminal UI and ANSI color styling utility for sdctl.
 * Zero external dependencies, automatic TTY & NO_COLOR detection.
 */

const isColorSupported = (): boolean => {
  if (typeof process === 'undefined' || !process.stdout) return false;
  if (process.env.NO_COLOR || process.env.NODE_DISABLE_COLORS) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY) || process.env.TERM !== 'dumb';
};

const format = (open: number, close: number) => {
  return (str: string | number): string => {
    if (!isColorSupported()) return String(str);
    return `\x1b[${open}m${str}\x1b[${close}m`;
  };
};

export const colors = {
  reset: format(0, 0),
  bold: format(1, 22),
  dim: format(2, 22),
  italic: format(3, 23),
  underline: format(4, 24),

  // Standard Colors
  black: format(30, 39),
  red: format(31, 39),
  green: format(32, 39),
  yellow: format(33, 39),
  blue: format(34, 39),
  magenta: format(35, 39),
  cyan: format(36, 39),
  white: format(37, 39),
  gray: format(90, 39),

  // Bright Colors
  brightRed: format(91, 39),
  brightGreen: format(92, 39),
  brightYellow: format(93, 39),
  brightBlue: format(94, 39),
  brightMagenta: format(95, 39),
  brightCyan: format(96, 39),
  brightWhite: format(97, 39),

  // Background Colors
  bgRed: format(41, 49),
  bgGreen: format(42, 49),
  bgYellow: format(43, 49),
  bgBlue: format(44, 49),
  bgMagenta: format(45, 49),
  bgCyan: format(46, 49),
  bgGray: format(100, 49),
};

export const ui = {
  banner(title: string, subtitle?: string): string {
    const border = '═'.repeat(64);
    const lines = [
      colors.cyan(`╔${border}╗`),
      colors.cyan(`║ `) + colors.bold(colors.brightWhite(title.padEnd(62))) + colors.cyan(` ║`),
    ];
    if (subtitle) {
      lines.push(
        colors.cyan(`║ `) + colors.dim(colors.cyan(subtitle.padEnd(62))) + colors.cyan(` ║`),
      );
    }
    lines.push(colors.cyan(`╚${border}╝`));
    return lines.join('\n');
  },

  sectionHeader(step: string, title: string, description?: string): string {
    let out = `\n${colors.cyan('◆')} ${colors.bold(colors.brightCyan(`[${step}]`))} ${colors.bold(colors.brightWhite(title))}`;
    if (description) {
      out += `\n  ${colors.dim(description)}`;
    }
    return out;
  },

  menuOption(key: string, label: string, detail?: string, isRecommended = false): string {
    const badge = isRecommended ? ` ${colors.bgCyan(colors.black(' RECOMMENDED '))}` : '';
    let out = `  ${colors.cyan(`(${key})`)} ${colors.bold(label)}${badge}`;
    if (detail) {
      out += `\n      ${colors.dim(detail)}`;
    }
    return out;
  },

  prompt(label: string, defaultVal?: string): string {
    const def = defaultVal ? ` ${colors.dim(`[${defaultVal}]`)}` : '';
    return `  ${colors.brightYellow('?')} ${colors.bold(label)}${def}: `;
  },

  badge(status: 'pass' | 'fail' | 'warn' | 'skip' | 'info'): string {
    switch (status) {
      case 'pass':
        return colors.bgGreen(colors.black(' PASS '));
      case 'fail':
        return colors.bgRed(colors.black(' FAIL '));
      case 'warn':
        return colors.bgYellow(colors.black(' WARN '));
      case 'skip':
        return colors.bgGray(colors.black(' SKIP '));
      case 'info':
        return colors.bgBlue(colors.black(' INFO '));
    }
  },

  statusSymbol(status: 'pass' | 'fail' | 'warn' | 'skip'): string {
    switch (status) {
      case 'pass':
        return colors.brightGreen('✓');
      case 'fail':
        return colors.brightRed('✗');
      case 'warn':
        return colors.brightYellow('⚠');
      case 'skip':
        return colors.gray('○');
    }
  },

  tag(label: string, color: keyof typeof colors = 'cyan'): string {
    const colorFn = colors[color] as (s: string) => string;
    return colorFn(`[${label}]`);
  },

  success(msg: string): string {
    return `${colors.brightGreen('✓')} ${colors.bold(msg)}`;
  },

  error(msg: string): string {
    return `${colors.brightRed('✗')} ${colors.bold(msg)}`;
  },

  warning(msg: string): string {
    return `${colors.brightYellow('⚠')} ${colors.bold(msg)}`;
  },

  info(msg: string): string {
    return `${colors.brightCyan('ℹ')} ${msg}`;
  },

  divider(len = 66): string {
    return colors.dim('─'.repeat(len));
  },
};
