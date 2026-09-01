import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_SSL = (process.env.DATABASE_SSL || "false").toLowerCase();
const DATABASE_PROVIDER = (
  process.env.DATABASE_PROVIDER ||
  process.env.DB_PROVIDER ||
  "pg"
).toLowerCase();

const SUPABASE_URL =
  process.env.SUPABASE_PROJECT_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHED_KEY;

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_REGION = process.env.R2_REGION || "auto";
const S3_FORCE_PATH_STYLE = ["true", "1"].includes(
  (process.env.S3_FORCE_PATH_STYLE || "false").toLowerCase(),
);

const SUPABASE_BUCKET =
  process.env.OTA_STORAGE_BUCKET ||
  process.env.R2_BUCKET ||
  process.env.SUPABASE_UPDATES_BUCKET ||
  "expo-updates";
const SIGNED_URL_TTL = parseInt(
  process.env.OTA_SIGNED_URL_TTL ||
    process.env.SUPABASE_SIGNED_URL_TTL ||
    "3600",
  10,
);

const JSONB_VALUE = Symbol("jsonb-value");

function jsonb(value) {
  return {
    [JSONB_VALUE]: true,
    value,
  };
}

function isJsonbValue(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value[JSONB_VALUE] === true,
  );
}

function toPostgresWriteValue(value) {
  return isJsonbValue(value) ? JSON.stringify(value.value) : value;
}

function unwrapJsonbPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload || {}).map(([key, value]) => [
      key,
      isJsonbValue(value) ? value.value : value,
    ]),
  );
}

if (DATABASE_PROVIDER !== "pg" && DATABASE_PROVIDER !== "supabase") {
  throw new Error(
    `Unsupported DATABASE_PROVIDER value: ${DATABASE_PROVIDER}. Expected \"pg\" or \"supabase\".`,
  );
}

const shouldUseSsl =
  DATABASE_SSL === "true" || DATABASE_SSL === "1" || DATABASE_SSL === "require";

let pool = null;
let s3 = null;
let supabaseClient = null;

function getPool() {
  if (pool) {
    return pool;
  }

  if (!DATABASE_URL) {
    throw new Error("Missing DATABASE_URL in environment.");
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  });

  return pool;
}

function getS3Client() {
  if (s3) {
    return s3;
  }

  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "Missing R2_ENDPOINT, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY in environment.",
    );
  }

  s3 = new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    forcePathStyle: S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  return s3;
}

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "Missing SUPABASE_PROJECT_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_PUBLISHED_KEY in environment.",
    );
  }

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

