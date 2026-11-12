import { open, type FileHandle } from "node:fs/promises";
import { HttpError } from "../http-errors";
import { inspectImage, MAX_IMAGE_BYTES, type ImageInfo } from "./images";

export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
export const MAX_USER_ASSET_BYTES = 10 * MAX_MEDIA_BYTES;
export const MAX_CONFIG_MEDIA_BYTES = MAX_MEDIA_BYTES;

/** Containers are inspected, never transcoded. A browser still decides whether it can decode a codec. */
export const MEDIA_FORMATS = [
  { extension: "wav", mime: "audio/wav", codecHint: "PCM и IEEE float; поддержка разрядности зависит от браузера" },
  { extension: "mp3", mime: "audio/mpeg", codecHint: "MPEG Layer III" },
  { extension: "ogg", mime: "audio/ogg", codecHint: "Opus или Vorbis; поддержка зависит от браузера" },
  { extension: "m4a", mime: "audio/mp4", codecHint: "Аудиодорожка MP4; обычно AAC, кодек не перекодируется" },
  { extension: "mp4", mime: "video/mp4", codecHint: "Видеодорожка MP4; обычно H.264/AAC, другие кодеки могут не играть в браузере" },
  { extension: "webm", mime: "video/webm", codecHint: "VP8/VP9/AV1 и Opus/Vorbis; поддержка зависит от браузера" },
] as const;

export interface MediaInfo {
  mime: string;
  ext: string;
  width: number;
  height: number;
}

const invalid = (message = "Контейнер звука или видео повреждён или не поддерживается") => new HttpError(422, "invalid_media", message);

async function read(handle: FileHandle, offset: number, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size);
  const { bytesRead } = await handle.read(buffer, 0, size, offset);
  return buffer.subarray(0, bytesRead);
}

function imageSignature(b: Buffer): boolean {
  return b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    b.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) || /^GIF8[79]a/.test(b.subarray(0, 6).toString("ascii")) ||
    (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP");
}

async function inspectWav(handle: FileHandle, bytes: number): Promise<MediaInfo> {
  const header = await read(handle, 0, 12);
  const declared = header.readUInt32LE(4) + 8;
  if (declared > bytes || declared < 44) throw invalid("WAV обрывается раньше конца контейнера");
  let fmt = false;
  let data = false;
  for (let offset = 12, n = 0; offset + 8 <= declared && n < 4096; n++) {
    const chunk = await read(handle, offset, 8);
    if (chunk.length < 8) throw invalid();
    const size = chunk.readUInt32LE(4);
    if (offset + 8 + size > declared) throw invalid();
    const id = chunk.toString("ascii", 0, 4);
    if (id === "fmt ") {
      if (size < 16) throw invalid();
      const format = await read(handle, offset + 8, Math.min(size, 40));
      let encoding = format.readUInt16LE(0);
      if (encoding === 0xfffe && size >= 40 && format.readUInt16LE(16) >= 22 && format.subarray(28, 40).equals(Buffer.from("00001000800000aa00389b71", "hex"))) encoding = format.readUInt32LE(24);
      if (![1, 3].includes(encoding) || !format.readUInt16LE(2) || !format.readUInt32LE(4) || !format.readUInt16LE(12) || !format.readUInt16LE(14)) {
        throw invalid("Поддерживается WAV с PCM или IEEE float; перекодирование не выполняется");
      }
      fmt = true;
    }
    if (id === "data" && size > 0) data = true;
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw invalid("В WAV нет формата или звуковых данных");
  return { mime: "audio/wav", ext: "wav", width: 0, height: 0 };
}

function mp3FrameLength(b: Buffer): number | null {
  if (b.length < 4 || b[0] !== 0xff || (b[1]! & 0xe0) !== 0xe0) return null;
  const version = (b[1]! >> 3) & 3;
  if (version === 1 || ((b[1]! >> 1) & 3) !== 1) return null; // Layer III, not AAC's ADTS sync word.
  const rate = (b[2]! >> 4) & 15;
  const sample = (b[2]! >> 2) & 3;
  if (rate === 0 || rate === 15 || sample === 3) return null;
  const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[rate]!;
  const sampleRate = [44100, 48000, 32000][sample]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
  return Math.floor((version === 3 ? 144 : 72) * bitrate * 1000 / sampleRate) + ((b[2]! >> 1) & 1);
}

async function inspectMp3(handle: FileHandle, head: Buffer, bytes: number): Promise<MediaInfo> {
  let offset = 0;
  if (head.toString("ascii", 0, 3) === "ID3") {
    if (head.length < 10 || head[3]! < 2 || head[3]! > 4 || head.subarray(6, 10).some((n) => n > 127)) throw invalid();
    offset = 10 + head.subarray(6, 10).reduce((n, v) => n * 128 + v, 0) + (head[3] === 4 && (head[5]! & 0x10) ? 10 : 0);
  }
  const first = mp3FrameLength(await read(handle, offset, 4));
  if (!first || offset + first > bytes) throw invalid("В MP3 нет полного MPEG Layer III кадра");
  // A second frame, when present, must have a real frame header too.
  if (offset + first + 4 <= bytes) {
    const next = await read(handle, offset + first, 4);
    const nextLength = mp3FrameLength(next);
    if ((!nextLength && next.toString("ascii", 0, 3) !== "TAG") || (nextLength && offset + first + nextLength > bytes)) throw invalid("Повреждена последовательность кадров MP3");
  }
  return { mime: "audio/mpeg", ext: "mp3", width: 0, height: 0 };
}

function inspectOgg(head: Buffer): MediaInfo {
  if (head.length < 28 || head[4] !== 0 || !(head[5]! & 2) || head[26] === 0) throw invalid();
  const count = head[26]!;
  if (head.length < 27 + count) throw invalid();
  let size = 0;
  for (let n = 0; n < count; n++) { size += head[27 + n]!; if (head[27 + n] !== 255) break; }
  const packet = head.subarray(27 + count, 27 + count + size);
  const opus = packet.length >= 19 && packet.toString("ascii", 0, 8) === "OpusHead" && packet[9]! > 0;
  const vorbis = packet.length >= 30 && packet[0] === 1 && packet.toString("ascii", 1, 7) === "vorbis" && packet[11]! > 0;
  if (packet.length !== size || (!opus && !vorbis)) throw invalid("Поддерживается OGG с Opus или Vorbis; перекодирование не выполняется");
  return { mime: "audio/ogg", ext: "ogg", width: 0, height: 0 };
}

interface Box { type: string; start: number; end: number; body: number }
function boxes(buffer: Buffer, start = 0, end = buffer.length): Box[] {
  const out: Box[] = [];
  for (let offset = start, n = 0; offset < end; n++) {
    if (n > 10_000 || offset + 8 > end) throw invalid();
    let size = buffer.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw invalid();
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
      size = Number(large); header = 16;
    }
    if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw invalid();
    out.push({ type: buffer.toString("ascii", offset + 4, offset + 8), start: offset, body: offset + header, end: offset + size });
    offset += size;
  }
  return out;
}

