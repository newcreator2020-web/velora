"use client";
import "client-only";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { LogoutButton } from "@/app/(app)/dashboard/LogoutButton";
import { isAtLeastRole, type MembershipRole } from "@/modules/auth/core/roles";

type NavItem = Readonly<{
  label: string;
  href: string;
  minRole: MembershipRole;
  exact?: boolean;
}>;

const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/app", minRole: "staff", exact: true },
  { label: "Calendario", href: "/app/calendar", minRole: "staff" },
  { label: "Prenotazioni", href: "/app/bookings", minRole: "staff" },
  { label: "Clienti", href: "/app/customers", minRole: "staff" },
  { label: "Team", href: "/app/team", minRole: "staff" },
  { label: "Disponibilità", href: "/app/availability", minRole: "manager" },
  { label: "Sito", href: "/app/site", minRole: "manager" },
  { label: "Abbonamento", href: "/app/billing", minRole: "owner" },
  { label: "Impostazioni", href: "/app/settings", minRole: "manager" },
] as const;

export type AppShellProps = Readonly<{
  businessName: string | null;
  membershipRole: MembershipRole;
  userDisplayName: string | null;
  userLocalPart: string | null;
  children: React.ReactNode;
}>;

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (item.exact) return pathname === item.href;
  const base = item.href.endsWith("/") ? item.href : `${item.href}/`;
  return pathname === item.href || pathname.startsWith(base);
}

const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: "Proprietario",
  manager: "Manager",
  staff: "Staff",
};

function SkipLink(): JSX.Element {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-indigo-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      Salta al contenuto principale
    </a>
  );
}

function NavLinks(
  props: Readonly<{
    items: readonly NavItem[];
    pathname: string | null;
    role: MembershipRole;
    onNavigate?: () => void;
  }>,
): JSX.Element {
  const { items, pathname, role, onNavigate } = props;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        if (!isAtLeastRole(role, item.minRole)) return null;
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={() => onNavigate?.()}
              aria-current={active ? "page" : undefined}
              className={[
                "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900",
              ].join(" ")}
            >
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell(props: AppShellProps): JSX.Element {
  const {
    businessName,
    membershipRole,
    userDisplayName,
    userLocalPart: propLocalPart,
    children,
  } = props;

  const safeDisplayName = userDisplayName?.includes("@") ? null : userDisplayName?.trim() || null;
  const userLocalPart = propLocalPart?.trim() || null;

  const pathname = usePathname();

  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((i) => isAtLeastRole(membershipRole, i.minRole)),
    [membershipRole],
  );

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const onPopState = () => setMobileOpen(false);

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileOpen(false);
        openButtonRef.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        const drawer = drawerRef.current;
        if (!drawer) return;
        const focusable = drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("popstate", onPopState);
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";

    requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      const first = drawer.querySelector<HTMLAnchorElement>("nav ul a[href]");
      first?.focus();
    });

    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  }, [mobileOpen]);

  const roleBadge = ROLE_LABEL[membershipRole];
  const userLine = safeDisplayName ?? userLocalPart ?? "Utente";
  const showSub = Boolean(safeDisplayName && userLocalPart);
  const tenantLine = businessName?.trim() || "Attività";

  return (
    <div className="min-h-dvh overflow-x-hidden bg-zinc-50 text-zinc-900">
      <SkipLink />

      <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-zinc-200 bg-white px-4 shadow-sm md:hidden">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium uppercase tracking-wide text-zinc-500">
            {tenantLine}
          </div>
          <div className="truncate text-sm font-semibold text-zinc-900">{roleBadge}</div>
        </div>
        <button
          ref={openButtonRef}
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Apri menu di navigazione"
          aria-controls="app-nav-mobile-drawer"
          aria-expanded={mobileOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      <aside
        className="fixed inset-y-0 left-0 z-50 hidden w-[240px] flex-col border-r border-zinc-200 bg-white md:flex"
        aria-label="Navigazione area privata"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-200 px-4">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white"
          >
            V
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900">{tenantLine}</div>
            <div className="truncate text-xs text-zinc-500">VELORA · {roleBadge}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks items={visibleNavItems} pathname={pathname} role={membershipRole} />
        </nav>
        <div className="border-t border-zinc-200 px-3 py-3">
          <div className="mb-3 px-1">
            <div className="truncate text-sm font-medium text-zinc-900">{userLine}</div>
            {showSub ? <div className="truncate text-xs text-zinc-500">{userLocalPart}</div> : null}
          </div>
          <LogoutButton />
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Chiudi menu navigazione toccando fuori"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 border-0 bg-black/40 p-0 text-transparent md:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        />
      ) : null}

      <aside
        id="app-nav-mobile-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu navigazione"
        className={[
          "fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] transform border-r border-zinc-200 bg-white shadow-xl transition-transform md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900">{tenantLine}</div>
            <div className="truncate text-xs text-zinc-500">VELORA · {roleBadge}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              openButtonRef.current?.focus();
            }}
            aria-label="Chiudi menu di navigazione"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav
          className="h-[calc(100%-4rem-1px)] overflow-y-auto px-3 py-4"
          aria-label="Navigazione area privata"
        >
          <ul className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "group flex items-center rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                      active
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900",
                    ].join(" ")}
                  >
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-zinc-200 px-3 py-3">
          <div className="mb-3 px-1">
            <div className="truncate text-sm font-medium text-zinc-900">{userLine}</div>
            {showSub ? <div className="truncate text-xs text-zinc-500">{userLocalPart}</div> : null}
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="w-full md:pl-[240px]">
        {children}
      </main>
    </div>
  );
}
