"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  cancelBookingAction,
  completeBookingAction,
  noShowBookingAction,
} from "@/app/app/bookings/actions";
import { useFormState } from "react-dom";

type Resource = {
  id: string;
  slug: string | null;
  display_name: string | null;
  active: boolean | null;
  bookable: boolean | null;
  sort_order: number | null;
  color_hex: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type Status = "confirmed" | "completed" | "no_show" | "cancelled";

type CalendarRowBase = {
  row_type: "booking" | "business_closure" | "extra_open" | "reduced_hours" | "resource_time_off";
  booking_id?: string | null;
  starts_at: string;
  ends_at: string;
  status?: Status | null;
  service_id?: string | null;
  service_name?: string | null;
  service_duration_minutes?: number | null;
  resource_id?: string | null;
  resource_display_name?: string | null;
  resource_color_hex?: string | null;
  customer_display_name?: string | null;
};

type Props = {
  timezone: string;
  initialView: "day" | "week" | "agenda";
  initialAnchor: string;
  initialRangeStart: string;
  initialRangeEnd: string;
  initialStatuses: Status[];
  initialResourceIds: string[] | null;
  initialResources: Resource[];
  membershipRole: "owner" | "manager" | "staff";
};

const ALL_STATUS_CAP: Status[] = ["confirmed", "completed", "no_show", "cancelled"];
const DEFAULT_CAP: Status[] = ["confirmed", "completed", "no_show"];

function fmt(iso: string, tz: string, opts?: Intl.DateTimeFormatOptions): string {
  try {
    const dt = new Date(iso);
    const dtf = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      hourCycle: "h23",
      ...(opts ?? {}),
    });
    return dtf.format(dt);
  } catch {
    return String(iso);
  }
}

function timeOnly(iso: string, tz: string): string {
  return fmt(iso, tz, { hour: "2-digit", minute: "2-digit" });
}

