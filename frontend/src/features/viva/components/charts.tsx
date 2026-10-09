import { useEffect, useRef, useState, type ReactNode } from "react";

/* Small dependency-free charts for the staff dashboard and the speech lab.
   Every chart animates in once and respects prefers-reduced-motion (styles/dashboard.css). */

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up to its value, then eases to new values. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(reducedMotion() ? value : 0);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const begin = from.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 750);
      const current = begin + (value - begin) * (1 - Math.pow(1 - t, 3));
      setShown(current);
      from.current = current;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <>
      {shown.toFixed(decimals)}
      {suffix}
    </>
  );
}

export type Slice = { label: string; value: number; color: string };

/** Donut chart with an optional label in the middle. */
export function Donut({ items, size = 168, thickness = 22, center }: { items: Slice[]; size?: number; thickness?: number; center?: ReactNode }) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="ch-donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="ch-track-stroke" strokeWidth={thickness} />
        {total > 0 &&
          items
            .filter((i) => i.value > 0)
            .map((i) => {
              const length = (i.value / total) * circumference;
              const arc = (
                <circle
                  key={i.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={i.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${Math.max(length - 1.5, 0.5)} ${circumference}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                >
                  <title>{`${i.label}: ${i.value}`}</title>
                </circle>
              );
              offset += length;
              return arc;
            })}
      </svg>
      {center && <div className="ch-donut-center">{center}</div>}
    </div>
  );
}

/** Legend rows for a donut: colour, label, count and share. */
export function Legend({ items }: { items: Slice[] }) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  return (
    <ul className="ch-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="ch-swatch" style={{ background: i.color }} />
          <span className="ch-legend-label">{i.label}</span>
          <strong>{i.value}</strong>
          <small>{total ? Math.round((100 * i.value) / total) : 0}%</small>
        </li>
      ))}
    </ul>
  );
}

/** Columns over time; each column holds one bar per series. */
export function Columns({
  items,
  series,
  height = 170,
}: {
  items: { label: string; title: string; values: number[] }[];
  series: { name: string; color: string }[];
  height?: number;
}) {
  const max = Math.max(1, ...items.flatMap((i) => i.values));
  return (
    <div className="ch-columns-wrap">
      <div className="ch-columns" style={{ height, gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item, k) => (
          <div className="ch-col" key={item.title} title={`${item.title}: ${series.map((s, j) => `${s.name} ${item.values[j] ?? 0}`).join(", ")}`}>
            <div className="ch-bars">
              {series.map((s, j) => (
                <span
                  key={s.name}
                  className={item.values[j] ? undefined : "is-zero"}
                  style={{
                    height: `${((item.values[j] ?? 0) / max) * 100}%`,
                    background: s.color,
                    animationDelay: `${k * 28}ms`,
                  }}
                />
              ))}
            </div>
            <small>{item.label}</small>
          </div>
        ))}
      </div>
      <div className="ch-series">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars with a label and value on each row. */
export function BarList({ items, max }: { items: { label: string; value: number; color: string; hint?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="ch-barlist">
      {items.map((i, k) => (
        <div className="ch-barrow" key={i.label} title={i.hint}>
          <div className="ch-barrow-head">
            <span>{i.label}</span>
            <strong>{i.value}</strong>
          </div>
          <div className="ch-track">
            <span style={{ width: `${(i.value / top) * 100}%`, background: i.color, animationDelay: `${k * 60}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Progress ring for a percentage. */
export function Ring({ value, size = 58, stroke = 6, color = "var(--ch-accent)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="ch-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="ch-track-stroke" strokeWidth={stroke} />
        {clamped > 0 && (
          <circle
            className="ch-ring-value"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {children && <div className="ch-ring-center">{children}</div>}
    </div>
  );
}

/** A value on a scale with the threshold marked; the flagged side is shaded. */
export function Meter({ value, threshold, direction, max }: { value: number | null | undefined; threshold: number; direction: "below" | "above"; max?: number }) {
  const top = max ?? (Math.max(value ?? 0, threshold) * 1.5 || 1);
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / top) * 100))}%`;
  const flagged = value != null && (direction === "below" ? value < threshold : value > threshold);
  return (
    <div className={`ch-meter ${flagged ? "is-flagged" : ""}`}>
      <div className="ch-meter-zone" style={direction === "below" ? { left: 0, width: pct(threshold) } : { left: pct(threshold), right: 0 }} />
      {value != null && <span className="ch-meter-fill" style={{ width: pct(value) }} />}
      <i className="ch-meter-mark" style={{ left: pct(threshold) }} />
    </div>
  );
}

/** Speech rate per 15-second window, with the threshold line and pauses as a heat strip. */
export function Timeline({
  windows,
  threshold,
}: {
  windows: { start: number; end: number; rate: number | null; pauses: number; fillers: number }[];
  threshold?: number;
}) {
  if (!windows.length) return null;
  const width = Math.max(windows.length * 22, 300);
  const top = Math.max(threshold ?? 0, ...windows.map((w) => w.rate ?? 0)) * 1.15 || 1;
  const maxPauses = Math.max(1, ...windows.map((w) => w.pauses));
  const barWidth = width / windows.length;
  const y = (v: number) => 110 - (v / top) * 100;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className="ch-timeline">
      <svg viewBox={`0 0 ${width} 140`} preserveAspectRatio="none" role="img" aria-label="Speech rate and pauses over time">
        {windows.map((w, k) => {
          const low = threshold != null && w.rate != null && w.rate < threshold;
          return (
            <g key={k}>
              {w.rate != null && (
                <rect
                  className={`ch-tl-bar ${low ? "is-low" : ""}`}
                  x={k * barWidth + 2}
                  y={y(w.rate)}
                  width={barWidth - 4}
                  height={110 - y(w.rate)}
                  rx={3}
                  style={{ animationDelay: `${k * 18}ms` }}
                >
                  <title>{`${clock(w.start)}–${clock(w.end)}: ${w.rate.toFixed(2)} syllables/s, ${w.pauses} pauses, ${w.fillers} fillers`}</title>
                </rect>
              )}
              <rect className="ch-tl-heat" x={k * barWidth + 2} y={120} width={barWidth - 4} height={14} rx={3} style={{ opacity: 0.12 + 0.88 * (w.pauses / maxPauses) }}>
                <title>{`${clock(w.start)}–${clock(w.end)}: ${w.pauses} pauses`}</title>
              </rect>
            </g>
          );
        })}
        {threshold != null && <line className="ch-tl-threshold" x1={0} x2={width} y1={y(threshold)} y2={y(threshold)} />}
      </svg>
      <div className="ch-tl-axis">
        <span>{clock(windows[0]!.start)}</span>
        <span>{clock(windows[windows.length - 1]!.end)}</span>
      </div>
    </div>
  );
}