async function inspectMp4(handle: FileHandle, bytes: number): Promise<MediaInfo> {
  let moov: Buffer | null = null;
  let ftyp = false;
  let data = false;
  // Seek over mdat instead of loading an entire movie just to reach a trailing moov.
  for (let offset = 0, n = 0; offset < bytes; n++) {
    if (n > 10_000) throw invalid();
    const header = await read(handle, offset, Math.min(16, bytes - offset));
    if (header.length < 8) throw invalid();
    let size = header.readUInt32BE(0);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16 || header.readBigUInt64BE(8) > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
      size = Number(header.readBigUInt64BE(8)); headerSize = 16;
    }
    if (size === 0) size = bytes - offset;
    if (size < headerSize || offset + size > bytes) throw invalid();
    const type = header.toString("ascii", 4, 8);
    if (type === "ftyp") {
      if (size < headerSize + 8 || size > 4096 || (size - headerSize) % 4 !== 0) throw invalid();
      const brands = await read(handle, offset + headerSize, size - headerSize);
      const values = [brands.toString("ascii", 0, 4)];
      for (let n = 8; n + 4 <= brands.length; n += 4) values.push(brands.toString("ascii", n, n + 4));
      if (!values.some((brand) => /^(isom|iso[2-9]|mp4[12]|M4[ABPV] |avc1|dash|MSNV|cmf[acvs])$/.test(brand))) throw invalid("Контейнер не объявляет совместимость с MP4 или M4A");
      ftyp = true;
    }
    if (type === "mdat" && size > headerSize) data = true;
    if (type === "moov") {
      if (size > 8 * 1024 * 1024) throw invalid("Метаданные MP4 больше 8 МиБ");
      moov = await read(handle, offset + headerSize, size - headerSize);
    }
    offset += size;
  }
  if (!ftyp || !data || !moov) throw invalid("В MP4 нет таблицы дорожек или медиаданных");
  const handlers = new Set<string>();
  for (const track of boxes(moov).filter((box) => box.type === "trak")) {
    const mdia = boxes(moov, track.body, track.end).find((box) => box.type === "mdia");
    if (!mdia) continue;
    const children = boxes(moov, mdia.body, mdia.end);
    const hdlr = children.find((box) => box.type === "hdlr");
    const minf = children.find((box) => box.type === "minf");
    if (!hdlr || hdlr.end - hdlr.body < 12 || !minf) continue;
    const stbl = boxes(moov, minf.body, minf.end).find((box) => box.type === "stbl");
    const stsd = stbl && boxes(moov, stbl.body, stbl.end).find((box) => box.type === "stsd");
    if (!stsd || stsd.end - stsd.body < 16 || moov.readUInt32BE(stsd.body + 4) < 1) continue;
    const entries = boxes(moov, stsd.body + 8, stsd.end);
    if (entries.length < 1) continue;
    handlers.add(moov.toString("ascii", hdlr.body + 8, hdlr.body + 12));
  }
  if (handlers.has("vide")) return { mime: "video/mp4", ext: "mp4", width: 0, height: 0 };
  if (handlers.has("soun")) return { mime: "audio/mp4", ext: "m4a", width: 0, height: 0 };
  throw invalid("В MP4 не найдены аудио- или видеодорожки");
}

