# Frequently Asked Questions

## General

### What is OD pegged to?
OD targets a peg of **$1 USD**. The peg is maintained through overcollateralisation (400-800% reserve ratio) and the ability to always redeem OD for WBTC at the oracle price.

### Is OD an algorithmic stablecoin?
Yes — OD uses the Minimal Djed algorithm to maintain its peg. Unlike unbacked algorithmic stablecoins, OD is always backed by WBTC collateral at a minimum 4:1 ratio.

### What blockchain does OD run on?
OD runs on **OPNet**, a smart contract platform on Bitcoin Layer 1. Transactions settle directly on Bitcoin.

## Using the Protocol

### How do I get WBTC?
On testnet, use the **Faucet** tab in the OD app to receive free MockWBTC. On mainnet, WBTC will be available through official custodians and exchanges.

### Can I always redeem my OD?
Yes. Burning OD (redeeming for WBTC) is **never blocked**, regardless of the reserve ratio. This is a core guarantee of the Djed protocol.

### Why was my OD mint rejected?
OD minting is blocked when the reserve ratio would drop below 400%. Wait for the ratio to improve (via BTC price increase or ORC minting) and try again.

### Why was my ORC mint rejected?
ORC minting is blocked when the reserve ratio is already above 800%. The reserve is sufficiently capitalised and doesn't need more collateral.

## ORC & Yield

### How does ORC make money?
Every protocol operation (mint/burn of either token) charges a 1.5% fee. These fees accumulate in the WBTC reserve, increasing the equity that ORC represents. Over time, each ORC becomes backed by more WBTC.

### Is ORC a stablecoin?
No. ORC is an **equity token** that absorbs BTC price volatility. Its value fluctuates with BTC price and protocol activity. Think of it as shares in the WBTC reserve.

### What's the risk of holding ORC?
If BTC price drops significantly, ORC loses value because the equity shrinks. ORC holders bear the volatility that OD holders are protected from.

## Network & Wallet

### Which wallet do I need?
**OPWallet** version 1.8.2 or later. It's a browser extension wallet for the OPNet network.

### Which network should I use?
Use **OPNet Testnet** for testing with free tokens. Mainnet will be available after launch.

### Where can I see my transactions?
Transaction confirmations appear in the OD app interface. You can also check the OPNet block explorer for detailed transaction information.
