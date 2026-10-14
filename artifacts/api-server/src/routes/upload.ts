import { Router, type IRouter } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const router: IRouter = Router();

// Ensure upload directory exists
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "productos");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Allowed MIME types and corresponding extensions (strictly raster images, no SVG for XSS defense)
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// Maximum image size: 5MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function requireAuth(req: any, res: any): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

router.post("/upload", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { data } = req.body ?? {};

  if (!data || typeof data !== "string") {
    res.status(400).json({ error: "Missing or invalid 'data' property in body" });
    return;
  }

  // Parse data URL: data:image/png;base64,iVBORw0...
  const match = data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  let mimeType = "";
  let base64Content = "";

  if (match) {
    mimeType = match[1].toLowerCase();
    base64Content = match[2];
  } else {
    // If sent as raw base64 without prefix, default to image/png or reject
    res.status(400).json({ error: "Image data must be a valid base64 data URL (e.g. data:image/png;base64,...)" });
    return;
  }

  // Strict MIME type verification (defense against malware/XSS)
  const extension = ALLOWED_MIME_TYPES[mimeType];
  if (!extension) {
    res.status(400).json({
      error: `Formato de imagen no permitido: '${mimeType}'. Solo se admiten JPG, PNG, WEBP y GIF.`
    });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Content, "base64");
  } catch {
    res.status(400).json({ error: "Error decoding base64 image data" });
    return;
  }

  // Size limit check
  if (buffer.length > MAX_IMAGE_BYTES) {
    res.status(400).json({ error: "La imagen excede el tamaño máximo permitido de 5MB." });
    return;
  }

  // Magic bytes inspection for extra security
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  const isWebp = buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP";

  if (!isJpeg && !isPng && !isGif && !isWebp) {
    res.status(400).json({ error: "El archivo no contiene una firma válida de imagen (JPEG, PNG, GIF, WEBP)." });
    return;
  }

  // Generate a cryptographically secure random filename to prevent path traversal and collisions
  const safeFilename = `prod_${Date.now()}_${crypto.randomBytes(8).toString("hex")}${extension}`;
  const filePath = path.join(UPLOADS_DIR, safeFilename);

  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err: any) {
    res.status(500).json({ error: "Error saving image to disk", details: err?.message });
    return;
  }

  // Return public URL relative to /api
  const publicUrl = `/api/uploads/productos/${safeFilename}`;
  res.status(200).json({ url: publicUrl });
});

export default router;
