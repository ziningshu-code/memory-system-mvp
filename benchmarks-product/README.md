# Retrieval benchmarks

The main evaluation is the [200-exchange benchmark](blind/README.md), with [results](blind/RESULTS.md) and a public raw report. It uses real NVIDIA embeddings and an unmodified LongMemory baseline.

This folder also contains an earlier 50-exchange comparison. Those results were used for calibration, so they are not an independent test of the final settings. See [real embedding results](REAL-RESULTS.md) and [offline harness checks](OFFLINE-RESULTS.md).

## Run the earlier comparison

Install the repository dependencies and build the product first. Set `LONGMEMORY_UPSTREAM_DIR` to a clean checkout of LongMemory at `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`.

```sh
npm ci
npm run build
node benchmarks-product/run.mjs --prepare
node benchmarks-product/run.mjs --smoke
```

`--prepare` checks the upstream revision and input plan. `--smoke` uses deterministic test vectors to check the runner. Neither makes an embedding request, and their retrieval scores do not measure model quality.

Live runs use NVIDIA `nvidia/nemotron-3-embed-1b` at 2048 dimensions. Set `NVIDIA_API_KEY` privately before running `--live`. The plan has 108 document strings and 16 query strings, batched into at most eight requests. Both implementations use the same vectors. Successful batches are cached locally and reused on subsequent runs.

Reports are written under `results/`. They record requests, provider-reported input tokens when available, latency and source checks. They do not contain API keys. The fixtures are synthetic conversations, not user exports.

The comparison checks original text, session isolation and supported correction behavior. Unsupported upstream history, erase or rebuild APIs are marked N/A. It does not measure final AI answers or total chat-token savings.
