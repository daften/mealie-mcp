// Hostnames only — matched against parsed.hostname, never against the raw string.
// Note new URL('http://[::1]:3000/').hostname is '[::1]' WITH brackets in Node.
const LOOPBACK_REDIRECT_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

// Claude's hosted surfaces (claude.ai web, Desktop, mobile, Cowork) all complete
// OAuth against this callback. claude.ai is the URI Anthropic documents today;
// claude.com is allowed ahead of Anthropic's domain migration. Each is matched
// exactly on origin+pathname — a prefix match would also admit
// https://claude.ai/api/mcp/auth_callbackEVIL.
const CLAUDE_HOSTED_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

// Matching is done on components of the PARSED URL, never on the raw string. A raw
// `uri.startsWith(...)` check is unsafe: URL userinfo lets the raw string lie about
// the real host, e.g. 'http://127.0.0.1:@evil.example.com/steal' starts with
// 'http://127.0.0.1:' but its parsed origin is 'http://evil.example.com'. Such a URI
// reached /oauth/callback, which redirected the authorization code to the attacker.
// Rejecting any URI that carries userinfo closes that bypass for every branch below,
// including the env-var prefix branch (an entry like 'https://my-client.example.com'
// would otherwise also match 'https://my-client.example.com@evil.example.com/').
// Do not reintroduce a startsWith(rawUri) check.
//
// MCP_ALLOWED_REDIRECT_PREFIXES entries are compared in *canonical* form too. A raw
// startsWith on the prefix as typed is unsafe even without userinfo: 'https://example.com'
// also matches 'https://example.com.attacker.test/steal', and a prefix spelled in a
// non-canonical way ('https://Example.com', 'https://example.com:443', an IDN) never
// equals its own parsed origin, so an origin-equality guard keyed on the raw string
// silently fell back to that raw startsWith. Each entry is therefore parsed and matched
// as: same parsed origin, and the URI's normalized href starts with the prefix's (so a
// prefix with a path only admits that path, and '/cb/../admin' is resolved before
// comparing). The one exception is the port-wildcard form 'http://192.168.1.10:' (a
// trailing ':' right after the host), which means "this scheme and host, any port".
const PORT_WILDCARD_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/?#@]+:$/i;

function matchesAllowedPrefix(parsed: URL, prefix: string): boolean {
  let parsedPrefix: URL;
  try {
    parsedPrefix = new URL(prefix);
  } catch {
    return false; // an unparseable entry admits nothing
  }
  if (parsedPrefix.username !== '' || parsedPrefix.password !== '') return false;
  if (PORT_WILDCARD_PREFIX.test(prefix)) {
    return parsed.protocol === parsedPrefix.protocol && parsed.hostname === parsedPrefix.hostname;
  }
  return parsed.origin === parsedPrefix.origin && parsed.href.startsWith(parsedPrefix.href);
}

export function isRedirectUriAllowed(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.protocol === 'http:' && LOOPBACK_REDIRECT_HOSTNAMES.includes(parsed.hostname)) return true;
  if (CLAUDE_HOSTED_REDIRECT_URIS.includes(`${parsed.origin}${parsed.pathname}`)) return true;
  const extra = process.env.MCP_ALLOWED_REDIRECT_PREFIXES?.trim();
  if (!extra) return false;
  return extra
    .split(',')
    .map((s) => s.trim())
    .some((p) => p !== '' && matchesAllowedPrefix(parsed, p));
}
