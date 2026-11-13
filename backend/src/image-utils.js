const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) {
    return null;
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function readPngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (offset + 4 > buffer.length) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      return null;
    }
    const isSof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
    if (isSof) {
      if (offset + 7 + 4 > buffer.length) {
        return null;
      }
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpVp8Size(buffer, chunkStart) {
  const frameStart = chunkStart + 4;
  if (frameStart + 7 > buffer.length) {
    return null;
  }
  if (buffer[frameStart] !== 0x9d || buffer[frameStart + 1] !== 0x01 || buffer[frameStart + 2] !== 0x2a) {
    return null;
  }
  const width = buffer.readUInt16LE(frameStart + 3) & 0x3fff;
  const height = buffer.readUInt16LE(frameStart + 5) & 0x3fff;
  return { width, height };
}

function readWebpVp8lSize(buffer, chunkStart) {
  const dataStart = chunkStart + 4;
  if (dataStart + 5 > buffer.length) {
    return null;
  }
  if (buffer[dataStart] !== 0x2f) {
    return null;
  }
  const bits =
    buffer[dataStart + 1]
    | (buffer[dataStart + 2] << 8)
    | (buffer[dataStart + 3] << 16)
    | (buffer[dataStart + 4] << 24);
  const width = 1 + (bits & 0x3fff);
  const height = 1 + ((bits >> 14) & 0x3fff);
  return { width, height };
}

function readWebpVp8xSize(buffer, chunkStart) {
  const dataStart = chunkStart + 4;
  if (dataStart + 10 > buffer.length) {
    return null;
  }
  const width = 1 + (
    buffer[dataStart + 4]
    | (buffer[dataStart + 5] << 8)
    | (buffer[dataStart + 6] << 16)
  );
  const height = 1 + (
    buffer[dataStart + 7]
    | (buffer[dataStart + 8] << 8)
    | (buffer[dataStart + 9] << 16)
  );
  return { width, height };
}

function readWebpSize(buffer) {
  if (buffer.length < 16 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const fourCc = buffer.toString("ascii", 12, 16);
  const chunkStart = 16;
  if (fourCc === "VP8 ") {
    return readWebpVp8Size(buffer, chunkStart);
  }
  if (fourCc === "VP8L") {
    return readWebpVp8lSize(buffer, chunkStart);
  }
  if (fourCc === "VP8X") {
    return readWebpVp8xSize(buffer, chunkStart);
  }
  return null;
}

export function getImageSize(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !IMAGE_MIMES.has(mime)) {
    return null;
  }
  if (mime === "image/png") {
    return readPngSize(buffer);
  }
  if (mime === "image/jpeg") {
    return readJpegSize(buffer);
  }
  if (mime === "image/webp") {
    return readWebpSize(buffer);
  }
  return null;
}