function dateOnly(iso: string, tz: string): string {
  return fmt(iso, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function weekdayLabel(iso: string, tz: string): string {
  return fmt(iso, tz, { weekday: "short", day: "2-digit", month: "2-digit" });
}

function addBusinessDays(anchorYYYYMMDD: string, days: number, tz: string): string {
  const [ys, ms, ds] = anchorYYYYMMDD.split("-");
  const y = parseInt(ys ?? "1970", 10);
  const m0 = parseInt(ms ?? "01", 10) - 1;
  const d = parseInt(ds ?? "01", 10);
  const utcMs = Date.UTC(y, m0, d, 12, 0, 0) + days * 86400000;
  const dt = new Date(utcMs);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(dt);
}

function toMondayISO(anchorYYYYMMDD: string, tz: string): string {
  const [ys, ms, ds] = anchorYYYYMMDD.split("-");
  const y = parseInt(ys ?? "1970", 10);
  const m0 = parseInt(ms ?? "01", 10) - 1;
  const d = parseInt(ds ?? "01", 10);
  const dt = new Date(Date.UTC(y, m0, d, 12, 0, 0));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = dtf.formatToParts(dt);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  const offset = idx === 0 ? -6 : 1 - idx;
  return addBusinessDays(anchorYYYYMMDD, offset, tz);
}

const STATUS_LABEL: Record<Status, string> = {
  confirmed: "Confermato",
  completed: "Completato",
  no_show: "No show",
  cancelled: "Cancellato",
};

const STATUS_CLASS: Record<Status, string> = {
  confirmed: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20",
  completed: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-600/20",
  no_show: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  cancelled: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/20",
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      aria-label={`Stato: ${STATUS_LABEL[status]}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          status === "confirmed"
            ? "bg-emerald-500"
            : status === "completed"
              ? "bg-sky-500"
              : status === "no_show"
                ? "bg-amber-500"
                : "bg-neutral-500"
        }`}
        aria-hidden
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function CalendarClient(props: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams();

  const [view, setViewState] = useState<"day" | "week" | "agenda">(
    (query.get("view") as "day" | "week" | "agenda") || props.initialView,
  );
  const [anchor, setAnchorState] = useState<string>(query.get("date") || props.initialAnchor);
  const [resourceFilter, setResourceFilter] = useState<string>(
    query.get("resource") ||
      (props.initialResourceIds ? props.initialResourceIds.join(",") : "all"),
  );
  const [statusCSV, setStatusCSV] = useState<string>(
    query.get("status") || props.initialStatuses.join(","),
  );

  const selectedResourceIDs = useMemo(() => {
    if (!resourceFilter || resourceFilter === "all") return [] as string[];
    const parts = resourceFilter
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(parts)];
  }, [resourceFilter]);

  const selectedStatuses = useMemo<Status[]>(() => {
    const raw = statusCSV
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const out: Status[] = [];
    for (const s of raw) {
      if ((ALL_STATUS_CAP as string[]).includes(s) && !out.includes(s as Status)) {
        out.push(s as Status);
      }
    }
    return out.length ? out : DEFAULT_CAP.slice();
  }, [statusCSV]);

  const pushURL = useCallback(
    (patch: {
      view?: "day" | "week" | "agenda";
      date?: string;
      resource?: string;
      status?: string;
    }) => {
      const next = new URLSearchParams();
      const nextView = patch.view ?? view;
      const nextDate = patch.date ?? anchor;
      const nextRes = patch.resource ?? resourceFilter;
      const nextStatus = patch.status ?? statusCSV;
      next.set("view", nextView);
      next.set("date", nextDate);
      if (nextRes && nextRes !== "all") next.set("resource", nextRes);
      if (nextStatus && nextStatus !== DEFAULT_CAP.join(",")) next.set("status", nextStatus);
      const s = next.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    },
    [pathname, router, view, anchor, resourceFilter, statusCSV],
  );

  const updateView = (v: "day" | "week" | "agenda") => {
    setViewState(v);
    let date = anchor;
    if (v === "week") {
      date = toMondayISO(anchor, props.timezone);
    }
    setAnchorState(date);
    pushURL({ view: v, date });
  };

  const navigateDays = (delta: number) => {
    let date = anchor;
    if (view === "week") date = toMondayISO(anchor, props.timezone);
    const newDate = addBusinessDays(date, delta * (view === "week" ? 7 : 1), props.timezone);
    setAnchorState(newDate);
    pushURL({ date: newDate });
  };

  const goToday = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: props.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    const today = `${y}-${m}-${d}`;
    const setDate = view === "week" ? toMondayISO(today, props.timezone) : today;
    setAnchorState(setDate);
    pushURL({ date: setDate });
  };

  const updateResource = (csv: string) => {
    setResourceFilter(csv);
    pushURL({ resource: csv });
  };

  const updateStatus = (nextStatuses: Status[]) => {
    const csv = nextStatuses.join(",");
    setStatusCSV(csv);
    pushURL({ status: csv });
  };

  // ===========================
  // DATA FETCH + REFRESH STRATEGY
  // ===========================
  const [rows, setRows] = useState<CalendarRowBase[]>([]);
  const [resourcesList, setResourcesList] = useState<Resource[]>(props.initialResources);
  const [isLoading, setIsLoading] = useState(false);
  void isLoading;
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>(props.timezone);
  const [rangeInfo, setRangeInfo] = useState<{ start: string; end: string } | null>({
    start: props.initialRangeStart,
    end: props.initialRangeEnd,
  });
  void rangeInfo;
  const fetchingRef = useRef<Promise<void> | null>(null);
  const refreshSignalRef = useRef(0);

  const fetchData = useCallback(
    async (force = false) => {
      if (!force && fetchingRef.current) return fetchingRef.current;
      const sp = new URLSearchParams();
      sp.set("view", view);
      sp.set("date", anchor);
      if (selectedResourceIDs.length > 0) sp.set("resource", selectedResourceIDs.join(","));
      sp.set("status", selectedStatuses.join(","));
      const url = `/api/app/calendar?${sp.toString()}`;
      const p = (async () => {
        setIsLoading(true);
        setErrorCode(null);
        setErrorMessage(null);
        try {
          const r = await fetch(url, { credentials: "same-origin", cache: "no-store" });
          const json = await r.json();
          if (json && json.ok === true) {
            setRows(json.rows ?? []);
            setResourcesList(json.resources ?? []);
            setTimezone(json.timezone ?? props.timezone);
            setRangeInfo({ start: json.range.start, end: json.range.end });
            setGeneratedAt(json.generated_at ?? new Date().toISOString());
          } else if (json && json.ok === false) {
            setErrorCode(json.code ?? "CALENDAR_QUERY_FAILED");
            setErrorMessage(json.message ?? "Errore calendario");
            setRows([]);
          } else {
            setErrorCode("CALENDAR_QUERY_FAILED");
            setErrorMessage("Risposta non valida dal server.");
          }
        } catch {
          setErrorCode("INTERNAL");
          setErrorMessage("Impossibile caricare il calendario. Riprova.");
        } finally {
          setIsLoading(false);
          fetchingRef.current = null;
        }
      })();
      fetchingRef.current = p;
      refreshSignalRef.current += 1;
      return p;
    },
    [view, anchor, selectedResourceIDs, selectedStatuses, props.timezone],
  );

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    let visibleTimer: number | null = null;
    let pollTimer: number | null = null;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        visibleTimer = window.setTimeout(() => {
          void fetchData(true);
        }, 300);
      }
    };
    const onFocus = () => {
      void fetchData(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchData(true);
      }
    }, 60000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      if (visibleTimer) window.clearTimeout(visibleTimer);
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [fetchData]);

  // ===========================
  // BOOKING DRAWER
  // ===========================
  const [activeBooking, setActiveBooking] = useState<CalendarRowBase | null>(null);

  // ===========================
  // RESPONSIVE DETECTION (matches required default agenda at 375)
  // ===========================
  const [viewport, setViewport] = useState<"mobile" | "tablet" | "desktop">(
    (() => {
      if (typeof window === "undefined") return "desktop";
      const w = window.innerWidth;
      if (w <= 600) return "mobile";
      if (w <= 900) return "tablet";
      return "desktop";
    })(),
  );
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setViewport(w <= 600 ? "mobile" : w <= 900 ? "tablet" : "desktop");
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const effectiveView = useMemo<"day" | "week" | "agenda">(() => {
    if (viewport === "mobile" && !query.get("view")) return "agenda";
    return view;
  }, [viewport, view, query]);

  // ===========================
  // RESOURCE COLUMNS STRATEGY
  // ===========================
  const allResourcesSorted = useMemo(() => {
    return resourcesList.slice().sort((a, b) => {
      const sa = a.sort_order ?? 9999;
      const sb = b.sort_order ?? 9999;
      if (sa !== sb) return sa - sb;
      return (a.display_name ?? "").localeCompare(b.display_name ?? "");
    });
  }, [resourcesList]);

  const filteredRes = useMemo(() => {
    if (selectedResourceIDs.length === 0) return allResourcesSorted;
    const set = new Set(selectedResourceIDs);
    return allResourcesSorted.filter((r) => set.has(r.id));
  }, [allResourcesSorted, selectedResourceIDs]);

  const maxCols = useMemo(() => {
    if (viewport === "tablet") return 4;
    return 5;
  }, [viewport]);

  const displayedResources = useMemo(() => {
    if (effectiveView === "agenda") return filteredRes;
    if (effectiveView === "week") return filteredRes;
    if (filteredRes.length <= maxCols) return filteredRes;
    return filteredRes.slice(0, maxCols);
  }, [filteredRes, maxCols, effectiveView]);

  // ===========================
  // RENDER
  // ===========================
  return (
    <div className="space-y-3" aria-label="Calendario operativo">
      <Toolbar
        view={view}
        setView={updateView}
        anchor={anchor}
        tz={timezone}
        navigateDays={navigateDays}
        goToday={goToday}
        allResources={allResourcesSorted}
        selectedIDs={selectedResourceIDs}
        onSelectResource={updateResource}
        selectedStatuses={selectedStatuses}
        onToggleStatus={(s) => {
          const set = new Set(selectedStatuses);
          if (set.has(s)) set.delete(s);
          else set.add(s);
          updateStatus([...set]);
        }}
      />

      {errorCode ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <div className="font-semibold">Errore caricamento</div>
          <div className="mt-1">{errorMessage}</div>
        </div>
      ) : null}

      {generatedAt ? (
        <div className="text-xs text-neutral-500" aria-live="polite">
          Aggiornato:{" "}
          {fmt(generatedAt, timezone, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            day: "2-digit",
            month: "2-digit",
          })}
          {" · "}Fuso: {timezone}
        </div>
      ) : null}

      {effectiveView === "agenda" ? (
        <AgendaView
          rows={rows}
          resources={displayedResources}
          tz={timezone}
          anchor={anchor}
          viewDays={view === "week" ? 7 : 1}
          onOpen={(b) => setActiveBooking(b)}
        />
      ) : effectiveView === "week" ? (
        <WeekView
          rows={rows}
          resources={displayedResources}
          tz={timezone}
          anchor={toMondayISO(anchor, timezone)}
          rangeStartISO={rangeInfo?.start ?? props.initialRangeStart}
          rangeEndISO={rangeInfo?.end ?? props.initialRangeEnd}
          onOpen={(b) => setActiveBooking(b)}
        />
      ) : (
        <DayView
          rows={rows}
          resources={displayedResources}
          tz={timezone}
          anchor={anchor}
          rangeStartISO={rangeInfo?.start ?? props.initialRangeStart}
          rangeEndISO={rangeInfo?.end ?? props.initialRangeEnd}
          showResourceSelector={allResourcesSorted.length > maxCols}
          allResources={allResourcesSorted}
          selectedIDs={selectedResourceIDs}
          onPickRes={(id) => {
            if (id === "all") {
              updateResource("all");
            } else {
              updateResource(id);
            }
          }}
          onOpen={(b) => setActiveBooking(b)}
        />
      )}

      {activeBooking ? (
        <BookingDrawer
          booking={activeBooking}
          tz={timezone}
          onClose={() => setActiveBooking(null)}
          role={props.membershipRole}
          onStatusChanged={() => {
            void fetchData(true);
          }}
        />
      ) : null}
    </div>
  );
}

