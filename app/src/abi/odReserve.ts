import { ABIDataTypes } from '@btc-vision/transaction';
import { BitcoinAbiTypes } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';

export const OD_RESERVE_ABI: BitcoinInterfaceAbi = [
  // View methods
  {
    name: 'getPhase',
    constant: true,
    inputs: [],
    outputs: [{ name: 'phase', type: ABIDataTypes.UINT8 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getReserveRatio',
    constant: true,
    inputs: [],
    outputs: [{ name: 'ratio', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getEquity',
    constant: true,
    inputs: [],
    outputs: [{ name: 'equity', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getTwap',
    constant: true,
    inputs: [],
    outputs: [{ name: 'twap', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getTwapWindow',
    constant: true,
    inputs: [],
    outputs: [{ name: 'blocks', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  // ORC operations
  {
    name: 'mintORC',
    inputs: [{ name: 'wbtcAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'orcMinted', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'burnORC',
    inputs: [{ name: 'orcAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'wbtcReturned', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  // OD operations
  {
    name: 'mintOD',
    inputs: [{ name: 'wbtcAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'odMinted', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'burnOD',
    inputs: [{ name: 'odAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'wbtcReturned', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  // Bootstrap / admin
  {
    name: 'advancePhase',
    inputs: [{ name: 'seedPrice', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'premintOD',
    inputs: [{ name: 'odAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'initPool',
    inputs: [{ name: 'poolAddress', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'updateTwapSnapshot',
    inputs: [],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];
