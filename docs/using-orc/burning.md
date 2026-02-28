# Burning ORC

Burning ORC means returning ORC tokens to redeem your proportional share of the reserve's equity.

## Step by Step

1. Open the OD app and connect your wallet
2. Select **ORC** in the token selector
3. Select **Burn** as the action
4. Enter the ORC amount you want to redeem
5. Review the estimated WBTC output and fee
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## What You Get Back

The WBTC you receive is proportional to your share of the total equity:

```
WBTC received = (ORC burned / ORC supply) x equity - fee
```

## When Burning Is Blocked

ORC burning is blocked when the [reserve ratio](/protocol/reserve-ratio) would drop below **400%**. This protects OD holders — the reserve can't be drained below the safety threshold by ORC exits.

If burning is blocked, wait for the BTC price to rise (increasing equity) or for OD to be burned (reducing liabilities).
