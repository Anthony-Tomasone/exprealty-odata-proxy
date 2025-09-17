// api/odata/[...path].ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const OD_BASE = process.env.ODATA_BASE!; // e.g. https://qa-test-dsapi.expcloud.com/odata
const TOKEN_URL = process.env.OAUTH_TOKEN_URL!;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET!;
const SCOPE = "dataservices/read";
const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";

// simple in-memory token cache (per warm lambda instance)
let tokenCache: { token: string; exp: number } | null = null;

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
}

async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: SCOPE,
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!r.ok) throw new Error(`token_error ${r.status}: ${await r.text()}`);
  const { access_token, expires_in } = (await r.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache = { token: access_token, exp: now + expires_in };
  return access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const token = await getToken();

    // Build upstream OData URL
    const segments = Array.isArray(req.query.path) ? req.query.path : [];
    const subpath = segments.join("/");
    const query = req.url?.includes("?") ? `?${req.url.split("?")[1]}` : "";
    const upstream = `${OD_BASE}/${subpath}${query}`;

    const od = await fetch(upstream, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json;odata.metadata=none",
      },
    });

    const text = await od.text();
    res
      .status(od.status)
      .setHeader("Content-Type", od.headers.get("content-type") || "application/json")
      .send(text);
  } catch (e: any) {
    res.status(502).json({ error: "proxy_error", message: String(e?.message || e) });
  }
}

