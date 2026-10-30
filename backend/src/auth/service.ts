import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { AuthUser } from "../contract/api.js";
import { AppError } from "../errors.js";
import { log } from "../lib/log.js";
import { AuthCipher, newSessionToken, sessionHash } from "./crypto.js";
import { createSupabaseAuthProvider, type AuthProvider, type AuthTokens } from "./provider.js";
import { createSupabaseAuthStore, type AuthStore, type StoredSession } from "./store.js";

const flowSchema = z.object({ issuedAt: z.number(), storage: z.record(z.string()) });
export const OAUTH_TTL_MS = 10 * 60_000;

export class AuthService {
  private readonly cipher: AuthCipher;
  // Prevent refresh-token rotation races in this single-process backend.
  private readonly refreshing = new Map<string, Promise<StoredSession>>();

  constructor(
    private readonly config: AppConfig,
    private readonly provider: AuthProvider,
    private readonly store: AuthStore,
    private readonly now: () => number = Date.now,
  ) {
    this.cipher = new AuthCipher(config.AUTH_ENCRYPTION_KEY!);
  }

  async begin(): Promise<{ url: string; flowCookie: string }> {
    const { url, storage } = await this.provider.begin(this.config.AUTH_CALLBACK_URL);
    const flowCookie = this.cipher.seal(JSON.stringify({ issuedAt: this.now(), storage }), "oauth-flow");
    if (flowCookie.length > 3800) throw new AppError("INTERNAL", "Unable to start sign-in.");
    return { url, flowCookie };
  }

  async complete(code: string, cookie: string | null): Promise<string> {
    let flow: z.infer<typeof flowSchema>;
    try {
      flow = flowSchema.parse(JSON.parse(this.cipher.open(cookie ?? "", "oauth-flow")));
      const age = this.now() - flow.issuedAt;
      if (age < 0 || age > OAUTH_TTL_MS || !Object.keys(flow.storage).length) throw new Error("expired");
    } catch {
      throw new AppError("AUTH_FAILED", "Your sign-in attempt expired or belongs to another browser. Start again.");
    }
    // PKCE binds this callback to the verifier in this browser's encrypted cookie.
    // Supabase manages the Google OAuth state parameter on the upstream redirect.
    const tokens = await this.provider.exchange(code, flow.storage);
    const token = newSessionToken();
    const hash = sessionHash(token);
    try {
      const user = await this.provider.verify(tokens.accessToken);
      await this.store.saveProfile(user);
      await this.store.insertSession({
        token_hash: hash, user_id: user.id,
        ...this.encryptedTokens(tokens, hash),
        expires_at: new Date(this.now() + this.config.AUTH_SESSION_DAYS * 86_400_000).toISOString(),
      });
    } catch (err) {
      await this.provider.revoke(tokens.accessToken).catch(() => undefined);
      throw err;
    }
    return token;
  }

  async authenticate(token: string | null): Promise<AuthUser> {
    const hash = this.hash(token);
    let session = await this.store.findSession(hash);
    if (!session || new Date(session.expires_at).getTime() <= this.now()) {
      if (session) await this.store.deleteSession(hash);
      throw this.unauthenticated();
    }
    try {
      if (new Date(session.access_expires_at).getTime() <= this.now() + 60_000) session = await this.refresh(hash);
      const user = await this.provider.verify(this.cipher.open(session.access_token_encrypted, `access:${hash}`));
      if (user.id !== session.user_id) throw this.unauthenticated();
      return user;
    } catch (error) {
      if (error instanceof AppError && ["UNAUTHENTICATED", "AUTH_FAILED"].includes(error.code)) {
        await this.store.deleteSession(hash);
        throw this.unauthenticated();
      }
      if (!(error instanceof AppError)) {
        await this.store.deleteSession(hash);
        throw this.unauthenticated();
      }
      throw error;
    }
  }

  async logout(token: string | null): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const hash = sessionHash(token);
    const session = await this.store.findSession(hash);
    // Delete our authority first: logout stays effective even during a provider outage.
    await this.store.deleteSession(hash);
    if (session) {
      try {
        await this.provider.revoke(this.cipher.open(session.access_token_encrypted, `access:${hash}`));
      } catch {
        log("warn", "auth.provider_logout_failed");
      }
    }
  }

  private encryptedTokens(tokens: AuthTokens, hash: string) {
    return {
      access_token_encrypted: this.cipher.seal(tokens.accessToken, `access:${hash}`),
      refresh_token_encrypted: this.cipher.seal(tokens.refreshToken, `refresh:${hash}`),
      access_expires_at: new Date(tokens.expiresAt * 1000).toISOString(),
    };
  }

  private refresh(hash: string): Promise<StoredSession> {
    const existing = this.refreshing.get(hash);
    if (existing) return existing;
    const pending = (async () => {
      const session = await this.store.findSession(hash);
      if (!session || new Date(session.expires_at).getTime() <= this.now()) throw this.unauthenticated();
      if (new Date(session.access_expires_at).getTime() > this.now() + 60_000) return session;
      const tokens = await this.provider.refresh(this.cipher.open(session.refresh_token_encrypted, `refresh:${hash}`));
      const user = await this.provider.verify(tokens.accessToken);
      if (user.id !== session.user_id) throw this.unauthenticated();
      const encrypted = this.encryptedTokens(tokens, hash);
      if (!(await this.store.updateTokens(hash, encrypted))) throw this.unauthenticated();
      return { ...session, ...encrypted };
    })().finally(() => this.refreshing.delete(hash));
    this.refreshing.set(hash, pending);
    return pending;
  }

  private hash(token: string | null): string {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw this.unauthenticated();
    return sessionHash(token);
  }

  private unauthenticated() { return new AppError("UNAUTHENTICATED", "Sign in with Google to continue."); }
}

export function createAuthService(config: AppConfig): AuthService | null {
  return config.capabilities.auth
    ? new AuthService(config, createSupabaseAuthProvider(config), createSupabaseAuthStore(config))
    : null;
}
