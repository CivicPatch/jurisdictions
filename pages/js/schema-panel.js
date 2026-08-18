import { escapeHtml } from "./utils.js";

// Lists registered tables + columns, queried live via information_schema
// against the in-browser DuckDB instance (not a static/hardcoded list).
export const SchemaPanel = {
  el: document.getElementById("schema-wrap"),

  async load(conn, tableNames) {
    if (!tableNames.length) return [];
    const nameList = tableNames.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
    const result = await conn.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name IN (${nameList})
      ORDER BY table_name, ordinal_position
    `);
    return result.toArray().map((row) => ({
      table: row.table_name,
      column: row.column_name,
      type: row.data_type,
    }));
  },

  render(schemaRows, rowCounts, onSelectTable) {
    if (!schemaRows.length) {
      this.el.innerHTML = "";
      return;
    }

    const byTable = new Map();
    for (const { table, column, type } of schemaRows) {
      if (!byTable.has(table)) byTable.set(table, []);
      byTable.get(table).push({ column, type });
    }

    const tablesHtml = [...byTable.entries()]
      .map(([table, cols]) => {
        const colsHtml = cols
          .map((c) => `${escapeHtml(c.column)} <span class="col-type">${escapeHtml(c.type)}</span>`)
          .join(", ");
        const rows = rowCounts.get(table);
        const rowCountHtml = rows === undefined
          ? ""
          : `<div class="schema-row-count">${rows.toLocaleString()} row${rows === 1 ? "" : "s"}</div>`;
        return `
          <div class="schema-table">
            <button type="button" class="schema-table-name" data-table="${escapeHtml(table)}">${escapeHtml(table)}</button>
            ${rowCountHtml}
            <div class="schema-columns">${colsHtml}</div>
          </div>
        `;
      })
      .join("");

    this.el.innerHTML = `<h2>Available tables</h2>${tablesHtml}`;

    this.el.querySelectorAll(".schema-table-name").forEach((btn) => {
      btn.addEventListener("click", () => onSelectTable(btn.dataset.table));
    });
  },
};
