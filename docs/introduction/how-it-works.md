# How It Works

The Orange Dollar protocol has three components:

1. **The Reserve** — A smart contract (`ODReserve`) holding WBTC collateral
2. **OD** — The stablecoin token, minted and burned against the reserve
3. **ORC** — The equity token, representing ownership of reserve surplus

## The Flow

**Minting OD:**
You deposit WBTC → the reserve calculates how much OD you get at the current TWAP price → deducts 1.5% fee → sends you OD.

**Burning OD:**
You return OD → the reserve calculates how much WBTC to give you at the current TWAP price → deducts 1.5% fee → sends you WBTC.

**Minting ORC:**
You deposit WBTC → the reserve calculates how much ORC you get based on the current equity per ORC → deducts 1.5% fee → sends you ORC.

**Burning ORC:**
You return ORC → the reserve calculates your proportional share of equity → deducts 1.5% fee → sends you WBTC.

## Reserve Ratio

The protocol enforces a reserve ratio between **400%** and **800%**:

- If the ratio is near 400%, minting OD is blocked (reserve is too thin)
- If the ratio is near 800%, minting ORC is blocked (reserve is already oversaturated)
- Burning OD is **never** blocked — you can always redeem

This range ensures the reserve is always overcollateralised while keeping capital somewhat efficient.

## Price Oracle

OD uses a **6-block TWAP** (Time-Weighted Average Price) from the MotoSwap WBTC/OD pool. This is a rolling average that resists manipulation — an attacker would need to sustain a fake price for a full hour to move it.

## Fee Yield

Every operation charges **1.5%**. This fee stays in the reserve, growing the total WBTC held. Since ORC represents a claim on the equity (reserve minus OD liabilities), fees make ORC more valuable over time.
