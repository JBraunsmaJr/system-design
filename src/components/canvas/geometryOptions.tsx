import type { ReactNode } from 'react';

export interface GeometryOption {
  id: string;
  label: string;
  renderIcon: () => ReactNode;
}

export const GEOMETRY_OPTIONS: GeometryOption[] = [
  {
    id: 'rounded-rectangle',
    label: 'Rounded Rectangle',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="1.5" y="2.5" width="15" height="13" rx="3.5" />
      </svg>
    ),
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="1.5" y="2.5" width="15" height="13" />
      </svg>
    ),
  },
  {
    id: 'circle',
    label: 'Circle / Ellipse',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="9" cy="9" r="6.5" />
      </svg>
    ),
  },
  {
    id: 'cylinder',
    label: 'Cylinder (Database)',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M 2.5 4.5 C 2.5 3 15.5 3 15.5 4.5 L 15.5 13.5 C 15.5 15 2.5 15 2.5 13.5 Z" />
        <path d="M 2.5 4.5 C 2.5 6 15.5 6 15.5 4.5" />
      </svg>
    ),
  },
  {
    id: 'diamond',
    label: 'Diamond (Decision)',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <polygon points="9,2 16,9 9,16 2,9" />
      </svg>
    ),
  },
  {
    id: 'hexagon',
    label: 'Hexagon',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <polygon points="4.5,2 13.5,2 16.5,9 13.5,16 4.5,16 1.5,9" />
      </svg>
    ),
  },
  {
    id: 'parallelogram',
    label: 'Parallelogram',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <polygon points="4.5,3 16.5,3 13.5,15 1.5,15" />
      </svg>
    ),
  },
  {
    id: 'document',
    label: 'Document',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M 2.5 2.5 L 11.5 2.5 L 15.5 6.5 L 15.5 15.5 C 11.5 13.5 6.5 16.5 2.5 14.5 Z" />
      </svg>
    ),
  },
  {
    id: 'cloud',
    label: 'Cloud',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M 3.5 13 C 1.5 13 1.5 10 3.5 9.5 C 3 6.5 7 5 9 6.5 C 11 4.5 15 6 14.5 9 C 16.5 9.5 16.5 13 14.5 13 Z" />
      </svg>
    ),
  },
  {
    id: 'actor',
    label: 'Actor (User)',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="9" cy="5" r="2.5" />
        <path d="M 2.5 15.5 C 2.5 11 15.5 11 15.5 15.5" />
      </svg>
    ),
  },
  {
    id: 'path',
    label: 'Custom SVG Path',
    renderIcon: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path
          d="M 2.5 14.5 L 6.5 3.5 L 11.5 14.5 L 15.5 7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];
