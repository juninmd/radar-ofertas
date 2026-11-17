import { describe, expect, test } from "bun:test";
import { isAdminRequest } from "../src/adminAuth.ts";

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
