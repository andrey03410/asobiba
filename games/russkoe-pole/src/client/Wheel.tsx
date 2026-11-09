import { memo, useEffect, useId, useRef } from "react";
import type { SpinInfo } from "../game";
import type { Sector } from "../rules";
import type { ResolvedVisual, ThemeId } from "../visual";

/** Wheel geometry in SVG units. The frame is fixed, the rotor turns. */
export const WHEEL = {
  width: 552,
  height: 456,
  cx: 222,
  cy: 228,
  frameOuter: 214,
  frameInner: 193,
  lamps: 203,
  disk: 187,
  pegs: 179,
  hub: 52,
  lens: { cx: 476, cy: 96, r: 66, focusY: 70, zoom: 2.05 },
} as const;

const SPIN_TURNS = 5;

interface Metal {
  hi: string;
  mid: string;
  low: string;
  deep: string;
  lamp: string;
  lampCore: string;
  hubFace: string;
  hubInk: string;
}

const METALS: Record<ThemeId, Metal> = {
  studio: { hi: "#fff1b8", mid: "#e2b54d", low: "#a8741f", deep: "#5d3a0c", lamp: "#ffcf5a", lampCore: "#fffbe6", hubFace: "#2a1a10", hubInk: "#f4d27c" },
  neon: { hi: "#f6d9ff", mid: "#c37cff", low: "#6a35c8", deep: "#2b145a", lamp: "#4dfff0", lampCore: "#eafffd", hubFace: "#120c26", hubInk: "#7ef9ff" },
  paper: { hi: "#fbf6ea", mid: "#c9b896", low: "#8c7650", deep: "#4a3b22", lamp: "#e15b3c", lampCore: "#fff3e6", hubFace: "#f3ead7", hubInk: "#3a2a17" },
};

export function sectorFill(look: ResolvedVisual, index: number, sector: Sector | undefined): string {
  if (sector?.color) return sector.color;
  if (sector?.type === "bankrupt") return look.theme === "paper" ? "#2a2420" : "#141118";
  if (sector?.type === "zero") return look.theme === "neon" ? "#e9ecff" : "#f1eadb";
  return look.palette[index % look.palette.length] ?? "#888888";
}

/** Short text on the sector itself. */
export function wheelLabel(sector: Sector): string {
  if (sector.label) return sector.label.toLocaleUpperCase("ru-RU");
  switch (sector.type) {
    case "points":
      return String(sector.value);
    case "bankrupt":
      return "БАНКРОТ";
    case "zero":
      return "0";
    case "multiplier":
      return `×${sector.k}`;
    case "plus":
      return "+";
    case "prize":
      return "ПРИЗ";
    case "chance":
      return "ШАНС";
    case "roulette":
      return "РУЛЕТКА";
    case "math":
      return "СЧЁТ";
    case "steal":
      return "КРАЖА";
    case "swap":
      return "ОБМЕН";
    case "hint":
      return "ПОДСКАЗКА";
  }
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return false;
  const v = Number.parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 168;
}

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [WHEEL.cx + Math.cos(a) * r, WHEEL.cy + Math.sin(a) * r];
}

