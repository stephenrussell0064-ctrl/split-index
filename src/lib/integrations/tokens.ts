const TOKEN_PREFIX = "enc:";

export function encodeToken(token: string): string {
  if (!token) return token;
  return `${TOKEN_PREFIX}${Buffer.from(token, "utf8").toString("base64url")}`;
}

export function decodeToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(TOKEN_PREFIX)) return stored;
  try {
    return Buffer.from(stored.slice(TOKEN_PREFIX.length), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function generateOAuthState(userId: string): string {
  const payload = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function parseOAuthState(state: string): { userId: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [userId] = decoded.split(":");
    if (!userId) return null;
    return { userId };
  } catch {
    return null;
  }
}
