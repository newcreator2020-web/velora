"use client";
import "client-only";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { LogoutButton } from "@/app/(app)/dashboard/LogoutButton";
import { isAtLeastRole, type MembershipRole } from "@/modules/auth/core/roles";

type NavItem = Readonly<{
  label: string;
  href: string;
  minRole: MembershipRole;
  exact?: boolean;
}>;

type NavGroup = Readonly<{
  id: "operations" | "business" | "site";
  label: string;
  items: readonly NavItem[];
}>;

const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "site",
    label: "Sito",
    items: [
      { label: "Studio sito", href: "/app/site", minRole: "manager" },
      { label: "Analytics", href: "/app/analytics", minRole: "manager" },
      { label: "Abbonamento", href: "/app/billing", minRole: "owner" },
      { label: "Impostazioni", href: "/app/settings", minRole: "manager" },
    ],
  },
  {
    id: "business",
    label: "Attività",
    items: [
      { label: "Clienti", href: "/app/customers", minRole: "staff" },
      { label: "Team", href: "/app/team", minRole: "staff" },
      { label: "Disponibilità", href: "/app/availability", minRole: "manager" },
    ],
  },
  {
    id: "operations",
    label: "Operazioni",
    items: [
      { label: "Dashboard", href: "/app", minRole: "staff", exact: true },
      { label: "Setup iniziale", href: "/app/setup", minRole: "owner" },
      { label: "Calendario", href: "/app/calendar", minRole: "staff" },
      { label: "Prenotazioni", href: "/app/bookings", minRole: "staff" },
    ],
  },
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

const SHELL_BG = "#f1f5f9";
const SHELL_FG = "#0f172a";
const PANEL_BG = "#ffffff";
const MUTED_FG = "#64748b";
const BORDER = "#e5e7eb";
const _BORDER_SOFT = "#f1f5f9";
const ACCENT_BG = "#4f46e5";
const ACCENT_FG = "#ffffff";
const HOVER_BG = "#f1f5f9";
const HOVER_FG = "#0f172a";

function shellStyle(active: boolean): CSSProperties {
  return active
    ? {
        background: ACCENT_BG,
        color: ACCENT_FG,
        boxShadow: "0 1px 2px 0 rgba(15, 23, 42, 0.06)",
      }
    : {
        background: "transparent",
        color: "#334155",
      };
}

