import { Panel } from "@xyflow/react";

interface BreadcrumbProps {
  labels: string[];
  onNavigateToRoot: () => void;
  onNavigateToIndex: (index: number) => void;
}

export function Breadcrumb({ labels, onNavigateToRoot, onNavigateToIndex }: BreadcrumbProps) {
  if (labels.length === 0) return null;

  return (
    <Panel position="top-left" className="breadcrumb">
      <button type="button" onClick={onNavigateToRoot}>
        Top level
      </button>
      {labels.map((label, index) => (
        <span className="breadcrumb__segment" key={index}>
          <span className="breadcrumb__sep">›</span>
          {index === labels.length - 1 ? (
            <span className="breadcrumb__current">{label}</span>
          ) : (
            <button type="button" onClick={() => onNavigateToIndex(index)}>
              {label}
            </button>
          )}
        </span>
      ))}
    </Panel>
  );
}
