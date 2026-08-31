import path from "path";
import { fileURLToPath } from "url";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);
const ROOT_DIR = path.resolve(CURRENT_DIR, "../");

export { CURRENT_DIR, ROOT_DIR };
