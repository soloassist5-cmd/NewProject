/**
 * Достаёт размеры картинки прямо из заголовка файла.
 *
 * Нужно, чтобы отвести под изображение правильное место ещё до его загрузки —
 * иначе лента дёргается, когда картинки долистываются. Ради этого не тянем
 * стороннюю библиотеку: четырёх популярных форматов достаточно.
 */
export function imageSize(buffer: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return pngSize(buffer);
    if (mime === 'image/jpeg') return jpegSize(buffer);
    if (mime === 'image/gif') return gifSize(buffer);
    if (mime === 'image/webp') return webpSize(buffer);
  } catch {
    // Битый или непривычный заголовок — не беда, покажем без заданных размеров.
  }
  return null;
}

function pngSize(buffer: Buffer): { width: number; height: number } | null {
  // 8 байт подписи, затем чанк IHDR: длина(4) + тип(4) + ширина(4) + высота(4).
  if (buffer.length < 24) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function webpSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30 || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const format = buffer.toString('ascii', 12, 16);

  if (format === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  return null;
}

function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  // Идём по маркерам до SOFn — в нём и лежат размеры кадра.
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15, кроме DHT (c4), JPGA (c8) и DAC (cc) — они не про размер кадра.
    const isFrameStart = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrameStart) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}