function SkipLink(): JSX.Element {
  return (
    <a
      href="#main-content"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
      onFocus={(e) => {
        const t = e.currentTarget;
        t.style.position = "fixed";
        t.style.top = "12px";
        t.style.left = "12px";
        t.style.width = "auto";
        t.style.height = "auto";
        t.style.padding = "10px 14px";
        t.style.margin = "0";
        t.style.overflow = "visible";
        t.style.clip = "auto";
        t.style.borderRadius = "8px";
        t.style.background = ACCENT_BG;
        t.style.color = ACCENT_FG;
        t.style.fontWeight = "600";
        t.style.zIndex = "999";
      }}
      onBlur={(e) => {
        const t = e.currentTarget;
        t.style.position = "absolute";
        t.style.width = "1px";
        t.style.height = "1px";
        t.style.padding = "0";
        t.style.margin = "-1px";
        t.style.overflow = "hidden";
        t.style.clip = "rect(0,0,0,0)";
      }}
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
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {items.map((item) => {
        if (!isAtLeastRole(role, item.minRole)) return null;
        const active = isActive(pathname, item);
        const base = shellStyle(active);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={() => onNavigate?.()}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                textDecoration: "none",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                transition: "background 0.15s ease, color 0.15s ease",
                ...base,
                background: base.background,
                color: base.color,
                boxShadow: base.boxShadow,
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = HOVER_BG;
                  (e.currentTarget as HTMLElement).style.color = HOVER_FG;
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = base.background as string;
                  (e.currentTarget as HTMLElement).style.color = base.color as string;
                }
              }}
            >
              <span style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                {item.label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type NavGroupWithItems = Readonly<{
  id: "operations" | "business" | "site";
  label: string;
  items: readonly NavItem[];
}>;

const MD_BREAKPOINT = 768;

export function AppShell(props: AppShellProps): JSX.Element {
  void _BORDER_SOFT;
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
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth >= MD_BREAKPOINT : true,
  );
  const drawerRef = useRef<HTMLElement>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    const prevBodyBgColor = document.body.style.backgroundColor;
    document.documentElement.style.background = SHELL_BG;
    document.body.style.background = SHELL_BG;
    document.body.style.backgroundColor = SHELL_BG;
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
      document.body.style.backgroundColor = prevBodyBgColor;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => {
      const now = window.innerWidth >= MD_BREAKPOINT;
      setIsDesktop(now);
      if (now) setMobileOpen(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const visibleNavGroups = useMemo<readonly NavGroupWithItems[]>(() => {
    return NAV_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      items: g.items.filter((i) => isAtLeastRole(membershipRole, i.minRole)),
    })).filter((g) => g.items.length > 0);
  }, [membershipRole]);

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

  const shellBgStyle: CSSProperties = {
    minHeight: "100dvh",
    overflowX: "hidden",
    background: SHELL_BG,
    color: SHELL_FG,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  };

  const sidebarFixedStyle: CSSProperties = {
    display: isDesktop ? "flex" : "none",
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: 240,
    flexDirection: "column",
    borderRight: `1px solid ${BORDER}`,
    background: PANEL_BG,
    color: SHELL_FG,
    zIndex: 40,
  };

  const mobileHeaderStyle: CSSProperties = {
    display: isDesktop ? "none" : "flex",
    position: "sticky",
    top: 0,
    zIndex: 30,
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    height: 64,
    padding: "0 16px",
    borderBottom: `1px solid ${BORDER}`,
    background: PANEL_BG,
    boxShadow: "0 1px 2px 0 rgba(15,23,42,0.04)",
  };

  return (
    <div style={shellBgStyle}>
      <SkipLink />

      <header style={mobileHeaderStyle}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              textTransform: "uppercase",
              fontSize: 11,
              letterSpacing: "0.08em",
              fontWeight: 500,
              color: MUTED_FG,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {tenantLine}
          </div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: SHELL_FG,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {roleBadge}
          </div>
        </div>
        <button
          ref={openButtonRef}
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Apri menu di navigazione"
          aria-controls="app-nav-mobile-drawer"
          aria-expanded={mobileOpen}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 8,
            border: `1px solid ${BORDER}`,
            background: PANEL_BG,
            color: "#334155",
            cursor: "pointer",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      <aside style={sidebarFixedStyle} aria-label="Navigazione area privata">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 64,
            flexShrink: 0,
            padding: "0 16px",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              flexShrink: 0,
              borderRadius: 8,
              background: ACCENT_BG,
              color: ACCENT_FG,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            V
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: SHELL_FG,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              {tenantLine}
            </div>
            <div
              style={{
                fontSize: 12,
                color: MUTED_FG,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              VELORA · {roleBadge}
            </div>
          </div>
        </div>

        <nav
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 12px",
          }}
          aria-label="Menu principale"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {visibleNavGroups.map((group) => (
              <div key={group.id}>
                <div
                  style={{
                    marginBottom: 8,
                    padding: "0 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: MUTED_FG,
                    userSelect: "none",
                  }}
                >
                  {group.label}
                </div>
                <NavLinks items={group.items} pathname={pathname} role={membershipRole} />
              </div>
            ))}
          </div>
        </nav>

        <div style={{ borderTop: `1px solid ${BORDER}`, padding: 12 }}>
          <div style={{ padding: "0 4px 12px" }}>
            <div
              style={{
                fontWeight: 500,
                color: SHELL_FG,
                fontSize: 14,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              {userLine}
            </div>
            {showSub ? (
              <div
                style={{
                  color: MUTED_FG,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                }}
              >
                {userLocalPart}
              </div>
            ) : null}
          </div>
          <LogoutButton />
        </div>
      </aside>

      {mobileOpen && !isDesktop ? (
        <button
          type="button"
          aria-label="Chiudi menu navigazione toccando fuori"
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            display: "block",
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.4)",
            border: 0,
            padding: 0,
            cursor: "pointer",
            color: "transparent",
          }}
        />
      ) : null}

      <aside
        id="app-nav-mobile-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu navigazione"
        style={{
          display: isDesktop ? "none" : "flex",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
          width: "85vw",
          maxWidth: 320,
          transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.2s ease",
          borderRight: `1px solid ${BORDER}`,
          background: PANEL_BG,
          color: SHELL_FG,
          flexDirection: "column",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            height: 64,
            flexShrink: 0,
            padding: "0 16px",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: SHELL_FG,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              {tenantLine}
            </div>
            <div
              style={{
                color: MUTED_FG,
                fontSize: 12,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              VELORA · {roleBadge}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              openButtonRef.current?.focus();
            }}
            aria-label="Chiudi menu di navigazione"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: PANEL_BG,
              color: "#334155",
              cursor: "pointer",
            }}
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
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 12px",
          }}
          aria-label="Navigazione area privata (mobile)"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {visibleNavGroups.map((group) => (
              <div key={group.id}>
                <div
                  style={{
                    marginBottom: 8,
                    padding: "0 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: MUTED_FG,
                    userSelect: "none",
                  }}
                >
                  {group.label}
                </div>
                <NavLinks
                  items={group.items}
                  pathname={pathname}
                  role={membershipRole}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            ))}
          </div>
        </nav>

        <div style={{ borderTop: `1px solid ${BORDER}`, padding: 12 }}>
          <div style={{ padding: "0 4px 12px" }}>
            <div
              style={{
                fontWeight: 500,
                color: SHELL_FG,
                fontSize: 14,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              {userLine}
            </div>
            {showSub ? (
              <div
                style={{
                  fontSize: 12,
                  color: MUTED_FG,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                }}
              >
                {userLocalPart}
              </div>
            ) : null}
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        style={{
          width: "100%",
          minHeight: "100dvh",
          display: "block",
          paddingLeft: isDesktop ? 240 : 0,
          padding: 0,
          margin: 0,
          outline: "none",
          boxSizing: "border-box",
        }}
      >
        {children}
      </main>
    </div>
  );
}
