import { timingSafeEqual } from "node:crypto";

function same(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Ações de admin (disparar ciclo, mudar buscas) exigem ADMIN_TOKEN quando ele está
 * configurado, via `Authorization: Bearer` ou `x-admin-token`. Sem o segredo
 * configurado ficam fechadas: a API é pública e não tem login.
 */
export function isAdminRequest(req: Request, token = process.env.ADMIN_TOKEN): boolean {
  const secret = token?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const given = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? req.headers.get("x-admin-token") ?? "";
  return same(given, secret);
}
