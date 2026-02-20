import express from "express";
import cors from "cors";
import pg from "pg";
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

client.connect();

// ------------------------------------------------------------
// ⭐ GRAPH-BASED CROSS-REFERENCE SEARCH (using access_parts)
// ------------------------------------------------------------
app.get("/search", async (req, res) => {
  try {
    const input = req.query.query?.trim().toUpperCase();
    if (!input) {
      return res.json({ count: 0, results: [] });
    }

    // STEP 1 — Load all rows (reference_number <-> part_number pairs)
    const allRows = await client.query(`
      SELECT reference_number, make, part_number, company, description
      FROM public.access_parts
    `);

    // STEP 2 — Build adjacency list (graph)
    const graph = {};
    for (const row of allRows.rows) {
      const a = row.part_number?.toUpperCase();
      const b = row.reference_number?.toUpperCase();

      if (!a || !b) continue;

      if (!graph[a]) graph[a] = new Set();
      if (!graph[b]) graph[b] = new Set();

      graph[a].add(b);
      graph[b].add(a);
    }

    // STEP 3 — BFS to find entire connected family
    const visited = new Set();
    const queue = [input];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;

      visited.add(current);

      if (graph[current]) {
        for (const neighbor of graph[current]) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    // STEP 4 — Fetch all rows where either field is in the family
    const family = Array.from(visited);

    const result = await client.query(
      `
      SELECT reference_number, make, part_number, company, description
      FROM public.access_parts
      WHERE UPPER(reference_number) = ANY($1)
         OR UPPER(part_number) = ANY($1)
      `,
      [family]
    );

    res.json({
      count: result.rows.length,
      results: result.rows
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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

