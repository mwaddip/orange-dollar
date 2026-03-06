import { ABIDataTypes } from '@btc-vision/transaction';
import { BitcoinAbiTypes, OP_20_ABI } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';

/**
 * OP-20 ABI extended with setReserve(address).
 * Used for OD and ORC contracts.
 */
export const OD_ORC_ABI: BitcoinInterfaceAbi = [
  ...OP_20_ABI,
  {
    name: 'setReserve',
    inputs: [{ name: 'reserve', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];
