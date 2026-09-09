/* eslint-disable no-console */
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error("FATAL: Missing env NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const email = process.argv[2] || "admin@velora.studio";
const password = process.argv[3] || "admin123";

console.log(`Testing signInWithPassword:`);
console.log(`  URL: ${SUPABASE_URL}`);
console.log(`  email: ${email}`);
console.log(`  password: ${password.replace(/./g, "*")}`);
console.log("");

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const t0 = Date.now();
const { data, error } = await sb.auth.signInWithPassword({ email, password });
const dt = Date.now() - t0;

console.log(`Risultato (${dt}ms):`);
if (error) {
  console.log(`  ❌ ERROR`);
  console.log(`     name: ${error.name}`);
  console.log(`     message: ${error.message}`);
  console.log(`     status: ${error.status ?? "n/a"}`);
  console.log(`     code: ${error.code ?? "n/a"}`);
  process.exit(2);
} else {
  console.log(`  ✅ SUCCESS`);
  console.log(`     user.id: ${data.user?.id ?? "n/a"}`);
  console.log(`     user.email: ${data.user?.email ?? "n/a"}`);
  console.log(`     user.role: ${data.user?.role ?? "n/a"}`);
  console.log(`     session expires_at: ${data.session?.expires_at ?? "n/a"}`);

  console.log("\nTest getUser() con sessione:");
  const { data: user2, error: e2 } = await sb.auth.getUser();
  if (e2) console.log(`  ❌ getUser error: ${e2.message}`);
  else console.log(`  ✅ getUser OK, id: ${user2?.user?.id ?? "n/a"}`);
  process.exit(0);
}
