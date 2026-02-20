import express from "express";
import cors from "cors";
import pg from "pg";
import Cursor from "pg-cursor";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL client
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// GLOBAL DATA
let ALL_ROWS = [];
let GRAPH = {};

// ------------------------------------------------------------
// STREAMING PRELOAD (prevents memory crash)
// ------------------------------------------------------------
async function preload() {
  console.log("Streaming access_parts...");

  const cursorQuery = `
    SELECT reference_number, make, part_number, company, description
    FROM public.access_parts
  `;

  const cursor = client.query(new Cursor(cursorQuery));

  ALL_ROWS = [];
  GRAPH = {};

  const batchSize = 5000;

  while (true) {
    const rows = await cursor.read(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      ALL_ROWS.push(row);

      const a = row.part_number?.toUpperCase();
      const b = row.reference_number?.toUpperCase();

      if (!a || !b) continue;

      if (!GRAPH[a]) GRAPH[a] = new Set();
      if (!GRAPH[b]) GRAPH[b] = new Set();

      GRAPH[a].add(b);
      GRAPH[b].add(a);
    }
  }

  console.log("Finished streaming rows:", ALL_ROWS.length);
}

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ------------------------------------------------------------
// SEARCH ENDPOINT
// ------------------------------------------------------------
app.get("/search", async (req, res) => {
  try {
    const input = req.query.query?.trim().toUpperCase();
    if (!input) {
      return res.json({ count: 0, results: [] });
    }

    const visited = new Set();
    const queue = [input];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;

      visited.add(current);

      if (GRAPH[current]) {
        for (const neighbor of GRAPH[current]) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
    }

    const family = Array.from(visited);

    const results = ALL_ROWS.filter(row =>
      family.includes(row.part_number?.toUpperCase()) ||
      family.includes(row.reference_number?.toUpperCase())
    );

    res.json({
      count: results.length,
      results
    });

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// SERVER START
// ------------------------------------------------------------
const PORT = process.env.PORT || 10000;
console.log("Render PORT value:", process.env.PORT);

client.connect().then(async () => {
  await preload();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
