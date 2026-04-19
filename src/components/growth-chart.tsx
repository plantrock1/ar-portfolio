"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber } from "@/lib/utils";

type Point = {
  day: string;
  value: number | null;
};

export function GrowthChart({
  data,
  label,
  color = "#1db954",
}: {
  data: Point[];
  label: string;
  color?: string;
}) {
  const clean = data.filter((d) => d.value !== null) as {
    day: string;
    value: number;
  }[];
  if (clean.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-white/40">
        Not enough data yet — come back after a couple of daily refreshes.
      </div>
    );
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={clean} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`g-${label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            stroke="rgba(255,255,255,0.3)"
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={(v: number) => formatNumber(v)}
            width={45}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.1)" }}
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "rgba(255,255,255,0.6)" }}
            formatter={(v) => [formatNumber(Number(v)), label] as [string, string]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#g-${label})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
