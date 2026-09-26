// 广告矩阵总览: 行=产品(重点/新品/常规/长尾/停售/未跟踪), 列=广告类型(SP自动/关键词/商品/品类, SB, SBV, SD细分)
// 单元格=7天$花费·ACOS(0销=花钱没单); 点击单元格展开该类型的系列明细(含30天)
import { Fragment, useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

const MARKETS = [
  { code: "US", flag: "🇺🇸 美国站", cur: "USD" },
  { code: "CA", flag: "🇨🇦 加拿大站", cur: "CAD" },
  { code: "JP", flag: "🇯🇵 日本站", cur: "JPY" },
] as const;

const BUCKETS = [
  { key: "auto", cn: "SP·自动" },
  { key: "keyword", cn: "SP·关键词" },
  { key: "product", cn: "SP·商品定向" },
  { key: "category", cn: "SP·品类定向" },
  { key: "sb_brand", cn: "SB·品牌" },
  { key: "sbv_kw", cn: "SBV·关键词" },
  { key: "sbv_prod", cn: "SBV·商品" },
  { key: "sbv_cat", cn: "SBV·品类" },
  { key: "sbv_other", cn: "SBV·其他" },
  { key: "sd_views", cn: "SD·浏览人群" },
  { key: "sd_prod", cn: "SD·商品定向" },
  { key: "sd_cat", cn: "SD·品类" },
] as const;

type Metrics = { cost: number; sales: number; orders: number; clicks: number; impressions: number };
type Camp = {
  campaignId: string; name: string; state: string; budget: string | null;
  bucket: string | null; asins: string[]; endDate: string;
  d7: Metrics; d30: Metrics; acos7: number | null; acos30: number | null; acosPrev7: number | null;
  adGroups: Array<{ name: string; d7: Metrics; d30: Metrics }>;
};
type Listing = { id: number; asin: string; title: string; marketplace: string; salesCategory: string | null; fbaStock: number | null; inventoryStatus: string | null };

const GROUPS = ["重点产品", "新品", "常规产品", "长尾产品", "停售(DISCONTINUED)", "未跟踪"];
const GROUP_BADGE: Record<string, string> = {
  重点产品: "bg-amber-100 text-amber-800", 新品: "bg-sky-100 text-sky-700", 常规产品: "bg-slate-100 text-slate-600",
  长尾产品: "bg-slate-100 text-slate-500", "停售(DISCONTINUED)": "bg-zinc-200 text-zinc-500", 未跟踪: "bg-rose-50 text-rose-400",
};

function shortTitle(title: string) {
  const drop = ["AFENGAU", "Seedlink", "Yinjiyue", "Natural"];
  let t = title.replace(/[|(,【】]/g, " ");
  for (const d of drop) t = t.replace(new RegExp(d, "i"), " ");
  const words = t.split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  for (const w of words) {
    if (/^\d/.test(w)) break;
    keep.push(w);
    if (keep.length >= 6) break;
  }
  return (keep.join(" ") || title).slice(0, 42);
}

function pct(v: number | null | undefined) {
  return v == null ? "—" : `${(v * 100).toFixed(0)}%`;
}
function lightOf(cost: number, sales: number, acos: number | null) {
  if (cost <= 0) return "gray";
  if (sales <= 0) return cost > 30 ? "red" : "yellow";
  if (acos == null) return "gray";
  if (acos > 0.5) return "red";
  if (acos > 0.3) return "yellow";
  return "green";
}
const CHIP: Record<string, string> = {
  red: "bg-red-100 text-red-700 border-red-200", yellow: "bg-amber-100 text-amber-800 border-amber-200",
  green: "bg-emerald-100 text-emerald-800 border-emerald-200", gray: "bg-slate-100 text-slate-400 border-slate-200",
};

export default function AdsOverview() {
  const [market, setMarket] = useState<"US" | "CA" | "JP">("US");
  const [openCell, setOpenCell] = useState<string | null>(null); // `${asin}:${bucket}`
  const campaignsQuery = trpc.dashboard.adCampaigns.useQuery({ marketplace: market });
  const listingsQuery = trpc.dashboard.listings.useQuery(undefined, { staleTime: 300_000 });

  const campaigns = (campaignsQuery.data ?? []) as unknown as Camp[];
  const listings = useMemo(() => (listingsQuery.data ?? []) as unknown as Listing[], [listingsQuery.data]);

  const rows = useMemo(() => {
    const metaByAsin = new Map(listings.filter(l => l.marketplace === market).map(l => [l.asin, l]));
    const per = new Map<string, { camps: Camp[]; cost: number; sales: number; orders: number }>();
    const add = (asin: string, c: Camp, share: number) => {
      const e = per.get(asin) ?? { camps: [], cost: 0, sales: 0, orders: 0 };
      e.camps.push(c);
      e.cost += c.d7.cost / share;
      e.sales += c.d7.sales / share;
      e.orders += c.d7.orders / share;
      per.set(asin, e);
    };
    for (const c of campaigns) {
      const share = Math.max(1, c.asins.length);
      for (const a of c.asins) add(a, c, share);
    }
    // 网站在售产品全列出(无广告也显示)
    for (const a of Array.from(metaByAsin.keys())) if (!per.has(a)) per.set(a, { camps: [], cost: 0, sales: 0, orders: 0 });

    const groupOf = (asin: string) => {
      const m0 = metaByAsin.get(asin);
      if (!m0) return "未跟踪";
      if (m0.salesCategory === "discontinued") return "停售(DISCONTINUED)";
      if ((m0.fbaStock ?? 0) <= 0 || (m0.inventoryStatus && m0.inventoryStatus !== "Active")) return "停售(DISCONTINUED)";
      return ({ key_product: "重点产品", new_product: "新品", long_tail: "长尾产品", regular: "常规产品" } as Record<string, string>)[m0.salesCategory ?? ""] ?? "常规产品";
    };
    const grouped: Record<string, Array<{ asin: string; camps: Camp[]; cost: number; sales: number; orders: number; title: string }>> = {};
    for (const [asin, e] of Array.from(per.entries())) {
      const g = groupOf(asin);
      (grouped[g] ??= []).push({ asin, camps: e.camps, cost: e.cost, sales: e.sales, orders: e.orders, title: metaByAsin.get(asin)?.title ?? asin });
    }
    for (const g of Object.keys(grouped)) grouped[g].sort((a, b) => b.cost - a.cost);
    return grouped;
  }, [campaigns, listings, market]);

  const cur = MARKETS.find(m => m.code === market)!.cur;
  const totals = campaigns.reduce((acc, c) => ({ cost: acc.cost + c.d7.cost, sales: acc.sales + c.d7.sales, orders: acc.orders + c.d7.orders }), { cost: 0, sales: 0, orders: 0 });

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900 sm:text-xl">广告矩阵总览</h1>
          <p className="text-xs text-slate-500">
            单元格 = 该产品×该类型 7天合计（$花费·ACOS%，<span className="text-amber-600">0销=花钱没单</span>）· 红&gt;50% 黄30-50% · 点击单元格展开系列明细
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {MARKETS.map(m => (
            <button key={m.code} onClick={() => { setMarket(m.code); setOpenCell(null); }}
              className={`rounded-md px-3 py-1.5 font-medium ${market === m.code ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {m.flag}
            </button>
          ))}
        </div>
      </div>

      {campaignsQuery.isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm"><div className="text-slate-400">系列数</div><div className="text-lg font-bold text-slate-800">{campaigns.length}</div></div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm"><div className="text-slate-400">7天花费 ({cur})</div><div className="text-lg font-bold text-slate-800">{totals.cost.toFixed(0)}</div></div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm"><div className="text-slate-400">7天广告销售</div><div className="text-lg font-bold text-slate-800">{totals.sales.toFixed(0)}</div></div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm"><div className="text-slate-400">7天整体ACOS</div><div className="text-lg font-bold text-slate-800">{pct(totals.sales > 0 ? totals.cost / totals.sales : null)}</div></div>
            <div className="rounded-lg bg-white px-4 py-2 shadow-sm"><div className="text-slate-400">7天广告单</div><div className="text-lg font-bold text-slate-800">{totals.orders}</div></div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[1100px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr>
                  <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 font-medium">产品</th>
                  <th className="px-2 py-2 text-right font-medium">7天花费</th>
                  <th className="px-2 py-2 text-right font-medium">ACOS</th>
                  <th className="px-2 py-2 text-right font-medium">单</th>
                  {BUCKETS.map(b => <th key={b.key} className="px-2 py-2 text-center font-medium whitespace-nowrap">{b.cn}</th>)}
                </tr>
              </thead>
              <tbody>
                {GROUPS.filter(g => rows[g]?.length).map(g => (
                  <Fragment key={g}>
                    <tr className="bg-blue-50/60">
                      <td colSpan={3 + BUCKETS.length} className="px-3 py-1.5 font-semibold text-slate-700">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] mr-1 ${GROUP_BADGE[g] ?? ""}`}>{g}</span>
                        {rows[g].length} 个产品 · 7天花费 {rows[g].reduce((s, r) => s + r.cost, 0).toFixed(0)} {cur}
                      </td>
                    </tr>
                    {rows[g].map(r => {
                      const acos = r.sales > 0 ? r.cost / r.sales : null;
                      const lg = r.camps.length === 0 ? "gray" : lightOf(r.cost, r.sales, acos);
                      return (
                        <Fragment key={r.asin}>
                          <tr className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="sticky left-0 z-10 bg-white px-3 py-2">
                              <div className="flex flex-col">
                                <span className="max-w-[220px] truncate font-medium text-slate-800" title={r.title}>{shortTitle(r.title)}</span>
                                <Link href={`/?asin=${r.asin}`} className="font-mono text-[10px] text-blue-600 hover:underline">{r.asin} ↗</Link>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${CHIP[lg]}`}>{r.cost.toFixed(1)}</span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${CHIP[lg]}`}>{pct(acos)}</span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${CHIP[lg]}`}>{r.orders.toFixed(1)}</span>
                            </td>
                            {BUCKETS.map(b => {
                              const camps = r.camps.filter(c => (c.bucket ?? "auto") === b.key);
                              const cost = camps.reduce((s, c) => s + c.d7.cost / Math.max(1, c.asins.length), 0);
                              const sales = camps.reduce((s, c) => s + c.d7.sales / Math.max(1, c.asins.length), 0);
                              const ba = sales > 0 ? cost / sales : null;
                              const bl = lightOf(cost, sales, ba);
                              const key = `${r.asin}:${b.key}`;
                              const open = openCell === key;
                              return (
                                <td key={b.key} className="px-1.5 py-2 text-center">
                                  {camps.length === 0 ? (
                                    <span className="text-slate-300">—</span>
                                  ) : (
                                    <button onClick={() => setOpenCell(open ? null : key)}
                                      className={`rounded border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${CHIP[bl]} ${open ? "ring-2 ring-blue-400" : ""}`}>
                                      {cost > 0 ? `$${cost.toFixed(0)}·${ba != null ? pct(ba) : "0销"}` : "0·—"}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                          {openCell && openCell.startsWith(r.asin + ":") && r.camps.filter(c => (c.bucket ?? "auto") === openCell.split(":")[1]).map(c => {
                            const delta = c.acos7 != null && c.acosPrev7 != null ? c.acos7 - c.acosPrev7 : null;
                            const ca = c.acos7;
                            const cl = ca == null ? "text-slate-500" : ca > 0.5 ? "text-red-600 font-semibold" : ca > 0.3 ? "text-amber-600 font-semibold" : "text-emerald-700 font-semibold";
                            return (
                              <tr key={c.campaignId + openCell} className="border-t border-slate-50 bg-slate-50/60 text-[11px]">
                                <td className="px-3 py-1.5 pl-8 text-slate-600" colSpan={3}>
                                  <span className="mr-1">{c.state !== "ENABLED" ? `(${c.state})` : ""}</span>
                                  <span className="font-medium">{c.name}</span>
                                  {c.budget != null && <span className="ml-1 text-slate-400">预算{c.budget}</span>}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono">${c.d7.cost.toFixed(1)}</td>
                                <td className={`px-2 py-1.5 text-right font-mono ${cl}`}>{pct(ca)}</td>
                                <td className="px-2 py-1.5 text-right font-mono text-slate-500">{c.d7.orders}单</td>
                                <td className="px-2 py-1.5 text-slate-500" colSpan={BUCKETS.length - 1}>
                                  30天 ${c.d30.cost.toFixed(1)}·{pct(c.acos30)} {c.d30.orders}单
                                  {delta != null && <span className={delta >= 0 ? "ml-2 text-rose-500" : "ml-2 text-emerald-600"}>{delta >= 0 ? "+" : ""}{(delta * 100).toFixed(0)}pp</span>}
                                </td>
                              </tr>
                            );
                          })}
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
