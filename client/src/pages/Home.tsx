import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildDateWindow, chartRank, dateKeyInTimeZone } from "@shared/rankTrend";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Flame,
  Globe2,
  GripVertical,
  Layers,
  Minus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Tags,
  TrendingDown,
  TrendingUp,
  UserCheck,
} from "lucide-react";

type Marketplace = "US" | "CA" | "JP";
type MarketplaceFilter = Marketplace | "ALL";
type SalesCategory = "unclassified" | "new_product" | "key_product" | "long_tail" | "regular" | "discontinued" | "custom";
type DesktopAdFilter = "all" | "has_any" | "ad_only" | "sbv_only" | "not_found";
type KeywordSelectionBasis = "sqp_purchase" | "sqp_cart" | "sqp_click" | "title_fallback" | "manual_review";

const SALES_CATEGORY_CONFIG: Record<SalesCategory, { label: string; className: string }> = {
  unclassified: { label: "未分类", className: "bg-slate-100 text-slate-600 border-slate-200" },
  new_product: { label: "新品", className: "bg-sky-100 text-sky-700 border-sky-200" },
  key_product: { label: "重点产品", className: "bg-amber-100 text-amber-800 border-amber-200" },
  long_tail: { label: "长尾产品", className: "bg-violet-100 text-violet-700 border-violet-200" },
  regular: { label: "常规产品", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  discontinued: { label: "DISCONTINUED", className: "bg-rose-100 text-rose-700 border-rose-200" },
  custom: { label: "自定义", className: "bg-cyan-100 text-cyan-700 border-cyan-200" },
};

const SALES_CATEGORY_CARD_CLASS: Record<SalesCategory, string> = {
  unclassified: "border-l-slate-300",
  new_product: "border-l-sky-500 bg-sky-50/25",
  key_product: "border-l-amber-500 bg-amber-50/35",
  long_tail: "border-l-violet-500 bg-violet-50/25",
  regular: "border-l-emerald-500 bg-emerald-50/20",
  discontinued: "border-l-rose-500 bg-rose-50/40",
  custom: "border-l-cyan-500 bg-cyan-50/25",
};

function salesCategoryLabel(category: SalesCategory, customLabel?: string | null) {
  return category === "custom" && customLabel ? customLabel : SALES_CATEGORY_CONFIG[category].label;
}

const marketplaceLabel = (marketplace: Marketplace) =>
  marketplace === "US" ? "🇺🇸 美国站" : marketplace === "CA" ? "🇨🇦 加拿大站" : "🇯🇵 日本站";

function KeywordRankSparkline({ ranks }: { ranks: Array<number | null> }) {
  const normalized = ranks.map(rank => (rank === null ? null : chartRank(rank)));
  const observed = normalized.filter((rank): rank is number => rank !== null);
  const first = observed[0];
  const last = observed.at(-1);
  const color = first !== undefined && last !== undefined && last < first
    ? "#059669"
    : first !== undefined && last !== undefined && last > first
    ? "#e11d48"
    : "#2563eb";
  const width = 96;
  const height = 28;
  const padding = 3;
  const step = width / Math.max(ranks.length - 1, 1);
  const pointAt = (rank: number, index: number) => {
    const x = Number((index * step).toFixed(1));
    const y = Number((padding + ((rank - 1) / 60) * (height - padding * 2)).toFixed(1));
    return { x, y };
  };
  const segments: string[][] = [];
  let segment: string[] = [];
  normalized.forEach((rank, index) => {
    if (rank === null) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    const point = pointAt(rank, index);
    segment.push(`${point.x},${point.y}`);
  });
  if (segment.length) segments.push(segment);

  if (!observed.length) return <span className="text-[10px] text-slate-400">待积累</span>;

  return (
    <div className="group inline-flex min-w-[112px] items-center gap-1" title={`最近 7 天已采集 ${observed.length}/7 天；排名越低越好，60+ 表示未进前三页`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-24 overflow-visible" role="img" aria-label={`最近 7 天自然位趋势，已有 ${observed.length} 天真实快照`}>
        <line x1="0" x2={width} y1={height - padding} y2={height - padding} stroke="#e2e8f0" strokeDasharray="2 2" />
        {segments.map((points, index) => points.length > 1 ? (
          <polyline key={`line-${index}`} points={points.join(" ")} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : null)}
        {normalized.map((rank, index) => rank === null ? null : (() => {
          const point = pointAt(rank, index);
          return <circle key={`dot-${index}`} cx={point.x} cy={point.y} r="2.3" fill="white" stroke={color} strokeWidth="1.5" />;
        })())}
      </svg>
      <span className="font-mono text-[10px] text-slate-400">{observed.length}/7</span>
    </div>
  );
}

function hasDesktopPlacement(rank: number | null | undefined) {
  return typeof rank === "number" && rank > 0 && rank < 999;
}

function isDesktopFirstPage(rank: number | null | undefined) {
  // DataForSEO rank_absolute is the desktop SERP order; the first 48 result slots are treated as page one.
  return typeof rank === "number" && rank > 0 && rank < 999 && rank <= 48;
}

function hasRepositoryCpr(keyword: { cprSource?: string | null; cprEstimate?: number | null }) {
  return Boolean(keyword.cprSource?.startsWith("github_cpr_json:") && keyword.cprEstimate !== null && keyword.cprEstimate !== undefined);
}

function keywordEvidencePresentation(basis: KeywordSelectionBasis) {
  if (basis === "sqp_purchase") return { label: "SQP购买", className: "border-emerald-200 bg-emerald-50 text-emerald-700", title: "SQP 已记录实际购买：可优先用于转化型广告" };
  if (basis === "sqp_cart") return { label: "SQP加购", className: "border-amber-200 bg-amber-50 text-amber-700", title: "SQP 已记录加购但未形成购买：可作为高意图测试词" };
  if (basis === "sqp_click") return { label: "SQP点击", className: "border-sky-200 bg-sky-50 text-sky-700", title: "SQP 有合格点击证据：需在广告中验证转化" };
  if (basis === "title_fallback") return { label: "待验证", className: "border-slate-200 bg-slate-100 text-slate-600", title: "标题强相关补充词：没有SQP漏斗证据，不应直接视为高转化词" };
  return { label: "人工审核", className: "border-violet-200 bg-violet-50 text-violet-700", title: "需销售或广告人员确认的人工选词" };
}

export default function Home() {
  const [marketplace, setMarketplace] = useState<MarketplaceFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [salesCategoryFilter, setSalesCategoryFilter] = useState<SalesCategory | "all">("all");
  const [desktopAdFilter, setDesktopAdFilter] = useState<DesktopAdFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);

  // Quick Action States
  const [isFollowUpModalOpen, setIsFollowUpModalOpen] = useState(false);
  const [followUpStatus, setFollowUpStatus] = useState<"normal" | "watch" | "action_needed" | "optimizing">("action_needed");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [salesName, setSalesName] = useState("销售组");
  const [isOrganizationModalOpen, setIsOrganizationModalOpen] = useState(false);
  const [salesCategory, setSalesCategory] = useState<SalesCategory>("unclassified");
  const [customCategoryLabel, setCustomCategoryLabel] = useState("");
  const [salesNotes, setSalesNotes] = useState("");
  const [draggedListingId, setDraggedListingId] = useState<number | null>(null);
  const [dragOverListingId, setDragOverListingId] = useState<number | null>(null);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<number>>(() => new Set());
  const [isBulkOrganizationModalOpen, setIsBulkOrganizationModalOpen] = useState(false);
  const [bulkSalesCategory, setBulkSalesCategory] = useState<SalesCategory | "keep">("keep");
  const [bulkCustomCategoryLabel, setBulkCustomCategoryLabel] = useState("");
  const [bulkNotesAction, setBulkNotesAction] = useState<"keep" | "append" | "replace" | "clear">("keep");
  const [bulkSalesNotes, setBulkSalesNotes] = useState("");

  // Sync / Import Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newAsin, setNewAsin] = useState("");
  const [newMarketplace, setNewMarketplace] = useState<Marketplace>("US");
  const [newTitle, setNewTitle] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newFbaStock, setNewFbaStock] = useState("");

  const utils = trpc.useUtils();
  const listingsInput = useMemo(
    () => ({ marketplace: marketplace === "ALL" ? undefined : marketplace, category: categoryFilter }),
    [marketplace, categoryFilter]
  );

  const overviewQuery = trpc.dashboard.overview.useQuery(
    marketplace === "ALL" ? undefined : { marketplace }
  );

  const listingsQuery = trpc.dashboard.listings.useQuery(listingsInput);
  const cprSyncStatusQuery = trpc.dashboard.cprSyncStatus.useQuery();

  const refreshMutation = trpc.dashboard.triggerDailyRefresh.useMutation({
    onSuccess: (data) => {
      toast.success(`每日排名更新完毕！已追踪 ${data.listingsTracked} 个Listing，${data.keywordsUpdated} 个核心词`);
      utils.dashboard.invalidate();
    },
    onError: (err) => {
      toast.error(`更新失败: ${err.message}`);
    },
  });

  const updateFollowUpMutation = trpc.dashboard.updateFollowUp.useMutation({
    onSuccess: () => {
      toast.success("销售跟进状态已同步更新！");
      setIsFollowUpModalOpen(false);
      utils.dashboard.invalidate();
    },
  });

  const reorderListingsMutation = trpc.dashboard.reorderListings.useMutation({
    onMutate: async ({ orderedIds }) => {
      await utils.dashboard.listings.cancel(listingsInput);
      const previous = utils.dashboard.listings.getData(listingsInput);
      utils.dashboard.listings.setData(listingsInput, old => {
        if (!old) return old;
        const requestedSet = new Set(orderedIds);
        const byId = new Map(old.map(item => [item.id, item] as const));
        let cursor = 0;
        return old.map(item => {
          if (!requestedSet.has(item.id)) return item;
          const replacement = byId.get(orderedIds[cursor]);
          cursor += 1;
          return replacement ?? item;
        });
      });
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) utils.dashboard.listings.setData(listingsInput, context.previous);
      toast.error(`排序保存失败：${error.message}`);
    },
    onSuccess: () => toast.success("Listing 顺序已保存"),
    onSettled: () => utils.dashboard.listings.invalidate(listingsInput),
  });

  const updateOrganizationMutation = trpc.dashboard.updateListingOrganization.useMutation({
    onSuccess: () => {
      toast.success("产品分类和销售备注已保存");
      setIsOrganizationModalOpen(false);
      utils.dashboard.invalidate();
    },
    onError: error => toast.error(`保存失败：${error.message}`),
  });

  const bulkUpdateOrganizationMutation = trpc.dashboard.bulkUpdateListingOrganization.useMutation({
    onSuccess: data => {
      toast.success(`已批量更新 ${data.updated} 个 Listing`);
      setIsBulkOrganizationModalOpen(false);
      setSelectedListingIds(new Set());
      setBulkSalesCategory("keep");
      setBulkCustomCategoryLabel("");
      setBulkNotesAction("keep");
      setBulkSalesNotes("");
      utils.dashboard.invalidate();
    },
    onError: error => toast.error(`批量修改失败：${error.message}`),
  });

  const importMutation = trpc.dashboard.importListingManual.useMutation({
    onSuccess: () => {
      toast.success("新 Listing 已成功录入跟踪库！");
      setIsImportModalOpen(false);
      setNewAsin("");
      setNewTitle("");
      setNewPrice("");
      setNewFbaStock("");
      utils.dashboard.invalidate();
    },
    onError: (err) => {
      toast.error(`录入失败: ${err.message}`);
    },
  });

  // Filter listings by search
  const filteredListings = useMemo(() => {
    if (!listingsQuery.data) return [];
    return listingsQuery.data.filter((item) => {
      if (salesCategoryFilter !== "all" && item.salesCategory !== salesCategoryFilter) return false;
      const matchText = `${item.asin} ${item.sku} ${item.title} ${item.assignedSales} ${salesCategoryLabel(item.salesCategory, item.customCategoryLabel)} ${item.salesNotes ?? ""}`.toLowerCase();
      return matchText.includes(searchQuery.toLowerCase());
    });
  }, [listingsQuery.data, salesCategoryFilter, searchQuery]);

  const effectiveListingId = selectedListingId && filteredListings.some(item => item.id === selectedListingId)
    ? selectedListingId
    : filteredListings[0]?.id;
  const detailQuery = trpc.dashboard.listingDetail.useQuery(
    { id: effectiveListingId ?? 1 },
    { enabled: !!effectiveListingId }
  );
  const currentDetail = detailQuery.data && filteredListings.some(item => item.id === detailQuery.data?.listing.id)
    ? detailQuery.data
    : null;
  const visibleKeywords = useMemo(() => {
    const allKeywords = currentDetail?.keywords ?? [];
    return allKeywords.filter(keyword => {
      const hasAd = hasDesktopPlacement(keyword.pcAdRank);
      const hasSbv = hasDesktopPlacement(keyword.pcSbvRank);
      if (desktopAdFilter === "has_any") return hasAd || hasSbv;
      if (desktopAdFilter === "ad_only") return hasAd;
      if (desktopAdFilter === "sbv_only") return hasSbv;
      if (desktopAdFilter === "not_found") return keyword.pcAdRank === 999 && keyword.pcSbvRank === 999;
      return true;
    });
  }, [currentDetail?.keywords, desktopAdFilter]);
  const activeListingId = effectiveListingId;
  const trendDates = useMemo(() => buildDateWindow(dateKeyInTimeZone(new Date(), "Asia/Shanghai"), 7), []);
  const snapshotRanks = useMemo(() => new Map(
    (currentDetail?.snapshots ?? []).map(snapshot => [`${snapshot.keywordId}:${snapshot.snapshotDate}`, snapshot.rank] as const)
  ), [currentDetail?.snapshots]);
  const visibleIds = filteredListings.map(item => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedListingIds.has(id));

  const toggleListingSelection = (listingId: number) => {
    setSelectedListingIds(current => {
      const next = new Set(current);
      if (next.has(listingId)) next.delete(listingId);
      else next.add(listingId);
      return next;
    });
  };

  const toggleAllVisibleListings = () => {
    setSelectedListingIds(current => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  const openOrganizationEditor = (item: {
    id: number;
    salesCategory: SalesCategory;
    customCategoryLabel: string | null;
    salesNotes: string | null;
  }) => {
    setSelectedListingId(item.id);
    setSalesCategory(item.salesCategory);
    setCustomCategoryLabel(item.customCategoryLabel ?? "");
    setSalesNotes(item.salesNotes ?? "");
    setIsOrganizationModalOpen(true);
  };

  const moveListing = (listingId: number, direction: -1 | 1) => {
    const ids = filteredListings.map(item => item.id);
    const currentIndex = ids.indexOf(listingId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[currentIndex], ids[nextIndex]] = [ids[nextIndex]!, ids[currentIndex]!];
    reorderListingsMutation.mutate({ orderedIds: ids });
  };

  const dropListingBefore = (targetId: number) => {
    if (!draggedListingId || draggedListingId === targetId) {
      setDraggedListingId(null);
      setDragOverListingId(null);
      return;
    }
    const ids = filteredListings.map(item => item.id);
    const fromIndex = ids.indexOf(draggedListingId);
    const targetIndex = ids.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    ids.splice(fromIndex, 1);
    ids.splice(targetIndex, 0, draggedListingId);
    reorderListingsMutation.mutate({ orderedIds: ids });
    setDraggedListingId(null);
    setDragOverListingId(null);
  };

  const handleExportCSV = () => {
    if (!currentDetail) return;
    const rows = [
      ["Listing ASIN", "站点", "销售分类", "销售自由备注", "核心关键词", "今日自然排名", "CPR(8天)", "广告排名(PC)", "SBV广告排名(PC)", "昨日排名", "变化", "日搜索量", "历史转化数", "转化率(%)"],
      ...currentDetail.keywords.map((kw) => [
        currentDetail.listing.asin,
        currentDetail.listing.marketplace,
        salesCategoryLabel(currentDetail.listing.salesCategory, currentDetail.listing.customCategoryLabel),
        currentDetail.listing.salesNotes ?? "",
        kw.keyword,
        kw.currentRank,
        hasRepositoryCpr(kw) ? kw.cprEstimate : "",
        kw.pcAdRank ?? "",
        kw.pcSbvRank ?? "",
        kw.previousRank,
        (kw.rankChange ?? 0) > 0 ? `+${kw.rankChange}` : `${kw.rankChange}`,
        kw.searchVolume,
        kw.historicalConversionCount,
        kw.conversionRate,
      ]),
    ];
    const escapeCsvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map(row => row.map(escapeCsvCell).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Amazon_Rank_${currentDetail.listing.asin}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("核心词每日排名表已导出！");
  };

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 pb-16">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 px-3 py-3 backdrop-blur-md sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-start gap-2.5 sm:items-center sm:gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-600/10 text-amber-700 sm:h-10 sm:w-10">
              <Flame className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-xl">Amazon 美加日线香香炉核心词每日排名看板</h1>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 sm:text-xs">
                  每日 07:35 自动更新
                </Badge>
              </div>
              <p className="mt-0.5 hidden text-xs text-slate-500 sm:block">
                仅限美国、加拿大、日本站线香（Sticks）与香炉香插（Burner/Holder）FBA 在售有库存商品 | 每个 Listing 维护 6–20 个分级核心词：SQP购买优先，其他证据透明标注
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshMutation.mutate({})}
              disabled={refreshMutation.isPending}
              className="h-8 w-full gap-1 bg-white text-[11px] sm:h-9 sm:w-auto sm:gap-1.5 sm:text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              立即抓取今日最新排名
            </Button>

            <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 w-full gap-1 bg-slate-900 text-[11px] text-white hover:bg-slate-800 sm:h-9 sm:w-auto sm:gap-1.5 sm:text-xs">
                  <PlusCircle className="h-3.5 w-3.5" />
                  手动录入/同步商品
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                  <DialogTitle>录入待跟踪的 FBA Listing</DialogTitle>
                  <DialogDescription>
                    默认仅接纳线香、香炉与香插。已获人工批准的精油/眼罩 ASIN 可一次性跳过类目守卫，但仍必须是 FBA、Active 且可售库存为正。
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 py-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-medium text-slate-700">站点 (Marketplace)</label>
                      <Select value={newMarketplace} onValueChange={(v: Marketplace) => setNewMarketplace(v)}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="US">美国站 (amazon.com)</SelectItem>
                          <SelectItem value="CA">加拿大站 (amazon.ca)</SelectItem>
                          <SelectItem value="JP">日本站 (amazon.co.jp)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="font-medium text-slate-700">商品 ASIN</label>
                      <Input
                        placeholder="例: B09X8Q21L3"
                        className="mt-1 uppercase"
                        maxLength={10}
                        value={newAsin}
                        onChange={(e) => setNewAsin(e.target.value.trim())}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="font-medium text-slate-700">Listing 标题（用于自动校验类目）</label>
                    <Input
                      placeholder="例: Natural Sandalwood Incense Sticks 120 Count..."
                      className="mt-1"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="font-medium text-slate-700">售价 (USD/CAD/JPY)</label>
                      <Input
                        placeholder="19.99"
                        className="mt-1"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="font-medium text-slate-700">FBA 可售库存</label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="例: 78"
                        className="mt-1"
                        value={newFbaStock}
                        onChange={(e) => setNewFbaStock(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="font-medium text-slate-700">负责销售专员</label>
                      <Input
                        placeholder="例: Sarah W."
                        className="mt-1"
                        value={salesName}
                        onChange={(e) => setSalesName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => setIsImportModalOpen(false)}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    disabled={!newAsin || !newTitle || importMutation.isPending}
                    onClick={() =>
                      importMutation.mutate({
                        marketplace: newMarketplace,
                        asin: newAsin,
                        title: newTitle,
                        price: newPrice || "19.99",
                        fbaStock: newFbaStock ? Number(newFbaStock) : undefined,
                        assignedSales: salesName,
                      })
                    }
                  >
                    确认录入并建档
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto w-full max-w-[1600px] space-y-3 px-3 pt-3 sm:space-y-5 sm:px-6 sm:pt-5">
        {/* Marketplace & Category Bar */}
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:gap-4 sm:p-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Tabs value={marketplace} onValueChange={(v) => { setMarketplace(v as MarketplaceFilter); setSelectedListingId(null); }} className="w-auto">
              <TabsList className="h-auto flex-wrap bg-slate-100 p-1">
                <TabsTrigger value="ALL" className="h-7 px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs">全部站点</TabsTrigger>
                <TabsTrigger value="US" className="flex h-7 items-center gap-1 px-2 text-[10px] sm:h-8 sm:gap-1.5 sm:px-3 sm:text-xs">
                  <span className="text-sm">🇺🇸</span> 美国站
                </TabsTrigger>
                <TabsTrigger value="CA" className="flex h-7 items-center gap-1 px-2 text-[10px] sm:h-8 sm:gap-1.5 sm:px-3 sm:text-xs">
                  <span className="text-sm">🇨🇦</span> 加拿大站
                </TabsTrigger>
                <TabsTrigger value="JP" className="flex h-7 items-center gap-1 px-2 text-[10px] sm:h-8 sm:gap-1.5 sm:px-3 sm:text-xs">
                  <span className="text-sm">🇯🇵</span> 日本站
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-[152px] bg-slate-50 text-[11px] sm:h-9 sm:w-[180px] sm:text-xs">
                <SelectValue placeholder="筛选品类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全品类（香道 + 手动豁免）</SelectItem>
                <SelectItem value="incense_sticks">线香 / 盘香类</SelectItem>
                <SelectItem value="incense_burner">香炉 / 倒流炉</SelectItem>
                <SelectItem value="incense_holder">香插 / 香托盘</SelectItem>
                <SelectItem value="other">手动豁免品类</SelectItem>
              </SelectContent>
            </Select>

          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2 h-4 w-4 text-slate-400 sm:top-2.5" />
            <Input
              placeholder="搜索 ASIN、标题、分类、备注..."
              className="h-8 bg-slate-50 pl-9 text-[11px] sm:h-9 sm:text-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Metric KPI Cards */}
        <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-4">
          <Card className="border-slate-200 shadow-xs">
            <CardContent className="flex items-center justify-between p-3 sm:p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">在售监控 LISTING</p>
                <div className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">{overviewQuery.data?.totalListings ?? 0}</div>
                <div className="mt-0.5 text-[10px] text-slate-400 sm:text-[11px]">
                  线香 {overviewQuery.data?.incenseSticksCount ?? 0} | 香炉 {overviewQuery.data?.burnerCount ?? 0} | 香插 {overviewQuery.data?.holderCount ?? 0}
                  {(overviewQuery.data?.manualExceptionCount ?? 0) > 0 ? ` | 手动豁免 ${overviewQuery.data?.manualExceptionCount}` : ""}
                </div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 sm:h-10 sm:w-10">
                <Layers className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-xs">
            <CardContent className="flex items-center justify-between p-3 sm:p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">核心词跟踪总量</p>
                <div className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">{overviewQuery.data?.totalKeywordsTracked ?? 0}</div>
                <div className="mt-0.5 text-[10px] font-medium text-emerald-600 sm:text-[11px]">
                  首页 Top 10 占 {overviewQuery.data?.top10Count ?? 0} 个词
                </div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 sm:h-10 sm:w-10">
                <BarChart3 className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-xs">
            <CardContent className="flex items-center justify-between p-3 sm:p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">今日排名上升词数</p>
                <div className="mt-1 flex items-center gap-1 text-xl font-bold text-emerald-600 sm:text-2xl">
                  {overviewQuery.data?.risenCount ?? 0}
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400 sm:text-[11px]">自然权重与转化正向提升</div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 sm:h-10 sm:w-10">
                <ArrowUpRight className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-xs">
            <CardContent className="flex items-center justify-between p-3 sm:p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">今日排名下滑预警</p>
                <div className="mt-1 flex items-center gap-1 text-xl font-bold text-rose-600 sm:text-2xl">
                  {overviewQuery.data?.droppedCount ?? 0}
                  <TrendingDown className="h-4 w-4" />
                </div>
                <div className="mt-0.5 text-[10px] font-medium text-rose-500 sm:text-[11px]">建议销售优先介入跟进</div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 sm:h-10 sm:w-10">
                <ArrowDownRight className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Master & Detail Layout */}
        <div className="grid grid-cols-1 items-start gap-3 lg:gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* Left Column: Listings Master Table */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <span>在售 Listing 列表</span>
                <span className="text-xs text-slate-400 font-normal">({filteredListings.length} 个)</span>
              </h2>
              <Select value={salesCategoryFilter} onValueChange={(value: SalesCategory | "all") => setSalesCategoryFilter(value)}>
                <SelectTrigger className="h-8 w-[152px] border-slate-200 bg-white text-[11px] shadow-xs">
                  <Tags className="mr-1 h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="右侧筛选分类" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">全部销售分类</SelectItem>
                  <SelectItem value="regular">常规产品</SelectItem>
                  <SelectItem value="key_product">重点产品</SelectItem>
                  <SelectItem value="long_tail">长尾产品</SelectItem>
                  <SelectItem value="discontinued">DISCONTINUED</SelectItem>
                  <SelectItem value="custom">自定义分类</SelectItem>
                  <SelectItem value="new_product">新品</SelectItem>
                  <SelectItem value="unclassified">未分类</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisibleListings} />
                选择当前筛选结果
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">已选 {selectedListingIds.size} 个</span>
                {selectedListingIds.size > 0 ? (
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setSelectedListingIds(new Set())}>
                    清空
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  className="h-7 bg-slate-900 px-3 text-[11px] text-white hover:bg-slate-800"
                  disabled={selectedListingIds.size === 0}
                  onClick={() => setIsBulkOrganizationModalOpen(true)}
                >
                  <Tags className="mr-1 h-3.5 w-3.5" /> 批量分类 / 备注
                </Button>
              </div>
            </div>

            <div className="space-y-2.5">
              {filteredListings.map((item, index) => {
                const isSelected = item.id === activeListingId;
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => setDraggedListingId(item.id)}
                    onDragEnd={() => {
                      setDraggedListingId(null);
                      setDragOverListingId(null);
                    }}
                    onDragOver={event => {
                      event.preventDefault();
                      setDragOverListingId(item.id);
                    }}
                    onDrop={event => {
                      event.preventDefault();
                      dropListingBefore(item.id);
                    }}
                    onClick={() => setSelectedListingId(item.id)}
                    className={`cursor-pointer rounded-lg border border-l-4 p-2.5 transition-all hover:border-amber-400/80 hover:shadow-xs ${SALES_CATEGORY_CARD_CLASS[item.salesCategory]} ${
                      draggedListingId === item.id ? "opacity-55" : "opacity-100"
                    } ${dragOverListingId === item.id && draggedListingId !== item.id ? "border-sky-400 ring-2 ring-sky-400/15" : ""} ${
                      isSelected ? "border-amber-500 ring-2 ring-amber-500/10 shadow-sm" : "border-slate-200"
                    }`}
                  >
                    <div className="flex gap-2">
                      <div className="flex shrink-0 items-start pt-0.5" onClick={event => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedListingIds.has(item.id)}
                          onCheckedChange={() => toggleListingSelection(item.id)}
                          aria-label={`选择 ${item.asin}`}
                        />
                      </div>
                      <div className="flex w-6 shrink-0 flex-col items-center gap-1 text-slate-400" onClick={event => event.stopPropagation()}>
                        <GripVertical className="h-4 w-4 cursor-grab active:cursor-grabbing" aria-label="拖拽排序" />
                        <button
                          type="button"
                          aria-label="上移 Listing"
                          title="上移"
                          disabled={index === 0 || reorderListingsMutation.isPending}
                          onClick={() => moveListing(item.id, -1)}
                          className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="下移 Listing"
                          title="下移"
                          disabled={index === filteredListings.length - 1 || reorderListingsMutation.isPending}
                          onClick={() => moveListing(item.id, 1)}
                          className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="h-14 w-14 shrink-0 rounded-md border border-slate-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-amber-100 bg-amber-50 text-amber-700">
                          <Flame className="h-6 w-6" aria-hidden="true" />
                          <span className="sr-only">暂无商品图片</span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-slate-100">
                            {marketplaceLabel(item.marketplace)}
                          </Badge>
                          <span className="text-xs font-mono font-medium text-slate-700">{item.asin}</span>
                          <span className="text-[11px] text-slate-400 truncate max-w-[100px]">{item.sku}</span>
                          <Badge className={`text-[10px] px-1.5 py-0 ${SALES_CATEGORY_CONFIG[item.salesCategory].className}`}>
                            {salesCategoryLabel(item.salesCategory, item.customCategoryLabel)}
                          </Badge>
                          {item.category === "other" ? (
                            <Badge className="border-violet-200 bg-violet-50 px-1.5 py-0 text-[10px] text-violet-700">
                              手动豁免
                            </Badge>
                          ) : null}
                          <Badge
                            className={`text-[10px] ml-auto px-1.5 py-0 ${
                              item.salesFollowUpStatus === "action_needed"
                                ? "bg-rose-100 text-rose-700 border-rose-200"
                                : item.salesFollowUpStatus === "watch"
                                ? "bg-amber-100 text-amber-700 border-amber-200"
                                : item.salesFollowUpStatus === "optimizing"
                                ? "bg-blue-100 text-blue-700 border-blue-200"
                                : "bg-emerald-100 text-emerald-700 border-emerald-200"
                            }`}
                          >
                            {item.salesFollowUpStatus === "action_needed"
                              ? "需销售跟进"
                              : item.salesFollowUpStatus === "watch"
                              ? "观察中"
                              : item.salesFollowUpStatus === "optimizing"
                              ? "优化中"
                              : "正常"}
                          </Badge>
                        </div>
                        <h3 className="text-xs font-medium text-slate-800 line-clamp-2 mt-1 leading-snug">
                          {item.title}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700">
                            {item.currency} {item.price}
                          </span>
                          <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            {item.reviewRating === null || (item.reviewCount ?? 0) === 0
                              ? "暂无评分"
                              : `${Number(item.reviewRating).toFixed(1)} (${item.reviewCount})`}
                          </span>
                          <span>FBA可售: {item.fbaStock}</span>
                          <span className={item.fbaInboundTotal > 0 ? "font-medium text-blue-700" : "text-slate-400"}>
                            在途: {item.fbaInboundTotal}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-slate-400">
                          <span>Working {item.fbaInboundWorking}</span>
                          <span>Shipped {item.fbaInboundShipped}</span>
                          <span>Receiving {item.fbaInboundReceiving}</span>
                          <span className="ml-auto">负责销售: {item.assignedSales}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                          <span className="min-w-0 truncate text-[11px] text-slate-500">
                            {item.salesNotes || "暂无销售自由备注"}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 gap-1 px-2 text-[10px] text-slate-600"
                            onClick={event => {
                              event.stopPropagation();
                              openOrganizationEditor(item);
                            }}
                          >
                            <Tags className="h-3 w-3" /> 分类 / 备注
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredListings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
                  当前站点没有同时满足“FBA、Active、有可售库存”条件的 Listing，或没有符合当前品类筛选的结果。
                </div>
              ) : null}
            </div>
          </div>

          {/* Right Column: Keyword Rank Statistics & Sales Action Detail */}
          <div className="min-w-0 space-y-4">
            {currentDetail ? (
              <>
                {/* Active Listing Profile Card */}
                <Card className="border-slate-200 shadow-xs bg-white">
                  <CardHeader className="flex flex-col items-start justify-between gap-3 border-b border-slate-100 p-3 pb-3 sm:flex-row sm:gap-4 sm:p-4 sm:pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-200 font-semibold">
                          {currentDetail.listing.marketplace} 站核心监控
                        </Badge>
                        <span className="text-xs font-mono font-bold text-slate-800">{currentDetail.listing.asin}</span>
                        <span className="text-xs text-slate-500">| {currentDetail.listing.categoryName}</span>
                      </div>
                      <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
                        {currentDetail.listing.title}
                      </h2>
                    </div>

                    <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openOrganizationEditor(currentDetail.listing)}
                        className="h-8 gap-1 px-2 text-[11px] sm:gap-1.5 sm:px-3 sm:text-xs"
                      >
                        <Tags className="h-3.5 w-3.5" />
                        分类 / 备注
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-8 gap-1 px-2 text-[11px] sm:gap-1.5 sm:px-3 sm:text-xs">
                        <Download className="h-3.5 w-3.5" />
                        导出排名表
                      </Button>

                      <Dialog open={isFollowUpModalOpen} onOpenChange={setIsFollowUpModalOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" className="h-8 gap-1 bg-amber-600 px-2 text-[11px] text-white hover:bg-amber-700 sm:gap-1.5 sm:px-3 sm:text-xs">
                            <UserCheck className="h-3.5 w-3.5" />
                            登记销售跟进
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[440px]">
                          <DialogHeader>
                            <DialogTitle>销售跟进与复盘记录</DialogTitle>
                            <DialogDescription>
                              针对 {currentDetail.listing.asin} 的核心词上升或下滑趋势，下发或记录调整动作。
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-3 py-2 text-xs">
                            <div>
                              <label className="font-medium text-slate-700">跟进状态</label>
                              <Select
                                value={followUpStatus}
                                onValueChange={(v: any) => setFollowUpStatus(v)}
                              >
                                <SelectTrigger className="mt-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="normal">正常 (自然排名稳居首页)</SelectItem>
                                  <SelectItem value="watch">密切观察 (轻微波动)</SelectItem>
                                  <SelectItem value="action_needed">需销售干预 (核心词下滑需补刀)</SelectItem>
                                  <SelectItem value="optimizing">优化中 (调整广告/主图进行中)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="font-medium text-slate-700">销售动作与策略备注</label>
                              <Textarea
                                placeholder="例: 核心词下滑 2 位，已对该词提高精准匹配竞价 15%，并检查主图秒杀标..."
                                className="mt-1 h-24"
                                value={followUpNotes}
                                onChange={(e) => setFollowUpNotes(e.target.value)}
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" size="sm" onClick={() => setIsFollowUpModalOpen(false)}>
                              取消
                            </Button>
                            <Button
                              size="sm"
                              disabled={updateFollowUpMutation.isPending}
                              onClick={() =>
                                updateFollowUpMutation.mutate({
                                  listingId: currentDetail.listing.id,
                                  status: followUpStatus,
                                  notes: followUpNotes,
                                  logContent: followUpNotes,
                                  salesName: currentDetail.listing.assignedSales ?? "销售组",
                                })
                              }
                            >
                              保存并归档
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-wrap gap-x-3 gap-y-2 bg-slate-50/50 p-3 pt-3 text-[11px] text-slate-600 sm:gap-4 sm:p-4 sm:pt-3 sm:text-xs">
                    <div>
                      <span className="text-slate-400">产品分类：</span>
                      <Badge className={`text-[10px] px-1.5 py-0 ${SALES_CATEGORY_CONFIG[currentDetail.listing.salesCategory].className}`}>
                        {salesCategoryLabel(currentDetail.listing.salesCategory, currentDetail.listing.customCategoryLabel)}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-slate-400">负责销售：</span>
                      <span className="font-medium text-slate-800">{currentDetail.listing.assignedSales}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">FBA可售库存：</span>
                      <span className="font-medium text-slate-800">{currentDetail.listing.fbaStock} 件</span>
                    </div>
                    <div>
                      <span className="text-slate-400">FBA在途库存：</span>
                      <span className="font-medium text-blue-700">{currentDetail.listing.fbaInboundTotal} 件</span>
                      <span className="ml-1 hidden text-[10px] text-slate-400 sm:inline">
                        (Working {currentDetail.listing.fbaInboundWorking} / Shipped {currentDetail.listing.fbaInboundShipped} / Receiving {currentDetail.listing.fbaInboundReceiving})
                      </span>
                    </div>
                    <div className="inline-flex items-center gap-1">
                      <span className="text-slate-400">Review Rating：</span>
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="font-medium text-slate-800">
                        {currentDetail.listing.reviewRating === null || (currentDetail.listing.reviewCount ?? 0) === 0
                          ? "暂无评分"
                          : `${Number(currentDetail.listing.reviewRating).toFixed(1)} / 5（${currentDetail.listing.reviewCount ?? 0} 条评价）`}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">销售自由备注：</span>
                      <span className="text-slate-700 italic">
                        {currentDetail.listing.salesNotes || "暂无自由备注"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">最新跟进备注：</span>
                      <span className="text-slate-700 italic">
                        {currentDetail.listing.notes || "暂无最新复盘备注"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Keywords Ranking Statistics Table (Core 6-20) */}
                <Card className="border-slate-200 shadow-xs bg-white">
                  <CardHeader className="flex flex-col items-start justify-between gap-3 p-3 pb-2 sm:flex-row sm:items-center sm:p-4 sm:pb-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold text-slate-900">
                      核心关键词每日排名统计表 (共 {currentDetail.keywords.length} 个)
                      </CardTitle>
                      <CardDescription className="mt-0.5 text-[11px] leading-relaxed text-slate-500 sm:text-xs">
                        选词证据：SQP购买优先；SQP加购/点击仅作高意图测试；“待验证”是标题强相关补足，不能直接视为高转化词。自然位与广告位独立采集；CPR(8天)仅显示 GitHub 仓库 `data/cpr.json` 的已同步值。
                      </CardDescription>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {cprSyncStatusQuery.data?.lastStatus === "applied"
                          ? `CPR 仓库已同步：${cprSyncStatusQuery.data.updatedKeywordCount} 个关键词`
                          : cprSyncStatusQuery.data?.lastStatus === "not_newer"
                          ? "CPR 仓库文件未更新，保留上次仓库同步值"
                          : cprSyncStatusQuery.data?.lastStatus === "file_not_found"
                          ? "等待 GitHub 仓库生成 data/cpr.json；自然位与广告位不受影响"
                          : cprSyncStatusQuery.data?.lastStatus === "error"
                          ? "CPR 仓库同步异常，未覆盖现有值"
                          : "等待 GitHub 仓库 data/cpr.json 首次同步"}
                      </p>
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Badge variant="secondary" className="hidden whitespace-nowrap bg-amber-50 text-xs text-amber-700 sm:inline-flex">
                        高价值转化导向
                      </Badge>
                      <Select value={desktopAdFilter} onValueChange={(value: DesktopAdFilter) => setDesktopAdFilter(value)}>
                        <SelectTrigger className="h-8 w-full bg-white text-[11px] sm:w-[188px] sm:text-xs">
                          <SelectValue placeholder="广告位筛选" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部核心词</SelectItem>
                          <SelectItem value="has_any">仅看有广告 / SBV</SelectItem>
                          <SelectItem value="ad_only">仅看常规广告位</SelectItem>
                          <SelectItem value="sbv_only">仅看 SBV 广告位</SelectItem>
                          <SelectItem value="not_found">前三页未检索到广告</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="hidden overflow-hidden lg:block">
                      <table className="w-full table-fixed text-left text-[11px]">
                        <colgroup>
                          <col className="w-[15%]" />
                          <col className="w-[8%]" />
                          <col className="w-[5%]" />
                          <col className="w-[5%]" />
                          <col className="w-[5%]" />
                          <col className="w-[8%]" />
                          <col className="w-[6%]" />
                          <col className="w-[7%]" />
                          <col className="w-[7%]" />
                          <col className="w-[6%]" />
                          <col className="w-[6%]" />
                          <col className="w-[12%]" />
                          <col className="w-[5%]" />
                        </colgroup>
                        <thead className="bg-slate-50 border-y border-slate-200 text-slate-600 font-medium">
                          <tr>
                            <th className="px-2 py-2">核心关键词</th>
                            <th className="px-1.5 py-2">来源</th>
                            <th className="px-1.5 py-2">月搜</th>
                            <th className="px-1.5 py-2">转化</th>
                            <th className="px-1.5 py-2">CVR</th>
                            <th className="px-1.5 py-2">今日自然位</th>
                            <th className="px-1.5 py-2" title="唯一数据源：GitHub 仓库 data/cpr.json；每日 07:35（北京时间）检查更新">CPR(8天)<br/><span className="font-normal text-[9px]">GitHub</span></th>
                            <th className="px-1.5 py-2">广告位<br/><span className="font-normal text-[9px]">PC</span></th>
                            <th className="px-1.5 py-2">SBV 位<br/><span className="font-normal text-[9px]">PC</span></th>
                            <th className="px-1.5 py-2">昨日自然</th>
                            <th className="px-1.5 py-2">日变化</th>
                            <th className="px-1.5 py-2 whitespace-nowrap">7日趋势</th>
                            <th className="px-1.5 py-2">最佳</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {visibleKeywords.length === 0 ? (
                            <tr>
                              <td colSpan={13} className="px-4 py-8 text-center text-sm text-slate-500">
                                当前筛选下没有符合条件的核心词。
                              </td>
                            </tr>
                          ) : visibleKeywords.map((kw) => {
                            const change = kw.rankChange ?? 0;
                            const currentRank = kw.currentRank ?? 0;
                            const previousRank = kw.previousRank ?? 0;
                            const hasPcAd = hasDesktopPlacement(kw.pcAdRank);
                            const hasPcSbv = hasDesktopPlacement(kw.pcSbvRank);
                            const isDualFirstPage = currentRank > 0 && currentRank <= 48 && (isDesktopFirstPage(kw.pcAdRank) || isDesktopFirstPage(kw.pcSbvRank));
                            const notFoundInDesktopAds = kw.pcAdRank === 999 && kw.pcSbvRank === 999;
                            const isRisen = change > 0;
                            const isDropped = change < 0;
                            const sparklineRanks = trendDates.map(date => snapshotRanks.get(`${kw.id}:${date}`) ?? null);
                            const evidence = keywordEvidencePresentation(kw.selectionBasis as KeywordSelectionBasis);
                            return (
                              <tr key={kw.id} className="hover:bg-amber-50/30 transition-colors">
                                <td className="px-2 py-2 font-semibold leading-snug text-slate-900">
                                  <div className="flex flex-col items-start gap-1">
                                    <span className="break-words">{kw.keyword}</span>
                                    {isDualFirstPage ? (
                                      <Badge className="border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50">
                                        双首页占位
                                      </Badge>
                                    ) : notFoundInDesktopAds ? (
                                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500" title="前三页未检索到桌面端广告或 SBV 广告；可评估精准广告防御">
                                        未检广告 · 防御
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="px-1.5 py-2">
                                  <Badge variant="outline" className={`whitespace-nowrap px-1 py-0 text-[10px] ${evidence.className}`} title={evidence.title}>
                                    {evidence.label}
                                  </Badge>
                                </td>
                                <td className="px-1.5 py-2 font-mono text-slate-600">
                                  {kw.searchVolume?.toLocaleString()}
                                </td>
                                <td className="px-1.5 py-2 font-mono font-medium text-slate-700">
                                  {kw.historicalConversionCount}
                                </td>
                                <td className="px-1.5 py-2 font-mono text-slate-600">
                                  {kw.conversionRate}%
                                </td>
                                <td className="px-1.5 py-2">
                                  <div className="flex flex-col items-start gap-0.5">
                                    <span
                                      className={`inline-flex items-center justify-center whitespace-nowrap rounded px-1.5 py-0.5 font-bold text-[11px] ${
                                        currentRank > 0 && currentRank <= 3
                                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                                          : currentRank <= 10 && currentRank > 0
                                          ? "bg-emerald-100 text-emerald-800"
                                          : "bg-slate-100 text-slate-700"
                                      }`}
                                    >
                                      {currentRank === 0 ? "待采集" : currentRank === 999 ? "3页外" : `#${currentRank}`}
                                    </span>
                                    {currentRank > 0 && currentRank !== 999 ? (
                                      <span className="text-[9px] text-slate-400">P{kw.pageNumber}</span>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="px-1.5 py-2" title={hasRepositoryCpr(kw) ? `GitHub data/cpr.json：月销均值 ${kw.cprMonthlySalesAverage ?? "—"}；样本 ${kw.cprSampleCount ?? "—"}` : "等待 GitHub 仓库 data/cpr.json 的对应关键词"}>
                                  {!hasRepositoryCpr(kw) ? (
                                    <span className="text-[10px] text-slate-400">待仓库</span>
                                  ) : (
                                    <div className="leading-tight">
                                      <span className="font-mono text-xs font-semibold text-cyan-700">{kw.cprEstimate}</span>
                                      <span className="block text-[9px] text-slate-400">{kw.cprSampleCount ?? "—"}样本</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-1.5 py-2">
                                  {kw.pcAdRank === null || kw.pcAdRank === undefined ? (
                                    <span className="text-[10px] text-slate-400">待采</span>
                                  ) : kw.pcAdRank === 999 ? (
                                    <span className="inline-flex items-center rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-600">3页外</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-purple-700">
                                      #{kw.pcAdRank}
                                    </span>
                                  )}
                                </td>
                                <td className="px-1.5 py-2">
                                  {kw.pcSbvRank === null || kw.pcSbvRank === undefined ? (
                                    <span className="text-[10px] text-slate-400">待采</span>
                                  ) : kw.pcSbvRank === 999 ? (
                                    <span className="inline-flex items-center rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-600">3页外</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-700">
                                      #{kw.pcSbvRank}
                                    </span>
                                  )}
                                </td>
                                <td className="px-1.5 py-2 font-mono text-slate-400">
                                  {previousRank === 0 ? "—" : previousRank === 999 ? "3页外" : `#${previousRank}`}
                                </td>
                                <td className="px-1.5 py-2">
                                  {currentRank === 0 ? (
                                    <span className="text-[10px] text-slate-400">待采</span>
                                  ) : isRisen ? (
                                    <span className="inline-flex items-center text-emerald-600 font-bold gap-0.5">
                                      <TrendingUp className="h-3.5 w-3.5" />+{change}
                                    </span>
                                  ) : isDropped ? (
                                    <span className="inline-flex items-center text-rose-600 font-bold gap-0.5">
                                      <TrendingDown className="h-3.5 w-3.5" />{change}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center text-slate-400 gap-0.5">
                                      <Minus className="h-3.5 w-3.5" />0
                                    </span>
                                  )}
                                </td>
                                <td className="px-1.5 py-2">
                                  <KeywordRankSparkline ranks={sparklineRanks} />
                                </td>
                                <td className="px-1.5 py-2 font-mono text-slate-500">
                                  {(kw.bestRank ?? 0) === 0 ? "—" : `#${kw.bestRank}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="divide-y divide-slate-100 lg:hidden">
                      {visibleKeywords.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">当前筛选下没有符合条件的核心词。</div>
                      ) : visibleKeywords.map(kw => {
                        const currentRank = kw.currentRank ?? 0;
                        const previousRank = kw.previousRank ?? 0;
                        const change = kw.rankChange ?? 0;
                        const hasPcAd = hasDesktopPlacement(kw.pcAdRank);
                        const hasPcSbv = hasDesktopPlacement(kw.pcSbvRank);
                        const dualFirstPage = currentRank > 0 && currentRank <= 48 && (isDesktopFirstPage(kw.pcAdRank) || isDesktopFirstPage(kw.pcSbvRank));
                        const adLabel = kw.pcAdRank === null || kw.pcAdRank === undefined ? "待采" : kw.pcAdRank === 999 ? "3页外" : `#${kw.pcAdRank}`;
                        const sbvLabel = kw.pcSbvRank === null || kw.pcSbvRank === undefined ? "待采" : kw.pcSbvRank === 999 ? "3页外" : `#${kw.pcSbvRank}`;
                        const evidence = keywordEvidencePresentation(kw.selectionBasis as KeywordSelectionBasis);
                        return (
                          <article key={kw.id} className="space-y-2.5 px-3 py-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-words text-sm font-semibold leading-snug text-slate-900">{kw.keyword}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${evidence.className}`} title={evidence.title}>
                                    {evidence.label}
                                  </Badge>
                                  <span className="text-[10px] text-slate-500">月搜 {kw.searchVolume?.toLocaleString() ?? "—"} · CVR {kw.conversionRate}%</span>
                                </div>
                              </div>
                              {dualFirstPage ? <Badge className="shrink-0 border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-700">双首页</Badge> : null}
                            </div>

                            <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5">
                              <div>
                                <p className="text-[10px] text-slate-500">今日自然位</p>
                                <p className="mt-0.5 font-mono text-sm font-bold text-slate-900">{currentRank === 0 ? "待采" : currentRank === 999 ? "3页外" : `#${currentRank}`}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500">CPR(8天) · GitHub</p>
                                <p className="mt-0.5 font-mono text-sm font-bold text-cyan-700">{hasRepositoryCpr(kw) ? kw.cprEstimate : "待仓库"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500">7日自然趋势</p>
                                <div className="mt-0.5"><KeywordRankSparkline ranks={trendDates.map(date => snapshotRanks.get(`${kw.id}:${date}`) ?? null)} /></div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className={`rounded-lg border px-2.5 py-2 ${hasPcAd ? "border-purple-200 bg-purple-50" : "border-slate-200 bg-slate-50"}`}>
                                <p className="text-[10px] text-slate-500">广告位 · PC</p>
                                <p className={`mt-0.5 font-mono text-sm font-semibold ${hasPcAd ? "text-purple-700" : "text-slate-500"}`}>{adLabel}</p>
                              </div>
                              <div className={`rounded-lg border px-2.5 py-2 ${hasPcSbv ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}>
                                <p className="text-[10px] text-slate-500">SBV 位 · PC</p>
                                <p className={`mt-0.5 font-mono text-sm font-semibold ${hasPcSbv ? "text-indigo-700" : "text-slate-500"}`}>{sbvLabel}</p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-500">
                              <span>昨日 {previousRank === 0 ? "—" : previousRank === 999 ? "3页外" : `#${previousRank}`}</span>
                              <span className={change > 0 ? "font-semibold text-emerald-600" : change < 0 ? "font-semibold text-rose-600" : "text-slate-500"}>日变化 {change > 0 ? `+${change}` : change}</span>
                              <span>最佳 {(kw.bestRank ?? 0) === 0 ? "—" : `#${kw.bestRank}`}</span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Sales Action Logs & Follow-up History */}
                <Card className="border-slate-200 shadow-xs bg-white">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-500" />
                      销售跟进与系统告警复盘动态
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      记录每日排位异动、针对性打法（如精准拓量、掉词拉升、库存告警）
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    <div className="space-y-3">
                      {currentDetail.logs.length === 0 ? (
                        <p className="text-xs text-slate-400 py-3 text-center">暂无跟进动态记录</p>
                      ) : (
                        currentDetail.logs.map((log) => (
                          <div key={log.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/60 text-xs space-y-1">
                            <div className="flex items-center justify-between text-slate-500">
                              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                                <Badge variant="outline" className="text-[10px] px-1 py-0 bg-white">
                                  {log.actionType}
                                </Badge>
                                {log.author}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {new Date(log.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-slate-700">{log.content}</p>
                            {log.suggestedAction && (
                              <p className="text-amber-700 font-medium text-[11px] bg-amber-50/80 p-1.5 rounded">
                                建议跟进动作：{log.suggestedAction}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-xs">
                正在加载数据...
              </div>
            )}
          </div>
        </div>

        <Dialog open={isOrganizationModalOpen} onOpenChange={setIsOrganizationModalOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>产品分类与销售自由备注</DialogTitle>
              <DialogDescription>
                分类和备注由销售团队维护，不会被每天的 SP-API 商品同步覆盖。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-medium text-slate-700">产品分类</label>
                <Select value={salesCategory} onValueChange={(value: SalesCategory) => setSalesCategory(value)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unclassified">未分类</SelectItem>
                    <SelectItem value="new_product">新品</SelectItem>
                    <SelectItem value="key_product">重点产品</SelectItem>
                    <SelectItem value="long_tail">长尾产品</SelectItem>
                    <SelectItem value="regular">常规产品</SelectItem>
                    <SelectItem value="discontinued">DISCONTINUED</SelectItem>
                    <SelectItem value="custom">自定义分类</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {salesCategory === "custom" ? (
                <div>
                  <label className="font-medium text-slate-700">自定义分类名称</label>
                  <Input
                    className="mt-1"
                    maxLength={80}
                    placeholder="例：Q4季节性重点、清仓观察"
                    value={customCategoryLabel}
                    onChange={event => setCustomCategoryLabel(event.target.value)}
                  />
                </div>
              ) : null}
              <div>
                <div className="flex items-center justify-between">
                  <label className="font-medium text-slate-700">销售自由备注</label>
                  <span className="text-[10px] text-slate-400">{salesNotes.length}/2000</span>
                </div>
                <Textarea
                  className="mt-1 min-h-32"
                  maxLength={2000}
                  placeholder="例：新品冷启动期；重点维护 sandalwood incense；10月补货；暂不增加广告预算……"
                  value={salesNotes}
                  onChange={event => setSalesNotes(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOrganizationModalOpen(false)}>
                取消
              </Button>
              <Button
                disabled={
                  updateOrganizationMutation.isPending ||
                  !selectedListingId ||
                  (salesCategory === "custom" && !customCategoryLabel.trim())
                }
                onClick={() => {
                  if (!selectedListingId) return;
                  updateOrganizationMutation.mutate({
                    listingId: selectedListingId,
                    salesCategory,
                    customCategoryLabel: salesCategory === "custom" ? customCategoryLabel : undefined,
                    salesNotes,
                  });
                }}
              >
                保存分类与备注
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isBulkOrganizationModalOpen} onOpenChange={setIsBulkOrganizationModalOpen}>
          <DialogContent className="sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle>批量修改 {selectedListingIds.size} 个 Listing</DialogTitle>
              <DialogDescription>
                可只修改分类、只处理备注，或两项同时处理；未选择的字段会保持原值。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-medium text-slate-700">批量产品分类</label>
                <Select value={bulkSalesCategory} onValueChange={(value: SalesCategory | "keep") => setBulkSalesCategory(value)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">保持各产品原分类</SelectItem>
                    <SelectItem value="unclassified">未分类</SelectItem>
                    <SelectItem value="new_product">新品</SelectItem>
                    <SelectItem value="key_product">重点产品</SelectItem>
                    <SelectItem value="long_tail">长尾产品</SelectItem>
                    <SelectItem value="regular">常规产品</SelectItem>
                    <SelectItem value="discontinued">DISCONTINUED</SelectItem>
                    <SelectItem value="custom">自定义分类</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {bulkSalesCategory === "custom" ? (
                <div>
                  <label className="font-medium text-slate-700">自定义分类名称</label>
                  <Input
                    className="mt-1"
                    maxLength={80}
                    placeholder="例：Q4季节性重点、待清仓"
                    value={bulkCustomCategoryLabel}
                    onChange={event => setBulkCustomCategoryLabel(event.target.value)}
                  />
                </div>
              ) : null}
              <div>
                <label className="font-medium text-slate-700">批量备注处理方式</label>
                <Select value={bulkNotesAction} onValueChange={(value: "keep" | "append" | "replace" | "clear") => setBulkNotesAction(value)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">保持原备注</SelectItem>
                    <SelectItem value="append">追加到原备注后</SelectItem>
                    <SelectItem value="replace">覆盖原备注</SelectItem>
                    <SelectItem value="clear">清空备注</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {bulkNotesAction === "append" || bulkNotesAction === "replace" ? (
                <div>
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-slate-700">批量销售备注</label>
                    <span className="text-[10px] text-slate-400">{bulkSalesNotes.length}/2000</span>
                  </div>
                  <Textarea
                    className="mt-1 min-h-28"
                    maxLength={2000}
                    placeholder="输入需要批量追加或覆盖的备注内容"
                    value={bulkSalesNotes}
                    onChange={event => setBulkSalesNotes(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsBulkOrganizationModalOpen(false)}>取消</Button>
              <Button
                disabled={
                  bulkUpdateOrganizationMutation.isPending ||
                  selectedListingIds.size === 0 ||
                  (bulkSalesCategory === "keep" && bulkNotesAction === "keep") ||
                  (bulkSalesCategory === "custom" && !bulkCustomCategoryLabel.trim()) ||
                  ((bulkNotesAction === "append" || bulkNotesAction === "replace") && !bulkSalesNotes.trim())
                }
                onClick={() =>
                  bulkUpdateOrganizationMutation.mutate({
                    listingIds: Array.from(selectedListingIds),
                    salesCategory: bulkSalesCategory === "keep" ? undefined : bulkSalesCategory,
                    customCategoryLabel: bulkSalesCategory === "custom" ? bulkCustomCategoryLabel : undefined,
                    notesAction: bulkNotesAction,
                    salesNotes: bulkSalesNotes || undefined,
                  })
                }
              >
                确认批量修改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
