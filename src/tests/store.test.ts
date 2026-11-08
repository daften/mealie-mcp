import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, hashToken } from '../auth/crypto.js';
import { ACCESS_TOKEN_TTL_MS, MIGRATIONS, migrate, REFRESH_TOKEN_TTL_MS, TokenStore } from '../auth/store.js';
import { ConfigError } from '../config.js';

const SECRET = 's'.repeat(40);
const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mealie-mcp-test-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const grantInput = {
  clientId: 'c1',
  mealieToken: 'mealie-secret-token',
  mealieTokenId: 7,
  resource: 'https://m.example',
};

describe('crypto', () => {
  const key = deriveKey(SECRET);
  it('round-trips', () => {
    expect(decrypt(key, encrypt(key, 'hello', 'ctx'), 'ctx')).toBe('hello');
  });
  it('rejects a wrong key, wrong context, or tampering', () => {
    const sealed = encrypt(key, 'hello', 'ctx');
    expect(() => decrypt(deriveKey('other'.repeat(10)), sealed, 'ctx')).toThrow();
    expect(() => decrypt(key, sealed, 'other')).toThrow();
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    raw[raw.length - 1] ^= 1;
    expect(() => decrypt(key, `v1.${raw.toString('base64url')}`, 'ctx')).toThrow();
  });
});

describe('TokenStore', () => {
  it('keeps grants and tokens across reopen', async () => {
    const dir = tempDir();
    const first = await TokenStore.open(dir, SECRET);
    const pair = first.issueTokens(first.createGrant(grantInput));
    first.close();
    const second = await TokenStore.open(dir, SECRET);
    expect(second.resolveAccessToken(pair.accessToken)?.grant.mealieToken).toBe('mealie-secret-token');
    second.close();
  });

  it('refuses to open with a different key', async () => {
    const dir = tempDir();
    (await TokenStore.open(dir, SECRET)).close();
    await expect(TokenStore.open(dir, 'x'.repeat(40))).rejects.toBeInstanceOf(ConfigError);
  });

  it('stores no plaintext tokens', async () => {
    const dir = tempDir();
    const store = await TokenStore.open(dir, SECRET);
    const pair = store.issueTokens(store.createGrant(grantInput));
    store.close();
    const contents = readFileSync(join(dir, 'mealie-mcp.db'), 'latin1');
    expect(contents).not.toContain('mealie-secret-token');
    expect(contents).not.toContain(pair.accessToken);
    expect(contents).not.toContain(pair.refreshToken);
  });

  it('fails clearly on an unwritable directory', async () => {
    // A file as the parent, not a /proc path: Node's recursive mkdir never returns on those under Linux,
    // and permission bits don't stop root, which is what some containers run as.
    const file = join(tempDir(), 'not-a-directory');
    writeFileSync(file, '');
    await expect(TokenStore.open(join(file, 'data'), SECRET)).rejects.toBeInstanceOf(ConfigError);
  });

  it('expires access tokens and never accepts a refresh token as one', async () => {
    let now = 1_000_000;
    const store = await TokenStore.open(':memory:', SECRET, () => now);
    const pair = store.issueTokens(store.createGrant(grantInput));
    expect(store.resolveAccessToken(pair.accessToken)).toBeDefined();
    expect(store.resolveAccessToken(pair.refreshToken)).toBeUndefined();
    now += ACCESS_TOKEN_TTL_MS + 1;
    expect(store.resolveAccessToken(pair.accessToken)).toBeUndefined();
    store.close();
  });

  it('marks the replaced refresh token and deletes tokens with their grant', async () => {
    const store = await TokenStore.open(':memory:', SECRET, () => 5);
    const id = store.createGrant(grantInput);
    const first = store.issueTokens(id);
    store.issueTokens(id, first.refreshToken);
    expect(store.findToken(first.refreshToken)?.supersededAt).toBe(5);
    store.deleteGrant(id);
    expect(store.findToken(first.refreshToken)).toBeUndefined();
    store.close();
  });

  it('finds grants with no usable refresh token, past the minimum age', async () => {
    let now = 1_000_000;
    const store = await TokenStore.open(':memory:', SECRET, () => now);
    const id = store.createGrant(grantInput);
    expect(store.findAbandonedGrants(1000)).toEqual([]); // too young: a login may be in progress
    now += 2000;
    expect(store.findAbandonedGrants(1000).map((g) => g.id)).toEqual([id]);
    store.issueTokens(id);
    expect(store.findAbandonedGrants(1000)).toEqual([]);
    now += REFRESH_TOKEN_TTL_MS + 1;
    store.deleteExpiredTokens();
    expect(store.findAbandonedGrants(1000).map((g) => g.id)).toEqual([id]);
    store.close();
  });

  it('hashes bearers for lookup', () => {
    expect(hashToken('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('migrate', () => {
  it('upgrades from an older version and is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    migrate(db);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
    db.close();
  });
  it('refuses a database newer than the code', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer/);
    db.close();
  });
});
