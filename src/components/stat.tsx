import { formatNumber, formatFullNumber } from "@/lib/utils";

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | null | undefined;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase tracking-[0.18em] text-white/40">
        {label}
      </div>
      <div
        className="display text-4xl md:text-5xl text-white"
        title={formatFullNumber(value)}
      >
        {formatNumber(value)}
      </div>
      {sub ? <div className="text-xs text-white/40">{sub}</div> : null}
    </div>
  );
}