function Toolbar(props: {
  view: "day" | "week" | "agenda";
  setView: (v: "day" | "week" | "agenda") => void;
  anchor: string;
  tz: string;
  navigateDays: (delta: number) => void;
  goToday: () => void;
  allResources: Resource[];
  selectedIDs: string[];
  onSelectResource: (csv: string) => void;
  selectedStatuses: Status[];
  onToggleStatus: (s: Status) => void;
}) {
  return (
    <div className="flex flex-wrap items-stretch justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Giorno precedente"
          onClick={() => props.navigateDays(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={props.goToday}
          className="inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Oggi
        </button>
        <button
          type="button"
          aria-label="Giorno successivo"
          onClick={() => props.navigateDays(1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
        >
          ›
        </button>
        <div
          aria-live="polite"
          className="ml-2 hidden text-sm font-semibold text-neutral-800 sm:block"
        >
          {props.anchor}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Vista calendario"
        className="flex items-center rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs"
      >
        {(
          [
            ["day", "Giorno"],
            ["week", "Settimana"],
            ["agenda", "Agenda"],
          ] as const
        ).map(([k, l]) => {
          const active = props.view === k;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => props.setView(k)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                active
                  ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200"
                  : "text-neutral-600"
              }`}
            >
              {l}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-600">
          <span className="mb-1 block font-medium">Operatori</span>
          <select
            value={props.selectedIDs.length === 0 ? "__all__" : props.selectedIDs[0]}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__all__") props.onSelectResource("all");
              else props.onSelectResource(v);
            }}
            aria-label="Filtro operatore singolo"
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
          >
            <option value="__all__">Tutti</option>
            {props.allResources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name ?? r.slug ?? r.id}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1 rounded-md border border-neutral-200 bg-white p-1">
          {ALL_STATUS_CAP.map((s) => {
            const on = props.selectedStatuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => props.onToggleStatus(s)}
                className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                  on ? STATUS_CLASS[s] : "text-neutral-500 hover:bg-neutral-50"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===========================
// DAY VIEW
// ===========================
function DayView(props: {
  rows: CalendarRowBase[];
  resources: Resource[];
  tz: string;
  anchor: string;
  rangeStartISO: string;
  rangeEndISO: string;
  showResourceSelector: boolean;
  allResources: Resource[];
  selectedIDs: string[];
  onPickRes: (v: string) => void;
  onOpen: (b: CalendarRowBase) => void;
}) {
  const hours: number[] = [];
  for (let h = 6; h <= 22; h++) hours.push(h);
  const startOfDayMs = new Date(props.rangeStartISO).valueOf();
  const endOfDayMs = new Date(props.rangeEndISO).valueOf();
  const dayHours = endOfDayMs - startOfDayMs;
  const viewStartFrac = 6 / 24;
  const viewEndFrac = 22 / 24;
  const viewSpanFrac = viewEndFrac - viewStartFrac;

  const yTop = (iso: string): number => {
    const ms = new Date(iso).valueOf();
    const frac24 = (ms - startOfDayMs) / dayHours;
    const frac = (frac24 - viewStartFrac) / viewSpanFrac;
    return Math.min(Math.max(0, frac), 1) * 100;
  };
  const heightPx = (starts_at: string, ends_at: string): number => {
    const a = new Date(starts_at).valueOf();
    const b = new Date(ends_at).valueOf();
    const frac24 = (b - a) / dayHours;
    const frac = frac24 / viewSpanFrac;
    return Math.min(Math.max(0.01, frac), 1) * 100;
  };

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const nowPct = (() => {
    const frac24 = (nowMs - startOfDayMs) / dayHours;
    const frac = (frac24 - viewStartFrac) / viewSpanFrac;
    return Math.min(Math.max(0, frac), 1) * 100;
  })();

  const bookingsByResource = useMemo(() => {
    const map: Record<string, CalendarRowBase[]> = {};
    const closures: CalendarRowBase[] = [];
    const extras: CalendarRowBase[] = [];
    const reduced: CalendarRowBase[] = [];
    const timeoffs: Record<string, CalendarRowBase[]> = {};
    for (const r of props.resources) {
      map[r.id] = [];
      timeoffs[r.id] = [];
    }
    for (const row of props.rows) {
      if (row.row_type === "booking") {
        const key = row.resource_id ?? "__noid__";
        if (!map[key]) map[key] = [];
        map[key].push(row);
      } else if (row.row_type === "business_closure") closures.push(row);
      else if (row.row_type === "extra_open") extras.push(row);
      else if (row.row_type === "reduced_hours") reduced.push(row);
      else if (row.row_type === "resource_time_off") {
        const k = row.resource_id ?? "__noid__";
        if (!timeoffs[k]) timeoffs[k] = [];
        timeoffs[k].push(row);
      }
    }
    return { map, closures, extras, reduced, timeoffs };
  }, [props.rows, props.resources]);

  const columnResources =
    props.resources.length > 0
      ? props.resources
      : [
          {
            id: "__nores__",
            slug: "__nores__",
            display_name: "Nessun operatore",
            active: true,
            bookable: true,
            sort_order: 0,
            color_hex: null,
            created_at: null,
            updated_at: null,
          } as Resource,
        ];

  return (
    <div className="space-y-3">
      {props.showResourceSelector ? (
        <div
          data-cal-res-selector="true"
          className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-200 bg-white p-2 text-xs"
        >
          <span className="mr-1 text-neutral-500">Operatori:</span>
          {props.allResources.map((r) => {
            const on = props.selectedIDs.length === 0 || props.selectedIDs.includes(r.id);
            return (
              <button
                data-cal-res-chip="true"
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const allOn = props.selectedIDs.length === 0;
                  if (allOn || props.selectedIDs.includes(r.id)) {
                    const nxt = allOn
                      ? props.allResources.filter((x) => x.id !== r.id).map((x) => x.id)
                      : props.selectedIDs.filter((x) => x !== r.id);
                    props.onPickRes(nxt.length === 0 ? "all" : nxt.join(","));
                  } else {
                    const nxt = [...props.selectedIDs, r.id];
                    props.onPickRes(nxt.join(","));
                  }
                }}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                  on
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: r.color_hex ?? "#cbd5e1" }}
                  aria-hidden
                />
                {r.display_name ?? r.slug ?? r.id}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        data-cal-day-grid="true"
        className="grid overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm"
        style={{
          display: "grid",
          gridTemplateColumns: `64px repeat(${columnResources.length}, minmax(180px, 1fr))`,
          gridTemplateRows: `40px repeat(${hours.length}, 48px)`,
        }}
        aria-label={`Vista giorno ${props.anchor}`}
      >
        <div
          className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-50 px-2 py-2 text-xs font-medium text-neutral-500"
          style={{ position: "sticky" }}
        >
          Ora
        </div>
        {columnResources.map((r) => (
          <div
            key={r.id}
            data-cal-res-header={r.id}
            className="border-b border-neutral-200 bg-neutral-50 px-2 py-2 text-xs font-semibold text-neutral-700"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: r.color_hex ?? "#cbd5e1" }}
              />
              {r.display_name ?? r.slug ?? r.id}
            </div>
          </div>
        ))}

        {hours.map((h) => (
          <div key={`l-${h}`} className="contents" style={{ display: "contents" }}>
            <div
              className="sticky left-0 z-10 border-r border-neutral-100 bg-white px-2 pt-1 text-right text-[10px] font-medium text-neutral-500"
              style={{ minHeight: 48, position: "sticky" }}
            >
              {h.toString().padStart(2, "0")}:00
            </div>
            {columnResources.map((r) => (
              <div
                key={`${r.id}-${h}`}
                className="relative border-l border-neutral-100"
                style={{ minHeight: 48, position: "relative" }}
              />
            ))}
          </div>
        ))}

        <div
          className="relative col-start-2 row-start-2"
          aria-hidden
          style={{ gridColumn: `2 / span ${columnResources.length}`, display: "none" }}
        />
        {bookingsByResource.closures.map((c, i) => (
          <div
            data-cal-block="business_closure"
            key={`cl-${i}`}
            className="pointer-events-none absolute col-start-2 rounded-sm bg-neutral-900/5 ring-1 ring-inset ring-neutral-400/30"
            style={{
              gridColumn: `2 / span ${columnResources.length}`,
              gridRow: `2 / span ${hours.length}`,
              position: "absolute",
              top: `${yTop(c.starts_at)}%`,
              height: `${heightPx(c.starts_at, c.ends_at)}%`,
              left: 0,
              right: 0,
            }}
          >
            <div className="px-2 py-1 text-[10px] font-semibold text-neutral-700">Chiusura</div>
          </div>
        ))}
        {bookingsByResource.extras.map((c, i) => (
          <div
            data-cal-block="extra_open"
            key={`ex-${i}`}
            className="pointer-events-none absolute col-start-2 rounded-sm bg-emerald-50 ring-1 ring-inset ring-emerald-200"
            style={{
              gridColumn: `2 / span ${columnResources.length}`,
              gridRow: `2 / span ${hours.length}`,
              position: "absolute",
              top: `${yTop(c.starts_at)}%`,
              height: `${heightPx(c.starts_at, c.ends_at)}%`,
              left: 0,
              right: 0,
            }}
          >
            <div className="px-2 py-1 text-[10px] font-semibold text-emerald-700">
              Apertura straordinaria
            </div>
          </div>
        ))}
        {bookingsByResource.reduced.map((c, i) => (
          <div
            data-cal-block="reduced_hours"
            key={`rd-${i}`}
            className="pointer-events-none absolute col-start-2 rounded-sm bg-amber-50 ring-1 ring-inset ring-amber-200"
            style={{
              gridColumn: `2 / span ${columnResources.length}`,
              gridRow: `2 / span ${hours.length}`,
              position: "absolute",
              top: `${yTop(c.starts_at)}%`,
              height: `${heightPx(c.starts_at, c.ends_at)}%`,
              left: 0,
              right: 0,
            }}
          >
            <div className="px-2 py-1 text-[10px] font-semibold text-amber-700">Orario ridotto</div>
          </div>
        ))}

        {columnResources.map((r, idx) => {
          const list = bookingsByResource.map[r.id] ?? [];
          const timeoffs = bookingsByResource.timeoffs[r.id] ?? [];
          return (
            <div
              key={`col-${r.id}`}
              data-cal-res-col={r.id}
              className="relative"
              style={{
                gridColumn: 2 + idx,
                gridRow: `2 / span ${hours.length}`,
                position: "relative",
              }}
            >
              {timeoffs.map((t, i) => (
                <div
                  data-cal-block="resource_time_off"
                  key={`to-${i}`}
                  className="pointer-events-none absolute inset-x-0 rounded-sm bg-amber-100/40 ring-1 ring-inset ring-amber-300/60"
                  style={{
                    position: "absolute",
                    top: `${yTop(t.starts_at)}%`,
                    height: `${heightPx(t.starts_at, t.ends_at)}%`,
                  }}
                >
                  <div className="px-2 py-1 text-[10px] font-semibold text-amber-800">Ferie</div>
                </div>
              ))}
              {list.map((b) => (
                <BookingBlock
                  key={b.booking_id ?? Math.random()}
                  b={b}
                  resourceId={r.id}
                  top={yTop(b.starts_at)}
                  height={heightPx(b.starts_at, b.ends_at)}
                  tz={props.tz}
                  onOpen={props.onOpen}
                />
              ))}
              {nowPct > 0 && nowPct < 100 && idx === 0 ? (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-rose-500/80"
                  style={{ position: "absolute", top: `${nowPct}%` }}
                  aria-label="Ora corrente"
                >
                  <span className="rounded-br bg-rose-500 px-1 text-[10px] font-bold text-white">
                    ●
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BookingBlock(props: {
  b: CalendarRowBase;
  resourceId: string;
  top: number;
  height: number;
  tz: string;
  onOpen: (b: CalendarRowBase) => void;
}) {
  const color = props.b.resource_color_hex ?? "#3b82f6";
  const s = props.b.status as Status;
  return (
    <button
      data-booking-id={props.b.booking_id ?? undefined}
      data-booking-resource={props.resourceId}
      type="button"
      onClick={() => props.onOpen(props.b)}
      aria-label={`Prenotazione ${props.b.service_name ?? ""} ${props.b.customer_display_name ?? ""}`}
      className="absolute inset-x-1 overflow-hidden rounded-md px-2 py-1 text-left text-[11px] shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
      style={{
        position: "absolute",
        left: 4,
        right: 4,
        top: `calc(${props.top}% + 1px)`,
        height: `calc(${Math.max(1.2, props.height)}% - 2px)`,
        background: color,
        color: lightColor(color) ? "#111" : "#fff",
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="truncate font-semibold">
          {timeOnly(props.b.starts_at, props.tz)}–{timeOnly(props.b.ends_at, props.tz)}
        </div>
        <div className="shrink-0" data-cal-status="true">
          {s ? (
            <span className="rounded-sm bg-black/10 px-1 text-[9px] font-semibold uppercase">
              {STATUS_LABEL[s].slice(0, 4)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="truncate">{props.b.service_name ?? "Servizio"}</div>
      <div className="truncate text-[10px] opacity-90">{props.b.customer_display_name ?? ""}</div>
    </button>
  );
}

function lightColor(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6;
}

// ===========================
// WEEK VIEW
// ===========================
function WeekView(props: {
  rows: CalendarRowBase[];
  resources: Resource[];
  tz: string;
  anchor: string;
  rangeStartISO: string;
  rangeEndISO: string;
  onOpen: (b: CalendarRowBase) => void;
}) {
  const days: Date[] = [];
  const weekStart = new Date(props.rangeStartISO);
  const weekEnd = new Date(props.rangeEndISO);
  const totalDays = Math.max(1, Math.min(7, Math.round((+weekEnd - +weekStart) / 86400000)));
  for (let i = 0; i < totalDays; i++) {
    days.push(new Date(+weekStart + i * 86400000));
  }

  const bookingsByDayRes = useMemo(() => {
    const map: Record<string, CalendarRowBase[]> = {};
    for (const r of props.rows) {
      if (r.row_type !== "booking") continue;
      const d = dateOnly(r.starts_at, props.tz);
      const key = `${d}__${r.resource_id ?? "noid"}`;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [props.rows, props.tz]);

  return (
    <div
      data-cal-week="true"
      className="grid overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm"
      style={{
        display: "grid",
        gridTemplateColumns: `140px repeat(7, minmax(140px, 1fr))`,
      }}
      aria-label={`Vista settimana ${props.anchor}`}
    >
      <div
        className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-50 px-2 py-2 text-xs font-medium text-neutral-500"
        style={{ position: "sticky" }}
      >
        Operatore
      </div>
      {days.map((d) => {
        const iso = new Intl.DateTimeFormat("en-CA", {
          timeZone: props.tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d);
        return (
          <div
            data-cal-weekday="true"
            key={iso}
            className="border-b border-neutral-200 bg-neutral-50 px-2 py-2 text-xs font-semibold text-neutral-700"
          >
            {weekdayLabel(iso, props.tz)}
          </div>
        );
      })}

      {props.resources.length === 0 ? (
        <div className="col-span-full p-6 text-center text-sm text-neutral-500">
          Nessun operatore.
        </div>
      ) : null}

      {props.resources.map((r) => (
        <div key={`wk-res-${r.id}`} className="contents" style={{ display: "contents" }}>
          <div
            className="sticky left-0 z-10 flex items-center gap-2 border-b border-r border-neutral-100 bg-white px-2 py-2 text-xs font-medium text-neutral-700"
            style={{ position: "sticky" }}
          >
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: r.color_hex ?? "#cbd5e1" }}
            />
            <span className="truncate">{r.display_name ?? r.slug ?? r.id}</span>
          </div>
          {days.map((d) => {
            const iso = new Intl.DateTimeFormat("en-CA", {
              timeZone: props.tz,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(d);
            const key = `${iso}__${r.id}`;
            const list = bookingsByDayRes[key] ?? [];
            return (
              <div
                key={`${r.id}-${iso}`}
                className="space-y-1 border-b border-l border-neutral-100 p-1"
              >
                {list.map((b) => (
                  <button
                    data-booking-id={b.booking_id ?? undefined}
                    key={b.booking_id ?? Math.random()}
                    type="button"
                    onClick={() => props.onOpen(b)}
                    className="block w-full rounded-md px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
                    style={{
                      background: r.color_hex ?? "#3b82f6",
                      color: lightColor(r.color_hex ?? "#3b82f6") ? "#111" : "#fff",
                    }}
                  >
                    <div className="truncate">
                      {timeOnly(b.starts_at, props.tz)} {b.service_name ?? ""}
                    </div>
                    <div className="truncate text-[10px] opacity-90">
                      {b.customer_display_name ?? ""}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ===========================
// AGENDA VIEW (mobile default)
// ===========================
function AgendaView(props: {
  rows: CalendarRowBase[];
  resources: Resource[];
  tz: string;
  anchor: string;
  viewDays: number;
  onOpen: (b: CalendarRowBase) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, CalendarRowBase[]>();
    for (const r of props.rows) {
      if (r.row_type !== "booking") continue;
      const d = dateOnly(r.starts_at, props.tz);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(r);
    }
    for (const arr of map.values())
      arr.sort((a, b) => new Date(a.starts_at).valueOf() - new Date(b.starts_at).valueOf());
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [props.rows, props.tz]);

  return (
    <div data-cal-agenda="true" className="space-y-3" aria-label="Agenda giornaliera">
      {groups.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500"
        >
          Nessun appuntamento nel periodo selezionato.
        </div>
      ) : (
        groups.map(([day, list]) => (
          <section
            key={day}
            aria-label={`Appuntamenti ${day}`}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
          >
            <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-700">
              {day}
            </div>
            <ul className="divide-y divide-neutral-100">
              {list.map((b) => (
                <li key={b.booking_id ?? String(b.starts_at) + (b.customer_display_name ?? "")}>
                  <button
                    data-booking-id={b.booking_id ?? undefined}
                    type="button"
                    onClick={() => props.onOpen(b)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-neutral-900 tabular-nums">
                          {timeOnly(b.starts_at, props.tz)}
                          <span aria-hidden>–</span>
                          {timeOnly(b.ends_at, props.tz)}
                        </span>
                        {b.service_duration_minutes ? (
                          <span className="text-xs text-neutral-500">
                            · {b.service_duration_minutes} min
                          </span>
                        ) : null}
                        {b.status ? <StatusBadge status={b.status as Status} /> : null}
                      </div>
                      <div className="mt-1 text-sm font-medium text-neutral-800 truncate">
                        {b.service_name ?? "Servizio"}
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-500 truncate">
                        {b.customer_display_name ?? ""}
                        {b.resource_display_name ? ` · ${b.resource_display_name}` : ""}
                      </div>
                    </div>
                    {b.resource_color_hex ? (
                      <span
                        aria-hidden
                        className="mt-1 inline-block h-6 w-1 shrink-0 rounded-full"
                        style={{ background: b.resource_color_hex }}
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

// ===========================
// BOOKING DRAWER (read-only)
// ===========================
function BookingDrawer(props: {
  booking: CalendarRowBase;
  tz: string;
  onClose: () => void;
  role: "owner" | "manager" | "staff";
  onStatusChanged: () => void;
}) {
  const b = props.booking;
  const canOperate = props.role === "owner" || props.role === "manager";

  const [cancelState, cancelAct] = useFormState(cancelBookingAction, null);
  const [completeState, completeAct] = useFormState(completeBookingAction, null);
  const [noShowState, noShowAct] = useFormState(noShowBookingAction, null);

  useEffect(() => {
    if (cancelState?.ok === true || completeState?.ok === true || noShowState?.ok === true) {
      props.onStatusChanged();
      props.onClose();
    }
  }, [cancelState, completeState, noShowState, props]);

  return (
    <div
      data-cal-drawer="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-drawer-title"
      className="fixed inset-0 z-50 flex items-end justify-end bg-neutral-900/40 sm:items-center sm:justify-center"
    >
      <button
        data-cal-drawer-close="true"
        type="button"
        aria-label="Chiudi pannello"
        onClick={props.onClose}
        className="absolute inset-0 h-full w-full cursor-default appearance-none bg-transparent"
      />
      <div className="relative w-full max-w-md rounded-t-2xl border border-neutral-200 bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2
              id="calendar-drawer-title"
              className="truncate text-base font-semibold text-neutral-900"
            >
              Dettaglio appuntamento
            </h2>
            <div className="mt-1 text-xs text-neutral-500 truncate">
              {b.service_name ?? "Servizio"} · {timeOnly(b.starts_at, props.tz)}–
              {timeOnly(b.ends_at, props.tz)}
            </div>
          </div>
          <button
            data-cal-drawer-close="true"
            type="button"
            aria-label="Chiudi dettaglio"
            onClick={props.onClose}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
          >
            ✕
          </button>
        </div>

        <dl className="divide-y divide-neutral-100 px-4 text-sm">
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-neutral-500">Cliente</dt>
            <dd className="font-medium text-neutral-900 truncate">
              {b.customer_display_name ?? "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-neutral-500">Servizio</dt>
            <dd className="font-medium text-neutral-900 truncate">{b.service_name ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-neutral-500">Operatore</dt>
            <dd className="font-medium text-neutral-900 truncate">
              {b.resource_display_name ?? "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-neutral-500">Data</dt>
            <dd className="font-medium text-neutral-900">
              {fmt(b.starts_at, props.tz, {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-neutral-500">Fascia oraria</dt>
            <dd className="font-medium text-neutral-900 tabular-nums">
              {timeOnly(b.starts_at, props.tz)} – {timeOnly(b.ends_at, props.tz)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-neutral-500">Durata</dt>
            <dd className="font-medium text-neutral-900">
              {b.service_duration_minutes ? `${b.service_duration_minutes} min` : "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-neutral-500">Stato</dt>
            <dd>
              {b.status ? (
                <StatusBadge status={b.status as Status} />
              ) : (
                <span className="text-neutral-400">—</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="space-y-2 border-t border-neutral-200 px-4 py-4">
          {canOperate &&
          b.booking_id &&
          b.status &&
          b.status !== "cancelled" &&
          b.status !== "completed" &&
          b.status !== "no_show" ? (
            <form action={cancelAct}>
              <input type="hidden" name="booking_id" value={b.booking_id} />
              <button
                type="submit"
                className="w-full rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
              >
                Cancella prenotazione
              </button>
              {cancelState && cancelState.ok === false ? (
                <p className="mt-1 text-xs text-rose-700">{cancelState.error}</p>
              ) : null}
            </form>
          ) : null}

          {canOperate && b.booking_id && b.status === "confirmed" ? (
            <>
              <form action={completeAct}>
                <input type="hidden" name="booking_id" value={b.booking_id} />
                <button
                  type="submit"
                  className="w-full rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
                >
                  Segna come completato
                </button>
                {completeState && completeState.ok === false ? (
                  <p className="mt-1 text-xs text-sky-700">{completeState.error}</p>
                ) : null}
              </form>
              <form action={noShowAct}>
                <input type="hidden" name="booking_id" value={b.booking_id} />
                <button
                  type="submit"
                  className="w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Segna come No Show
                </button>
                {noShowState && noShowState.ok === false ? (
                  <p className="mt-1 text-xs text-amber-700">{noShowState.error}</p>
                ) : null}
              </form>
            </>
          ) : null}

          {!canOperate ? (
            <p className="text-xs text-neutral-500">
              Non disponi delle autorizzazioni per modificare lo stato di questa prenotazione.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
