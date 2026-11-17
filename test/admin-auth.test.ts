import { describe, expect, test } from "bun:test";
import { clientIp, isAdminRequest } from "../src/adminAuth.ts";

const req = (headers: Record<string, string> = {}) =>
  new Request("http://x/api/crawl", { method: "POST", headers });

describe("isAdminRequest", () => {
  test("com ADMIN_TOKEN, exige o token certo", () => {
    expect(isAdminRequest(req(), "s3cret")).toBe(false);
    expect(isAdminRequest(req({ "x-admin-token": "errado" }), "s3cret")).toBe(false);
    expect(isAdminRequest(req({ "x-admin-token": "s3cret" }), "s3cret")).toBe(true);
    expect(isAdminRequest(req({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
  });

  test("sem ADMIN_TOKEN configurado, ninguém passa", () => {
    expect(isAdminRequest(req(), "")).toBe(false);
    expect(isAdminRequest(req({ "x-admin-token": "qualquer" }), "  ")).toBe(false);
  });
});

describe("clientIp", () => {
  test("usa o último hop do X-Forwarded-For (o que o proxy acrescentou)", () => {
    expect(clientIp("1.2.3.4, 10.0.0.9", "10.0.0.1")).toBe("10.0.0.9");
  });
  test("cliente forjando vários IPs no começo não muda a chave", () => {
    expect(clientIp("6.6.6.6, 7.7.7.7, 203.0.113.5", undefined)).toBe("203.0.113.5");
  });
  test("sem header cai para o IP do socket", () => {
    expect(clientIp(null, "10.0.0.1")).toBe("10.0.0.1");
    expect(clientIp(null, undefined)).toBe("unknown");
  });
});
