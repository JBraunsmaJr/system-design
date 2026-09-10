import React from "react";
import type { ShapeGeometry, ShapeStyle } from "../../domain/shapeRegistry";
import { IconRenderer } from "../IconRenderer";

interface SvgShapeRendererProps {
  geometry: ShapeGeometry;
  width: number;
  height: number;
  color: string;
  style?: ShapeStyle;
  iconId?: string;
}

export function SvgShapeRenderer({
  geometry,
  width,
  height,
  color,
  style,
  iconId,
}: SvgShapeRendererProps) {
  const strokeColor = style?.stroke || color;
  const strokeWidth = style?.strokeWidth ?? 2;
  const fillColor =
    style?.fill || (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? `${color}22` : "transparent");
  const strokeDasharray = style?.strokeDasharray;
  const opacity = style?.opacity ?? 1;

  const renderGeometry = (geom: ShapeGeometry, key?: string | number): React.ReactNode => {
    switch (geom.type) {
      case "rectangle": {
        const rx = geom.rx ?? 0;
        const ry = geom.ry ?? 0;
        return (
          <rect
            key={key}
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(1, width - strokeWidth)}
            height={Math.max(1, height - strokeWidth)}
            rx={rx}
            ry={ry}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      }

      case "rounded-rectangle": {
        const radius = geom.radius ?? 10;
        return (
          <rect
            key={key}
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(1, width - strokeWidth)}
            height={Math.max(1, height - strokeWidth)}
            rx={radius}
            ry={radius}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      }

      case "circle":
      case "ellipse": {
        return (
          <ellipse
            key={key}
            cx={width / 2}
            cy={height / 2}
            rx={Math.max(1, width / 2 - strokeWidth / 2)}
            ry={Math.max(1, height / 2 - strokeWidth / 2)}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      }

      case "diamond": {
        const cx = width / 2;
        const cy = height / 2;
        const inset = strokeWidth / 2;
        const pts = `${cx},${inset} ${width - inset},${cy} ${cx},${height - inset} ${inset},${cy}`;
        return (
          <polygon
            key={key}
            points={pts}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinejoin="round"
          />
        );
      }

      case "parallelogram": {
        const inset = strokeWidth / 2;
        const offset = width * 0.18;
        const pts = `${offset + inset},${inset} ${width - inset},${inset} ${width - offset - inset},${height - inset} ${inset},${height - inset}`;
        return (
          <polygon
            key={key}
            points={pts}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinejoin="round"
          />
        );
      }

      case "hexagon": {
        const inset = strokeWidth / 2;
        const offset = width * 0.18;
        const cy = height / 2;
        const pts = `${offset + inset},${inset} ${width - offset - inset},${inset} ${width - inset},${cy} ${width - offset - inset},${height - inset} ${offset + inset},${height - inset} ${inset},${cy}`;
        return (
          <polygon
            key={key}
            points={pts}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinejoin="round"
          />
        );
      }

      case "polygon": {
        const pts = geom.points.map((p) => `${p.x * width},${p.y * height}`).join(" ");
        return (
          <polygon
            key={key}
            points={pts}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinejoin="round"
          />
        );
      }

      case "line": {
        return (
          <line
            key={key}
            x1={geom.x1 * width}
            y1={geom.y1 * height}
            x2={geom.x2 * width}
            y2={geom.y2 * height}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      }

      case "cylinder": {
        const capH = Math.min(height * 0.25, 24);
        const w = width - strokeWidth;
        const h = height - strokeWidth;
        const x = strokeWidth / 2;
        const y = strokeWidth / 2;

        const bodyD = `M ${x} ${y + capH / 2} L ${x} ${y + h - capH / 2} A ${w / 2} ${capH / 2} 0 0 0 ${x + w} ${y + h - capH / 2} L ${x + w} ${y + capH / 2} Z`;
        return (
          <g key={key}>
            <path d={bodyD} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
            <ellipse cx={x + w / 2} cy={y + capH / 2} rx={w / 2} ry={capH / 2} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
            <ellipse cx={x + w / 2} cy={y + h - capH / 2} rx={w / 2} ry={capH / 2} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
          </g>
        );
      }

      case "database": {
        const diskH = height / 3;
        const capH = Math.min(diskH * 0.45, 14);
        const w = width - strokeWidth;
        const x = strokeWidth / 2;

        return (
          <g key={key}>
            {[0, 1, 2].map((i) => {
              const y = strokeWidth / 2 + i * diskH;
              const d = `M ${x} ${y + capH / 2} L ${x} ${y + diskH - capH / 2} A ${w / 2} ${capH / 2} 0 0 0 ${x + w} ${y + diskH - capH / 2} L ${x + w} ${y + capH / 2} Z`;
              return (
                <g key={i}>
                  <path d={d} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
                  <ellipse cx={x + w / 2} cy={y + capH / 2} rx={w / 2} ry={capH / 2} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
                </g>
              );
            })}
          </g>
        );
      }

      case "queue": {
        const capW = Math.min(width * 0.2, 20);
        const w = width - strokeWidth;
        const h = height - strokeWidth;
        const x = strokeWidth / 2;
        const y = strokeWidth / 2;

        const d = `M ${x + capW / 2} ${y} L ${x + w - capW / 2} ${y} A ${capW / 2} ${h / 2} 0 0 1 ${x + w - capW / 2} ${y + h} L ${x + capW / 2} ${y + h} A ${capW / 2} ${h / 2} 0 0 1 ${x + capW / 2} ${y} Z`;
        return (
          <g key={key}>
            <path d={d} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
            <ellipse cx={x + capW / 2} cy={y + h / 2} rx={capW / 2} ry={h / 2} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
            <ellipse cx={x + w - capW / 2} cy={y + h / 2} rx={capW / 2} ry={h / 2} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          </g>
        );
      }

      case "document": {
        const fold = Math.min(width * 0.25, 24);
        const w = width - strokeWidth;
        const h = height - strokeWidth;
        const x = strokeWidth / 2;
        const y = strokeWidth / 2;

        const bodyD = `M ${x} ${y} L ${x + w - fold} ${y} L ${x + w} ${y + fold} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
        const foldD = `M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold}`;
        return (
          <g key={key}>
            <path d={bodyD} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />
            <path d={foldD} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
          </g>
        );
      }

      case "actor": {
        const headR = Math.min(width * 0.2, height * 0.15);
        const headCx = width / 2;
        const headCy = strokeWidth + headR;

        const neckY = headCy + headR;
        const waistY = height * 0.6;
        const feetY = height - strokeWidth;
        const armY = neckY + (waistY - neckY) * 0.35;

        return (
          <g key={key}>
            {/* Head */}
            <circle cx={headCx} cy={headCy} r={headR} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Spine */}
            <line x1={headCx} y1={neckY} x2={headCx} y2={waistY} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Arms */}
            <line x1={width * 0.15} y1={armY} x2={width * 0.85} y2={armY} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Left Leg */}
            <line x1={headCx} y1={waistY} x2={width * 0.2} y2={feetY} stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Right Leg */}
            <line x1={headCx} y1={waistY} x2={width * 0.8} y2={feetY} stroke={strokeColor} strokeWidth={strokeWidth} />
          </g>
        );
      }

      case "cloud": {
        const w = width - strokeWidth;
        const h = height - strokeWidth;
        const x = strokeWidth / 2;
        const y = strokeWidth / 2;
        const d = `M ${x + w * 0.2} ${y + h * 0.75}
                   A ${w * 0.18} ${h * 0.25} 0 0 1 ${x + w * 0.15} ${y + h * 0.4}
                   A ${w * 0.2} ${h * 0.3} 0 0 1 ${x + w * 0.4} ${y + h * 0.2}
                   A ${w * 0.25} ${h * 0.35} 0 0 1 ${x + w * 0.75} ${y + h * 0.25}
                   A ${w * 0.2} ${h * 0.3} 0 0 1 ${x + w * 0.9} ${y + h * 0.55}
                   A ${w * 0.18} ${h * 0.25} 0 0 1 ${x + w * 0.8} ${y + h * 0.8}
                   Z`;
        return <path key={key} d={d} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />;
      }

      case "path": {
        return (
          <path
            key={key}
            d={geom.d}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      }

      case "group": {
        return <g key={key}>{geom.children.map((child, idx) => renderGeometry(child, idx))}</g>;
      }

      case "text": {
        return (
          <text
            key={key}
            x={(geom.x ?? 0.5) * width}
            y={(geom.y ?? 0.5) * height}
            fontSize={geom.fontSize ?? 14}
            textAnchor={geom.align === "left" ? "start" : geom.align === "right" ? "end" : "middle"}
            dominantBaseline="middle"
            fill={strokeColor}
          >
            {geom.text}
          </text>
        );
      }

      case "icon": {
        return null; // Handled separately
      }

      default:
        return (
          <rect
            key={key}
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(1, width - strokeWidth)}
            height={Math.max(1, height - strokeWidth)}
            rx={8}
            ry={8}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
    }
  };

  const activeIcon = iconId && iconId !== "none" ? iconId : undefined;

  return (
    <svg
      className="svg-shape-renderer"
      width={width}
      height={height}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        opacity,
        overflow: "visible",
      }}
    >
      {renderGeometry(geometry)}
      {activeIcon && (
        <foreignObject x={width / 2 - 12} y={10} width={24} height={24}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", color: strokeColor }}>
            <IconRenderer icon={activeIcon} size={18} />
          </div>
        </foreignObject>
      )}
    </svg>
  );
}
