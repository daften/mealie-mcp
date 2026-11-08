import { randomUUID } from 'node:crypto';
import { accessSync, chmodSync, constants, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { ConfigError } from '../config.js';
import { decrypt, deriveKey, encrypt, hashToken, newToken } from './crypto.js';

export const ACCESS_TOKEN_PREFIX = 'mcp_at_';
export const REFRESH_TOKEN_PREFIX = 'mcp_rt_';
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const KEY_CHECK_PLAINTEXT = 'mealie-mcp key check';

// Append only: each entry moves the schema one version forward, so an image update keeps existing data.
export const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE clients (client_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE grants (
     id TEXT PRIMARY KEY,
     client_id TEXT NOT NULL,
     mealie_token TEXT NOT NULL,
     mealie_token_id INTEGER NOT NULL,
     resource TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE tokens (
     hash TEXT PRIMARY KEY,
     grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
     expires_at INTEGER NOT NULL,
     superseded_at INTEGER
   );
   CREATE INDEX tokens_grant ON tokens(grant_id);
   CREATE INDEX tokens_expiry ON tokens(expires_at);`,
];

export interface Grant {
  id: string;
  clientId: string;
  mealieToken: string;
  mealieTokenId: number;
  resource: string;
  createdAt: number;
}

export interface TokenRecord {
  grantId: string;
  kind: 'access' | 'refresh';
  expiresAt: number;
  supersededAt: number | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

interface GrantRow {
  id: string;
  client_id: string;
  mealie_token: string;
  mealie_token_id: number;
  resource: string;
  created_at: number;
}

export class TokenStore {
  private constructor(
    private readonly db: DatabaseSync,
    private readonly key: Buffer,
    private readonly now: () => number,
  ) {}

  static async open(dataDir: string, secret: string, now: () => number = Date.now): Promise<TokenStore> {
    const path = prepareDatabasePath(dataDir);
    const { DatabaseSync: Database } = await import('node:sqlite');
    const db = new Database(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(db);
    const store = new TokenStore(db, deriveKey(secret), now);
    store.verifyKey();
    return store;
  }

  /** Fails at startup, rather than logging every user out one request at a time. */
  private verifyKey(): void {
    const context = 'meta:key_check';
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('key_check') as
      | { value: string }
      | undefined;
    if (!row) {
      this.db
        .prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
        .run('key_check', encrypt(this.key, KEY_CHECK_PLAINTEXT, context));
      return;
    }
    try {
      decrypt(this.key, row.value, context);
    } catch {
      throw new ConfigError(
        'MCP_TOKEN_KEY does not match the key this data directory was created with. Restore the original key, or delete the database to make everyone log in again.',
      );
    }
  }

  close(): void {
    this.db.close();
  }

  saveClient(client: OAuthClientInformationFull): void {
    this.db
      .prepare('INSERT INTO clients (client_id, data, created_at) VALUES (?, ?, ?)')
      .run(client.client_id, encrypt(this.key, JSON.stringify(client), `client:${client.client_id}`), this.now());
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db.prepare('SELECT data FROM clients WHERE client_id = ?').get(clientId) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    return JSON.parse(decrypt(this.key, row.data, `client:${clientId}`)) as OAuthClientInformationFull;
  }

  createGrant(input: { clientId: string; mealieToken: string; mealieTokenId: number; resource: string }): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO grants (id, client_id, mealie_token, mealie_token_id, resource, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.clientId,
        encrypt(this.key, input.mealieToken, `grant:${id}`),
        input.mealieTokenId,
        input.resource,
        this.now(),
      );
    return id;
  }

  getGrant(id: string): Grant | undefined {
    const row = this.db.prepare('SELECT * FROM grants WHERE id = ?').get(id) as GrantRow | undefined;
    return row ? this.toGrant(row) : undefined;
  }

  private toGrant(row: GrantRow): Grant {
    return {
      id: row.id,
      clientId: row.client_id,
      mealieToken: decrypt(this.key, row.mealie_token, `grant:${row.id}`),
      mealieTokenId: row.mealie_token_id,
      resource: row.resource,
      createdAt: row.created_at,
    };
  }

  deleteGrant(id: string): void {
    this.db.prepare('DELETE FROM grants WHERE id = ?').run(id);
  }

  findToken(rawToken: string): TokenRecord | undefined {
    const row = this.db
      .prepare('SELECT grant_id, kind, expires_at, superseded_at FROM tokens WHERE hash = ?')
      .get(hashToken(rawToken)) as
      | { grant_id: string; kind: 'access' | 'refresh'; expires_at: number; superseded_at: number | null }
      | undefined;
    if (!row) return undefined;
    return { grantId: row.grant_id, kind: row.kind, expiresAt: row.expires_at, supersededAt: row.superseded_at };
  }

  /** The Mealie token behind a live access token, or undefined. Refresh tokens never authorize a request. */
  resolveAccessToken(rawToken: string): { grant: Grant; expiresAt: number } | undefined {
    if (!rawToken.startsWith(ACCESS_TOKEN_PREFIX)) return undefined;
    const token = this.findToken(rawToken);
    if (token?.kind !== 'access' || token.expiresAt <= this.now()) return undefined;
    const grant = this.getGrant(token.grantId);
    return grant ? { grant, expiresAt: token.expiresAt } : undefined;
  }

  /** Issues a fresh pair and, when rotating, marks the refresh token it replaces. Atomic. */
  issueTokens(grantId: string, replacing?: string): TokenPair {
    const now = this.now();
    const accessToken = newToken(ACCESS_TOKEN_PREFIX);
    const refreshToken = newToken(REFRESH_TOKEN_PREFIX);
    const insert = this.db.prepare('INSERT INTO tokens (hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)');
    this.transaction(() => {
      insert.run(hashToken(accessToken), grantId, 'access', now + ACCESS_TOKEN_TTL_MS);
      insert.run(hashToken(refreshToken), grantId, 'refresh', now + REFRESH_TOKEN_TTL_MS);
      if (replacing) {
        this.db
          .prepare('UPDATE tokens SET superseded_at = ? WHERE hash = ? AND superseded_at IS NULL')
          .run(now, hashToken(replacing));
      }
    });
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_MS / 1000 };
  }

  deleteExpiredTokens(): void {
    this.db.prepare('DELETE FROM tokens WHERE expires_at <= ?').run(this.now());
  }

  /** Grants with no usable refresh token left, older than `minAgeMs` so a login in progress is never caught. */
  findAbandonedGrants(minAgeMs: number): Grant[] {
    const rows = this.db
      .prepare(
        `SELECT g.* FROM grants g
         WHERE g.created_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM tokens t
             WHERE t.grant_id = g.id AND t.kind = 'refresh' AND t.expires_at > ? AND t.superseded_at IS NULL
           )`,
      )
      .all(this.now() - minAgeMs, this.now()) as unknown as GrantRow[];
    return rows.map((row) => this.toGrant(row));
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function prepareDatabasePath(dataDir: string): string {
  if (dataDir === ':memory:') return dataDir;
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
  } catch {
    throw new ConfigError(
      `MCP_DATA_DIR "${dataDir}" is not writable by this process. In Docker, use the named volume from docker-compose.yml, or make a bind mount writable by uid 1000.`,
    );
  }
  return join(dataDir, 'mealie-mcp.db');
}

export function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version > MIGRATIONS.length) {
    throw new ConfigError(
      `The database schema (version ${version}) is newer than this server supports (${MIGRATIONS.length}). Upgrade the server.`,
    );
  }
  for (let next = version; next < MIGRATIONS.length; next++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[next]);
      db.exec(`PRAGMA user_version = ${next + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
