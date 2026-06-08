"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const LABELS: Record<string, string> = {
  pre_contact: "Pre-contact",
  engaged_post: "Engaged post",
  invited: "Invited",
  accepted: "Accepted",
  messaged: "Messaged",
  replied: "Replied",
  qualified: "Qualified",
};

export function FunnelChart({ data }: { data: { current_stage: string; count: number }[] }) {
  const chartData = data.map(d => ({ name: LABELS[d.current_stage] ?? d.current_stage, count: d.count }));
  return (
    <div className="mt-4 h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20, top: 10, bottom: 10 }}>
          <XAxis type="number" stroke="#94a3b8" fontSize={12} />
          <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={12} width={110} />
          <Tooltip cursor={{ fill: "rgba(28, 104, 250, 0.05)" }} />
          <Bar dataKey="count" fill="#1C68FA" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
