

'use strict';

importScripts('countred_rules.js?v=186', 'countred_ai_core.js?v=186');

const _antisymTestDone = {};

self.onmessage = function(e){
  const { id, board, player, p1parity, skill, seenPositions, drawClock } = e.data;
  try {

    self.PARITY_P1 = p1parity;
    if(!_antisymTestDone[p1parity]){
      antisymmetrySelfTest(p1parity);
      _antisymTestDone[p1parity] = true;
    }
    const res = pickMove(board, player, p1parity, skill, seenPositions, drawClock);
    self.postMessage({ id, res });
  } catch(err){
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
