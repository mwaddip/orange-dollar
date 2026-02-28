# Bootstrap Phases

The protocol starts empty and progresses through three phases before becoming fully operational.

## Phase 0: SEEDING

The reserve is being capitalised. Only **mintORC** is available — investors deposit WBTC and receive ORC tokens. No price oracle exists yet.

During seeding, the first ORC mint uses 1:1 pricing (1 WBTC = 1e8 ORC). Subsequent mints in this phase also use this initial pricing.

## Phase 1: PREMINT

The owner advances the phase and sets a **seed price** — the assumed BTC/USD price for initial calculations. The owner then:

1. Premints OD tokens (one-shot, subject to 400% ratio guard)
2. Creates a MotoSwap WBTC/OD liquidity pool
3. Registers the pool with the reserve (starts the TWAP clock)

During premint, the TWAP window fills (6 blocks, ~1 hour).

## Phase 2: LIVE

Automatic transition once the TWAP window has enough data. All four operations become available to anyone:

- **mintOD** — deposit WBTC, receive OD
- **burnOD** — return OD, receive WBTC
- **mintORC** — deposit WBTC, receive ORC
- **burnORC** — return ORC, receive WBTC

The seed price is never used again — the TWAP is the sole price source from this point forward.

::: info
Phase transitions are **irreversible**. Once LIVE, the protocol cannot be paused or reverted to an earlier phase.
:::
