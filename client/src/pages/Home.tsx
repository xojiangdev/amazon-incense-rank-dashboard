import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Flame,
  Globe2,
  Layers,
  LineChart,
  Minus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserCheck,
} from "lucide-react";

type Marketplace = "US" | "CA" | "JP";
type MarketplaceFilter = Marketplace | "ALL";

const marketplaceLabel = (marketplace: Marketplace) =>
  marketplace === "US" ? "🇺🇸 美国站" : marketplace === "CA" ? "🇨🇦 加拿大站" : "🇯🇵 日本站";

export default function Home() {
  const [marketplace, setMarketplace] = useState<MarketplaceFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);

  // Quick Action States
  const [isFollowUpModalOpen, setIsFollowUpModalOpen] = useState(false);
  const [followUpStatus, setFollowUpStatus] = useState<"normal" | "watch" | "action_needed" | "optimizing">("action_needed");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [salesName, setSalesName] = useState("销售组");

  // Sync / Import Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newAsin, setNewAsin] = useState("");
  const [newMarketplace, setNewMarketplace] = useState<Marketplace>("US");
  const [newTitle, setNewTitle] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const utils = trpc.useUtils();

  const overviewQuery = trpc.dashboard.overview.useQuery(
    marketplace === "ALL" ? undefined : { marketplace }
  );

  const listingsQuery = trpc.dashboard.listings.useQuery({
    marketplace: marketplace === "ALL" ? undefined : marketplace,
    category: categoryFilter,
  });

  const detailQuery = trpc.dashboard.listingDetail.useQuery(
    { id: selectedListingId ?? (listingsQuery.data?.[0]?.id ?? 1) },
    { enabled: !!(selectedListingId || listingsQuery.data?.[0]?.id) }
  );

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

  const currentDetail = detailQuery.data && listingsQuery.data?.some(item => item.id === detailQuery.data?.listing.id)
    ? detailQuery.data
    : null;

  // Filter listings by search
  const filteredListings = useMemo(() => {
    if (!listingsQuery.data) return [];
    return listingsQuery.data.filter((item) => {
      const matchText = `${item.asin} ${item.sku} ${item.title} ${item.assignedSales}`.toLowerCase();
      return matchText.includes(searchQuery.toLowerCase());
    });
  }, [listingsQuery.data, searchQuery]);

  const activeListingId = selectedListingId ?? listingsQuery.data?.[0]?.id;

  const handleExportCSV = () => {
    if (!currentDetail) return;
    const rows = [
      ["Listing ASIN", "站点", "核心关键词", "今日自然排名", "昨日排名", "变化", "日搜索量", "历史转化数", "转化率(%)"],
      ...currentDetail.keywords.map((kw) => [
        currentDetail.listing.asin,
        currentDetail.listing.marketplace,
        kw.keyword,
        kw.currentRank,
        kw.previousRank,
        (kw.rankChange ?? 0) > 0 ? `+${kw.rankChange}` : `${kw.rankChange}`,
        kw.searchVolume,
        kw.historicalConversionCount,
        kw.conversionRate,
      ]),
    ];
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map((e) => e.join(",")).join("\n");
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
          <div className="flex items-center gap-3">
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
              placeholder="搜索 ASIN、标题或销售姓名..."
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
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <span>在售 Listing 列表</span>
                <span className="text-xs text-slate-400 font-normal">({filteredListings.length} 个)</span>
              </h2>
              <span className="text-[11px] text-slate-400">按销售优先级排序 · 点击查看 6-20 个核心词趋势</span>
            </div>

            <div className="space-y-2.5">
              {filteredListings.map((item) => {
                const isSelected = item.id === activeListingId;
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedListingId(item.id)}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all bg-white hover:border-amber-400/80 hover:shadow-xs ${
                      isSelected ? "border-amber-500 ring-2 ring-amber-500/10 shadow-sm" : "border-slate-200"
                    }`}
                  >
                    <div className="flex gap-3">
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
                        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                          <span className="font-semibold text-slate-700">
                            {item.currency} {item.price}
                          </span>
                          <span>FBA在售库存: {item.fbaStock}</span>
                          <span className="text-slate-400">负责销售: {item.assignedSales}</span>
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
                      <span className="text-slate-400">负责销售：</span>
                      <span className="font-medium text-slate-800">{currentDetail.listing.assignedSales}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">FBA可售库存：</span>
                      <span className="font-medium text-slate-800">{currentDetail.listing.fbaStock} 件</span>
                    </div>
                    <div>
                      <span className="text-slate-400">最新销售备注：</span>
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
                            <th className="py-2.5 px-3">昨日自然位</th>
                            <th className="py-2.5 px-3">日环比趋势</th>
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
      </main>
    </div>
  );
}
