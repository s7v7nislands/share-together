import { verifyAuth } from "../src/auth.js";
import { signJwt } from "../src/jwt.js";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Minimal env mock
const env = { JWT_SECRET: "test-secret-key-for-auth-tests!" };

function mockRequest(authHeader) {
  const headers = new Headers();
  if (authHeader) headers.set("Authorization", authHeader);
  return new Request("https://example.com/api/something", { headers });
}

describe("verifyAuth", () => {
  it("returns null when no Authorization header", async () => {
    const req = mockRequest(null);
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns null when Authorization header is malformed", async () => {
    const req = mockRequest("NotBearer xyz");
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns payload for valid JWT", async () => {
    const token = await signJwt({ sub: "u1", nickname: "Test" }, env.JWT_SECRET, 3600);
    const req = mockRequest(`Bearer ${token}`);
    const payload = await verifyAuth(req, env);
    assert.ok(payload !== null);
    assert.equal(payload.sub, "u1");
    assert.equal(payload.nickname, "Test");
  });

  it("returns null for expired JWT", async () => {
    const token = await signJwt({ sub: "u1" }, env.JWT_SECRET, 0);
    await new Promise((r) => setTimeout(r, 1100));
    const req = mockRequest(`Bearer ${token}`);
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns null for JWT signed with wrong secret", async () => {
    const token = await signJwt({ sub: "u1" }, "different-secret-key-yeah!!!!", 3600);
    const req = mockRequest(`Bearer ${token}`);
    assert.equal(await verifyAuth(req, env), null);
  });

  it("returns null for empty Bearer token", async () => {
    const req = mockRequest("Bearer ");
    assert.equal(await verifyAuth(req, env), null);
  });
});
