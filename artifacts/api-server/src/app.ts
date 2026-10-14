import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required");
}

const app: Express = express();

// ── 1. Security headers (helmet) ──────────────────────────────────────────────
// Adds X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security,
// Content-Security-Policy, Referrer-Policy, and more.
app.use(
  helmet({
    // CSP: allow same-origin resources only; adjust if serving a CDN-hosted frontend
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles common in express error pages
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Prevent MIME-type sniffing
    noSniff: true,
    // Block page from being loaded in an iframe (clickjacking protection)
    frameguard: { action: "deny" },
    // Force HTTPS for 1 year (includeSubDomains)
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    // Hide X-Powered-By: Express
    hidePoweredBy: true,
    // Prevent IE from executing downloads in the site context
    ieNoOpen: true,
    // Disable DNS prefetching
    dnsPrefetchControl: { allow: false },
    // Referrer policy — don't leak path in referrer header
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Cross-origin resource policy
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginEmbedderPolicy: false, // keep false to avoid breaking image loading in API responses
  }),
);

// ── 2. Request logger ─────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0], // strip query params from logs (may contain sensitive data)
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── 3. CORS — locked to known local origins only ──────────────────────────────
// Never reflects back the request origin (origin: true) with credentials enabled.
const ALLOWED_ORIGINS = [
  "http://localhost:5173",  // Vite dev server
  "http://127.0.0.1:5173",
  "http://localhost:4173",  // Vite preview
  "http://127.0.0.1:4173",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, same-origin server calls)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400, // preflight cache 24h
  }),
);

// ── 4. Rate limiting ───────────────────────────────────────────────────────────
// General limiter: all /api routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." },
  skip: (req) => req.method === "OPTIONS",
});

// Strict limiter: auth endpoints only (login / setup)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // max 20 attempts per 15 min per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos de autenticación. Intenta de nuevo en 15 minutos." },
});

app.use("/api", generalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/config/setup", authLimiter);

// ── 5. Body parsers ────────────────────────────────────────────────────────────
// Default: 1 MB (sufficient for all endpoints except image upload)
app.use((req: Request, res: Response, next: NextFunction) => {
  const isUpload = req.path === "/api/upload" || req.path === "/upload";
  express.json({ limit: isUpload ? "8mb" : "1mb" })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── 6. Session ─────────────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === "production";

app.use(
  session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    name: "sid", // don't use default "connect.sid" — obscure the framework
    cookie: {
      httpOnly: true,                // JS cannot read the cookie
      secure: isProduction,          // HTTPS-only in production
      sameSite: "strict",            // CSRF mitigation — only send on same-site requests
      maxAge: 1000 * 60 * 60 * 8,   // 8-hour session (shorter than previous 7 days)
    },
  }),
);

// ── 7. Static uploads ──────────────────────────────────────────────────────────
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(
  "/api/uploads",
  express.static(uploadsDir, {
    dotfiles: "deny",
    index: false,
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      // Prevent browsers from executing uploaded files as scripts
      res.setHeader("Content-Disposition", "inline");
    },
  }),
);

// ── 8. API routes ──────────────────────────────────────────────────────────────
app.use("/api", router);

// ── 9. 404 handler ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── 10. Global error handler ───────────────────────────────────────────────────
// Catches all unhandled errors from route handlers (Express 5 forwards async rejections here).
// NEVER leaks stack traces or internal details to the client.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const status = (err as any).status ?? (err as any).statusCode ?? 500;

  // Log full error server-side (including stack)
  logger.error({ err, method: req.method, url: req.url?.split("?")[0], status }, "Unhandled error");

  // CORS errors → 403
  if (err.message?.startsWith("CORS:")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Only reveal error message for client errors (4xx); never expose internals for 5xx
  const safe = status < 500
    ? err.message ?? "Bad request"
    : "Error interno del servidor";

  res.status(status).json({ error: safe });
});

export default app;
