import React, { useMemo } from "react";
import * as Icons from "lucide-react";
import { globalIconRegistry, type IconDefinition } from "../domain/iconRegistry";

interface IconRendererProps {
  icon?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  fallback?: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  iconDefinition?: IconDefinition;
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
    return (
      <span
        className={`custom-svg-icon ${className || ""}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          ...style,
        }}
        dangerouslySetInnerHTML={{ __html: source.data }}
      />
    );
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