function slice(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  if (r0 <= 0) return `M ${WHEEL.cx} ${WHEEL.cy} L ${x0} ${y0} A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1} Z`;
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M ${x0} ${y0} A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

/** Same pseudo-random value on every client for one spin: the stop is not always dead centre. */
export function spinJitter(startedAt: number, sweep: number): number {
  const x = Math.sin(startedAt * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * sweep * 0.62;
}

/** Rotor angle (degrees, clockwise) that puts `sector` under the pointer. */
export function restAngle(sector: number, count: number, startedAt: number): number {
  const sweep = 360 / count;
  const raw = -(sector + 0.5) * sweep + spinJitter(startedAt, sweep);
  return ((raw % 360) + 360) % 360;
}

function easeSpin(t: number): number {
  const p = Math.min(1, Math.max(0, t));
  return 1 - (1 - p) ** 3.2;
}

interface ArtProps {
  ids: string;
  wheel: Sector[];
  look: ResolvedVisual;
  centerUrl?: string;
  /** Server previews have no fonts: skip text. */
  text: boolean;
  /** Fixed rotor angle for static renders. The live wheel moves the rotor itself. */
  rotorAngle?: number;
}

/** Defs, frame and rotor. Static: React never touches it while the wheel turns. */
export const WheelArt = memo(function WheelArt({ ids, wheel, look, centerUrl, text, rotorAngle }: ArtProps) {
  const metal = METALS[look.theme];
  const n = Math.max(1, wheel.length);
  const sweep = 360 / n;
  const lampCount = n >= 28 ? n : n >= 14 ? n * 2 : Math.max(24, n * 3);
  const labelSpace = WHEEL.disk - WHEEL.hub - 26;
  const arcAtLabel = (2 * Math.PI * (WHEEL.disk - 46)) / n;
  return (
    <>
      <defs>
        <linearGradient id={`${ids}-brass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={metal.hi} />
          <stop offset="0.28" stopColor={metal.mid} />
          <stop offset="0.52" stopColor={metal.low} />
          <stop offset="0.74" stopColor={metal.mid} />
          <stop offset="1" stopColor={metal.deep} />
        </linearGradient>
        <linearGradient id={`${ids}-brass-soft`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={metal.deep} />
          <stop offset="0.5" stopColor={metal.mid} />
          <stop offset="1" stopColor={metal.hi} />
        </linearGradient>
        <radialGradient id={`${ids}-lamp`}>
          <stop offset="0" stopColor={metal.lampCore} />
          <stop offset="0.35" stopColor={metal.lamp} stopOpacity="0.95" />
          <stop offset="1" stopColor={metal.lamp} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${ids}-shade`} cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.disk} gradientUnits="userSpaceOnUse">
          <stop offset="0.25" stopColor="#000" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="0.9" stopColor="#000" stopOpacity="0.04" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </radialGradient>
        <radialGradient id={`${ids}-gloss`} cx="0.32" cy="0.22" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${ids}-peg`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={metal.hi} />
          <stop offset="1" stopColor={metal.deep} />
        </radialGradient>
        <radialGradient id={`${ids}-hub`} cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor={metal.hi} />
          <stop offset="0.6" stopColor={metal.mid} />
          <stop offset="1" stopColor={metal.deep} />
        </radialGradient>
        <radialGradient id={`${ids}-floor`}>
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${ids}-hubclip`}>
          <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.hub - 9} />
        </clipPath>
      </defs>

      <ellipse cx={WHEEL.cx} cy={WHEEL.cy + WHEEL.frameOuter - 6} rx={WHEEL.frameOuter * 0.92} ry={20} fill={`url(#${ids}-floor)`} />
      <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.frameOuter} fill={`url(#${ids}-brass)`} />
      <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.frameOuter - 3} fill="none" stroke={metal.hi} strokeOpacity="0.55" strokeWidth="1.5" />
      <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.frameInner + 4} fill={metal.deep} />
      <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.frameInner} fill={`url(#${ids}-brass-soft)`} />
      <g className="rp-lamps">
        {Array.from({ length: lampCount }, (_, i) => {
          const [x, y] = polar(WHEEL.lamps, (i * 360) / lampCount);
          return (
            <g key={i} className={`rp-lamp${i % 2 ? " is-odd" : ""}`} style={{ ["--i" as string]: i }}>
              <circle cx={x} cy={y} r={7.5} fill={`url(#${ids}-lamp)`} />
              <circle cx={x} cy={y} r={2.6} fill={metal.lampCore} />
            </g>
          );
        })}
      </g>
      <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.disk + 4} fill="#000" fillOpacity="0.55" />

      <g id={`${ids}-rotor`} className="rp-rotor" transform={rotorAngle === undefined ? undefined : `rotate(${rotorAngle} ${WHEEL.cx} ${WHEEL.cy})`}>
        {wheel.map((sector, index) => (
          <path key={index} d={slice(0, WHEEL.disk, index * sweep, (index + 1) * sweep)} fill={sectorFill(look, index, sector)} />
        ))}
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.disk} fill={`url(#${ids}-shade)`} />
        {wheel.map((_, index) => {
          const [x0, y0] = polar(WHEEL.hub, index * sweep);
          const [x1, y1] = polar(WHEEL.disk, index * sweep);
          return <line key={index} x1={x0} y1={y0} x2={x1} y2={y1} stroke={metal.mid} strokeWidth="1.8" strokeOpacity="0.9" />;
        })}
        {text &&
          wheel.map((sector, index) => {
            const label = wheelLabel(sector);
            const fill = sectorFill(look, index, sector);
            const ink = isLight(fill) ? "#2a1d10" : "#fffaf0";
            const glyph = label.length <= 2;
            const size = Math.max(9, Math.min(glyph ? 34 : 24, arcAtLabel * (glyph ? 0.78 : 0.6)));
            const natural = label.length * size * (glyph ? 0.62 : 0.6);
            const mid = (index + 0.5) * sweep;
            return (
              <g key={index} transform={`rotate(${mid - 90} ${WHEEL.cx} ${WHEEL.cy})`}>
                <text
                  x={WHEEL.cx + WHEEL.disk - 16}
                  y={WHEEL.cy}
                  textAnchor="end"
                  dominantBaseline="central"
                  fontSize={size}
                  fontWeight={900}
                  fill={ink}
                  stroke={ink === "#fffaf0" ? "rgba(0,0,0,.45)" : "rgba(255,255,255,.35)"}
                  strokeWidth={size > 16 ? 2 : 1}
                  paintOrder="stroke"
                  className="rp-sector-text"
                  {...(natural > labelSpace ? { textLength: labelSpace, lengthAdjust: "spacingAndGlyphs" } : {})}
                >
                  {label}
                </text>
              </g>
            );
          })}
        {wheel.map((_, index) => {
          const [x, y] = polar(WHEEL.pegs, index * sweep);
          return <circle key={index} cx={x} cy={y} r={3.6} fill={`url(#${ids}-peg)`} stroke={metal.deep} strokeWidth="0.8" />;
        })}
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.hub + 5} fill="#000" fillOpacity="0.35" />
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.hub} fill={`url(#${ids}-hub)`} />
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.hub - 8} fill={metal.hubFace} />
        {centerUrl ? (
          <image href={centerUrl} x={WHEEL.cx - WHEEL.hub + 9} y={WHEEL.cy - WHEEL.hub + 9} width={(WHEEL.hub - 9) * 2} height={(WHEEL.hub - 9) * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${ids}-hubclip)`} />
        ) : (
          <>
            {Array.from({ length: 12 }, (_, i) => {
              const [x, y] = polar(WHEEL.hub - 15, i * 30);
              return <circle key={i} cx={x} cy={y} r={1.8} fill={metal.hubInk} fillOpacity="0.8" />;
            })}
            {text ? (
              <text x={WHEEL.cx} y={WHEEL.cy + 1} textAnchor="middle" dominantBaseline="central" fontSize="26" fontWeight={900} fill={metal.hubInk} className="rp-hub-text">
                РП
              </text>
            ) : (
              <path d={`M ${WHEEL.cx} ${WHEEL.cy - 16} L ${WHEEL.cx + 5} ${WHEEL.cy - 5} L ${WHEEL.cx + 16} ${WHEEL.cy} L ${WHEEL.cx + 5} ${WHEEL.cy + 5} L ${WHEEL.cx} ${WHEEL.cy + 16} L ${WHEEL.cx - 5} ${WHEEL.cy + 5} L ${WHEEL.cx - 16} ${WHEEL.cy} L ${WHEEL.cx - 5} ${WHEEL.cy - 5} Z`} fill={metal.hubInk} />
            )}
          </>
        )}
      </g>

      <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.disk} fill={`url(#${ids}-gloss)`} pointerEvents="none" />
    </>
  );
});

