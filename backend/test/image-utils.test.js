import assert from "node:assert/strict";
import test from "node:test";
import { detectImageType, getImageSize } from "../src/image-utils.js";

test("detectImageType recognizes PNG, JPEG, WebP and rejects unknown bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const webp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
    Buffer.from("VP8 ", "ascii")
  ]);
  const unknown = Buffer.from([0x00, 0x01, 0x02, 0x03]);

  assert.equal(detectImageType(png), "image/png");
  assert.equal(detectImageType(jpeg), "image/jpeg");
  assert.equal(detectImageType(webp), "image/webp");
  assert.equal(detectImageType(unknown), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

test("getImageSize reads PNG IHDR dimensions", () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  Buffer.from("IHDR", "ascii").copy(png, 12);
  png.writeUInt32BE(200, 16);
  png.writeUInt32BE(150, 20);
  assert.deepEqual(getImageSize(png, "image/png"), { width: 200, height: 150 });
  assert.equal(getImageSize(png.subarray(0, 20), "image/png"), null);
});

test("getImageSize reads JPEG SOF0 segment", () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff,
    0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    0x00, 0x96,
    0x00, 0x78,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01
  ]);
  assert.deepEqual(getImageSize(jpeg, "image/jpeg"), { width: 120, height: 150 });
  assert.equal(getImageSize(jpeg.subarray(0, 8), "image/jpeg"), null);
});

test("getImageSize reads WebP VP8, VP8L and VP8X headers", () => {
  const vp8 = Buffer.alloc(28);
  Buffer.from("RIFF", "ascii").copy(vp8, 0);
  Buffer.from("WEBP", "ascii").copy(vp8, 8);
  Buffer.from("VP8 ", "ascii").copy(vp8, 12);
  vp8[20] = 0x9d;
  vp8[21] = 0x01;
  vp8[22] = 0x2a;
  vp8.writeUInt16LE(200, 23);
  vp8.writeUInt16LE(64, 25);
  assert.deepEqual(getImageSize(vp8, "image/webp"), { width: 200, height: 64 });

  const vp8l = Buffer.alloc(25);
  Buffer.from("RIFF", "ascii").copy(vp8l, 0);
  Buffer.from("WEBP", "ascii").copy(vp8l, 8);
  Buffer.from("VP8L", "ascii").copy(vp8l, 12);
  vp8l[20] = 0x2f;
  vp8l.writeUInt32LE((199 << 14) | 199, 21);
  assert.deepEqual(getImageSize(vp8l, "image/webp"), { width: 200, height: 200 });

  const vp8x = Buffer.alloc(30);
  Buffer.from("RIFF", "ascii").copy(vp8x, 0);
  Buffer.from("WEBP", "ascii").copy(vp8x, 8);
  Buffer.from("VP8X", "ascii").copy(vp8x, 12);
  vp8x[24] = 199;
  vp8x[25] = 0;
  vp8x[26] = 0;
  vp8x[27] = 199;
  vp8x[28] = 0;
  vp8x[29] = 0;
  assert.deepEqual(getImageSize(vp8x, "image/webp"), { width: 200, height: 200 });
});
