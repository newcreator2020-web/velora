/* eslint-disable no-console */
import { request, json } from "./scratch_f4_http.mjs";

const TONINO_SLUG = "slugo-mtu30v76-1fon";
const TONINO_PUBLIC = `http://localhost:3000/s/${TONINO_SLUG}`;

const HERO_NEW_TITLE = "ESTETISTA TONINO EDIT LIVE FASE4 2026";
const TRUST_NEW_BADGES = ["Qualita", "Esperienza", "Professionalita", "100% Clienti Soddisfatti"];

function print(label, obj) {
  const str = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  console.log(
    `\n=== ${label} ===\n${str.length > 1500 ? str.slice(0, 1500) + `\n...[truncated ${str.length} chars]` : str}`,
  );
}

function patchHeroAndTrust(sections) {
  if (!Array.isArray(sections)) throw new Error("sections not array");
  let heroPatched = 0;
  let trustPatched = 0;
  const out = sections.map((s) => {
    if (!s || typeof s !== "object") return s;
    const copy = JSON.parse(JSON.stringify(s));
    if (copy.type === "hero") {
      if (!copy.props || typeof copy.props !== "object") copy.props = {};
      copy.props.title = HERO_NEW_TITLE;
      heroPatched++;
    }
    if (copy.type === "trust") {
      if (!copy.props || typeof copy.props !== "object") copy.props = {};
      copy.props.badges = TRUST_NEW_BADGES;
      trustPatched++;
    }
    return copy;
  });
  return { patched: out, heroPatched, trustPatched };
}

