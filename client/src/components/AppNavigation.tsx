import { BarChart3, Megaphone } from "lucide-react";
import { Link, useLocation } from "wouter";

const navigationItems = [
  { href: "/", label: "排名看板", icon: BarChart3 },
  { href: "/ads", label: "广告总览", icon: Megaphone },
] as const;

function NavigationLinks({ compact = false }: { compact?: boolean }) {
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
              compact ? "px-3 py-2 text-xs" : "px-3 py-2.5 text-sm"
            } ${
              isActive
                ? "bg-amber-50 text-amber-800"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/** Shared public navigation; this dashboard remains readable without a Manus sign-in. */
export function AppNavigation() {
  return (
    <>
      <aside className="hidden border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-44 lg:flex-col" aria-label="看板导航">
        <div className="border-b border-slate-100 px-4 py-5">
          <p className="text-xs font-semibold tracking-wide text-slate-900">Amazon 运营中心</p>
          <p className="mt-1 text-[11px] text-slate-400">排名与广告监控</p>
        </div>
        <nav className="space-y-1 p-3" aria-label="主导航">
          <NavigationLinks />
        </nav>
      </aside>
      <nav className="sticky top-0 z-50 flex gap-1 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:hidden" aria-label="移动主导航">
        <NavigationLinks compact />
      </nav>
    </>
  );
}
