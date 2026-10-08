# 0.5.0-beta.2

[Install from npm](https://www.npmjs.com/package/memory-system-v2/v/0.5.0-beta.2) · [Download](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.2)

```sh
npm install memory-system-v2@beta
```

Use `npm.cmd` in Windows PowerShell if script execution is blocked. Requires Node.js 22 or 24 and an embedding provider.

This release uses the name **Memory System V2** and package **memory-system-v2**. The chat SDK saves original messages, retrieves their sources, and supports explicit corrections, deletion and rebuilding. The memory runtime and storage format are unchanged from beta.1.

The English and Chinese setup examples have been tested. Validation includes 23 SDK tests, Windows/Linux CI on Node 22/24, a fresh npm installation and the NVIDIA recall example. [Benchmark results](../benchmarks-product/blind/RESULTS.md) are unchanged.

## Limits

This is a developer SDK, without a bundled chat app, proxy or setup page. Recall can miss relevant messages. Long sources may be excerpted, token budgets are estimates, and rebuilding can make embedding requests. V1 data is not imported automatically.

## Download details

The attached package is `memory-system-v2-0.5.0-beta.2.tgz`, 244,282 bytes.

SHA256: `3121b7157da4338bee793a00e6f254d9bce3e3a219c6e8c6dbf12d748c521ec3`.

The package contains an earlier documentation snapshot. Use the current repository README for installation instructions.

The core comes from [LongMemory](https://github.com/CaviraOSS/LongMemory), with the revision and changes listed in [ATTRIBUTION](../ATTRIBUTION.md). Project code is MIT; imported LongMemory code is Apache-2.0.
