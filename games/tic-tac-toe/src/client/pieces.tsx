import type { ReactElement } from "react";
import type { PieceId } from "../visual";

/** Darker shade for outlines and faces. */
export function shade(hex: string, amount = -0.45): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.slice(0, 6);
  const n = Number.parseInt(full, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount),
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Developer-drawn pieces, centered at (0, 0), roughly within ±40 units. */
export function PieceShape({ preset, color }: { preset: PieceId; color: string }): ReactElement {
  const dark = shade(color);
  switch (preset) {
    case "cross":
      return <path d="M-28 -28 L28 28 M28 -28 L-28 28" stroke={color} strokeWidth={14} strokeLinecap="round" fill="none" />;
    case "ring":
      return <circle r={27} stroke={color} strokeWidth={12} fill="none" />;
    case "triangle":
      return <polygon points="0,-32 30,24 -30,24" stroke={color} strokeWidth={11} strokeLinejoin="round" fill="none" />;
    case "square":
      return <rect x={-26} y={-26} width={52} height={52} rx={6} stroke={color} strokeWidth={11} fill="none" />;
    case "diamond":
      return <polygon points="0,-34 30,0 0,34 -30,0" stroke={color} strokeWidth={11} strokeLinejoin="round" fill="none" />;
    case "star":
      return (
        <polygon
          points="0,-36 10.6,-14.6 34.2,-11.1 17.1,5.6 21.2,29.1 0,18 -21.2,29.1 -17.1,5.6 -34.2,-11.1 -10.6,-14.6"
          fill={color}
          stroke={dark}
          strokeWidth={3}
          strokeLinejoin="round"
        />
      );
    case "heart":
      return (
        <path
          d="M0 30 C -38 6 -34 -26 -14 -28 C -4 -29 0 -20 0 -16 C 0 -20 4 -29 14 -28 C 34 -26 38 6 0 30 Z"
          fill={color}
          stroke={dark}
          strokeWidth={3}
        />
      );
    case "smile":
      return (
        <g>
          <circle r={32} fill={color} stroke={dark} strokeWidth={3} />
          <circle cx={-11} cy={-8} r={4.5} fill={dark} />
          <circle cx={11} cy={-8} r={4.5} fill={dark} />
          <path d="M-15 8 Q0 22 15 8" stroke={dark} strokeWidth={4.5} strokeLinecap="round" fill="none" />
        </g>
      );
    case "ghost":
      return (
        <g>
          <path
            d="M-26 30 L-26 -6 C -26 -26 -14 -34 0 -34 C 14 -34 26 -26 26 -6 L26 30 L17 22 L9 30 L0 22 L-9 30 L-17 22 Z"
            fill={color}
            stroke={dark}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <ellipse cx={-9} cy={-8} rx={5} ry={7} fill="#ffffff" />
          <ellipse cx={9} cy={-8} rx={5} ry={7} fill="#ffffff" />
          <circle cx={-8} cy={-6} r={2.6} fill="#1e1e2e" />
          <circle cx={10} cy={-6} r={2.6} fill="#1e1e2e" />
          <ellipse cx={0} cy={9} rx={5} ry={4} fill={dark} />
        </g>
      );
    case "cat":
      return (
        <g>
          <polygon points="-27,-10 -22,-36 -6,-22" fill={color} stroke={dark} strokeWidth={3} strokeLinejoin="round" />
          <polygon points="27,-10 22,-36 6,-22" fill={color} stroke={dark} strokeWidth={3} strokeLinejoin="round" />
          <ellipse cx={0} cy={2} rx={30} ry={27} fill={color} stroke={dark} strokeWidth={3} />
          <ellipse cx={-10} cy={-3} rx={4} ry={6} fill="#1e1e2e" />
          <ellipse cx={10} cy={-3} rx={4} ry={6} fill="#1e1e2e" />
          <path d="M-3 7 L3 7 L0 11 Z" fill={dark} />
          <path d="M0 11 Q-5 17 -9 13 M0 11 Q5 17 9 13" stroke="#1e1e2e" strokeWidth={2} fill="none" strokeLinecap="round" />
          <path d="M-14 8 L-34 4 M-14 12 L-33 14 M14 8 L34 4 M14 12 L33 14" stroke="#1e1e2e" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      );
    case "blob":
      return (
        <g>
          <path
            d="M-4 -32 C 14 -36 30 -22 30 -4 C 32 14 22 30 2 30 C -18 32 -32 20 -30 2 C -34 -14 -22 -30 -4 -32 Z"
            fill={color}
            stroke={dark}
            strokeWidth={3}
          />
          <circle cx={-10} cy={-6} r={8} fill="#ffffff" stroke={dark} strokeWidth={1.5} />
          <circle cx={11} cy={-8} r={6} fill="#ffffff" stroke={dark} strokeWidth={1.5} />
          <circle cx={-8} cy={-4} r={3.5} fill="#1e1e2e" />
          <circle cx={12} cy={-6} r={2.8} fill="#1e1e2e" />
          <path d="M-8 12 Q2 18 10 10" stroke={dark} strokeWidth={3.5} strokeLinecap="round" fill="none" />
        </g>
      );
    case "bolt":
      return <polygon points="6,-36 -22,6 -2,6 -8,36 22,-8 2,-8" fill={color} stroke={dark} strokeWidth={3} strokeLinejoin="round" />;
    default:
      return <circle r={20} fill={color} />;
  }
}
