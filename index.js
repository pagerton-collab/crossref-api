import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// PostgreSQL client
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ------------------------------------------------------------
// ROOT HTML HOMEPAGE
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>CrossRef API</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 40px;
            background: #f5f5f5;
            color: #333;
          }
          .box {
            background: white;
            padding: 30px;
            border-radius: 10px;
            max-width: 600px;
            margin: auto;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 {
            margin-top: 0;
          }
          code {
            background: #eee;
            padding: 4px 6px;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>CrossRef API is Live</h1>
          <p>Your backend is running successfully.</p>
          <p>Try a search:</p>
          <p><code>/search?query=12345</code></p>
          <p>Health check:</p>
          <p><code>/health</code></p>
        </div>
      </body>
    </html>
  `);
});

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ------------------------------------------------------------
// SEARCH ENDPOINT — SINGLE RECURSIVE SQL QUERY
// ------------------------------------------------------------
app.get("/search", async (req, res) => {
  try {
    const input = req.query.query?.trim().toUpperCase();
    if (!input) {
      return res.json({ count: 0, results: [] });
    }

    const sql = `
      WITH RECURSIVE family AS (
        -- Start with the input
        SELECT reference_number, part_number
        FROM public.access_parts
        WHERE UPPER(reference_number) = $1
           OR UPPER(part_number) = $1

        UNION

        -- Expand outward
        SELECT ap.reference_number, ap.part_number
        FROM public.access_parts ap
        INNER JOIN family f
          ON ap.reference_number = f.part_number
          OR ap.part_number = f.reference_number
      )
      SELECT DISTINCT ap.reference_number, ap.make, ap.part_number, ap.company, ap.description
      FROM public.access_parts ap
      INNER JOIN family f
        ON ap.reference_number = f.reference_number
        OR ap.part_number = f.part_number;
    `;

    const result = await client.query(sql, [input]);

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
// SERVER START — WITH DELAY TO ALLOW RENDER TO INJECT PORT
// ------------------------------------------------------------
client.connect().then(() => {
  setTimeout(() => {
    const PORT = process.env.PORT || 10000;
    console.log("Render PORT value:", process.env.PORT);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  }, 50);
});
