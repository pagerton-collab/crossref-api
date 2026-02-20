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

// ------------------------------------------------------------
// ROOT ROUTE (helps Render detect the port instantly)
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "running", message: "CrossRef API is live" });
});

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ------------------------------------------------------------
// SEARCH ENDPOINT (NO PRELOAD, NO MEMORY CRASH)
// ------------------------------------------------------------
app.get("/search", async (req, res) => {
  try {
    const input = req.query.query?.trim().toUpperCase();
    if (!input) {
      return res.json({ count: 0, results: [] });
    }

    // STEP 1 — Get all rows where either field matches the input
    const seedRows = await client.query(
      `
      SELECT reference_number, make, part_number, company, description
      FROM public.access_parts
      WHERE UPPER(reference_number) = $1
         OR UPPER(part_number) = $1
      `,
      [input]
    );

    if (seedRows.rows.length === 0) {
      return res.json({ count: 0, results: [] });
    }

    // STEP 2 — BFS using database queries (no preload)
    const visited = new Set([input]);
    const queue = [input];
    const family = new Set([input]);

    while (queue.length > 0) {
      const current = queue.shift();

      const neighbors = await client.query(
        `
        SELECT reference_number, part_number
        FROM public.access_parts
        WHERE UPPER(reference_number) = $1
           OR UPPER(part_number) = $1
        `,
        [current]
      );

      for (const row of neighbors.rows) {
        const a = row.part_number?.toUpperCase();
        const b = row.reference_number?.toUpperCase();

        if (a && !visited.has(a)) {
          visited.add(a);
          family.add(a);
          queue.push(a);
        }

        if (b && !visited.has(b)) {
          visited.add(b);
          family.add(b);
          queue.push(b);
        }
      }
    }

    const familyArray = Array.from(family);

    // STEP 3 — Final fetch of all matching rows
    const finalRows = await client.query(
      `
      SELECT reference_number, make, part_number, company, description
      FROM public.access_parts
      WHERE UPPER(reference_number) = ANY($1)
         OR UPPER(part_number) = ANY($1)
      `,
      [familyArray]
    );

    res.json({
      count: finalRows.rows.length,
      results: finalRows.rows
    });

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// SERVER START — WITH DELAY TO ALLOW RENDER TO INJECT PORT
// ------------------------------------------------------------
client.connect().then(() => {
  setTimeout(() => {
    const PORT = process.env.PORT || 10000;
    console.log("Render PORT value:", process.env.PORT);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  }, 50);
});
