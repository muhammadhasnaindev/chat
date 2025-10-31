/*
[PRO] Purpose:
  Provide stable absolute paths for file handling (uploads, static assets).

Context:
  `import.meta.url` resolution differs from CommonJS `__dirname`. We convert
  once here, so other modules avoid repeating this boilerplate.

Edge cases:
  - Running server from different directory or bundler requires realpath usage.
  - Uploads directory should exist; creation handled where needed.

Notes:
  Adjust relative path depth if folder structure changes.
*/
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repo root: server/src/config -> go up twice
export const ROOT_DIR = path.resolve(__dirname, "../../");
export const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
