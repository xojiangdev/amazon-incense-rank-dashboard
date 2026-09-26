import { BarChart3, Megaphone, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

const NAVIGATION_COLLAPSED_KEY = "amazon-rank-navigation-collapsed";

const navigationItems = [
  { href: "/", label: "排名看板", icon: BarChart3 },
  { href: "/ads", label: "广告总览", icon: Megaphone },
] as const;

function NavigationLinks({ compact = false, collapsed = false }: { compact?: boolean; collapsed?: boolean }) {
  const [location] = useLocation();

  return (
    <>
      {navigationItems.map(item => {
        const Icon = item.icon;
        const isActive = location === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 rounded-lg font-medium transition-colors ${
              compact ? "px-3 py-2 text-xs" : collapsed ? "justify-center px-2 py-2.5 text-sm" : "px-3 py-2.5 text-sm"
            } ${
              isActive
                ? "bg-amber-50 text-amber-800"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
            aria-current={isActive ? "page" : undefined}
            title={collapsed ? item.label : undefined}
          >
            <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
            {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>
        );
      })}
    </>
  );
}

/** Shared public navigation; this dashboard remains readable without a Manus sign-in. */
export function AppNavigation() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(NAVIGATION_COLLAPSED_KEY) === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(NAVIGATION_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <>
      <aside className={`hidden shrink-0 border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col ${collapsed ? "lg:w-14" : "lg:w-40"}`} aria-label="看板导航">
        <div className={`flex min-h-16 items-center border-b border-slate-100 ${collapsed ? "justify-center px-2" : "justify-between px-3"}`}>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-slate-900">Amazon 运营中心</p>
              <p className="mt-1 text-[11px] text-slate-400">排名与广告监控</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed(value => !value)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className={`space-y-1 ${collapsed ? "p-2" : "p-3"}`} aria-label="主导航">
          <NavigationLinks collapsed={collapsed} />
        </nav>
      </aside>
      <nav className="sticky top-0 z-50 flex gap-1 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:hidden" aria-label="移动主导航">
        <NavigationLinks compact />
      </nav>
    </>
  );
}
