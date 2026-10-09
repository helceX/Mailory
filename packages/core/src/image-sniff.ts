/**
 * Identify an image by its leading bytes, never by the filename or the client-supplied MIME type.
 * Raster formats only: SVG is deliberately unsupported because it can carry script.
 */
export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (bytes.length >= 3 && startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytes.length >= 6 &&
    (startsWith([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      startsWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    startsWith([0x57, 0x45, 0x42, 0x50], 8)
  )
    return "image/webp";
  return null;
}
