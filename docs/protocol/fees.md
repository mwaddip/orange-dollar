# Fees

Every operation in the Orange Dollar protocol charges a flat **1.5%** fee.

## Which Operations

| Operation | Fee |
|-----------|-----|
| Mint OD | 1.5% deducted from OD output |
| Burn OD | 1.5% deducted from WBTC output |
| Mint ORC | 1.5% deducted from ORC output |
| Burn ORC | 1.5% deducted from WBTC output |

## Where Fees Go

Fees stay in the WBTC reserve. They are not paid out to anyone — they increase the total WBTC held by the reserve contract.

Since ORC represents a claim on the reserve's equity (total WBTC minus OD liabilities), accumulated fees increase the value of each ORC over time. This is how ORC holders earn yield.

## Example

If you mint OD by depositing 1 WBTC:
- Fee: 0.015 WBTC (stays in reserve)
- Used for OD calculation: 0.985 WBTC
- OD received: 0.985 x TWAP price

The 0.015 WBTC fee permanently increases the reserve, benefiting all ORC holders.
