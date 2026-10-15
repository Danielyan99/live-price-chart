Measured 2026-10-15 on Intel(R) Core(TM) i5-14400, ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11), Chrome 154.0.8037.100 (headless), 1440x900 @1x. 10 s per row.

| Scenario                        | CPU slowdown | Points in view | Feed msg/s | FPS | Draw avg | Draw p95 | Draw p99 | Draw max | Frames over 16.7 ms |
| ------------------------------- | ------------ | -------------- | ---------- | --- | -------- | -------- | -------- | -------- | ------------------- |
| Live feed, 15 min view          | none         | 5,727          | 22         | 143 | 0.70 ms  | 1.50 ms  | 2.20 ms  | 7.3 ms   | 0 / 1428            |
| Live feed, all history in view  | none         | 10,164         | 16         | 144 | 1.08 ms  | 2.10 ms  | 2.70 ms  | 3.9 ms   | 0 / 1440            |
| Live feed, all history in view  | 4×           | 10,276         | 20         | 126 | 3.17 ms  | 4.70 ms  | 6.80 ms  | 8.8 ms   | 0 / 1270            |
| Stress 10x, 100k points in view | none         | 100,000        | 609        | 143 | 2.18 ms  | 3.90 ms  | 5.10 ms  | 8.6 ms   | 0 / 1429            |
| Stress 10x, 100k points in view | 4×           | 100,000        | 592        | 56  | 8.48 ms  | 13.20 ms | 16.40 ms | 20.6 ms  | 4 / 582             |
| Stress 10x, 100k points in view | 6×           | 100,000        | 619        | 16  | 19.15 ms | 28.00 ms | 31.00 ms | 40.3 ms  | 103 / 176           |
| Stress 10x, 5 min view          | 6×           | 32,354         | 627        | 29  | 10.30 ms | 17.60 ms | 21.00 ms | 31.7 ms  | 28 / 303            |
| Replay 16x, 5 min view          | none         | 3,613          | 633        | 140 | 0.87 ms  | 2.20 ms  | 4.00 ms  | 7.7 ms   | 0 / 1405            |
