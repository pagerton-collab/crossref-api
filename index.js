app.get("/search", async (req, res) => {
  const client = await pool.connect();
  try {
    const query = req.query.query?.trim() || "";
    const fuzzy = req.query.fuzzy === "true";

    if (!query) {
      return res.json({ count: 0, results: [] });
    }

    // Normalize input (remove spaces, hyphens, slashes)
    const normalized = query.replace(/[\s\-\/]/g, "").toUpperCase();

    let sql;
    let params = [normalized];

    if (!fuzzy) {
      // -------------------------------
      // EXACT SEARCH MODE (fastest)
      // -------------------------------
      sql = `
        SELECT *,
          1 AS relevance
        FROM access_parts
        WHERE REPLACE(REPLACE(REPLACE(UPPER(part_number), ' ', ''), '-', ''), '/', '') = $1
           OR REPLACE(REPLACE(REPLACE(UPPER(reference_number), ' ', ''), '-', ''), '/', '') = $1
        LIMIT 500;
      `;
    } else {
      // -------------------------------
      // HYBRID FUZZY SEARCH MODE
      // Exact → Partial → Trigram
      // Balanced thresholds
      // -------------------------------

      sql = `
        WITH normalized_data AS (
          SELECT *,
            REPLACE(REPLACE(REPLACE(UPPER(part_number), ' ', ''), '-', ''), '/', '') AS npn,
            REPLACE(REPLACE(REPLACE(UPPER(reference_number), ' ', ''), '-', ''), '/', '') AS nrn
          FROM access_parts
        ),

        ranked AS (
          SELECT *,
            CASE
              WHEN npn = $1 OR nrn = $1 THEN 1        -- exact
              WHEN npn LIKE '%' || $1 || '%' 
                OR nrn LIKE '%' || $1 || '%' THEN 2  -- partial
              WHEN similarity(npn, $1) > 0.25 
                OR similarity(nrn, $1) > 0.25 THEN 3 -- trigram (balanced)
              ELSE 99
            END AS relevance_group,

            GREATEST(
              similarity(npn, $1),
              similarity(nrn, $1)
            ) AS sim_score

          FROM normalized_data
        )

        SELECT *
        FROM ranked
        WHERE relevance_group < 99
        ORDER BY relevance_group ASC, sim_score DESC
        LIMIT 500;
      `;
    }

    const result = await client.query(sql, params);

    res.json({
      count: result.rows.length,
      results: result.rows
    });

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  } finally {
    client.release();
  }
});
