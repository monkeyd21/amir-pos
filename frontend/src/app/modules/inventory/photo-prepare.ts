/**
 * Shrinks a photo in the browser before it is uploaded.
 *
 * A phone photo is 3 to 8 MB and 4000px wide; the shop needs about 2000px. Re-
 * encoding here makes the upload fast on shop Wi-Fi, keeps the server free of
 * image libraries, turns the picture upright (the browser applies the camera's
 * EXIF orientation when it decodes), and drops the EXIF block itself, which
 * would otherwise publish the phone's GPS position on the website.
 */

export const MAX_EDGE = 2000;
const WEBP_QUALITY = 0.85;
const JPEG_QUALITY = 0.88;

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

/** The size to draw at: the longest side capped at `maxEdge`, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function preparePhoto(file: Blob, maxEdge = MAX_EDGE): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Chrome and Firefox cannot decode HEIC, the iPhone camera's format. An
    // iPhone converts it when uploading from Safari; a Mac needs an export.
    const name = (file as File).name ?? '';
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(name)) {
      throw new Error('HEIC photos cannot be read in this browser. Export it as JPEG, or upload from Safari.');
    }
    throw new Error('This photo could not be read. Save it as a JPEG and try again.');
  }

  const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare photos.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  // WebP is about a third smaller; a browser that cannot write it hands back a
  // PNG instead, which would be larger than the original, so fall back to JPEG.
  let blob = await encode(canvas, 'image/webp', WEBP_QUALITY);
  if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', JPEG_QUALITY);
  if (!blob) throw new Error('This photo could not be prepared.');
  return { blob, ...size };
}
