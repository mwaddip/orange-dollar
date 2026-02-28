# Why ORC?

ORC (Orange Reserve Coin) is the **equity token** of the Orange Dollar protocol. It represents ownership of the reserve's surplus — the value left after all OD liabilities are covered.

## How ORC Earns Yield

Every time anyone mints or burns OD or ORC, the protocol charges a **1.5% fee**. This fee stays in the WBTC reserve.

Since ORC represents a claim on the equity (total reserve minus OD liabilities), every fee collected increases the WBTC backing each ORC. Over time, as more people use the protocol, ORC becomes more valuable.

## ORC Pricing

ORC price is determined by a simple formula:

```
equity = (reserve WBTC x TWAP) - OD supply
ORC price = equity / ORC supply
```

If the reserve holds 1 WBTC ($100,000), OD supply is $20,000, and ORC supply is 80,000:
- Equity = $100,000 - $20,000 = $80,000
- ORC price = $80,000 / 80,000 = $1.00 per ORC

## The Risk

ORC absorbs Bitcoin's price volatility. If BTC drops, the equity shrinks and ORC loses value. If BTC rises, equity grows and ORC gains value. The fees provide a baseline yield, but ORC is **not** a stablecoin — it's an investment in the reserve.

## When to Buy ORC

ORC is attractive when:
- You're bullish on BTC (you benefit from price appreciation + fees)
- The reserve ratio is moderate (400-600%) — more room for growth
- Protocol activity is high (more fees accruing)

ORC is riskier when:
- BTC is in a downtrend (equity shrinks faster than fees accumulate)
- The reserve ratio is near 400% (further BTC drops could cause losses)
