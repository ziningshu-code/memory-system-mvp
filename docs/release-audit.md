# Validation

## Installation and SDK

Beta.2 passed a fresh npm registry installation, strict TypeScript checking, native SQLite initialization and the save/recall/restart/history/rebuild/delete/close lifecycle. The NVIDIA README example returned the exact saved flight message.

The SDK has 23 passing tests. [CI](https://github.com/ziningshu-code/memory-system-mvp/actions) checks Windows/Linux and Node 22/24.

## Retrieval

The synthetic benchmark contains 200 exchanges across eight sessions, 400 messages and 50 labeled queries. Both implementations received the same messages and cached real NVIDIA embeddings.

Among 35 shared ranked queries, the expected user source appeared in the first five results in 33 cases for this SDK and 21 for the pinned LongMemory baseline. Both recovered all 400 saved messages after restart. Two Chinese-history/English-query cases were missed by this SDK.

This evaluates retrieval and storage, not generated answers or total chat-token savings. The [method](../benchmarks-product/blind/README.md), [results](../benchmarks-product/blind/RESULTS.md) and [raw report](../benchmarks-product/blind/FINAL-RESULTS.json) contain the details.

## Package

The published `memory-system-v2-0.5.0-beta.2.tgz` is 244,282 bytes, SHA256 `3121b7157da4338bee793a00e6f254d9bce3e3a219c6e8c6dbf12d748c521ec3`.

The npm download and GitHub release attachment have matching bytes. Required licenses and notices are included. No credentials, local databases or private application files are shipped.
