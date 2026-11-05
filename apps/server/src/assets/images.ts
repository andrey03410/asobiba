import { Resvg } from "@resvg/resvg-js";
import { imageSize } from "image-size";
import { HttpError } from "../http-errors";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 2048;
export const MAX_SVG_CHARS = 200_000;
const SVG_RENDER_WIDTH = 512;

export interface ImageInfo {
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  ext: "png" | "jpg" | "gif" | "webp";
  width: number;
  height: number;
}

function sniff(buf: Buffer): Pick<ImageInfo, "mime" | "ext"> | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")) return { mime: "image/gif", ext: "gif" };
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/** Checks the signature, size and dimensions of a raster image. Throws HttpError 422. */
export function inspectImage(buf: Buffer): ImageInfo {
  if (buf.length === 0) throw new HttpError(422, "empty", "Пустой файл");
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, "too_big", `Картинка больше ${MAX_IMAGE_BYTES / 1024 / 1024} МБ`);
  const type = sniff(buf);
  if (!type) {
    const head = buf.subarray(0, 200).toString("utf8").trimStart().toLowerCase();
    const hint = head.startsWith("<svg") || head.startsWith("<?xml") ? " SVG передайте через asset_create_svg — сервер переведёт его в PNG." : "";
    throw new HttpError(422, "not_image", `Это не PNG, JPEG, GIF или WebP.${hint}`);
  }
  let size: { width?: number; height?: number };
  try {
    size = imageSize(buf);
  } catch {
    throw new HttpError(422, "broken_image", "Не удалось прочитать размеры картинки");
  }
  const width = size.width ?? 0;
  const height = size.height ?? 0;
  if (width < 1 || height < 1) throw new HttpError(422, "broken_image", "Не удалось прочитать размеры картинки");
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw new HttpError(422, "too_large_dimensions", `Картинка ${width}×${height}: максимум ${MAX_IMAGE_SIDE} px по стороне`);
  }
  return { ...type, width, height };
}

const SAFE_HREF = /^(#|data:image\/(png|jpeg|gif|webp);base64,)/i;

/**
 * Rasterizes an agent-made SVG into PNG. The SVG never reaches browsers.
 * References outside the document (files, URLs) and DTD entities are refused.
 */
export function rasterizeSvg(svg: string): Buffer {
  if (svg.length > MAX_SVG_CHARS) throw new HttpError(413, "too_big", `SVG длиннее ${MAX_SVG_CHARS} символов`);
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) throw new HttpError(422, "svg_unsafe", "DOCTYPE и сущности в SVG запрещены");
  if (!/<svg[\s>/]/i.test(svg)) throw new HttpError(422, "not_svg", "Нужен SVG-документ с корнем <svg>");
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    if (!SAFE_HREF.test((m[1] ?? "").trim())) {
      throw new HttpError(422, "svg_external", "Ссылки наружу в SVG запрещены: разрешены только #id и встроенные data:image/…;base64");
    }
  }
  if (/url\(\s*["']?(?!#)/i.test(svg) || /@import/i.test(svg)) {
    throw new HttpError(422, "svg_external", "В SVG разрешены только url(#id)");
  }
  let png: Buffer;
  try {
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: SVG_RENDER_WIDTH }, font: { loadSystemFonts: false }, background: "rgba(0,0,0,0)" });
    png = resvg.render().asPng();
  } catch (e) {
    throw new HttpError(422, "svg_invalid", `SVG не разобрался: ${(e as Error).message.slice(0, 200)}`);
  }
  inspectImage(png);
  return png;
}

/** Renders a trusted SVG (our own previews) into PNG. */
export function renderTrustedSvg(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
}
