import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthCipher, sessionHash } from "../src/auth/crypto.js";
import { accountFromGoogle, createSupabaseAuthProvider, type AuthProvider, type AuthTokens } from "../src/auth/provider.js";
import { AuthService, OAUTH_TTL_MS } from "../src/auth/service.js";
import type { AuthStore, StoredSession } from "../src/auth/store.js";
import { cookieSettings } from "../src/auth/http.js";
import { createSupabaseAuthStore } from "../src/auth/store.js";
import { loadConfig } from "../src/config.js";
import type { AuthUser } from "../src/contract/api.js";
import { AppError } from "../src/errors.js";
import { makeContext } from "./fakes.js";
import type { User } from "@supabase/supabase-js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const env = {
  AUTH_ENABLED: "true", SUPABASE_URL: "https://test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "test-publishable",
  SUPABASE_SERVICE_ROLE_KEY: "test-service", AUTH_ENCRYPTION_KEY: encryptionKey,
};
const config = () => loadConfig(env);
const user: AuthUser = {
  id: "cf2de752-72dc-4711-b9ab-03d5e74f04ca", email: "traveller@example.com", displayName: "Traveller",
  avatarUrl: "https://example.com/avatar.png", provider: "google", createdAt: "2026-10-01T00:00:00Z", lastSignInAt: "2026-10-30T00:00:00Z",
};
const rawUser = {
  id: user.id, email: user.email, email_confirmed_at: user.createdAt, created_at: user.createdAt,
  last_sign_in_at: user.lastSignInAt, app_metadata: { provider: "google" },
  user_metadata: { full_name: user.displayName, avatar_url: user.avatarUrl }, identities: [{ provider: "google" }],
} as User;

function setup() {
  let time = Date.parse("2026-10-30T06:00:00Z");
  const rows = new Map<string, StoredSession>();
  const profiles = new Map<string, AuthUser>();
  let access = 0;
  const tokens = (): AuthTokens => ({ accessToken: `access-secret-${++access}`, refreshToken: `refresh-secret-${access}`, expiresAt: time / 1000 + 3600 });
  const validTokens = new Set<string>();
  const provider: AuthProvider = {
    begin: vi.fn(async (url: string) => ({ url: `https://test.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(url)}`, storage: { verifier: "pkce-secret" } })),
    exchange: vi.fn(async (_code, storage) => {
      if (storage.verifier !== "pkce-secret") throw new AppError("AUTH_FAILED", "Invalid verifier");
      const result = tokens(); validTokens.add(result.accessToken); return result;
    }),
    refresh: vi.fn(async () => { const result = tokens(); validTokens.add(result.accessToken); return result; }),
    verify: vi.fn(async (token) => {
      if (!validTokens.has(token)) throw new AppError("UNAUTHENTICATED", "Invalid token");
      return user;
    }),
    revoke: vi.fn(async (token) => { validTokens.delete(token); }),
  };
  const store: AuthStore = {
    saveProfile: vi.fn(async (u) => { profiles.set(u.id, u); }),
    insertSession: vi.fn(async (row) => { rows.set(row.token_hash, { ...row }); }),
    findSession: vi.fn(async (hash) => rows.has(hash) ? { ...rows.get(hash)! } : null),
    updateTokens: vi.fn(async (hash, update) => {
      const row = rows.get(hash); if (!row) return false;
      rows.set(hash, { ...row, ...update }); return true;
    }),
    deleteSession: vi.fn(async (hash) => { rows.delete(hash); }),
  };
  const service = new AuthService(config(), provider, store, () => time);
  const login = async () => service.complete("valid-code", (await service.begin()).flowCookie);
  return { service, provider, store, rows, profiles, login, now: () => time, advance: (ms: number) => { time += ms; } };
}

