import { signJwt, verifyJwt } from "../src/jwt.js";
import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";

const SECRET = "test-secret-key-32-bytes-long!!";

describe("jwt sign and verify", () => {
  it("signs a JWT and returns a 3-part token", async () => {
    const token = await signJwt({ sub: "user-1", nickname: "Alice" }, SECRET, 3600);
    assert.ok(typeof token === "string");
    const parts = token.split(".");
    assert.equal(parts.length, 3);
    assert.ok(parts[0].length > 0);
    assert.ok(parts[1].length > 0);
    assert.ok(parts[2].length > 0);
  });

  it("verifies a valid token and returns the payload", async () => {
    const token = await signJwt({ sub: "user-1", nickname: "Alice" }, SECRET, 3600);
    const payload = await verifyJwt(token, SECRET);
    assert.ok(payload !== null);
    assert.equal(payload.sub, "user-1");
    assert.equal(payload.nickname, "Alice");
    assert.ok(typeof payload.iat === "number");
    assert.ok(typeof payload.exp === "number");
  });

  it("rejects a token with wrong secret", async () => {
    const token = await signJwt({ sub: "user-1" }, SECRET, 3600);
    const payload = await verifyJwt(token, "wrong-secret-key!!------------");
    assert.equal(payload, null);
  });

  it("rejects an expired token", async () => {
    const token = await signJwt({ sub: "user-1" }, SECRET, 0); // expires immediately
    // wait 1 second to ensure expiry
    await new Promise((r) => setTimeout(r, 1100));
    const payload = await verifyJwt(token, SECRET);
    assert.equal(payload, null);
  });

  it("rejects a tampered token", async () => {
    const token = await signJwt({ sub: "user-1" }, SECRET, 3600);
    const parts = token.split(".");
    // Tamper with the payload
    const tamperedPayload = btoa(JSON.stringify({ sub: "attacker", iat: 1, exp: 9999999999 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const payload = await verifyJwt(tampered, SECRET);
    assert.equal(payload, null);
  });

  it("rejects malformed input", async () => {
    assert.equal(await verifyJwt("", SECRET), null);
    assert.equal(await verifyJwt("not.a.jwt", SECRET), null);
    assert.equal(await verifyJwt("a.b", SECRET), null);
    assert.equal(await verifyJwt("a.b.c.d", SECRET), null);
  });
});
