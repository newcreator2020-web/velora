import { z } from "zod";
import { requireTenantRole } from "./auth";

export type CalendarView = "day" | "week" | "agenda";
export type CalendarStatusSet = ("confirmed" | "completed" | "no_show" | "cancelled")[];

export const calendarQuerySchema = z.object({
  view: z.enum(["day", "week", "agenda"]).default("day"),
  date: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "YYYY-MM-DD" })
    .default(new Date().toISOString().slice(0, 10)),
  resource: z.string().default("all"),
  status: z
    .string()
    .default("confirmed,completed,no_show")
    .transform(
      (v) =>
        [
          ...new Set(
            v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ] as string[],
    ),
});

export type CalendarQueryParsed = z.output<typeof calendarQuerySchema>;

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export interface CalendarWindow {
  tz: string;
  range: { start: Date; end: Date; iso_start: string; iso_end: string };
  resource_ids: string[] | null;
  statuses: CalendarStatusSet;
  view: CalendarView;
  anchor_date: string;
}

export interface CalendarContext {
  tenant_id: string;
  membership_role: "owner" | "manager" | "staff";
  window: CalendarWindow;
}

const STATUS_CAP: CalendarStatusSet[number][] = ["confirmed", "completed", "no_show", "cancelled"];

function isSafeTz(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function resolveCalendarContext(
  raw: Record<string, string | string[] | undefined>,
): Promise<CalendarContext> {
  const ctx = await requireTenantRole("staff");
  const parsed = calendarQuerySchema.safeParse({
    view: raw["view"],
    date: raw["date"],
    resource: raw["resource"],
    status: raw["status"],
  });

  const fallbackDate = (() => {
    const tz0 = ctx.business_profile.timezone || "UTC";
    const ok = isSafeTz(tz0);
    const tz = ok ? tz0 : "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${m}-${d}`;
  })();

  const data: CalendarQueryParsed = parsed.success
    ? parsed.data
    : {
        view: "day",
        date: fallbackDate,
        resource: "all",
        status: ["confirmed", "completed", "no_show"],
      };

  const bpTz = ctx.business_profile.timezone || "UTC";
  const tzOk = isSafeTz(bpTz);
  const tz = tzOk ? bpTz : "UTC";
  if (!tzOk) {
    console.warn(
      `calendar:invlid_tz tenant_id=${ctx.tenant.id} raw=${JSON.stringify(bpTz)} fallback=UTC`,
    );
  }

  const anchor = data.date;
  const civilStart = new Date(`${anchor}T00:00:00`);
  let days = 1;
  if (data.view === "week") days = 7;
  if (data.view === "day") days = 1;
  if (data.view === "agenda") days = 1;
  const civilEndExclusive = new Date(civilStart.valueOf() + days * 86400000);
  const start = zonedCivilToUTC(
    civilStart.getFullYear(),
    civilStart.getMonth(),
    civilStart.getDate(),
    0,
    0,
    0,
    tz,
  );
  const end = zonedCivilToUTC(
    civilEndExclusive.getFullYear(),
    civilEndExclusive.getMonth(),
    civilEndExclusive.getDate(),
    0,
    0,
    0,
    tz,
  );

  const resource_ids = parseResourceFilter(data.resource);
  const statuses = parseStatusFilter(data.status);

  return {
    tenant_id: ctx.tenant.id,
    membership_role: ctx.membership.role as "owner" | "manager" | "staff",
    window: {
      tz,
      range: {
        start,
        end,
        iso_start: start.toISOString(),
        iso_end: end.toISOString(),
      },
      resource_ids: resource_ids.length > 0 ? resource_ids : null,
      statuses,
      view: data.view,
      anchor_date: anchor,
    },
  };
}

export function parseResourceFilter(resourceRaw: string): string[] {
  if (!resourceRaw) return [];
  if (resourceRaw === "all") return [];
  const parts = resourceRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (UUID_RE.test(p)) out.push(p);
  }
  return [...new Set(out)];
}

export function parseStatusFilter(rawArr: string[]): CalendarStatusSet {
  const out: CalendarStatusSet = [];
  for (const s of rawArr) {
    if ((STATUS_CAP as string[]).includes(s)) {
      if (!out.includes(s as CalendarStatusSet[number])) {
        out.push(s as CalendarStatusSet[number]);
      }
    }
  }
  return out;
}

export function zonedCivilToUTC(
  y: number,
  m0: number,
  d: number,
  h: number,
  min: number,
  s: number,
  tz: string,
): Date {
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const offsets: PartsMap = {
    year: String(y),
    month: pad2(m0 + 1),
    day: pad2(d),
    hour: pad2(h),
    minute: pad2(min),
    second: pad2(s),
  };
  let lo = -50400;
  let hi = 50400;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 80; i++) {
    const mid = Math.round((lo + hi) / 2);
    const probe = new Date(Date.UTC(y, m0, d, h, min, s) + mid * 1000);
    const map = parts2offsetMap(dtf.formatToParts(probe));
    const delta = Math.abs(hourOf(offsets) - hourOf(map));
    if (sameTime(offsets, map)) {
      best = mid;
      break;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      best = mid;
    }
    if (hourOf(offsets) > hourOf(map)) lo = mid;
    else hi = mid;
    if (Math.abs(lo - hi) <= 1) {
      break;
    }
  }
  const candidate = new Date(Date.UTC(y, m0, d, h, min, s) + best * 1000);
  return candidate;
}

type PartsMap = Record<string, string>;

function parts2offsetMap(parts: Intl.DateTimeFormatPart[]): PartsMap {
  const m: PartsMap = {};
  for (const p of parts) m[p.type] = p.value;
  return m;
}
function sameTime(a: PartsMap, b: PartsMap): boolean {
  return (
    a["year"] === b["year"] &&
    a["month"] === b["month"] &&
    a["day"] === b["day"] &&
    a["hour"] === b["hour"] &&
    a["minute"] === b["minute"] &&
    a["second"] === b["second"]
  );
}
function hourOf(a: PartsMap): number {
  return (
    (parseInt(a["year"] || "0", 10) * 366 * 24 +
      parseInt(a["month"] || "0", 10) * 31 * 24 +
      parseInt(a["day"] || "0", 10) * 24 +
      parseInt(a["hour"] || "0", 10)) *
      3600 +
    parseInt(a["minute"] || "0", 10) * 60 +
    parseInt(a["second"] || "0", 10)
  );
}
