import { escapeHtml, formatCell } from "./utils.js";

export const PAGE_SIZE = 100;

// Owns the SQL box, results table, pagination, and CSV export. Every query
// submitted through run() is paginated by wrapping it as a subquery with
// LIMIT/OFFSET pushed down into DuckDB — this keeps huge result sets (e.g.
// scanning master_ocdids' ~195k rows with no LIMIT) from ever being rendered
// into the DOM at once. CSV export is scoped to whatever page is on screen,
// matching the paginated view rather than re-fetching the full result set.
export const QueryRunner = {
  queryEl: document.getElementById("query"),
  runBtn: document.getElementById("run"),
  exportBtn: document.getElementById("export-csv"),
  resultsWrap: document.getElementById("results-wrap"),
  metaEl: document.getElementById("meta"),
  errorEl: document.getElementById("error"),
  paginationEl: document.getElementById("pagination"),
  prevBtn: document.getElementById("page-prev"),
  nextBtn: document.getElementById("page-next"),
  pageInfoEl: document.getElementById("page-info"),
  conn: null,
  lastResult: null,

  // Pagination state for the query currently on screen. baseSql is the
  // user's SQL with any trailing ";" stripped, ready to be wrapped as a
  // subquery; null means the last query couldn't be paginated (e.g. it
  // wasn't a SELECT) and ran as-is.
  baseSql: null,
  offset: 0,
  totalRows: 0,

  init(conn) {
    this.conn = conn;
    this.runBtn.addEventListener("click", () => this.run());
    this.exportBtn.addEventListener("click", () => this.exportCsv());
    this.prevBtn.addEventListener("click", () => this.goToPage(-1));
    this.nextBtn.addEventListener("click", () => this.goToPage(1));
    this.queryEl.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") this.run();
    });
  },

  setQuery(sql) {
    this.queryEl.value = sql;
  },

  showError(err) {
    this.errorEl.textContent = err instanceof Error ? err.message : String(err);
    this.errorEl.style.display = "block";
  },

  clearError() {
    this.errorEl.style.display = "none";
    this.errorEl.textContent = "";
  },

  renderResults(table) {
    this.lastResult = table;
    const cols = table.schema.fields.map((f) => f.name);
    const rows = table.toArray();

    if (rows.length === 0) {
      this.resultsWrap.innerHTML = "<p class='hint'>Query returned no rows.</p>";
      this.metaEl.textContent = "";
      this.exportBtn.disabled = true;
      return;
    }

    const thead = `<thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${rows
      .map(
        (row) =>
          `<tr>${cols.map((c) => `<td>${escapeHtml(formatCell(row[c]))}</td>`).join("")}</tr>`
      )
      .join("")}</tbody>`;

    this.resultsWrap.innerHTML = `<table>${thead}${tbody}</table>`;
    this.exportBtn.disabled = false;

    if (this.baseSql) {
      const from = this.totalRows === 0 ? 0 : this.offset + 1;
      const to = Math.min(this.offset + rows.length, this.totalRows);
      this.metaEl.textContent = `Rows ${from}–${to} of ${this.totalRows}`;
    } else {
      this.metaEl.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
    }
    this.updatePaginationUI();
  },

  updatePaginationUI() {
    if (!this.baseSql || this.totalRows <= PAGE_SIZE) {
      this.paginationEl.hidden = true;
      return;
    }
    this.paginationEl.hidden = false;
    const currentPage = Math.floor(this.offset / PAGE_SIZE) + 1;
    const totalPages = Math.ceil(this.totalRows / PAGE_SIZE);
    this.pageInfoEl.textContent = `Page ${currentPage} of ${totalPages}`;
    this.prevBtn.disabled = this.offset <= 0;
    this.nextBtn.disabled = this.offset + PAGE_SIZE >= this.totalRows;
  },

  toCsv(table) {
    const cols = table.schema.fields.map((f) => f.name);
    const rows = table.toArray();

    const escapeCsvCell = (value) => {
      const str = formatCell(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [cols.map(escapeCsvCell).join(",")];
    for (const row of rows) {
      lines.push(cols.map((c) => escapeCsvCell(row[c])).join(","));
    }
    return lines.join("\r\n");
  },

  exportCsv() {
    if (!this.lastResult) return;
    const csv = this.toCsv(this.lastResult);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `query-results-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  // Fetches the page at the current offset for the already-counted baseSql.
  async fetchPage() {
    const result = await this.conn.query(
      `SELECT * FROM (${this.baseSql}) AS _q LIMIT ${PAGE_SIZE} OFFSET ${this.offset}`
    );
    this.renderResults(result);
  },

  async goToPage(delta) {
    if (!this.baseSql) return;
    const nextOffset = this.offset + delta * PAGE_SIZE;
    if (nextOffset < 0 || nextOffset >= this.totalRows) return;

    this.offset = nextOffset;
    this.clearError();
    try {
      await this.fetchPage();
    } catch (err) {
      this.showError(err);
    }
  },

  async run() {
    this.clearError();
    this.runBtn.disabled = true;
    const sql = this.queryEl.value.trim().replace(/;\s*$/, "");

    try {
      // Push LIMIT/OFFSET down into DuckDB by wrapping the query as a
      // subquery, so huge result sets (e.g. the ~195k-row master_ocdids
      // table with no LIMIT) never get materialized into the DOM at once.
      // Only works for SELECT-shaped queries — DESCRIBE/PRAGMA/etc. can't
      // be wrapped this way and fall through to the unpaginated path below.
      const countResult = await this.conn.query(`SELECT COUNT(*) AS cnt FROM (${sql}) AS _q`);
      this.totalRows = Number(countResult.toArray()[0].cnt);
      this.baseSql = sql;
      this.offset = 0;
      await this.fetchPage();
    } catch {
      this.baseSql = null;
      this.paginationEl.hidden = true;
      try {
        const result = await this.conn.query(this.queryEl.value);
        this.renderResults(result);
      } catch (err) {
        this.showError(err);
        this.resultsWrap.innerHTML = "";
        this.metaEl.textContent = "";
        this.exportBtn.disabled = true;
      }
    } finally {
      this.runBtn.disabled = false;
    }
  },
};
