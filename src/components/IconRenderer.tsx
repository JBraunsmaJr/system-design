import React, { useMemo } from "react";
import * as Icons from "lucide-react";
import { globalIconRegistry, sanitizeSvg, isValidSvg, type IconDefinition } from "../domain/iconRegistry";

interface IconRendererProps {
  icon?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  fallback?: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  iconDefinition?: IconDefinition;
}

const SVG_ATTR_MAP: Record<string, string> = {
  "class": "className",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-opacity": "strokeOpacity",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "text-anchor": "textAnchor",
  "dominant-baseline": "dominantBaseline",
  "gradientunits": "gradientUnits",
  "gradienttransform": "gradientTransform",
  "spreadmethod": "spreadMethod",
  "xlink:href": "xlinkHref",
  "xml:space": "xmlSpace",
  "viewbox": "viewBox",
};

interface SvgAstNode {
  tag: string;
  props: Record<string, unknown>;
  children: (SvgAstNode | string)[];
}

function parseSvgToAst(svgString: string): SvgAstNode | null {
  const tagRegex = /<(\/)?([a-zA-Z0-9_:-]+)((?:\s+[^>]*)?)\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  const stack: SvgAstNode[] = [];
  let root: SvgAstNode | null = null;

  while ((match = tagRegex.exec(svgString)) !== null) {
    const [fullMatch, isClosing, tagName, rawAttrs, text] = match;

    if (text) {
      const trimmed = text.trim();
      if (trimmed && stack.length > 0) {
        stack[stack.length - 1].children.push(text);
      }
      continue;
    }

    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1].tag.toLowerCase() === tagName.toLowerCase()) {
        const finished = stack.pop()!;
        if (stack.length === 0 && !root) {
          root = finished;
        }
      }
      continue;
    }

    const props: Record<string, unknown> = {};
    if (rawAttrs) {
      const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        const name = attrMatch[1].toLowerCase();
        const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
        const reactName = SVG_ATTR_MAP[name] || attrMatch[1];
        props[reactName] = val;
      }
    }

    const node: SvgAstNode = {
      tag: tagName.toLowerCase(),
      props,
      children: [],
    };

    const isSelfClosing = fullMatch.trimEnd().endsWith("/>");
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    }
    if (!isSelfClosing) {
      stack.push(node);
    } else if (stack.length === 0 && !root) {
      root = node;
    }
  }

  return root || (stack.length > 0 ? stack[0] : null);
}

function astToReact(
  node: SvgAstNode | string,
  overrideProps?: Record<string, unknown>,
  key = 0
): React.ReactNode {
  if (typeof node === "string") {
    return node;
  }
  const props = { key, ...node.props, ...overrideProps };
  const children = node.children
    .map((child, idx) => astToReact(child, undefined, idx))
    .filter((c) => c !== null);
  return React.createElement(node.tag, props, children.length > 0 ? children : undefined);
}

function domNodeToReact(
  node: Node,
  overrideProps?: Record<string, unknown>,
  key = 0
): React.ReactNode {
  if (node.nodeType === (typeof Node !== "undefined" ? Node.TEXT_NODE : 3)) {
    return node.textContent || null;
  }
  if (node.nodeType !== (typeof Node !== "undefined" ? Node.ELEMENT_NODE : 1)) {
    return null;
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  const props: Record<string, unknown> = { key };
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const rawName = attr.name.toLowerCase();
    const reactName = SVG_ATTR_MAP[rawName] || attr.name;
    props[reactName] = attr.value;
  }
  if (overrideProps) {
    Object.assign(props, overrideProps);
  }
  const children: React.ReactNode[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = domNodeToReact(el.childNodes[i], undefined, i);
    if (child !== null) children.push(child);
  }
  return React.createElement(tag, props, children.length > 0 ? children : undefined);
}

function renderSafeSvgToReact(
  cleanSvg: string,
  options: {
    className?: string;
    style?: React.CSSProperties;
    width?: number;
    height?: number;
  }
): React.ReactNode {
  if (!cleanSvg || !isValidSvg(cleanSvg)) {
    return null;
  }

  const overrides: Record<string, unknown> = {
    className: options.className,
    style: options.style,
    width: options.width,
    height: options.height,
  };

  if (typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanSvg, "image/svg+xml");
      if (!doc.querySelector("parsererror")) {
        const root = doc.documentElement;
        if (root && root.nodeName.toLowerCase() === "svg") {
          return domNodeToReact(root, overrides, 0);
        }
      }
    } catch {
      // Fallback to AST parser
    }
  }

  const ast = parseSvgToAst(cleanSvg);
  if (!ast || ast.tag !== "svg") return null;
  return astToReact(ast, overrides, 0);
}

export function IconRenderer({
  icon,
  size = 16,
  className,
  style,
  fallback: FallbackIcon = Icons.Box,
  iconDefinition,
}: IconRendererProps) {
  const resolvedDef = useMemo(() => {
    if (iconDefinition) return iconDefinition;
    if (!icon) return undefined;
    return globalIconRegistry.getIcon(icon);
  }, [icon, iconDefinition]);

  // If no registry definition was found, try resolving directly as a Lucide icon key
  if (!resolvedDef) {
    if (icon && icon in Icons) {
      const LucideComp = Icons[icon as keyof typeof Icons] as Icons.LucideIcon;
      if (typeof LucideComp === "function") {
        return <LucideComp size={size} className={className} style={style} />;
      }
    }
    return <FallbackIcon size={size} className={className} style={style} />;
  }

  const { source } = resolvedDef;

  if (source.type === "builtin") {
    const LucideComp = (Icons[source.key as keyof typeof Icons] as Icons.LucideIcon) || FallbackIcon;
    return <LucideComp size={size} className={className} style={style} />;
  }

  if (source.type === "svg") {
    const sanitized = sanitizeSvg(source.data);
    const svgElement = renderSafeSvgToReact(sanitized, {
      className: `custom-svg-icon ${className || ""}`.trim(),
      width: size,
      height: size,
      style: {
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      },
    });

    return svgElement || <FallbackIcon size={size} className={className} style={style} />;
  }

  if (source.type === "image") {
    return (
      <img
        src={source.data}
        alt={resolvedDef.name}
        className={`custom-raster-icon ${className || ""}`}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          ...style,
        }}
      />
    );
  }

  return <FallbackIcon size={size} className={className} style={style} />;
}