interface Ebml { id: number; body: number; end: number }
function ebml(buffer: Buffer, start: number, end: number): Ebml[] {
  const out: Ebml[] = [];
  const vint = (offset: number, id: boolean): { value: number; length: number; unknown: boolean } => {
    const first = buffer[offset];
    if (!first) throw invalid();
    let length = 1;
    while (!(first & (0x80 >> (length - 1))) && length <= 8) length++;
    if (length > (id ? 4 : 8) || offset + length > end) throw invalid();
    let value = id ? first : first & (0xff >> length);
    let unknown = !id && value === (0xff >> length);
    for (let n = 1; n < length; n++) { value = value * 256 + buffer[offset + n]!; unknown &&= buffer[offset + n] === 255; }
    return { value, length, unknown };
  };
  for (let offset = start, n = 0; offset < end; n++) {
    if (n > 10_000) throw invalid();
    const id = vint(offset, true);
    const size = vint(offset + id.length, false);
    const body = offset + id.length + size.length;
    const stop = size.unknown ? end : body + size.value;
    // A bounded prefix may finish inside Cluster; it must still include complete Tracks.
    out.push({ id: id.value, body, end: Math.min(stop, end) });
    if (stop > end || size.unknown) break;
    offset = stop;
  }
  return out;
}

function inspectWebm(head: Buffer): MediaInfo {
  const top = ebml(head, 0, head.length);
  const header = top.find((e) => e.id === 0x1a45dfa3);
  const segment = top.find((e) => e.id === 0x18538067);
  if (!header || !segment) throw invalid();
  const docType = ebml(head, header.body, header.end).find((e) => e.id === 0x4282);
  if (!docType || head.toString("ascii", docType.body, docType.end) !== "webm") throw invalid("Поддерживается WebM, а не произвольный Matroska");
  const tracks = ebml(head, segment.body, segment.end).find((e) => e.id === 0x1654ae6b);
  if (!tracks) throw invalid("Дорожки WebM должны находиться в первом МиБ файла");
  const types = new Set<number>();
  for (const track of ebml(head, tracks.body, tracks.end).filter((e) => e.id === 0xae)) {
    const children = ebml(head, track.body, track.end);
    const type = children.find((e) => e.id === 0x83);
    const codec = children.find((e) => e.id === 0x86);
    if (!type || type.end - type.body !== 1 || !codec) continue;
    const codecId = head.toString("ascii", codec.body, codec.end);
    if (!/^(V_VP8|V_VP9|V_AV1|A_OPUS|A_VORBIS)$/.test(codecId)) throw invalid(`Кодек WebM ${codecId.slice(0, 40)} не поддерживается; перекодирование не выполняется`);
    types.add(head[type.body]!);
  }
  if (types.has(1)) return { mime: "video/webm", ext: "webm", width: 0, height: 0 };
  if (types.has(2)) return { mime: "audio/webm", ext: "webm", width: 0, height: 0 };
  throw invalid("В WebM нет звуковых или видеодорожек");
}

/** Reads bounded headers/metadata; images alone are loaded whole and retain their old limits. */
export async function inspectAssetFile(path: string, bytes: number): Promise<MediaInfo | ImageInfo> {
  if (bytes === 0) throw new HttpError(422, "empty", "Пустой файл");
  if (bytes > MAX_MEDIA_BYTES) throw new HttpError(413, "too_big", "Файл больше 1 ГиБ");
  const handle = await open(path, "r");
  try {
    const head = await read(handle, 0, Math.min(bytes, 1024 * 1024));
    if (imageSignature(head)) {
      if (bytes > MAX_IMAGE_BYTES) throw new HttpError(413, "too_big", "Картинка больше 2 МБ");
      return inspectImage(await read(handle, 0, bytes));
    }
    if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE") return await inspectWav(handle, bytes);
    if (head.toString("ascii", 0, 3) === "ID3" || mp3FrameLength(head)) return await inspectMp3(handle, head, bytes);
    if (head.toString("ascii", 0, 4) === "OggS") return inspectOgg(head);
    if (head.toString("ascii", 4, 8) === "ftyp") return await inspectMp4(handle, bytes);
    if (head.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"))) return inspectWebm(head);
    // Keep the established error code and SVG hint for existing image clients.
    return inspectImage(head);
  } finally { await handle.close(); }
}

export type FileRange = { start: number; end: number };
/** Only one byte range is supported; reject malformed/multiple ranges without opening the file. */
export function parseFileRange(value: string, bytes: number): FileRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || bytes < 1) return null;
  if (!match[1]) {
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length <= 0) return null;
    return { start: Math.max(0, bytes - length), end: bytes - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : bytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes || start > end) return null;
  return { start, end: Math.min(end, bytes - 1) };
}