function toSqlColumns(columns) {
  if (!columns || columns === "*") {
    return "*";
  }

  return columns
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function isNullLike(value) {
  return value === null || value === undefined;
}

async function readObjectBodyAsBuffer(body) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (typeof body.arrayBuffer === "function") {
    const ab = await body.arrayBuffer();
    return Buffer.from(ab);
  }

  if (typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return Buffer.alloc(0);
}

class TableQuery {
  constructor(tableName) {
    this.tableName = tableName;
    this.operation = "select";
    this.selectedColumns = "*";
    this.filters = [];
    this.orderBy = null;
    this.limitValue = null;
    this.updatePayload = null;
    this.upsertPayload = null;
    this.upsertConflict = null;
    this.singleMode = null;
  }

  select(columns) {
    this.selectedColumns = columns || "*";
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  is(column, value) {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  neq(column, value) {
    this.filters.push({ type: "neq", column, value });
    return this;
  }

  not(column, operator, value) {
    this.filters.push({ type: "not", column, operator, value });
    return this;
  }

  order(column, options = {}) {
    this.orderBy = {
      column,
      ascending: options.ascending !== false,
      nullsFirst: options.nullsFirst === true,
    };
    return this;
  }

  limit(value) {
    this.limitValue = Number(value);
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.updatePayload = payload || {};
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  upsert(payload, options = {}) {
    this.operation = "upsert";
    this.upsertPayload = payload || {};
    this.upsertConflict = options.onConflict || null;
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  single() {
    this.singleMode = "single";
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  buildWhereClause(startIndex = 1) {
    const params = [];
    const conditions = [];
    let index = startIndex;

    for (const filter of this.filters) {
      if (filter.type === "eq") {
        if (isNullLike(filter.value)) {
          conditions.push(`${filter.column} IS NULL`);
        } else {
          conditions.push(`${filter.column} = $${index}`);
          params.push(filter.value);
          index += 1;
        }
        continue;
      }

      if (filter.type === "neq") {
        if (isNullLike(filter.value)) {
          conditions.push(`${filter.column} IS NOT NULL`);
        } else {
          conditions.push(`${filter.column} <> $${index}`);
          params.push(filter.value);
          index += 1;
        }
        continue;
      }

      if (filter.type === "is") {
        if (isNullLike(filter.value)) {
          conditions.push(`${filter.column} IS NULL`);
        } else if (filter.value === true) {
          conditions.push(`${filter.column} IS TRUE`);
        } else if (filter.value === false) {
          conditions.push(`${filter.column} IS FALSE`);
        } else {
          throw new Error(
            `Unsupported filter value: is ${String(filter.value)}`,
          );
        }
        continue;
      }

      if (filter.type === "not") {
        if (filter.operator === "is") {
          conditions.push(
            isNullLike(filter.value)
              ? `${filter.column} IS NOT NULL`
              : `${filter.column} IS DISTINCT FROM $${index}`,
          );
          if (!isNullLike(filter.value)) {
            params.push(filter.value);
            index += 1;
          }
          continue;
        }

        throw new Error(`Unsupported filter operator: not ${filter.operator}`);
      }
    }

    if (conditions.length === 0) {
      return { text: "", params, nextIndex: index };
    }

    return {
      text: ` WHERE ${conditions.join(" AND ")}`,
      params,
      nextIndex: index,
    };
  }

  buildOrderClause() {
    if (!this.orderBy) {
      return "";
    }

    const direction = this.orderBy.ascending ? "ASC" : "DESC";
    const nulls = this.orderBy.nullsFirst ? "NULLS FIRST" : "NULLS LAST";
    return ` ORDER BY ${this.orderBy.column} ${direction} ${nulls}`;
  }

  buildLimitClause(index) {
    if (!Number.isFinite(this.limitValue) || this.limitValue <= 0) {
      return { text: "", params: [] };
    }

    return {
      text: ` LIMIT $${index}`,
      params: [this.limitValue],
    };
  }

  async execute() {
    try {
      if (this.operation === "select") {
        return await this.executeSelect();
      }

      if (this.operation === "update") {
        return await this.executeUpdate();
      }

      if (this.operation === "delete") {
        return await this.executeDelete();
      }

      if (this.operation === "upsert") {
        return await this.executeUpsert();
      }

      throw new Error(`Unsupported operation: ${this.operation}`);
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  normalizeResultRows(rows) {
    if (this.singleMode === "single") {
      if (rows.length !== 1) {
        throw new Error("Expected a single row.");
      }
      return rows[0];
    }

    if (this.singleMode === "maybeSingle") {
      if (rows.length > 1) {
        throw new Error("Expected zero or one row.");
      }
      return rows[0] || null;
    }

    return rows;
  }

  async executeSelect() {
    const columnsSql = toSqlColumns(this.selectedColumns);
    const whereClause = this.buildWhereClause(1);
    const orderClause = this.buildOrderClause();
    const limitClause = this.buildLimitClause(whereClause.nextIndex);

    const sql = `SELECT ${columnsSql} FROM ${this.tableName}${whereClause.text}${orderClause}${limitClause.text}`;
    const params = [...whereClause.params, ...limitClause.params];

    const result = await getPool().query(sql, params);
    return {
      data: this.normalizeResultRows(result.rows),
      error: null,
    };
  }

  async executeUpdate() {
    const entries = Object.entries(this.updatePayload || {});
    if (entries.length === 0) {
      throw new Error("Update payload is empty.");
    }

    const setParts = [];
    const params = [];
    let index = 1;

    for (const [key, value] of entries) {
      setParts.push(`${key} = $${index}`);
      params.push(toPostgresWriteValue(value));
      index += 1;
    }

    const whereClause = this.buildWhereClause(index);
    const returning = this.selectedColumns
      ? ` RETURNING ${toSqlColumns(this.selectedColumns)}`
      : "";

    const sql = `UPDATE ${this.tableName} SET ${setParts.join(", ")}${whereClause.text}${returning}`;
    const result = await getPool().query(sql, [
      ...params,
      ...whereClause.params,
    ]);

    return {
      data: this.selectedColumns ? this.normalizeResultRows(result.rows) : null,
      error: null,
    };
  }

  async executeDelete() {
    const whereClause = this.buildWhereClause(1);
    const returning = this.selectedColumns
      ? ` RETURNING ${toSqlColumns(this.selectedColumns)}`
      : "";
    const sql = `DELETE FROM ${this.tableName}${whereClause.text}${returning}`;
    const result = await getPool().query(sql, whereClause.params);

    return {
      data: this.selectedColumns ? this.normalizeResultRows(result.rows) : null,
      error: null,
    };
  }

  async executeUpsert() {
    const payload = this.upsertPayload || {};
    const entries = Object.entries(payload);
    if (entries.length === 0) {
      throw new Error("Upsert payload is empty.");
    }

    const columns = entries.map(([key]) => key);
    const values = entries.map(([, value]) =>
      toPostgresWriteValue(value),
    );
    const placeholders = values.map((_, idx) => `$${idx + 1}`);

    const conflictColumns = (this.upsertConflict || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (conflictColumns.length === 0) {
      throw new Error("upsert requires onConflict columns.");
    }

    const updateColumns = columns.filter(
      (column) => !conflictColumns.includes(column),
    );
    const updateSetSql =
      updateColumns.length > 0
        ? updateColumns
            .map((column) => `${column} = EXCLUDED.${column}`)
            .join(", ")
        : `${conflictColumns[0]} = EXCLUDED.${conflictColumns[0]}`;

    const returning = this.selectedColumns
      ? ` RETURNING ${toSqlColumns(this.selectedColumns)}`
      : " RETURNING *";

    const sql = `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updateSetSql}${returning}`;
    const result = await getPool().query(sql, values);

    return {
      data: this.normalizeResultRows(result.rows),
      error: null,
    };
  }
}

class BucketStorageQuery {
  constructor(bucket) {
    this.bucket = bucket;
  }

  async list(prefix = "", options = {}) {
    try {
      const client = getS3Client();

      const normalizedPrefix = prefix
        ? prefix.endsWith("/")
          ? prefix
          : `${prefix}/`
        : "";
      const maxPageSize = 1000;
      const children = [];

      let continuationToken = undefined;
      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: normalizedPrefix,
            Delimiter: "/",
            ContinuationToken: continuationToken,
            MaxKeys: maxPageSize,
          }),
        );

        for (const folder of response.CommonPrefixes || []) {
          const folderPrefix = folder.Prefix || "";
          const folderName = folderPrefix
            .replace(normalizedPrefix, "")
            .replace(/\/$/, "");

          if (folderName) {
            children.push({ name: folderName, id: null });
          }
        }

        for (const item of response.Contents || []) {
          if (!item.Key) {
            continue;
          }

          const relative = item.Key.replace(normalizedPrefix, "");
          if (!relative || relative.includes("/")) {
            continue;
          }

          children.push({ name: relative, id: item.ETag || item.Key });
        }

        continuationToken = response.IsTruncated
          ? response.NextContinuationToken
          : undefined;
      } while (continuationToken);

      const order = options.sortBy?.order === "desc" ? "desc" : "asc";
      children.sort((a, b) => {
        if (a.name < b.name) {
          return order === "asc" ? -1 : 1;
        }
        if (a.name > b.name) {
          return order === "asc" ? 1 : -1;
        }
        return 0;
      });

      const offset = Number.isFinite(options.offset) ? options.offset : 0;
      const limit = Number.isFinite(options.limit)
        ? options.limit
        : children.length;

      return {
        data: children.slice(offset, offset + limit),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async download(objectPath) {
    try {
      const client = getS3Client();

      const result = await client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectPath,
        }),
      );

      const buffer = await readObjectBodyAsBuffer(result.Body);
      return {
        data: new Blob([buffer]),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async remove(paths) {
    try {
      const client = getS3Client();

      if (!Array.isArray(paths) || paths.length === 0) {
        return { data: [], error: null };
      }

      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: paths.map((key) => ({ Key: key })),
          },
        }),
      );

      return { data: paths, error: null };
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async createSignedUrl(objectPath, ttlSeconds) {
    try {
      const client = getS3Client();

      const signedUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectPath,
        }),
        { expiresIn: ttlSeconds },
      );

      return {
        data: { signedUrl },
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

class SupabaseTableQuery {
  constructor(builder) {
    this.builder = builder;
  }

  select(columns) {
    this.builder = this.builder.select(columns || "*");
    return this;
  }

  eq(column, value) {
    this.builder = this.builder.eq(column, value);
    return this;
  }

  is(column, value) {
    this.builder = this.builder.is(column, value);
    return this;
  }

  neq(column, value) {
    this.builder = this.builder.neq(column, value);
    return this;
  }

  not(column, operator, value) {
    this.builder = this.builder.not(column, operator, value);
    return this;
  }

  order(column, options = {}) {
    this.builder = this.builder.order(column, options);
    return this;
  }

  limit(value) {
    this.builder = this.builder.limit(value);
    return this;
  }

  update(payload) {
    this.builder = this.builder.update(unwrapJsonbPayload(payload));
    return this;
  }

  delete() {
    this.builder = this.builder.delete();
    return this;
  }

  upsert(payload, options = {}) {
    this.builder = this.builder.upsert(
      unwrapJsonbPayload(payload),
      options,
    );
    return this;
  }

  maybeSingle() {
    return this.builder.maybeSingle();
  }

  single() {
    return this.builder.single();
  }

  execute() {
    return this.builder;
  }

  then(resolve, reject) {
    return this.builder.then(resolve, reject);
  }
}

class SupabaseStorageQuery {
  constructor(client, bucket) {
    this.client = client;
    this.bucket = bucket;
  }

  list(prefix = "", options = {}) {
    return this.client.storage.from(this.bucket).list(prefix, options);
  }

  download(objectPath) {
    return this.client.storage.from(this.bucket).download(objectPath);
  }

  remove(paths) {
    return this.client.storage.from(this.bucket).remove(paths);
  }

  createSignedUrl(objectPath, ttlSeconds) {
    return this.client.storage
      .from(this.bucket)
      .createSignedUrl(objectPath, ttlSeconds);
  }
}

const supabase =
  DATABASE_PROVIDER === "supabase"
    ? {
        from(tableName) {
          return new SupabaseTableQuery(
            getSupabaseClient().from(tableName),
          );
        },
        storage: {
          from(bucket) {
            return new SupabaseStorageQuery(
              getSupabaseClient(),
              bucket || SUPABASE_BUCKET,
            );
          },
        },
      }
    : {
        from(tableName) {
          return new TableQuery(tableName);
        },
        storage: {
          from(bucket) {
            return new BucketStorageQuery(bucket || SUPABASE_BUCKET);
          },
        },
      };

export {
  supabase,
  jsonb,
  SUPABASE_BUCKET,
  SIGNED_URL_TTL,
  DATABASE_PROVIDER,
};