function Pointer({ ids, look }: { ids: string; look: ResolvedVisual }) {
  const metal = METALS[look.theme];
  const { cx } = WHEEL;
  const top = WHEEL.cy - WHEEL.frameOuter - 2;
  return (
    <g className="rp-pointer">
      <path d={`M ${cx} ${top + 62} L ${cx - 15} ${top + 20} Q ${cx} ${top - 4} ${cx + 15} ${top + 20} Z`} fill={`url(#${ids}-brass)`} stroke={metal.deep} strokeWidth="1.5" />
      <path d={`M ${cx} ${top + 54} L ${cx - 7} ${top + 24} Q ${cx} ${top + 12} ${cx + 7} ${top + 24} Z`} fill="#fff" fillOpacity="0.28" />
      <circle cx={cx} cy={top + 16} r={6} fill="#d1342b" stroke={metal.deep} strokeWidth="1.2" />
      <circle cx={cx - 1.8} cy={top + 14} r={1.8} fill="#fff" fillOpacity="0.8" />
    </g>
  );
}

export function StaticWheel({ wheel, look, sector, startedAt, centerUrl }: { wheel: Sector[]; look: ResolvedVisual; sector: number | null; startedAt: number; centerUrl?: string }) {
  const ids = "rpw-static";
  // Server previews cannot run effects: the rotor angle goes into the markup.
  const angle = sector === null ? 0 : restAngle(sector, Math.max(1, wheel.length), startedAt);
  return (
    <g>
      <WheelArt ids={ids} wheel={wheel} look={look} centerUrl={centerUrl} text={false} rotorAngle={angle} />
      <Pointer ids={ids} look={look} />
    </g>
  );
}