async function main() {
  console.log(
    "F4 WORKAROUND DRIVER — endpoint /api/f4 tramite Service Client diretto (bypass turbopack action channel)\n",
  );

  // STEP 1: GET pagina app/site per ricevere CSRF cookie
  const get1 = await request("GET", "/app/site");
  print("STEP 1 GET /app/site status", get1.status);
  const csrf = get1.cookies["velora_csrf_token"];
  if (!csrf) {
    console.error("FALLITO: nessun csrf token");
    process.exit(1);
  }
  console.log("✅ CSRF token ricevuto");
  const csrfHeaders = { "x-csrf-token": csrf };

  // STEP 2: READ FULL STATE pre-modifiche
  const pre = json(
    await request("POST", "/api/f4", {
      extraHeaders: csrfHeaders,
      cookies: get1.cookies,
      body: { op: "read_full_state" },
    }),
  );
  if (!pre.ok) {
    print("READ_FULL_STATE FAIL", pre);
    process.exit(1);
  }
  console.log(
    `Stato PRE: published=${pre.tenant_published}, versions=${pre.versions_count}, hero_title=${pre.sections?.find?.((s) => s.type === "hero")?.props?.title ?? "N/A"}`,
  );
  if (!pre.editorial_state_exists) {
    console.error("FALLITO: nessun editorial_state, usare loadEditorialDraft prima");
    process.exit(1);
  }

  // STEP 3: UNPUBLISH (Stato Pubblicata → Bozza)
  const unpub = json(
    await request("POST", "/api/f4", {
      extraHeaders: csrfHeaders,
      cookies: get1.cookies,
      body: { op: "unpublish" },
    }),
  );
  print("STEP 3 UNPUBLISH", unpub);
  const checkAfterUnpub = json(
    await request("POST", "/api/f4", {
      extraHeaders: csrfHeaders,
      cookies: get1.cookies,
      body: { op: "read_state" },
    }),
  );
  if (checkAfterUnpub.tenant_published) {
    console.error("❌ UNPUBLISH FALLITO");
    process.exit(1);
  }
  console.log("✅ UNPUBLISH RIUSCITO: tenant.published=false");

  // STEP 4: PATCH sections hero.title + trust badges
  const { patched, heroPatched, trustPatched } = patchHeroAndTrust(pre.sections);
  console.log(
    `✅ PATCH: heroPatched=${heroPatched}, trustPatched=${trustPatched}, sections=${patched.length}`,
  );
  if (heroPatched !== 1 || trustPatched !== 1) {
    console.error("❌ PATCH sections non trovato hero/trust 1:1");
    process.exit(1);
  }

  // STEP 5: SAVE BOZZA (upsert site_editorial_state)
  const save = json(
    await request("POST", "/api/f4", {
      extraHeaders: csrfHeaders,
      cookies: get1.cookies,
      body: { op: "save", sections: patched, services: pre.services, theme: pre.theme },
    }),
  );
  print("STEP 5 SAVE BOZZA", save);
  if (!save.ok) {
    console.error("❌ SAVE FALLITO");
    process.exit(1);
  }
  console.log("✅ SAVE BOZZA RIUSCITO: revision=", save.revision);

  // STEP 6: PUBLISH (RPC publish_site_draft → version_number MAX+1 = 4)
  const pub = json(
    await request("POST", "/api/f4", {
      extraHeaders: csrfHeaders,
      cookies: get1.cookies,
      body: { op: "publish", expected_revision: save.revision },
    }),
  );
  print("STEP 6 PUBLISH", pub);
  if (!pub.ok) {
    console.error("❌ PUBLISH FALLITO", pub);
    process.exit(1);
  }
  console.log(
    "✅ PUBLISH RIUSCITO: sections_applied=",
    pub.sections_applied,
    "services_applied=",
    pub.services_applied,
    "theme_applied=",
    pub.theme_applied,
  );

  // STEP 7: READ STATE POST-PUBLISH (verifica version_number=4 append-only, hero.title match)
  const post = json(
    await request("POST", "/api/f4", {
      extraHeaders: csrfHeaders,
      cookies: get1.cookies,
      body: { op: "read_full_state" },
    }),
  );
  console.log(`\n=== STEP 7 READ STATE POST-PUBLISH ===`);
  console.log(
    "  editorial_hero_title (from state): ",
    post.sections?.find?.((s) => s.type === "hero")?.props?.title ?? "N/A",
  );
  console.log("  versions_count = ", post.versions_count);
  console.log("  versions (ordered desc vn): ");
  for (const v of post.versions || [])
    console.log("    vn=", v.vn, "status=", v.status, "at=", v.at);
  const latestVn = (post.versions || [])[0]?.vn ?? null;
  const heroNew = post.sections?.find?.((s) => s.type === "hero")?.props?.title ?? "";
  if (latestVn !== 4) {
    console.error(`❌ versione latest non è 4: got ${latestVn}`);
    process.exit(1);
  }
  if (heroNew !== HERO_NEW_TITLE) {
    console.error(`❌ hero title non match: got ${heroNew}`);
    process.exit(1);
  }
  console.log("✅ READ STATE POST OK: latest vn=4, hero.title matches nuovo valore EDIT LIVE");

  // STEP 8: BROWSER PUBBLICO check /s/slugo-mtu30v76-1fon h1 contains EDIT LIVE
  // Revalidate fatto da publish → ricarica pagina pubblica
  await new Promise((r) => setTimeout(r, 1500));
  const respPub = await request("GET", TONINO_PUBLIC.replace("http://localhost:3000", ""));
  const hasNewTitle = respPub.body.includes(HERO_NEW_TITLE);
  console.log(`\n=== STEP 8 PUBBLICO ${TONINO_PUBLIC} ===`);
  console.log("  HTTP status:", respPub.status);
  console.log("  Contains nuovo hero.title?", hasNewTitle);
  if (!hasNewTitle) {
    // Provo a trovare <h1>
    const m = respPub.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    console.log(
      "  <h1> contenuto:",
      m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "Nessun <h1> trovato",
    );
    console.error("❌ SITO PUBBLICO NON CONTIENE NUOVO TITOLO");
    process.exit(1);
  }
  console.log("✅ SITO PUBBLICO CONTIENE NUOVO TITOLO EDIT LIVE FASE4 2026");

  console.log(
    "\n🏁 F4 WORKAROUND DRIVER COMPLETATO. GATE: PENDING cross-tenant leak check SQL (deve essere fatto separatamente con Docker psql count 0).",
  );
}

main().catch((e) => {
  console.error("DRIVER_ERR", e);
  process.exit(1);
});
