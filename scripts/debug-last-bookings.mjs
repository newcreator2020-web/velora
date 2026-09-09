import "dotenv/config";
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
if (!URL || !KEY) {
  console.log("ENV_MISSING", { URL: !!URL, KEY: !!KEY });
  process.exit(1);
}
const TENANT = "57ba7988-e8e6-46d4-b4ea-3192420d6ab0";
const qs = new URLSearchParams({
  tenant_id: `eq.${TENANT}`,
  select: "id,customer_name,customer_email,starts_at,ends_at,status,service_id,resource_id",
  order: "created_at.desc",
  limit: "10",
});
const res = await fetch(`${URL}/rest/v1/bookings?${qs.toString()}`, {
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    Prefer: "return=representation",
  },
});
const d = await res.json();
console.log("HTTP", res.status, "COUNT", d.length);
d.forEach((b, i) => {
  console.log(
    `#${i} id=${String(b.id).slice(0, 8)}… status=${b.status} name=${b.customer_name} email=${b.customer_email ?? "-"} starts=${String(b.starts_at ?? "").slice(0, 16)} svc=${String(b.service_id ?? "").slice(0, 6)}…`,
  );
});
