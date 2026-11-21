# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/miuoas47-gif/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/miuoas47-gif/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast broken-CSV reader: a dependency-free ES module whose `run(input)` returns exactly what csv-reader 1.0.0 returns for `{text, header}` — `{columns, rows, errors}` — including its broken-row policy (BOM drop, stray CRs, unterminated quotes, quote junk, short/long rows, quoted line breaks), but much faster.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## How it is fast

- Most records are plain lines, so each record first tries a whole-line fast path: one slice plus `split(',')`.
- Anything with a quote or a stray CR falls back to a field-at-a-time parser that jumps between delimiters with `indexOf` and slices fields instead of building them character by character.
- Quoted fields are sliced between quotes; doubled quotes and embedded line breaks are handled segment by segment.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6gvkzysc&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
