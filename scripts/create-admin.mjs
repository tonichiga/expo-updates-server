import { hash } from "bcryptjs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Environment may already be provided by the shell or deployment platform.
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;
const ROLES = new Set(["admin", "operator", "viewer"]);

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

async function readHidden(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Password input requires an interactive terminal.");
  }

  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };

    const onData = (character) => {
      if (character === "\u0003") {
        cleanup();
        reject(new Error("Cancelled."));
        return;
      }

      if (character === "\r" || character === "\n") {
        cleanup();
        resolve(value);
        return;
      }

      if (character === "\u007f") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      value += character;
      stdout.write("*");
    };

    stdin.on("data", onData);
  });
}

async function main() {
  const provider = (
    process.env.DATABASE_PROVIDER ||
    process.env.DB_PROVIDER ||
    "pg"
  ).toLowerCase();
  const databaseUrl = process.env.DATABASE_URL;
  if (provider !== "supabase" && !databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const username = normalizeUsername(
      await terminal.question("Username: "),
    );
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error(
        "Username must contain 3-64 lowercase letters, numbers, dots, underscores or dashes.",
      );
    }

    const roleInput = (
      await terminal.question("Role [admin]: ")
    ).trim().toLowerCase();
    const role = roleInput || "admin";
    if (!ROLES.has(role)) {
      throw new Error("Role must be admin, operator or viewer.");
    }

    terminal.pause();
    const password = await readHidden("Password: ");
    const confirmation = await readHidden("Confirm password: ");
    if (password !== confirmation) {
      throw new Error("Passwords do not match.");
    }
    if (password.length < 12) {
      throw new Error("Password must contain at least 12 characters.");
    }

    const passwordHash = await hash(password, 12);
    if (provider === "supabase") {
      const url = process.env.SUPABASE_PROJECT_URL || process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error(
          "SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
        );
      }

      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.from("ota_admin_users").upsert(
        {
          username,
          password_hash: passwordHash,
          role,
          is_active: true,
        },
        { onConflict: "username" },
      );
      if (error) {
        throw new Error(error.message);
      }
    } else {
      const sslEnabled = ["true", "1", "require"].includes(
        (process.env.DATABASE_SSL || "false").toLowerCase(),
      );
      const pool = new Pool({
        connectionString: databaseUrl,
        ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      });

      try {
        await pool.query(
          `insert into public.ota_admin_users
            (username, password_hash, role, is_active)
           values ($1, $2, $3, true)
           on conflict (username) do update
             set password_hash = excluded.password_hash,
                 role = excluded.role,
                 is_active = true,
                 modified_at = now()`,
          [username, passwordHash, role],
        );
      } finally {
        await pool.end();
      }
    }

    console.log(`User "${username}" is ready with role "${role}".`);
  } finally {
    terminal.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
