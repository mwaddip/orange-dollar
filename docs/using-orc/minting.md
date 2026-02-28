# Minting ORC

Minting ORC means depositing WBTC into the reserve and receiving ORC equity tokens.

## Step by Step

1. Open the OD app and connect your wallet
2. Select **ORC** in the token selector
3. Select **Mint** as the action
4. Enter the WBTC amount you want to deposit
5. Review the estimated ORC output and fee
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## ORC Pricing

The ORC you receive is based on the current equity price:

```
ORC received = (WBTC deposited x TWAP - fee) / (equity / ORC supply)
```

The app shows this calculation in the estimate before you execute.

## When Minting Is Blocked

ORC minting is blocked when the [reserve ratio](/protocol/reserve-ratio) is already above **800%**. This prevents the reserve from becoming excessively overcollateralised (which would dilute existing ORC holders without benefiting stability).
