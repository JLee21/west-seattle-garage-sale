# ZeeMaps listings export

Fetches West Seattle Garage Sale markers from ZeeMaps (`group=7045507`) and writes a UTF-8 CSV for Knowledge Base upload.

## Prereqs

- Node.js 18+

## Install

```bash
cd scripts/zeemaps-export
npm install
```

## Usage

Smoke test (first 3 sales):

```bash
npm run export:sample
```

Full export (665 rows, default concurrency 20):

```bash
npm run export
```

Output defaults to `./out/listings.csv` (gitignored). Override with `--out /path/to/file.csv`.

### Options

- `--out <file>` — CSV path
- `--limit <n>` — fetch only the first `n` sales in the range (testing)
- `--start <n>` — first sale number (default `1`)
- `--count <n>` — how many sales to fetch (default `665`)
- `--base-eid <n>` — ZeeMaps id for sale 001 (default `566009225`)
- `--allow-partial` — exit 0 even if some rows failed
- `CONCURRENCY` — parallel requests (default `20`)

Example:

```bash
CONCURRENCY=15 npx tsx src/index.ts --out ./out/listings.csv
```

Confirm ZeeMaps terms allow this use before running at scale.
