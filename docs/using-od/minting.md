# Minting OD

Minting OD means depositing WBTC into the reserve and receiving OD stablecoins in return.

## How It Works

1. You specify how much **WBTC** to deposit
2. The app calculates how much **OD** you'll receive at the current TWAP price, minus the 1.5% fee
3. You approve the transaction in OPWallet
4. The reserve takes your WBTC and sends you OD

## Step by Step

1. Open the OD app and connect your wallet
2. Select **OD** in the token selector
3. Select **Mint** as the action
4. Enter the WBTC amount you want to deposit
5. Review the estimated OD output and fee breakdown
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## Example

If WBTC is trading at $100,000 and you deposit **0.01 WBTC** ($100):

| | Amount |
|--|--------|
| WBTC deposited | 0.01 ($100.00) |
| Fee (1.5%) | $1.50 |
| OD received | ~98.50 OD |

## When Minting Is Blocked

OD minting is blocked when the [reserve ratio](/protocol/reserve-ratio) would drop below **400%**. This protects the system from becoming undercollateralised. If minting is blocked, wait for more WBTC to enter the reserve (via ORC minting) or for the BTC price to rise.
