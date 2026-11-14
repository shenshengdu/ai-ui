/**
 * 简单折线图（SVG，无依赖）：净值 / 回撤。x 轴按日期，悬停显示当天各条线的值。
 */
import { useEffect, useMemo, useRef, useState } from "react";

export type Series = { name: string; color: string; points: [string, number][]; dashed?: boolean; area?: boolean };

type Props = {
  series: Series[];
  height?: number;
  log?: boolean;
  fmt?: (v: number) => string;
  baseline?: number; // 画一条水平参考线（净值 1、回撤 0）
};

const PAD = { l: 44, r: 8, t: 8, b: 20 };

function ts(d: string) {
  return Date.parse(d + "T00:00:00Z");
}

export function LineChart({ series, height = 260, log = false, fmt = (v) => v.toFixed(2), baseline }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800); // 按容器实际宽度画，字不会被拉伸
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(240, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const H = height;
  const data = useMemo(() => series.filter((s) => s.points.length > 1), [series]);
  const geo = useMemo(() => {
    if (!data.length) return null;
    const xs = data.flatMap((s) => s.points.map((p) => ts(p[0])));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const tf = (v: number) => (log ? Math.log(Math.max(v, 1e-6)) : v);
    let ys = data.flatMap((s) => s.points.map((p) => tf(p[1])));
    if (baseline !== undefined) ys = ys.concat(tf(baseline));
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    if (y1 - y0 < 1e-9) {
      y0 -= 1;
      y1 += 1;
    }
    const pad = (y1 - y0) * 0.05;
    y0 -= pad;
    y1 += pad;
    const sx = (t: number) => PAD.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (v: number) => PAD.t + (1 - (tf(v) - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
    // y 轴刻度：5 条（对数轴按原值等比）
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const t = y0 + ((y1 - y0) * i) / 4;
      return log ? Math.exp(t) : t;
    });
    // x 轴：年份
    const years: number[] = [];
    const ya = new Date(x0).getUTCFullYear();
    const yb = new Date(x1).getUTCFullYear();
    const step = Math.max(1, Math.ceil((yb - ya + 1) / Math.max(2, Math.floor(W / 70))));
    for (let y = ya + 1; y <= yb; y += step) years.push(y);
    return { x0, x1, sx, sy, ticks, years };
  }, [data, log, baseline, H, W]);

  if (!geo)
    return (
      <div ref={box} className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        —
      </div>
    );
  const { sx, sy, ticks, years } = geo;
  const main = data[0].points;
  const hp = hover !== null ? main[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const x = ((cx - rect.left) / rect.width) * W;
    let lo = 0;
    let hi = main.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sx(ts(main[mid][0])) < x) lo = mid;
      else hi = mid;
    }
    const pick = Math.abs(sx(ts(main[lo][0])) - x) < Math.abs(sx(ts(main[hi][0])) - x) ? lo : hi;
    setHover(pick);
  };

  const valueAt = (s: Series, d: string) => {
    // 同一天或之前最近的一个点
    let best: number | null = null;
    for (const [pd, v] of s.points) {
      if (pd > d) break;
      best = v;
    }
    return best;
  };

  return (
    <div ref={box} className="relative w-full">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchMove={onMove}
        onTouchEnd={() => setHover(null)}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.l - 4} y={sy(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
              {fmt(v)}
            </text>
          </g>
        ))}
        {years.map((y) => {
          const x = sx(Date.UTC(y, 0, 1));
          return (
            <text key={y} x={x} y={H - 5} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
              {y}
            </text>
          );
        })}
        {baseline !== undefined && (
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(baseline)} y2={sy(baseline)} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {[...data].reverse().map((s) => {
          const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(ts(p[0])).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
          return (
            <g key={s.name}>
              {s.area && baseline !== undefined && (
                <path
                  d={`${d}L${sx(ts(s.points[s.points.length - 1][0])).toFixed(1)},${sy(baseline)}L${sx(ts(s.points[0][0])).toFixed(1)},${sy(baseline)}Z`}
                  fill={s.color}
                  opacity={0.15}
                />
              )}
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray={s.dashed ? "4 3" : undefined} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {hp && (
          <line x1={sx(ts(hp[0]))} x2={sx(ts(hp[0]))} y1={PAD.t} y2={H - PAD.b} className="stroke-muted-foreground" strokeWidth={1} />
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
          style={{
            left: `${(sx(ts(hp[0])) / W) * 100}%`,
            transform: sx(ts(hp[0])) > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
          }}
        >
          <div className="font-medium tabular-nums">{hp[0]}</div>
          {data.map((s) => {
            const v = valueAt(s, hp[0]);
            return (
              <div key={s.name} className="flex items-center gap-1.5 tabular-nums">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="ml-auto pl-2">{v === null ? "—" : fmt(v)}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-3 px-1 text-xs text-muted-foreground">
        {data.map((s) => (
          <span key={s.name} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
