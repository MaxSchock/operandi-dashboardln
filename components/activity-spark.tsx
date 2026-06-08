"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ActivitySpark({ data }: { data: { day: string; count: number }[] }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
          <defs>
            <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1C68FA" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#1C68FA" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" stroke="#cbd5e1" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis stroke="#cbd5e1" fontSize={10} tickLine={false} axisLine={false} width={20} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#64748b" }}
          />
          <Area dataKey="count" stroke="#1C68FA" strokeWidth={2} fill="url(#actGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
