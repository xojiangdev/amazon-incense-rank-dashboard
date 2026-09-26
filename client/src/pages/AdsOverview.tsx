// 广告总览: 三站 ACTIVE 广告系列 30天日报(数据来自每日 refreshAdCampaigns 推送)
// 层级: 站点 → 产品类型 → 系列(红绿灯) → 广告组; 点击 ASIN 跳回主看板对应产品
import { Fragment, useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

const MARKETS = [
  { code: "US", flag: "🇺🇸 美国站", cur: "USD" },
  { code: "CA", flag: "🇨🇦 加拿大站", cur: "CAD" },
  { code: "JP", flag: "🇯🇵 日本站", cur: "JPY" },
] as const;

const CAT_CN: Record<string, string> = {
  incense_sticks: "线香类",
  incense_holder: "香插/香座类",
  incense_burner: "香炉类",
  essential_oil: "精油类",
  eye_mask: "眼罩类",
  other: "其他/未跟踪",
};

type Metrics = { cost: number; sales: number; orders: number; clicks: number; impressions: number };
type Camp = {
  marketplace: "US" | "CA" | "JP";
  campaignId: string;
  name: string;
  state: string;
  budget: string | null;
  asins: string[];
  endDate: string;
  yesterday: Metrics;
  d7: Metrics;
  d30: Metrics;
  acos7: number | null;
  acos30: number | null;
  acosPrev7: number | null;
  adGroups: Array<{ name: string; d7: Metrics; d30: Metrics }>;
};

function fmtAcos(v: number | null | undefined) {
  return v == null ? "—" : `${(v * 100).toFixed(0)}%`;
}

function lightOf(c: { d7: { cost: number; sales: number } ; acos7: number | null }) {
  if (c.d7.cost <= 0) return { label: "⚪无花费", cls: "bg-slate-100 text-slate-500" };
  if (c.d7.sales <= 0) return c.d7.cost > 30
    ? { label: "🔴花钱零单", cls: "bg-red-100 text-red-700" }
    : { label: "🟡零单低费", cls: "bg-amber-100 text-amber-800" };
  if (c.acos7 == null) return { label: "⚪", cls: "bg-slate-100 text-slate-500" };
  if (c.acos7 > 0.5) return { label: "🔴高ACOS", cls: "bg-red-100 text-red-700" };
  if (c.acos7 > 0.3) return { label: "🟡观察", cls: "bg-amber-100 text-amber-800" };
  return { label: "🟢健康", cls: "bg-emerald-100 text-emerald-800" };
}

export default function AdsOverview() {
  const [market, setMarket] = useState<"US" | "CA" | "JP">("US");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const campaignsQuery = trpc.dashboard.adCampaigns.useQuery({ marketplace: market });
  const listingsQuery = trpc.dashboard.listings.useQuery(undefined, { staleTime: 300_000 });

  const campaigns: Camp[] = (campaignsQuery.data ?? []) as unknown as Camp[];
  const asinCat = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of listingsQuery.data ?? []) m.set(l.asin, l.category);
    return m;
  }, [listingsQuery.data]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Camp[]>();
    for (const c of campaigns) {
      const cat = c.asins.map((a: string) => asinCat.get(a)).find(Boolean) ?? "other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(c);
    }
    for (const list of Array.from(groups.values())) list.sort((a, b) => b.d7.cost - a.d7.cost);
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [campaigns, asinCat]);

  const totals = useMemo(() => campaigns.reduce(
    (acc: { cost: number; sales: number; orders: number }, c: Camp) => ({ cost: acc.cost + c.d7.cost, sales: acc.sales + c.d7.sales, orders: acc.orders + c.d7.orders }),
    { cost: 0, sales: 0, orders: 0 }
  ), [campaigns]);

  const endDate = campaigns[0]?.endDate;
  const cur = MARKETS.find(m => m.code === market)!.cur;

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900 sm:text-xl">广告总览 · ACTIVE 系列监控</h1>
          <p className="text-xs text-slate-500">
            数据截至 {endDate ?? "—"} · 红线 ACOS&gt;50% 黄&gt;30% · 点击 ASIN 回主看板看关键词
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {MARKETS.map(m => (
            <button
              key={m.code}
              onClick={() => setMarket(m.code)}
              className={`rounded-md px-3 py-1.5 font-medium ${market === m.code ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {m.flag}
            </button>
          ))}
        </div>
      </div>

      {campaignsQuery.isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
      ) : !campaigns.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
          该站点没有推送过来的广告系列数据（无广告，或当日采集未完成）。
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm">
              <div className="text-slate-400">启用系列</div>
              <div className="text-lg font-bold text-slate-800">{campaigns.length}</div>
            </div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm">
              <div className="text-slate-400">7天花费 ({cur})</div>
              <div className="text-lg font-bold text-slate-800">{totals.cost.toFixed(0)}</div>
            </div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm">
              <div className="text-slate-400">7天广告销售 ({cur})</div>
              <div className="text-lg font-bold text-slate-800">{totals.sales.toFixed(0)}</div>
            </div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm">
              <div className="text-slate-400">7天整体 ACOS</div>
              <div className="text-lg font-bold text-slate-800">{fmtAcos(totals.sales > 0 ? totals.cost / totals.sales : null)}</div>
            </div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm">
              <div className="text-slate-400">7天广告单</div>
              <div className="text-lg font-bold text-slate-800">{totals.orders}</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">广告系列 / 广告组</th>
                  <th className="px-2 py-2 font-medium">投放ASIN</th>
                  <th className="px-2 py-2 text-right font-medium">预算</th>
                  <th className="px-2 py-2 text-right font-medium">昨日花费</th>
                  <th className="px-2 py-2 text-right font-medium">7天花费</th>
                  <th className="px-2 py-2 text-right font-medium">7天单</th>
                  <th className="px-2 py-2 text-right font-medium">7天ACOS</th>
                  <th className="px-2 py-2 text-right font-medium">30天ACOS</th>
                  <th className="px-2 py-2 text-right font-medium">环比</th>
                  <th className="px-2 py-2 font-medium">红绿灯</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map(([cat, list]) => (
                  <Fragment key={cat}>
                    <tr className="bg-blue-50/60">
                      <td colSpan={10} className="px-3 py-1.5 font-semibold text-slate-700">
                        ▸ {CAT_CN[cat] ?? cat}（{list.length} 个系列 · 7天花费 {list.reduce((s: number, c: Camp) => s + c.d7.cost, 0).toFixed(0)} {cur}）
                      </td>
                    </tr>
                    {list.map(c => {
                      const lg = lightOf(c);
                      const delta = c.acos7 != null && c.acosPrev7 != null ? c.acos7 - c.acosPrev7 : null;
                      const open = expanded.has(c.campaignId);
                      return (
                        <Fragment key={c.campaignId}>
                          <tr key={c.campaignId} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2">
                              <button className="text-left font-medium text-slate-800" onClick={() => toggle(c.campaignId)}>
                                {open ? "▾" : "▸"} {c.name}
                              </button>
                            </td>
                            <td className="px-2 py-2">
                              {c.asins.slice(0, 3).map((a: string) => (
                                <Link key={a} href={`/?asin=${a}`}>
                                  <span className="mr-1 font-mono text-[11px] text-blue-600 hover:underline">{a}</span>
                                </Link>
                              ))}
                              {c.asins.length > 3 && <span className="text-slate-400">+{c.asins.length - 3}</span>}
                            </td>
                            <td className="px-2 py-2 text-right font-mono">{c.budget ?? "—"}</td>
                            <td className="px-2 py-2 text-right font-mono">{c.yesterday.cost.toFixed(2)}</td>
                            <td className="px-2 py-2 text-right font-mono">{c.d7.cost.toFixed(2)}</td>
                            <td className="px-2 py-2 text-right font-mono">{c.d7.orders}</td>
                            <td className={`px-2 py-2 text-right font-mono font-semibold ${c.acos7 != null && c.acos7 > 0.5 ? "text-red-600" : c.acos7 != null && c.acos7 > 0.3 ? "text-amber-600" : "text-slate-700"}`}>
                              {fmtAcos(c.acos7)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-500">{fmtAcos(c.acos30)}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-500">
                              {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}pp`}
                            </td>
                            <td className="px-2 py-2">
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${lg.cls}`}>{lg.label}</span>
                            </td>
                          </tr>
                          {open && c.adGroups.map((g: Camp["adGroups"][number]) => (
                            <tr key={`${c.campaignId}-${g.name}`} className="border-t border-slate-50 bg-slate-50/50 text-[11px] text-slate-500">
                              <td className="px-3 py-1.5 pl-8">· {g.name}</td>
                              <td colSpan={4} />
                              <td className="px-2 py-1.5 text-right font-mono">{g.d7.orders}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{fmtAcos(g.d7.sales > 0 ? g.d7.cost / g.d7.sales : null)}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{fmtAcos(g.d30.sales > 0 ? g.d30.cost / g.d30.sales : null)}</td>
                              <td colSpan={2} />
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
