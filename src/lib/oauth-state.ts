async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createOAuthState(secret: string): Promise<string> {
  const nonce = crypto.randomUUID();
  const exp = String(Date.now() + 10 * 60 * 1000);
  const payload = `${nonce}.${exp}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyOAuthState(secret: string, state: string): Promise<boolean> {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, exp, sig] = parts;
  if (!nonce || !exp || !sig) return false;
  const payload = `${nonce}.${exp}`;
  const expected = await hmacSha256Hex(secret, payload);
  if (sig !== expected) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return false;
  return true;
}
