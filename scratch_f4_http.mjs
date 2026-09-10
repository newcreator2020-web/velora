import http from "node:http";

function lowcaseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  }
  return out;
}

function _extractCookiesFromHeader(cookiesHeader) {
  const out = {};
  if (!cookiesHeader) return out;
  const arr = Array.isArray(cookiesHeader) ? cookiesHeader : [cookiesHeader];
  for (const header of arr) {
    for (const part of String(header).split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  }
  return out;
}

export function request(method, path, opts = {}) {
  const u = new URL(path, "http://localhost:3000");
  const cookies = opts.cookies ?? {};
  return new Promise((resolve, reject) => {
    let bodyStr;
    if (opts.body !== undefined) {
      if (opts.json !== false && typeof opts.body !== "string") {
        bodyStr = JSON.stringify(opts.body);
      } else {
        bodyStr = String(opts.body);
      }
    }
    const headers = {
      Host: "localhost:3000",
    };
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (cookieStr) headers["Cookie"] = cookieStr;
    if (bodyStr !== undefined) {
      headers["Content-Type"] = opts.json !== false ? "application/json" : "text/plain";
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
    }
    if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders);

    const req = http.request(
      {
        method,
        hostname: "127.0.0.1",
        port: 3000,
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const setCookieRaw = [];
          const incoming = res.headers;
          if (Array.isArray(incoming["set-cookie"])) setCookieRaw.push(...incoming["set-cookie"]);
          else if (typeof incoming["set-cookie"] === "string")
            setCookieRaw.push(incoming["set-cookie"]);
          const merged = { ...cookies };
          for (const raw of setCookieRaw) {
            const m = /^([^=]+)=([^;]+)/.exec(raw);
            if (m) merged[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: lowcaseHeaders(res.headers),
            cookies: merged,
            setCookieRaw,
            body: buf.toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

export function json(r) {
  try {
    return JSON.parse(r.body);
  } catch (_e) {
    return { _raw: r.body.slice(0, 500) };
  }
}
