# Licence texts the npm packages do not carry

`@duckdb/duckdb-wasm` declares the MIT licence in its `package.json` but ships no licence
text, and its WebAssembly binary embeds DuckDB. The build copies these into the package's
`licenses/` beside the files of every other bundled package.

| File | From |
|---|---|
| `duckdb-wasm.LICENSE` | https://github.com/duckdb/duckdb-wasm, `LICENSE` |
| `duckdb.LICENSE` | https://github.com/duckdb/duckdb, `LICENSE` |
