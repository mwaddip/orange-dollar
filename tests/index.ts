// Run test suites sequentially to avoid shared Blockchain state interference.
await import('./OD.test.js');
await import('./ORC.test.js');
await import('./ODReserve.phase.test.js');
await import('./ODReserve.twap.test.js');
await import('./ODReserve.orc.test.js');
await import('./ODReserve.od.test.js');
