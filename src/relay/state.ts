import { createHash, randomUUID } from "node:crypto";
import { PairingRecord, PairingSummary, RelaySession } from "./types";

export class PairingStore {
  private readonly pairings = new Map<string, PairingRecord>();

  create(ttlMs: number): PairingRecord {
    const createdAt = Date.now();
    const pairing: PairingRecord = {
      pairingId: randomUUID(),
      token: randomUUID(),
      createdAt,
      expiresAt: createdAt + ttlMs
    };
    this.pairings.set(pairing.token, pairing);
    return pairing;
  }

  consume(token: string): PairingRecord | undefined {
    this.cleanup();
    const pairing = this.pairings.get(token);
    if (!pairing || pairing.usedAt || pairing.expiresAt <= Date.now()) {
      return undefined;
    }
    pairing.usedAt = Date.now();
    return pairing;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [token, pairing] of this.pairings.entries()) {
      if (pairing.expiresAt <= now || pairing.usedAt) {
        this.pairings.delete(token);
      }
    }
  }

  list(): PairingRecord[] {
    this.cleanup();
    return Array.from(this.pairings.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  listSummaries(): PairingSummary[] {
    const now = Date.now();
    return Array.from(this.pairings.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((pairing) => ({
        pairingId: pairing.pairingId,
        createdAt: pairing.createdAt,
        expiresAt: pairing.expiresAt,
        usedAt: pairing.usedAt,
        status: pairing.usedAt ? "used" : pairing.expiresAt <= now ? "expired" : "active"
      }));
  }
}

export class SessionStore {
  private readonly sessions = new Map<string, RelaySession>();

  create(
    pairingId: string,
    ttlMs: number,
    metadata?: Pick<
      RelaySession,
      "ipAddress" | "userAgent" | "os" | "country" | "city" | "asn" | "isp"
    >
  ): RelaySession {
    const createdAt = Date.now();
    const session: RelaySession = {
      sessionId: randomUUID(),
      pairingId,
      createdAt,
      expiresAt: createdAt + ttlMs,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      os: metadata?.os,
      country: metadata?.country,
      city: metadata?.city,
      asn: metadata?.asn,
      isp: metadata?.isp
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string | undefined): RelaySession | undefined {
    this.cleanup();
    if (!sessionId) {
      return undefined;
    }
    return this.sessions.get(sessionId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  deleteAll(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  list(): RelaySession[] {
    this.cleanup();
    return Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  static signSession(sessionId: string, secret: string): string {
    return createHash("sha256").update(`${sessionId}:${secret}`, "utf8").digest("hex");
  }

  static readSignedSession(
    rawCookieValue: string | undefined,
    secret: string,
    store: SessionStore
  ): RelaySession | undefined {
    const [sessionId = "", signature = ""] = rawCookieValue ? rawCookieValue.split(".", 2) : [];
    const expected = sessionId ? SessionStore.signSession(sessionId, secret) : "";
    return signature === expected ? store.get(sessionId) : undefined;
  }
}
