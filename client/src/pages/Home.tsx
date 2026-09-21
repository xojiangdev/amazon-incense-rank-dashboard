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

export default function Home() {
  const [marketplace, setMarketplace] = useState<MarketplaceFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [salesCategoryFilter, setSalesCategoryFilter] = useState<SalesCategory | "all">("all");
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

  const utils = trpc.useUtils();
  const listingsInput = useMemo(
    () => ({ marketplace: marketplace === "ALL" ? undefined : marketplace, category: categoryFilter }),
    [marketplace, categoryFilter]
  );

  const overviewQuery = trpc.dashboard.overview.useQuery(
    marketplace === "ALL" ? undefined : { marketplace }
  );

  const listingsQuery = trpc.dashboard.listings.useQuery(listingsInput);

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
      ["Listing ASIN", "站点", "销售分类", "销售自由备注", "核心关键词", "今日自然排名", "广告排名(PC)", "SBV广告排名(PC)", "昨日排名", "变化", "日搜索量", "历史转化数", "转化率(%)"],
      ...currentDetail.keywords.map((kw) => [
        currentDetail.listing.asin,
        currentDetail.listing.marketplace,
        salesCategoryLabel(currentDetail.listing.salesCategory, currentDetail.listing.customCategoryLabel),
        currentDetail.listing.salesNotes ?? "",
        kw.keyword,
        kw.currentRank,
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
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-600/10 flex items-center justify-center text-amber-700">
              <Flame className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">Amazon 美加日线香香炉核心词每日排名看板</h1>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                  每日 07:00 自动更新
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                仅限美国、加拿大、日本站线香（Sticks）与香炉香插（Burner/Holder）FBA 在售有库存商品 | 每个 Listing 锁定 6-20 个高价值词
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshMutation.mutate({})}
              disabled={refreshMutation.isPending}
              className="gap-1.5 text-xs bg-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              立即抓取今日最新排名
            </Button>

            <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 text-xs bg-slate-900 text-white hover:bg-slate-800">
                  <PlusCircle className="h-3.5 w-3.5" />
                  手动录入/同步商品
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                  <DialogTitle>录入待跟踪的线香/香炉 Listing</DialogTitle>
                  <DialogDescription>
                    系统将为 US/CA/JP 商品建立核心高价值搜索词，并纳入每日 07:00 自然位监控体系。
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
                    <label className="font-medium text-slate-700">Listing 标题（用于自动校验香道类目）</label>
                    <Input
                      placeholder="例: Natural Sandalwood Incense Sticks 120 Count..."
                      className="mt-1"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
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
      <main className="max-w-7xl mx-auto px-6 pt-6 space-y-6">
        {/* Marketplace & Category Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={marketplace} onValueChange={(v) => { setMarketplace(v as MarketplaceFilter); setSelectedListingId(null); }} className="w-auto">
              <TabsList className="bg-slate-100">
                <TabsTrigger value="ALL" className="text-xs">全部站点</TabsTrigger>
                <TabsTrigger value="US" className="text-xs flex items-center gap-1.5">
                  <span className="text-sm">🇺🇸</span> 美国站
                </TabsTrigger>
                <TabsTrigger value="CA" className="text-xs flex items-center gap-1.5">
                  <span className="text-sm">🇨🇦</span> 加拿大站
                </TabsTrigger>
                <TabsTrigger value="JP" className="text-xs flex items-center gap-1.5">
                  <span className="text-sm">🇯🇵</span> 日本站
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px] text-xs h-9 bg-slate-50">
                <SelectValue placeholder="筛选品类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全品类 (线香 & 香炉)</SelectItem>
                <SelectItem value="incense_sticks">线香 / 盘香类</SelectItem>
                <SelectItem value="incense_burner">香炉 / 倒流炉</SelectItem>
                <SelectItem value="incense_holder">香插 / 香托盘</SelectItem>
              </SelectContent>
            </Select>

          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="搜索 ASIN、标题、分类、备注..."
              className="pl-9 text-xs h-9 bg-slate-50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Metric KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-slate-200 shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">在售监控 LISTING</p>
                <div className="text-2xl font-bold mt-1 text-slate-900">{overviewQuery.data?.totalListings ?? 0}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  线香 {overviewQuery.data?.incenseSticksCount ?? 0} | 香炉 {overviewQuery.data?.burnerCount ?? 0} | 香插 {overviewQuery.data?.holderCount ?? 0}
                </div>
              </div>
              <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                <Layers className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">核心词跟踪总量</p>
                <div className="text-2xl font-bold mt-1 text-slate-900">{overviewQuery.data?.totalKeywordsTracked ?? 0}</div>
                <div className="text-[11px] text-emerald-600 font-medium mt-0.5">
                  首页 Top 10 占 {overviewQuery.data?.top10Count ?? 0} 个词
                </div>
              </div>
              <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <BarChart3 className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">今日排名上升词数</p>
                <div className="text-2xl font-bold mt-1 text-emerald-600 flex items-center gap-1">
                  {overviewQuery.data?.risenCount ?? 0}
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">自然权重与转化正向提升</div>
              </div>
              <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                <ArrowUpRight className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">今日排名下滑预警</p>
                <div className="text-2xl font-bold mt-1 text-rose-600 flex items-center gap-1">
                  {overviewQuery.data?.droppedCount ?? 0}
                  <TrendingDown className="h-4 w-4" />
                </div>
                <div className="text-[11px] text-rose-500 font-medium mt-0.5">建议销售优先介入跟进</div>
              </div>
              <div className="h-10 w-10 rounded-lg bg-rose-50 flex items-center justify-center text-rose-600">
                <ArrowDownRight className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Master & Detail Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Listings Master Table */}
          <div className="lg:col-span-5 space-y-3">
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
                    className={`cursor-pointer rounded-xl border border-l-4 p-3 transition-all hover:border-amber-400/80 hover:shadow-xs ${SALES_CATEGORY_CARD_CLASS[item.salesCategory]} ${
                      draggedListingId === item.id ? "opacity-55" : "opacity-100"
                    } ${dragOverListingId === item.id && draggedListingId !== item.id ? "border-sky-400 ring-2 ring-sky-400/15" : ""} ${
                      isSelected ? "border-amber-500 ring-2 ring-amber-500/10 shadow-sm" : "border-slate-200"
                    }`}
                  >
                    <div className="flex gap-3">
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
                          className="h-16 w-16 rounded-lg object-cover border border-slate-100 shrink-0"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-lg border border-amber-100 bg-amber-50 text-amber-700 shrink-0 flex items-center justify-center">
                          <Flame className="h-7 w-7" aria-hidden="true" />
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
                  当前站点没有同时满足“FBA、Active、有可售库存、线香/香炉/香插类目”的 Listing。
                </div>
              ) : null}
            </div>
          </div>

          {/* Right Column: Keyword Rank Statistics & Sales Action Detail */}
          <div className="lg:col-span-7 space-y-4">
            {currentDetail ? (
              <>
                {/* Active Listing Profile Card */}
                <Card className="border-slate-200 shadow-xs bg-white">
                  <CardHeader className="p-4 pb-3 flex flex-row items-start justify-between gap-4 border-b border-slate-100">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-200 font-semibold">
                          {currentDetail.listing.marketplace} 站核心监控
                        </Badge>
                        <span className="text-xs font-mono font-bold text-slate-800">{currentDetail.listing.asin}</span>
                        <span className="text-xs text-slate-500">| {currentDetail.listing.categoryName}</span>
                      </div>
                      <h2 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
                        {currentDetail.listing.title}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openOrganizationEditor(currentDetail.listing)}
                        className="text-xs h-8 gap-1.5"
                      >
                        <Tags className="h-3.5 w-3.5" />
                        分类 / 备注
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportCSV} className="text-xs h-8 gap-1.5">
                        <Download className="h-3.5 w-3.5" />
                        导出排名表
                      </Button>

                      <Dialog open={isFollowUpModalOpen} onOpenChange={setIsFollowUpModalOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" className="text-xs h-8 bg-amber-600 hover:bg-amber-700 text-white gap-1.5">
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

                  <CardContent className="p-4 pt-3 flex flex-wrap gap-4 text-xs text-slate-600 bg-slate-50/50">
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
                      <span className="ml-1 text-[10px] text-slate-400">
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
                  <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-900">
                      核心关键词每日排名统计表 (共 {currentDetail.keywords.length} 个)
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-500 mt-0.5">
                        每个 Listing 追踪 6–20 个高价值词；仅采用 Sorftime latest_organic_position 自然位，广告位不计入
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700">
                      高价值转化导向
                    </Badge>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-y border-slate-200 text-slate-600 font-medium">
                          <tr>
                            <th className="py-2.5 px-3">核心关键词 (Keyword)</th>
                            <th className="py-2.5 px-3">来源标签</th>
                            <th className="py-2.5 px-3">月搜索量</th>
                            <th className="py-2.5 px-3">历史转化数</th>
                            <th className="py-2.5 px-3">转化率</th>
                            <th className="py-2.5 px-3">今日自然位</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">广告排名 (PC)</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">SBV广告排名 (PC)</th>
                            <th className="py-2.5 px-3">昨日自然位</th>
                            <th className="py-2.5 px-3">日环比趋势</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">近 7 天趋势</th>
                            <th className="py-2.5 px-3">历史最佳</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {currentDetail.keywords.map((kw) => {
                            const change = kw.rankChange ?? 0;
                            const currentRank = kw.currentRank ?? 0;
                            const previousRank = kw.previousRank ?? 0;
                            const isRisen = change > 0;
                            const isDropped = change < 0;
                            const sparklineRanks = trendDates.map(date => snapshotRanks.get(`${kw.id}:${date}`) ?? null);
                            return (
                              <tr key={kw.id} className="hover:bg-amber-50/30 transition-colors">
                                <td className="py-2.5 px-3 font-semibold text-slate-900">
                                  {kw.keyword}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] px-1 py-0 ${
                                      kw.source === "sqp_converting"
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                        : kw.source === "ads_converting"
                                        ? "bg-purple-50 text-purple-700 border-purple-200"
                                        : "bg-blue-50 text-blue-700 border-blue-200"
                                    }`}
                                  >
                                    {kw.source === "sqp_converting"
                                      ? "SQP高转化词"
                                      : kw.source === "ads_converting"
                                      ? "广告出单词"
                                      : "自然高价值词"}
                                  </Badge>
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 font-mono">
                                  {kw.searchVolume?.toLocaleString()}
                                </td>
                                <td className="py-2.5 px-3 text-slate-700 font-medium font-mono">
                                  {kw.historicalConversionCount} 单
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 font-mono">
                                  {kw.conversionRate}%
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="flex flex-col items-start gap-0.5">
                                    <span
                                      className={`inline-flex items-center justify-center font-bold px-2 py-0.5 rounded text-xs ${
                                        currentRank > 0 && currentRank <= 3
                                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                                          : currentRank <= 10 && currentRank > 0
                                          ? "bg-emerald-100 text-emerald-800"
                                          : "bg-slate-100 text-slate-700"
                                      }`}
                                    >
                                      {currentRank === 0 ? "待采集" : currentRank === 999 ? "未进前3页" : `# ${currentRank}`}
                                    </span>
                                    {currentRank > 0 && currentRank !== 999 ? (
                                      <span className="text-[10px] text-slate-400">Amazon 第 {kw.pageNumber} 页</span>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  {kw.pcAdRank === null || kw.pcAdRank === undefined ? (
                                    <span className="text-slate-400 font-mono text-[11px]">—</span>
                                  ) : kw.pcAdRank === 999 ? (
                                    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">未入前3页</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded bg-purple-50 px-2 py-0.5 font-mono text-xs font-semibold text-purple-700 border border-purple-200">
                                      #{kw.pcAdRank}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  {kw.pcSbvRank === null || kw.pcSbvRank === undefined ? (
                                    <span className="text-slate-400 font-mono text-[11px]">—</span>
                                  ) : kw.pcSbvRank === 999 ? (
                                    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">未入前3页</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700 border border-indigo-200">
                                      #{kw.pcSbvRank}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-slate-400 font-mono">
                                  {previousRank === 0 ? "—" : previousRank === 999 ? "未进前3页" : `# ${previousRank}`}
                                </td>
                                <td className="py-2.5 px-3">
                                  {currentRank === 0 ? (
                                    <span className="inline-flex items-center text-slate-400 gap-0.5">等待首次采集</span>
                                  ) : isRisen ? (
                                    <span className="inline-flex items-center text-emerald-600 font-bold gap-0.5">
                                      <TrendingUp className="h-3.5 w-3.5" /> +{change}
                                    </span>
                                  ) : isDropped ? (
                                    <span className="inline-flex items-center text-rose-600 font-bold gap-0.5">
                                      <TrendingDown className="h-3.5 w-3.5" /> {change}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center text-slate-400 gap-0.5">
                                      <Minus className="h-3.5 w-3.5" /> 持平
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <KeywordRankSparkline ranks={sparklineRanks} />
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 font-mono">
                                  {(kw.bestRank ?? 0) === 0 ? "—" : `#${kw.bestRank}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
