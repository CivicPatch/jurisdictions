import { Theme } from "./theme.js";
import { Dataset } from "./dataset.js";
import { SchemaPanel } from "./schema-panel.js";
import { QueryRunner } from "./query-runner.js";

const statusEl = document.getElementById("status");
const tablesHintEl = document.getElementById("tables-hint");

Theme.init();

(async () => {
  try {
    const db = await Dataset.initDb();
    const conn = await db.connect();
    QueryRunner.init(conn);

    statusEl.textContent = "Loading dataset manifest…";
    const { tableNames, rowCounts } = await Dataset.registerViews(conn);

    statusEl.textContent = "Loading table schema…";
    const schemaRows = await SchemaPanel.load(conn, tableNames);
    SchemaPanel.render(schemaRows, rowCounts, (table) => {
      QueryRunner.setQuery(`SELECT * FROM ${table};`);
      QueryRunner.run();
    });

    statusEl.textContent = "Ready.";
    tablesHintEl.textContent = tableNames.length
      ? `${tableNames.length} table${tableNames.length === 1 ? "" : "s"} available — click a table name above to preview it`
      : "No tables found in manifest.";

    QueryRunner.setQuery(
      tableNames.includes("ocdid_uuid_lookup")
        ? "SELECT * FROM ocdid_uuid_lookup;"
        : tableNames.length
          ? `SELECT * FROM ${tableNames[0]};`
          : "-- No tables available"
    );

    QueryRunner.runBtn.disabled = false;
    if (tableNames.length) QueryRunner.run();
  } catch (err) {
    statusEl.textContent = "";
    QueryRunner.showError(err);
  }
})();
