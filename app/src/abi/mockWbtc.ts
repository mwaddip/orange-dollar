import { ABIDataTypes } from '@btc-vision/transaction';
import { BitcoinAbiTypes, OP_20_ABI } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';

/**
 * MockWBTC ABI — OP-20 extended with unrestricted (rate-limited) mint.
 */
export const MOCK_WBTC_ABI: BitcoinInterfaceAbi = [
  ...OP_20_ABI,
  {
    name: 'mint',
    inputs: [
      { name: 'to', type: ABIDataTypes.ADDRESS },
      { name: 'amount', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];
