/**
 * src/selectors.ts
 *
 * Cross-contract call selectors for ODReserve.
 *
 * OPNet selectors are computed as the first 4 bytes of the SHA-256 hash of the
 * method signature string, e.g. SHA256("mint(address,uint256)")[0..3].
 *
 * These values were confirmed by:
 *   1. Matching the build output / test constants in OD.test.ts and ORC.test.ts
 *      for the OD/ORC selectors.
 *   2. Running SHA256 offline for the remaining signatures (same algorithm used
 *      by encodeSelector() in btc-runtime/runtime/math/abi.ts).
 *   3. Cross-referencing the MotoSwap ABIs found in
 *      node_modules/opnet/src/abi/shared/json/motoswap/ and
 *      node_modules/opnet/src/abi/shared/interfaces/motoswap/.
 */

// ─── OD / ORC (confirmed from build output + test constants) ─────────────────

/**
 * mint(address,uint256)
 * Used by ODReserve to mint OD and ORC tokens.
 * SHA256("mint(address,uint256)")[0..3] = 0x3950e061
 */
export const SEL_MINT: u32 = 0x3950e061;

/**
 * burn(address,uint256)
 * Used by ODReserve to burn OD and ORC tokens.
 * SHA256("burn(address,uint256)")[0..3] = 0xc5b162e8
 */
export const SEL_BURN: u32 = 0xc5b162e8;

// ─── WBTC / OP-20 standard (SHA256-derived, same standard as OD/ORC) ─────────

/**
 * transfer(address,uint256)
 * Used to transfer WBTC from the caller to the reserve.
 * SHA256("transfer(address,uint256)")[0..3] = 0x3b88ef57
 */
export const SEL_TRANSFER: u32 = 0x3b88ef57;

/**
 * transferFrom(address,address,uint256)
 * Used to pull WBTC from a user who has pre-approved the reserve.
 * SHA256("transferFrom(address,address,uint256)")[0..3] = 0x4b6685e7
 */
export const SEL_TRANSFER_FROM: u32 = 0x4b6685e7;

// ─── MotoSwap Pool (SHA256-derived; confirmed against MOTOSWAP_POOL_ABI.ts) ──

/**
 * token0()
 * Returns the address of the first token in the pool (sorted lexicographically).
 * SHA256("token0()")[0..3] = 0x3c1f365f
 */
export const SEL_TOKEN0: u32 = 0x3c1f365f;

/**
 * price0CumulativeLast()
 * Returns the cumulative price of token0 relative to token1, used for TWAP.
 * SHA256("price0CumulativeLast()")[0..3] = 0x2707193d
 */
export const SEL_PRICE0_CUMULATIVE_LAST: u32 = 0x2707193d;

/**
 * price1CumulativeLast()
 * Returns the cumulative price of token1 relative to token0, used for TWAP.
 * SHA256("price1CumulativeLast()")[0..3] = 0x0d1238ca
 */
export const SEL_PRICE1_CUMULATIVE_LAST: u32 = 0x0d1238ca;

/**
 * getReserves()
 * Returns (reserve0, reserve1, blockTimestampLast) from the pool.
 * SHA256("getReserves()")[0..3] = 0x06374bfc
 */
export const SEL_GET_RESERVES: u32 = 0x06374bfc;

// ─── MotoSwap Factory (SHA256-derived; confirmed against MOTOSWAP_FACTORY_ABI.ts) ─

/**
 * getPool(address,address)
 * Looks up the pool address for a given token pair.
 * SHA256("getPool(address,address)")[0..3] = 0x00bdc06a
 *
 * NOTE: The on-chain factory ABI in MOTOSWAP_FACTORY_ABI.ts uses parameter
 * names "tokenA" / "tokenB" but the selector is computed from the types only
 * ("getPool(address,address)"), so the selector is stable.
 */
export const SEL_GET_POOL: u32 = 0x00bdc06a;

// ─── ODReserve self (for documentation / cross-contract callback stubs) ───────

/**
 * getPhase()
 * SHA256("getPhase()")[0..3] = 0x8605fcee
 */
export const SEL_GET_PHASE: u32 = 0x8605fcee;

/**
 * advancePhase(uint256)
 * SHA256("advancePhase(uint256)")[0..3] = 0xd1ee3cb1
 */
export const SEL_ADVANCE_PHASE: u32 = 0xd1ee3cb1;

// ─── OP-20 standard view methods ──────────────────────────────────────────────

/**
 * balanceOf(address)
 * Returns the balance of the given address.
 * SHA256("balanceOf(address)")[0..3] = 0x5b46f8f6
 */
export const SEL_BALANCE_OF: u32 = 0x5b46f8f6;

/**
 * totalSupply()
 * Returns the total supply of the token.
 * SHA256("totalSupply()")[0..3] = 0xa368022e
 */
export const SEL_TOTAL_SUPPLY: u32 = 0xa368022e;

// ─── TODO markers ─────────────────────────────────────────────────────────────
//
// The following selectors are stubs that will be filled in as later tasks add
// the corresponding methods to ODReserve:
//
//   mintOD(uint256)            -- Task 8
//   burnOD(uint256)            -- Task 8
//   premintOD(address,uint256) -- Task 9
//
// MotoSwap factory createPool(address,address) selector:
//   TODO: confirm selector once we call it from reserve logic (Task 5/6)
//   SHA256("createPool(address,address)") needs runtime cross-check.
