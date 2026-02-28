# Burning OD

Burning OD means returning OD stablecoins to the reserve and receiving WBTC back.

## How It Works

1. You specify how much **OD** to return
2. The app calculates how much **WBTC** you'll receive at the current TWAP price, minus the 1.5% fee
3. You approve the transaction in OPWallet
4. The reserve takes your OD and sends you WBTC

## Step by Step

1. Open the OD app and connect your wallet
2. Select **OD** in the token selector
3. Select **Burn** as the action
4. Enter the OD amount you want to redeem
5. Review the estimated WBTC output and fee breakdown
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## Example

If WBTC is trading at $100,000 and you burn **100 OD** ($100):

| | Amount |
|--|--------|
| OD returned | 100.00 ($100.00) |
| Fee (1.5%) | $1.50 |
| WBTC received | ~0.000985 WBTC ($98.50) |

## Burning Is Never Blocked

Unlike minting, burning OD is **always** available regardless of the reserve ratio. You can always redeem your OD for WBTC. This is a core safety guarantee of the Djed protocol.