interface WheelProps {
  wheel: Sector[];
  look: ResolvedVisual;
  spin: SpinInfo | null;
  clockOffset: number;
  centerUrl?: string;
  /** Called once when the current spin comes to rest on screen. */
  onSettled?: (startedAt: number) => void;
}

/** The live wheel. One requestAnimationFrame loop moves the rotor, the flapper and the lens. */
export function Wheel({ wheel, look, spin, clockOffset, centerUrl, onSettled }: WheelProps) {
  const ids = `rpw${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<SVGGElement | null>(null);
  const flapRef = useRef<SVGGElement>(null);
  const lensRef = useRef<SVGGElement>(null);
  const restRef = useRef<number | null>(null);
  const settledRef = useRef<number | null>(null);
  const settleCb = useRef(onSettled);
  settleCb.current = onSettled;
  const n = Math.max(1, wheel.length);
  const sweep = 360 / n;

  const spinRef = useRef(spin);
  spinRef.current = spin;
  const angleRef = useRef<number | null>(null);
  // The path of a spin is fixed once: a new clock offset (it comes with every
  // message) must not restart the animation from the current angle.
  const planRef = useRef<{ key: string; from: number; target: number } | null>(null);
  const offsetRef = useRef(clockOffset);
  offsetRef.current = clockOffset;
  const spinKey = spin ? `${spin.startedAt}:${spin.sector}:${spin.durationMs}:${spin.skipped ? 1 : 0}` : "";

  useEffect(() => {
    const spin = spinRef.current;
    const root = rootRef.current;
    const rotor = root?.querySelector<SVGGElement>(`#${ids}-rotor`) ?? null;
    rotorRef.current = rotor;
    const flap = flapRef.current;
    const lens = lensRef.current;
    if (!rotor || !root) return;
    const place = (angle: number, flapDeg: number, lensOn: number) => {
      angleRef.current = angle;
      rotor.setAttribute("transform", `rotate(${angle.toFixed(3)} ${WHEEL.cx} ${WHEEL.cy})`);
      flap?.setAttribute("transform", `rotate(${flapDeg.toFixed(2)} ${WHEEL.cx} ${WHEEL.cy - WHEEL.frameOuter + 14})`);
      if (lens) {
        lens.style.opacity = String(lensOn);
        lens.style.transform = `scale(${0.6 + 0.4 * lensOn})`;
      }
    };
    if (!spin) {
      place(restRef.current ?? 0, 0, 0);
      root.classList.remove("is-spinning");
      return;
    }
    const finalMod = restAngle(spin.sector, n, spin.startedAt);
    const planKey = `${spin.startedAt}:${spin.sector}:${n}`;
    if (planRef.current?.key !== planKey) {
      const start = angleRef.current ?? restRef.current ?? finalMod;
      const delta = (((finalMod - (start % 360)) % 360) + 360) % 360;
      planRef.current = { key: planKey, from: start, target: start + delta + 360 * SPIN_TURNS };
    }
    const { from, target } = planRef.current;
    const end = spin.startedAt + spin.durationMs;
    let frame = 0;
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      restRef.current = finalMod;
      place(finalMod, 0, 1);
      root.classList.remove("is-spinning");
      if (settledRef.current !== spin.startedAt) {
        settledRef.current = spin.startedAt;
        settleCb.current?.(spin.startedAt);
      }
    };
    if (spin.skipped || Date.now() + offsetRef.current >= end) {
      settle();
      return;
    }
    const tick = () => {
      const now = Date.now() + offsetRef.current;
      if (now >= end) {
        settle();
        return;
      }
      const t = Math.max(0, (now - spin.startedAt) / spin.durationMs);
      const angle = from + (target - from) * easeSpin(t);
      // The flapper bends while a peg passes under it.
      const local = (((-angle % sweep) + sweep) % sweep + sweep) % sweep;
      const dist = Math.min(local, sweep - local);
      const reach = Math.min(10, sweep * 0.45);
      const bend = dist < reach ? -22 * (1 - dist / reach) * Math.min(1, 0.35 + (1 - t) * 1.4) : 0;
      const remaining = end - now;
      const lensOn = remaining < 1700 ? Math.min(1, (1700 - remaining) / 350) : 0;
      place(angle, bend, lensOn);
      frame = requestAnimationFrame(tick);
    };
    root.classList.add("is-spinning");
    frame = requestAnimationFrame(tick);
    // Background tabs pause animation frames: still reveal the sector on time.
    const fallback = window.setTimeout(settle, Math.max(0, end - (Date.now() + offsetRef.current)) + 400);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [spinKey, n, sweep, ids]);

  const { lens } = WHEEL;
  const metal = METALS[look.theme];
  return (
    <div className="rp-wheel" ref={rootRef}>
      <svg viewBox={`0 0 ${WHEEL.width} ${WHEEL.height}`} role="img" aria-label="Барабан">
        <WheelArt ids={ids} wheel={wheel} look={look} centerUrl={centerUrl} text />
        <g ref={flapRef} id={`${ids}-flap`}>
          <Pointer ids={ids} look={look} />
        </g>
        <defs>
          <clipPath id={`${ids}-lensclip`}>
            <circle cx={lens.cx} cy={lens.cy} r={lens.r} />
          </clipPath>
          <radialGradient id={`${ids}-lensglass`} cx="0.3" cy="0.25" r="0.8">
            <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#000" stopOpacity="0.25" />
          </radialGradient>
        </defs>
        <g ref={lensRef} className="rp-lens" style={{ opacity: 0, transformOrigin: `${lens.cx}px ${lens.cy}px` }}>
          <line x1={WHEEL.cx + 16} y1={WHEEL.cy - WHEEL.frameOuter + 26} x2={lens.cx - lens.r * 0.72} y2={lens.cy + lens.r * 0.62} stroke={metal.mid} strokeWidth="5" strokeLinecap="round" />
          <circle cx={lens.cx} cy={lens.cy} r={lens.r + 9} fill={`url(#${ids}-brass)`} />
          <circle cx={lens.cx} cy={lens.cy} r={lens.r} fill="#0b0a10" />
          <g clipPath={`url(#${ids}-lensclip)`}>
            <g transform={`translate(${lens.cx} ${lens.cy}) scale(${lens.zoom}) translate(${-WHEEL.cx} ${-lens.focusY})`}>
              <use href={`#${ids}-rotor`} />
              <use href={`#${ids}-flap`} />
            </g>
          </g>
          <circle cx={lens.cx} cy={lens.cy} r={lens.r} fill={`url(#${ids}-lensglass)`} />
          <circle cx={lens.cx} cy={lens.cy} r={lens.r} fill="none" stroke={metal.deep} strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}
