// PBKDF2-HMAC-SHA256 using WebAssembly SHA-256.
// Bypasses Workers 100k PBKDF2 iteration limit.
import SHA256 from "SHA256";

let instance = null;

function getInstance() {
  if (!instance) {
    instance = new WebAssembly.Instance(sha256Wasm, {});
  }
  return instance;
}

const BLOCK_SIZE = 64;
const DIGEST_SIZE = 32;

const _ipad = new Uint8Array(BLOCK_SIZE);
const _opad = new Uint8Array(BLOCK_SIZE);
const _innerMsg = new Uint8Array(BLOCK_SIZE + 256);
const _outerMsg = new Uint8Array(BLOCK_SIZE + DIGEST_SIZE);
const _hashedKey = new Uint8Array(DIGEST_SIZE);
const _saltBlock = new Uint8Array(64);
const _uBuf1 = new Uint8Array(DIGEST_SIZE);
const _uBuf2 = new Uint8Array(DIGEST_SIZE);
const _xorAcc = new Uint8Array(DIGEST_SIZE);

function sha256raw(data, out, outOffset = 0) {
  const inst = getInstance();
  const bufPtr = inst.exports.Hash_GetBuffer();
  const mem = new Uint8Array(inst.exports.memory.buffer);
  mem.subarray(bufPtr, bufPtr + data.length + 64).set(data);
  inst.exports.Hash_Init(256);
  inst.exports.Hash_Update(data.length);
  inst.exports.Hash_Final(0);
  out.set(mem.subarray(bufPtr, bufPtr + DIGEST_SIZE), outOffset);
}

function hmacSha256(key, message, out, outOffset = 0) {
  let k = key;
  if (key.length > BLOCK_SIZE) {
    sha256raw(key, _hashedKey);
    k = _hashedKey;
  }
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const b = i < k.length ? k[i] : 0;
    _ipad[i] = b ^ 0x36;
    _opad[i] = b ^ 0x5c;
  }
  _innerMsg.set(_ipad);
  _innerMsg.set(message, BLOCK_SIZE);
  sha256raw(_innerMsg.subarray(0, BLOCK_SIZE + message.length), _hashedKey);
  _outerMsg.set(_opad);
  _outerMsg.set(_hashedKey, BLOCK_SIZE);
  sha256raw(_outerMsg.subarray(0, BLOCK_SIZE + DIGEST_SIZE), out, outOffset);
}

export function pbkdf2hex(password, salt, iterations, keyLen) {
  const hLen = DIGEST_SIZE;
  const blocks = Math.ceil(keyLen / hLen);
  const pwBytes = new TextEncoder().encode(password);
  const result = new Uint8Array(blocks * hLen);

  for (let block = 1; block <= blocks; block++) {
    _saltBlock.set(salt.subarray(0, Math.min(salt.length, 60)));
    const sl = salt.length;
    _saltBlock[sl]     = (block >>> 24) & 0xff;
    _saltBlock[sl + 1] = (block >>> 16) & 0xff;
    _saltBlock[sl + 2] = (block >>> 8) & 0xff;
    _saltBlock[sl + 3] = block & 0xff;

    hmacSha256(pwBytes, _saltBlock.subarray(0, sl + 4), _uBuf1);
    _xorAcc.set(_uBuf1);

    let src = _uBuf1, dst = _uBuf2;
    for (let i = 1; i < iterations; i++) {
      hmacSha256(pwBytes, src, dst);
      for (let j = 0; j < hLen; j++) _xorAcc[j] ^= dst[j];
      [src, dst] = [dst, src];
    }

    result.set(_xorAcc.subarray(0, hLen), (block - 1) * hLen);
  }

  return bytesToHex(result.subarray(0, keyLen));
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, "0");
  }
  return out.join("");
}