describe("authentication configuration", () => {
  it("is explicitly opt-in and does not break an unconfigured backend", () => {
    expect(loadConfig({}).capabilities.auth).toBe(false);
    expect(() => loadConfig({ AUTH_ENABLED: "true" })).toThrow(/requires/);
  });
  it("rejects weak keys, unsafe hosted URLs and mismatched CORS", () => {
    expect(() => loadConfig({ ...env, AUTH_ENCRYPTION_KEY: "weak" })).toThrow(/32-byte/);
    expect(() => loadConfig({ ...env, AUTH_FRONTEND_URL: "http://example.com" })).toThrow(/HTTPS/);
    expect(() => loadConfig({ ...env, AUTH_CALLBACK_URL: "https://api.example.com/api/auth/callback" })).toThrow(/SECURE/);
    expect(() => loadConfig({ ...env, AUTH_FRONTEND_URL: "http://localhost:9999" })).toThrow(/CORS/);
  });
  it("uses secure host-only cookies for deployed authentication", () => {
    const c = loadConfig({ ...env, AUTH_COOKIE_SECURE: "true", AUTH_CALLBACK_URL: "https://api.example.com/api/auth/callback", AUTH_FRONTEND_URL: "https://app.example.com", CORS_ORIGIN: "https://app.example.com" });
    expect(cookieSettings(c)).toMatchObject({ session: "__Host-waydine_session", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" } });
  });
});

describe("authenticated encryption", () => {
  it("encrypts secrets, rejects tampering and prevents purpose substitution", () => {
    const cipher = new AuthCipher(encryptionKey);
    const sealed = cipher.seal("secret", "access:one");
    expect(sealed).not.toContain("secret");
    expect(cipher.open(sealed, "access:one")).toBe("secret");
    expect(() => cipher.open(sealed, "refresh:one")).toThrow();
    expect(() => cipher.open(sealed.slice(0, 12) + "AAAA" + sealed.slice(16), "access:one")).toThrow();
    expect(() => new AuthCipher(Buffer.alloc(32, 8).toString("base64")).open(sealed, "access:one")).toThrow();
  });
});

describe("Google identity validation", () => {
  it("accepts confirmed Google accounts and sanitizes profile URLs", () => {
    expect(accountFromGoogle(rawUser)).toEqual(user);
    expect(accountFromGoogle({ ...rawUser, user_metadata: { avatar_url: "javascript:alert(1)" } }).avatarUrl).toBeNull();
  });
  it("rejects non-Google identities and unverified email addresses", () => {
    expect(() => accountFromGoogle({ ...rawUser, app_metadata: { provider: "email" }, identities: [] })).toThrow(/Google/);
    expect(() => accountFromGoogle({ ...rawUser, email_confirmed_at: undefined })).toThrow(/verified/);
  });
});

describe("Google authentication lifecycle", () => {
  it("stores a hashed opaque session and encrypted provider tokens, and upserts one account", async () => {
    const f = setup(); const token = await f.login();
    const row = f.rows.get(sessionHash(token))!;
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain("access-secret");
    expect(JSON.stringify(row)).not.toContain("refresh-secret");
    expect(await f.service.authenticate(token)).toEqual(user);
    await f.login(); expect(f.profiles.size).toBe(1);
  });
  it("rejects missing, malformed, tampered and expired OAuth cookies before exchanging a code", async () => {
    const f = setup(); const flow = await f.service.begin();
    for (const cookie of [null, "garbage", flow.flowCookie.slice(0, 10) + "AAAA" + flow.flowCookie.slice(14)]) {
      await expect(f.service.complete("code", cookie)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    }
    f.advance(OAUTH_TTL_MS + 1);
    await expect(f.service.complete("code", flow.flowCookie)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(f.provider.exchange).not.toHaveBeenCalled();
  });
  it("rejects unknown sessions and expires database sessions after seven days", async () => {
    const f = setup();
    await expect(f.service.authenticate(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(f.service.authenticate("A".repeat(43))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const token = await f.login(); f.advance(7 * 86_400_000 + 1);
    await expect(f.service.authenticate(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.rows.size).toBe(0);
  });
  it("refreshes expiring tokens once for concurrent requests and survives service restart", async () => {
    const f = setup(); const token = await f.login(); f.advance(3_550_000);
    const result = await Promise.all([f.service.authenticate(token), f.service.authenticate(token)]);
    expect(result).toEqual([user, user]); expect(f.provider.refresh).toHaveBeenCalledTimes(1);
    // A separate service with the same encryption key can use a durable DB session.
    const restarted = new AuthService(config(), f.provider, f.store, f.now);
    expect(await restarted.authenticate(token)).toEqual(user);
  });
  it("removes a session if refresh is rejected, but preserves it during provider outages", async () => {
    const f = setup(); const token = await f.login(); f.advance(3_550_000);
    vi.mocked(f.provider.refresh).mockRejectedValueOnce(new AppError("UPSTREAM_UNAVAILABLE", "offline"));
    await expect(f.service.authenticate(token)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(f.rows.size).toBe(1);
    vi.mocked(f.provider.refresh).mockRejectedValueOnce(new AppError("UNAUTHENTICATED", "revoked"));
    await expect(f.service.authenticate(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.rows.size).toBe(0);
  });
  it("rejects mismatched users and invalid encryption envelopes", async () => {
    const f = setup(); const token = await f.login();
    vi.mocked(f.provider.verify).mockResolvedValueOnce({ ...user, id: "another-user" });
    await expect(f.service.authenticate(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const token2 = await f.login(); f.rows.get(sessionHash(token2))!.access_token_encrypted = "corrupt";
    await expect(f.service.authenticate(token2)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("does not recreate a session deleted while tokens are refreshing", async () => {
    const f = setup(); const token = await f.login(); f.advance(3_550_000);
    const refresh = f.provider.refresh;
    f.provider.refresh = async (value) => { await f.store.deleteSession(sessionHash(token)); return refresh(value); };
    await expect(f.service.authenticate(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.rows.size).toBe(0);
  });
  it("revokes locally on logout even if Supabase is unavailable", async () => {
    const f = setup(); const token = await f.login();
    vi.mocked(f.provider.revoke).mockRejectedValueOnce(new Error("offline"));
    await f.service.logout(token);
    await expect(f.service.authenticate(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(f.service.logout(null)).resolves.toBeUndefined();
  });
  it("fails closed if profile/session persistence fails and revokes the issued provider session", async () => {
    const f = setup(); vi.mocked(f.store.insertSession).mockRejectedValueOnce(new AppError("UPSTREAM_UNAVAILABLE", "storage"));
    await expect(f.login()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(f.provider.revoke).toHaveBeenCalledOnce(); expect(f.rows.size).toBe(0);
  });
});

describe("Supabase adapter with mocked HTTP (no live API requests)", () => {
  it("uses SDK PKCE and exchanges a code with the matching verifier", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = (async (input, init) => {
      const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, body });
      if (url.includes("/token")) return Response.json({ access_token: "provider-access", refresh_token: "provider-refresh", expires_in: 3600, token_type: "bearer", user: rawUser });
      if (url.endsWith("/user")) return Response.json(rawUser);
      if (url.includes("/logout")) return new Response(null, { status: 204 });
      throw new Error("Unexpected request");
    }) as typeof fetch;
    const provider = createSupabaseAuthProvider(config(), fakeFetch);
    const flow = await provider.begin(config().AUTH_CALLBACK_URL);
    const url = new URL(flow.url);
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("redirect_to")).toBe(config().AUTH_CALLBACK_URL);
    expect(flow.url).not.toContain("test-service");
    const result = await provider.exchange("code", flow.storage);
    expect(result.accessToken).toBe("provider-access");
    expect(requests[0]).toMatchObject({ body: { auth_code: "code", code_verifier: expect.any(String) } });
    expect((requests[0]!.body as { code_verifier: string }).code_verifier.length).toBeGreaterThan(40);
    expect(await provider.verify(result.accessToken)).toEqual(user);
    await provider.refresh(result.refreshToken);
    await provider.revoke(result.accessToken);
    expect(requests.some((r) => r.url.includes("scope=local"))).toBe(true);
  });
  it("maps provider rejection to sanitized authentication errors", async () => {
    const provider = createSupabaseAuthProvider(config(), (async () => Response.json({ error: "invalid_grant", msg: "private provider detail" }, { status: 400 })) as typeof fetch);
    const flow = await provider.begin(config().AUTH_CALLBACK_URL);
    await expect(provider.exchange("bad-code", flow.storage)).rejects.toMatchObject({ code: "AUTH_FAILED", message: expect.not.stringContaining("private") });
    await expect(provider.verify("bad-token")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("uses only the service role for session storage and sanitizes DB errors", async () => {
    const requests: Array<{ url: string; key: string | null }> = [];
    const store = createSupabaseAuthStore(config(), (async (input, init) => {
      requests.push({ url: String(input), key: new Headers(init?.headers).get("apikey") });
      return Response.json({ message: "sensitive DB detail", code: "42P01" }, { status: 400 });
    }) as typeof fetch);
    await expect(store.findSession("a".repeat(64))).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", message: expect.not.stringContaining("sensitive") });
    expect(requests[0]!.key).toBe("test-service");
  });
});

describe("authentication HTTP API", () => {
  let server: Server; let base: string; const f = setup();
  beforeAll(async () => {
    server = createApp(config(), makeContext({ places: [], requests: [] }), { enabled: false, record() {} }, f.service).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  const flowCookie = async () => {
    const r = await fetch(`${base}/api/auth/google`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toMatch(/^https:\/\/test.supabase.co/);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    return r.headers.getSetCookie()[0]!.split(";")[0]!;
  };
  const login = async () => {
    const flow = await flowCookie();
    const r = await fetch(`${base}/api/auth/callback?code=valid`, { headers: { cookie: flow }, redirect: "manual" });
    expect(r.status).toBe(303); expect(r.headers.get("location")).toBe(config().AUTH_FRONTEND_URL);
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith("waydine_session="))!;
    expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("HttpOnly");
    return cookie.split(";")[0]!;
  };

  it("reports status and rejects unauthenticated account requests", async () => {
    expect(await (await fetch(`${base}/api/auth/status`)).json()).toEqual({ enabled: true, provider: "google" });
    const r = await fetch(`${base}/api/auth/me`);
    expect(r.status).toBe(401); expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.json()).error.code).toBe("UNAUTHENTICATED");
  });
  it("returns only public account fields after login", async () => {
    const cookie = await login();
    const r = await fetch(`${base}/api/auth/me`, { headers: { cookie, origin: "http://localhost:5173" } });
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ user });
    expect(r.headers.get("access-control-allow-credentials")).toBe("true");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("rejects missing cookies, malformed callbacks and user denial without reflecting provider messages", async () => {
    expect((await fetch(`${base}/api/auth/callback?code=stolen`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/callback`)).status).toBe(400);
    const denied = await fetch(`${base}/api/auth/callback?error=access_denied&error_description=private-secret`);
    expect(denied.status).toBe(401); expect(await denied.text()).not.toContain("private-secret");
  });
  it("does not accept a client-supplied post-login redirect", async () => {
    const r = await fetch(`${base}/api/auth/google?returnTo=https://evil.example`, { redirect: "manual" });
    const providerUrl = new URL(r.headers.get("location")!);
    expect(providerUrl.searchParams.get("redirect_to")).toBe(config().AUTH_CALLBACK_URL);
  });
  it("blocks cross-origin logout and invalidates a trusted logout immediately", async () => {
    const cookie = await login();
    expect((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie, origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie } })).status).toBe(403);
    const r = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie, origin: "http://localhost:5173" } });
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie().some((c) => c.startsWith("waydine_session=;") && c.includes("Expires="))).toBe(true);
    expect((await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status).toBe(401);
  });
  it("rejects duplicate/shadowed session cookies", async () => {
    const cookie = await login();
    expect((await fetch(`${base}/api/auth/me`, { headers: { cookie: `${cookie}; ${cookie}` } })).status).toBe(401);
  });
  it("does not expose unrelated sessions to an unauthenticated browser", async () => {
    await login();
    expect((await fetch(`${base}/api/auth/me`, { headers: { cookie: `waydine_session=${"B".repeat(43)}` } })).status).toBe(401);
  });
});
