

'use strict';

const HEURISTIC_VERSION = 'countred-ai-2.2';

if(typeof globalThis!=='undefined'){ globalThis.HEURISTIC_VERSION = HEURISTIC_VERSION; }

const SKILL_LEVELS = {

  einsteiger:      { timeBudgetMs: 2500, maxDepth: 2, minDepth: 2, rankPool: 1, blockRate: 1.0, minThinkMs: 2000, poolWindow: 250, poolTemp: 60, forceTriple: true, jitterAmp: 80, randomRate: 0.3 },

  fortgeschritten: { timeBudgetMs: 2500, maxDepth: 3, minDepth: 2, rankPool: 1, blockRate: 1.0, minThinkMs: 2000, poolWindow: 110, poolTemp: 30, forceTriple: true },

  stark:           { timeBudgetMs: 2500, maxDepth: 5, minDepth: 2, rankPool: 1, blockRate: 1.0, minThinkMs: 2000, poolWindow:  30, poolTemp: 10 },
  meister:         { timeBudgetMs: 2500, maxDepth: 5, minDepth: 2, rankPool: 1, blockRate: 1.0, minThinkMs: 2000 },
};

const _now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Date.now();

function findImmediateWin(b, player, p1parity){
  for(const m of getLegalMoves(b, player, p1parity)){
    const nb = applyMoveOn(b, m.fr, m.fc, m.tr, m.tc, player);
    if(checkFourOn(nb)) return m;
  }
  return null;
}
function movesAllowingOpponentWin(b, player, p1parity){

  const opp = player === P1 ? P2 : P1;
  const bad = new Set();
  for(const m of getLegalMoves(b, player, p1parity)){
    const nb = applyMoveOn(b, m.fr, m.fc, m.tr, m.tc, player);
    if(checkFourOn(nb)) continue;
    const triple = applyLockOn(nb);

    if(triple){
      const bonusMoves = getLegalMoves(nb, player, p1parity);
      if(bonusMoves.length > 0) continue;
    }
    if(findImmediateWin(nb, opp, p1parity)) bad.add(m.fr+','+m.fc+','+m.tr+','+m.tc);
  }
  return bad;
}

function pickMove(board, player, p1parity, config, seenPositions, drawClock){
  const cfg = (typeof config === 'string') ? SKILL_LEVELS[config] : config;
  if(!cfg) throw new Error('pickMove: unbekannte Config/Stufe');

  _jitterAmp  = (typeof cfg.jitterAmp === 'number' && cfg.jitterAmp > 0) ? cfg.jitterAmp : 0;
  _jitterSeed = (typeof cfg.jitterSeed === 'number')
    ? (cfg.jitterSeed >>> 0)
    : ((Math.random() * 4294967296) >>> 0);

  const clockLimit = (drawClock && typeof drawClock.limit==='number') ? drawClock.limit : Infinity;
  const clock0 = (drawClock && typeof drawClock.halfmoves==='number' && clockLimit!==Infinity)
    ? Math.max(0, clockLimit - drawClock.halfmoves) : Infinity;

  if(typeof globalThis!=='undefined'){
    if(typeof globalThis.PARITY_P1==='undefined') globalThis.PARITY_P1 = p1parity;
    else if(globalThis.PARITY_P1!==p1parity)
      throw new Error('pickMove: p1parity-Parameter ('+p1parity+') != globale PARITY_P1 ('+globalThis.PARITY_P1+')');
  }
  const t0 = _now();
  let legal = getLegalMoves(board, player, p1parity);
  if(legal.length === 0) return { move: null, meta: { reason: 'no-moves' } };

  const win = findImmediateWin(board, player, p1parity);
  if(win) return { move: win, meta: { safety: 'took-win', depth: 0, ms: _now()-t0, score: 100000,
    best: 100000,
    raw: 100000, prevBest: null, sec: null, rank: 1, nRoot: null, nSkip: null, exact: null } };

  const badMoves = movesAllowingOpponentWin(board, player, p1parity);
  const blockActive = Math.random() < cfg.blockRate;
  const isBad = (m) => badMoves.has(m.fr+','+m.fc+','+m.tr+','+m.tc);

  const pathSet = new Set();
  if(seenPositions) for(const h of seenPositions) pathSet.add(h);
  pathSet.add(boardHash(board, player));

  let obs = null;
  let bestMove = legal[0], bestScore = null, reachedDepth = 0, budgetHit = false;

  let bestRootValue = null;
  let _randomUsed = false;

  const _randomRoll = (typeof cfg.randomRate === 'number' && cfg.randomRate > 0)
    && (Math.random() < cfg.randomRate);
  const opp = player === P1 ? P2 : P1;

  for(let depth = 1; depth <= cfg.maxDepth; depth++){
    let localBest = -Infinity, localMove = null;
    const scored = [];
    const skipped = [];
    let aborted = false;

    const _poolOn   = (typeof cfg.poolWindow === 'number');
    const poolSlack = _poolOn ? cfg.poolWindow : 0;
    const useRootAlpha = _poolOn ? true : (cfg.rankPool === 1);

    const rawByMove = new Map(), prevByMove = new Map();

    const tripleSet = new Set();
    const _key = m => m.fr+','+m.fc+','+m.tr+','+m.tc;
    for(const m of legal){

      if(blockActive && isBad(m) && badMoves.size < legal.length){ skipped.push(m); continue; }

      if(depth > cfg.minDepth && (_now() - t0) >= cfg.timeBudgetMs){ aborted = true; break; }
      const nb = applyMoveOn(board, m.fr, m.fc, m.tr, m.tc, player);
      if(checkFourOn(nb)){ rawByMove.set(_key(m),100000); prevByMove.set(_key(m), localBest===-Infinity?null:localBest);
        localBest = 100000; localMove = m; scored.push({m, v: 100000}); break; }
      const triple = applyLockOn(nb);
      if(triple) tripleSet.add(_key(m));
      const bonus = triple ? (getLegalMoves(nb, player, p1parity).length > 0 ? player : null) : null;
      const nextPlayer = bonus ? player : opp;
      const nbHash = boardHash(nb, nextPlayer);

      if(pathSet.has(nbHash)){
        const v = REP_DRAW_SCORE;
        scored.push({m, v}); rawByMove.set(_key(m), v);
        if(v > localBest){ prevByMove.set(_key(m), localBest===-Infinity?null:localBest); localBest = v; localMove = m; }
        continue;
      }

      const childClock = triple ? clockLimit : (clock0===Infinity ? Infinity : clock0 - 1);
      if(childClock <= 0){
        const v = 0;
        scored.push({m, v}); rawByMove.set(_key(m), v);
        if(v > localBest){ prevByMove.set(_key(m), localBest===-Infinity?null:localBest); localBest = v; localMove = m; }
        continue;
      }
      const branchSet = new Set(pathSet); branchSet.add(nbHash);

      const margin = triple ? DREIER_FORM_BONUS : 0;

      const _exactTriple = (cfg.forceTriple === true) && !!triple;
      const aWin = (useRootAlpha && !_exactTriple)
        ? (localBest - margin - poolSlack - (_poolOn ? 1e-6 : 0))
        : -Infinity;
      let v = bonus
        ? negamax(nb, depth+1, aWin, Infinity, player, bonus, branchSet, childClock, clockLimit)
        : -negamax(nb, depth, -Infinity, -aWin, opp, null, branchSet, childClock, clockLimit);
      const vRaw = v;
      if(triple && Math.abs(v) < 90000) v += DREIER_FORM_BONUS;
      scored.push({m, v}); rawByMove.set(_key(m), vRaw);
      if(v > localBest){ prevByMove.set(_key(m), localBest===-Infinity?null:localBest); localBest = v; localMove = m; }
    }

    if(aborted){ budgetHit = true; break; }
    if(localMove){

      let _base = scored;
      if(cfg.forceTriple === true){
        const _tri = scored.filter(x => tripleSet.has(_key(x.m)) && x.v > -90000);
        if(_tri.length) _base = _tri;
      }

      let _randomPick = null;
      if(_randomRoll){
        const _safe = _base.filter(x => x.v > -90000);
        if(_safe.length) _randomPick = _safe[Math.floor(Math.random() * _safe.length)];
      }

      if(_randomPick){
        _randomUsed = true;
        bestMove = _randomPick.m;
        bestScore = _randomPick.v;
        bestRootValue = localBest;
      } else if(typeof cfg.poolWindow === 'number'){

        _base.sort((a,b) => b.v - a.v);
        const top = _base[0].v;
        const cand = _base.filter(x => (top - x.v) <= cfg.poolWindow);
        const temp = (typeof cfg.poolTemp === 'number') ? cfg.poolTemp : 0;
        let pick;
        if(temp > 0){
          const w = cand.map(x => Math.exp(-(top - x.v) / temp));
          const sum = w.reduce((a,b) => a+b, 0);
          let r = Math.random() * sum, i = 0;
          while(i < w.length - 1 && r > w[i]){ r -= w[i]; i++; }
          pick = cand[i];
        } else {
          pick = cand[Math.floor(Math.random() * cand.length)];
        }
        bestMove = pick.m;
        bestScore = pick.v; bestRootValue = localBest;
      } else if(cfg.rankPool > 1){
        _base.sort((a,b) => b.v - a.v);
        const pool = _base.slice(0, Math.min(cfg.rankPool, _base.length));
        const pick = pool[Math.floor(Math.random() * pool.length)];
        bestMove = pick.m;
        bestScore = pick.v; bestRootValue = localBest;
      } else if(_base !== scored){

        _base.sort((a,b) => b.v - a.v);
        bestMove = _base[0].m;
        bestScore = _base[0].v; bestRootValue = localBest;
      } else {
        bestMove = localMove;
        bestScore = localBest; bestRootValue = localBest;
      }

      const _sorted = scored.slice().sort((a,b) => b.v - a.v);
      const _bk = _key(bestMove);
      obs = {
        raw:      rawByMove.has(_bk) ? rawByMove.get(_bk) : bestScore,
        prevBest: prevByMove.has(_bk) ? prevByMove.get(_bk) : null,
        sec:      _sorted.length > 1 ? _sorted[1].v : null,
        rank:     _sorted.findIndex(x => _key(x.m) === _bk) + 1,
        nRoot:    legal.length,
        nSkip:    skipped.length,

        exact:    (!useRootAlpha) || _poolOn
      };
      reachedDepth = depth;

      if(scored.length + skipped.length === legal.length){
        scored.sort((a,b) => b.v - a.v);
        legal = scored.map(s => s.m).concat(skipped);
      }
    }
    const elapsed = _now() - t0;

    if(elapsed >= cfg.timeBudgetMs && depth >= cfg.minDepth){ budgetHit = true; break; }
  }

  return {
    move: bestMove,
    meta: {
      depth: reachedDepth,
      ms: _now() - t0,
      budgetHit,

      safety: _randomUsed ? 'random' : ((blockActive && badMoves.size > 0) ? 'blocked' : 'none'),
      rankPool: cfg.rankPool,
      score: bestScore,

      best: bestRootValue,

      raw:      obs ? obs.raw      : null,
      prevBest: obs ? obs.prevBest : null,
      sec:      obs ? obs.sec      : null,
      rank:     obs ? obs.rank     : null,
      nRoot:    obs ? obs.nRoot    : null,
      nSkip:    obs ? obs.nSkip    : null,
      exact:    obs ? obs.exact    : null,
    }
  };
}

const P1 = 1, P2 = 2;
const STACK_WEIGHT = 1;
const W_PARITY = 4;
const W_SINGLE = 3;
const W_DOUBLE = 150;
const DREIER_FORM_BONUS = 80;
const REP_DRAW_SCORE = 0;

const DRAW_CLOCK_SOFT = 16;
function drawClockFactor(clockLeft){
  if(clockLeft===Infinity) return 1;
  return Math.max(0, Math.min(1, clockLeft / DRAW_CLOCK_SOFT));
}

function makesRunJS(rows, k){
  for(let s=0;s<=4-k;s++){
    let ok=true;
    for(let i=0;i<k;i++) if(!rows.includes(s+i)){ok=false;break;}
    if(ok) return true;
  }
  return false;
}

function colBaseRows(b,c,color){
  const out=[];
  for(let r=0;r<4;r++){
    const base=getBasePiece(b[r][c]);
    if(base&&base.color===color) out.push(r);
  }
  return out;
}

function colHasThreat(b,c,p1parity){
  for(const color of ['red','black']){
    const br=colBaseRows(b,c,color), n=br.length;
    if(n>=3){

      for(let r=0;r<4;r++) if(!br.includes(r) && !b[r][c].stack) return true;
    }
    if(n===2){
      for(let t=0;t<4;t++){
        if(br.includes(t)) continue;
        if(!b[t][c].piece && makesRunJS(br.concat([t]),3)) return true;
      }
    }
  }
  return false;
}

function parityCtrlJS(b,ai,p1parity){
  const hum = ai===1?2:1; let oa=0,oh=0;
  for(let r=0;r<4;r++) for(let c=0;c<4;c++){
    const cell=b[r][c];
    if(cell.stack||!cell.piece) continue;
    const la=canLift(b,r,c,ai,p1parity), lh=canLift(b,r,c,hum,p1parity);
    if(la&&!lh) oa++; else if(lh&&!la) oh++;
  }
  return oa-oh;
}

function asingleControlJS(b,ai,p1parity){
  let val=0;
  for(let c=0;c<4;c++){
    if(colHasThreat(b,c,p1parity)) continue;
    for(let r=0;r<4;r++)
      if(b[r][c].stack) val += (b[r][c].stack.formedBy===ai)?1:-1;
  }
  return val;
}

function canCompleteJS(b,tgt,c,color,party,p1parity){
  for(let sr=0;sr<4;sr++) for(let sc=0;sc<4;sc++){
    if(sr===tgt&&sc===c) continue;
    const cell=b[sr][sc];
    const mp=cell.stack?cell.stack.top:cell.piece;
    if(!mp||mp.color!==color||mp.stripe!==tgt) continue;
    if(canLift(b,sr,sc,party,p1parity)&&canDrop(b,sr,sc,tgt,c,party,p1parity)) return true;
  }
  return false;
}

function doubleThreatJS(b,ai,p1parity){
  let val=0;
  for(let c=0;c<4;c++) for(const color of ['red','black']){
    const br=colBaseRows(b,c,color);
    if(br.length!==2) continue;
    const tt=[];
    for(let t=0;t<4;t++) if(!br.includes(t)&&!b[t][c].piece&&makesRunJS(br.concat([t]),3)) tt.push(t);
    if(tt.length<2) continue;
    for(const party of [1,2]){
      const compl=tt.filter(t=>canCompleteJS(b,t,c,color,party,p1parity));
      if(compl.length<2) continue;
      const defender = party===1?2:1;
      let blockable=false;
      for(const m of getLegalMoves(b,defender,p1parity)){
        const nb=applyMoveOn(b,m.fr,m.fc,m.tr,m.tc,defender);
        let anyStill=false;
        for(const t of compl) if(!nb[t][c].piece && canCompleteJS(nb,t,c,color,party,p1parity)){anyStill=true;break;}
        if(!anyStill){blockable=true;break;}
      }
      if(!blockable) val += (party===ai)?1:-1;
    }
  }
  return val;
}

const W_HOHEIT = 300;

function _hoheitEigeneTops(b, stripe, color, P){
  const out=[];
  for(let r=0;r<4;r++) for(let c=0;c<4;c++){
    const cell=b[r][c];
    if(cell.stack && cell.stack.formedBy===P){
      const t=cell.stack.top;
      if(t.stripe===stripe && t.color===color) out.push({r,c});
    }
  }
  return out;
}

function _hoheitFuer(b, P, p1parity){
  let gefunden=0;
  for(let c=0;c<4;c++){
    let col=null; const leer=[]; let ok=true;
    for(let r=0;r<4;r++){
      const cell=b[r][c];
      const base=cell.stack?cell.stack.bottom:cell.piece;
      if(!base){ leer.push(r); continue; }
      if(col===null) col=base.color;
      else if(base.color!==col){ ok=false; break; }
    }
    if(!ok || col===null || leer.length!==2) continue;
    const [ra,rb]=leer;
    let treffer=false;
    for(const [t1,t2] of [[ra,rb],[rb,ra]]){
      for(const k1 of _hoheitEigeneTops(b,t1,col,P)){
        if(!canLift(b,k1.r,k1.c,P,p1parity)) continue;
        if(!canDrop(b,k1.r,k1.c,t1,c,P,p1parity)) continue;
        const nb=applyMoveOn(b,k1.r,k1.c,t1,c,P);
        for(const k2 of _hoheitEigeneTops(b,t2,col,P)){
          if(k2.r===k1.r && k2.c===k1.c) continue;
          if(!canLift(nb,k2.r,k2.c,P,p1parity)) continue;
          if(canDrop(nb,k2.r,k2.c,t2,c,P,p1parity)){ treffer=true; break; }
        }
        if(treffer) break;
      }
      if(treffer) break;
    }
    if(treffer) gefunden++;
  }
  return gefunden;
}

function hoheitJS(b, ai, p1parity){
  let gesperrt=false;
  for(let r=0;r<4 && !gesperrt;r++) for(let c=0;c<4;c++) if(b[r][c].locked){ gesperrt=true; break; }
  if(!gesperrt) return 0;
  const geg = ai===P1 ? P2 : P1;
  return _hoheitFuer(b,ai,p1parity) - _hoheitFuer(b,geg,p1parity);
}

function evaluate(b, forPlayer){
  const AI_=forPlayer, HUMAN_=forPlayer===P1?P2:P1;
  let score=0;

  const ALL8v=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  for(let c=0;c<4;c++){
    for(const color of['red','black']){

      const baseRows=[];
      for(let r=0;r<4;r++){
        const base=b[r][c].stack?b[r][c].stack.bottom:b[r][c].piece;
        if(base&&base.color===color) baseRows.push(r);
      }
      const n=baseRows.length;
      if(n===0) continue;

      if(n>=3){
        const emptyRow=[0,1,2,3].find(r=>!baseRows.includes(r));
        if(emptyRow===undefined) continue;

        const siegfeldFrei = !b[emptyRow][c].piece;
        let aiCanPlace=false, humCanPlace=false;
        for(let fr=0;fr<4&&!(aiCanPlace&&humCanPlace);fr++){
          for(let fc=0;fc<4&&!(aiCanPlace&&humCanPlace);fc++){
            if(fr===emptyRow&&fc===c) continue;
            const cell=b[fr][fc];
            const mp=cell.stack?cell.stack.top:cell.piece;
            if(!mp||mp.color!==color||mp.stripe!==emptyRow) continue;
            if(siegfeldFrei&&!aiCanPlace&&canLift(b,fr,fc,AI_,PARITY_P1)&&canDrop(b,fr,fc,emptyRow,c,AI_,PARITY_P1)) aiCanPlace=true;
            if(siegfeldFrei&&!humCanPlace&&canLift(b,fr,fc,HUMAN_,PARITY_P1)&&canDrop(b,fr,fc,emptyRow,c,HUMAN_,PARITY_P1)) humCanPlace=true;
          }
        }

        let aiActive=0, aiPassive=0, humActive=0, humPassive=0;
        for(let fr=0;fr<4;fr++){
          for(let fc=0;fc<4;fc++){
            if(fr===emptyRow&&fc===c) continue;
            const cell=b[fr][fc];
            const mp=cell.stack?cell.stack.top:cell.piece;
            if(mp&&mp.color===color&&mp.stripe===emptyRow){
              if(cell.stack){
                if(cell.stack.formedBy===AI_) aiActive++;
                else humActive++;
              } else if(!cell.locked){
                if(canLift(b,fr,fc,AI_,PARITY_P1)) aiActive+=0.4;
                if(canLift(b,fr,fc,HUMAN_,PARITY_P1)) humActive+=0.4;
              }
            }
            if(cell.stack){
              const bot=cell.stack.bottom;
              if(bot&&bot.color===color&&bot.stripe===emptyRow){
                if(cell.stack.formedBy===AI_) aiPassive++;
                else humPassive++;
              }
            }
          }
        }

        let stableAI=0, stableHUM=0;
        for(const [dr,dc] of ALL8v){
          const nr=emptyRow+dr, nc=c+dc;
          if(nr<0||nr>3||nc<0||nc>3) continue;
          const ncell=b[nr][nc];
          if(ncell.locked) continue;
          if(ncell.stack){
            if(ncell.stack.formedBy===AI_) stableAI++;
            else stableHUM++;
          }
        }
        const stabilityAdv=stableAI-stableHUM;

        const sfCell=b[emptyRow][c];
        if(sfCell.piece&&sfCell.stack){
          score += (sfCell.stack.formedBy===AI_ ? 80 : -80);
        } else if(aiCanPlace&&!humCanPlace){
          score += 300;
        } else if(humCanPlace&&!aiCanPlace){
          score -= 300;
        } else if(!aiCanPlace&&!humCanPlace){
          const aiCtrl=aiActive+aiPassive*0.6;
          const humCtrl=humActive+humPassive*0.6;
          if(aiCtrl>humCtrl+0.3){
            score += aiActive>=1 ? 200 : 120;
          } else if(humCtrl>aiCtrl+0.3){
            score -= humActive>=1 ? 200 : 120;
          } else {
            score += stabilityAdv*15;
          }
        } else {
          score += stabilityAdv*10;
        }
      }

      if(n===2){
        const freeRows=[0,1,2,3].filter(r=>!baseRows.includes(r));
        for(const targetRow of freeRows){
          if(b[targetRow][c].piece) continue;

          const rowsSet=[...baseRows,targetRow];
          const makesTriple=[0,1].some(s=>[0,1,2].every(i=>rowsSet.includes(s+i)));
          if(!makesTriple) continue;
          let aiCanPlace=false, humCanPlace=false;
          let aiHasActive=false, humHasActive=false;
          for(let fr=0;fr<4;fr++){
            for(let fc=0;fc<4;fc++){
              if(fr===targetRow&&fc===c) continue;
              const cell=b[fr][fc];
              const mp=cell.stack?cell.stack.top:cell.piece;
              if(!mp||mp.color!==color||mp.stripe!==targetRow) continue;
              if(canLift(b,fr,fc,AI_,PARITY_P1)&&canDrop(b,fr,fc,targetRow,c,AI_,PARITY_P1)){
                aiCanPlace=true;
                if(cell.stack&&cell.stack.formedBy===AI_) aiHasActive=true;
              }
              if(canLift(b,fr,fc,HUMAN_,PARITY_P1)&&canDrop(b,fr,fc,targetRow,c,HUMAN_,PARITY_P1)){
                humCanPlace=true;
                if(cell.stack&&cell.stack.formedBy===HUMAN_) humHasActive=true;
              }
            }
          }
          if(aiCanPlace&&!humCanPlace)  score += aiHasActive ? 90 : 60;
          else if(humCanPlace&&!aiCanPlace) score -= humHasActive ? 90 : 60;
        }
      }
    }
  }

  let aiRedTops=0, humRedTops=0, freeRed=0;
  let aiStacks=0, humStacks=0;
  for(let r=0;r<4;r++) for(let c=0;c<4;c++){
    const cell=b[r][c];
    if(cell.stack){
      if(cell.stack.formedBy===AI_)  aiStacks++;
      else                           humStacks++;
      if(cell.stack.top.color==='red'){
        if(cell.stack.formedBy===AI_) aiRedTops++;
        else humRedTops++;
      }
    } else if(cell.piece&&cell.piece.color==='red') freeRed++;
  }

  score += (Math.min(aiRedTops,2) - Math.min(humRedTops,2)) * 20;

  void freeRed;

  score += (aiStacks - humStacks) * STACK_WEIGHT;

  score += parityCtrlJS(b, AI_, PARITY_P1) * W_PARITY;
  score += asingleControlJS(b, AI_, PARITY_P1) * W_SINGLE;
  score += doubleThreatJS(b, AI_, PARITY_P1) * W_DOUBLE;
  score += hoheitJS(b, AI_, PARITY_P1) * W_HOHEIT;

  return score;
}

let _jitterAmp = 0;
let _jitterSeed = 0;

function _jitterOf(b, player){
  if(_jitterAmp <= 0) return 0;
  const key = boardHash(b, P1);
  let h = _jitterSeed ^ 0x9e3779b9;
  for(let i = 0; i < key.length; i++){
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
  const u = (h >>> 0) / 4294967296;
  const j = (u * 2 - 1) * _jitterAmp;
  return player === P1 ? j : -j;
}

function negamax(b, depth, alpha, beta, activePlayer, bonusPlayer, pathSet, clockLeft, clockLimit){
  const player = bonusPlayer || activePlayer;
  const opp = player===P1 ? P2 : P1;
  if(clockLeft===undefined){ clockLeft=Infinity; clockLimit=Infinity; }

  if(checkFourOn(b)) return -100000 - depth;

  if(clockLeft <= 0) return 0;

  if(depth===0){
    const v = evaluate(b, player) * drawClockFactor(clockLeft);

    return (Math.abs(v) < 90000) ? v + _jitterOf(b, player) : v;
  }

  const moves = getLegalMoves(b, player, PARITY_P1);
  if(moves.length===0){
    const om = getLegalMoves(b, opp, PARITY_P1);
    if(om.length===0) return 0;

    return -negamax(b, depth-1, -beta, -alpha, opp, null, pathSet, clockLeft, clockLimit);
  }

  let best = -Infinity;
  for(const m of moves){
    const nb = applyMoveOn(b, m.fr, m.fc, m.tr, m.tc, player);
    if(checkFourOn(nb)) return 100000 + depth;
    const triple = applyLockOn(nb);
    const bonus = triple ? (getLegalMoves(nb, player, PARITY_P1).length > 0 ? player : null) : null;

    const nextPlayer = bonus ? player : opp;
    const nbHash = boardHash(nb, nextPlayer);
    if(pathSet.has(nbHash)){

      best = Math.max(best, REP_DRAW_SCORE);
      alpha = Math.max(alpha, REP_DRAW_SCORE);
      if(beta <= alpha) break;
      continue;
    }
    pathSet.add(nbHash);

    const childClock = triple ? clockLimit : (clockLeft===Infinity ? Infinity : clockLeft - 1);

    const marginIn = (triple ? DREIER_FORM_BONUS : 0);
    const alphaIn  = (alpha === -Infinity) ? -Infinity : alpha - marginIn;
    const betaIn   = (beta  ===  Infinity) ?  Infinity : beta  - marginIn;
    const val = bonus
      ? negamax(nb, depth,   alphaIn, betaIn, player, bonus, pathSet, childClock, clockLimit)
      : -negamax(nb, depth-1, -betaIn, -alphaIn, opp, null, pathSet, childClock, clockLimit);
    pathSet.delete(nbHash);

    let valB = val;

    if(triple && Math.abs(val) < 90000) valB += DREIER_FORM_BONUS;

    best = Math.max(best, valB);
    alpha = Math.max(alpha, valB);
    if(beta <= alpha) break;
  }
  return best;
}

function antisymmetrySelfTest(p1parity){
  const prev = (typeof PARITY_P1 !== 'undefined') ? PARITY_P1 : undefined;

  if(typeof globalThis!=='undefined') globalThis.PARITY_P1 = p1parity;
  try {
  let worst = 0, tested = 0;
  for(let g=0; g<60; g++){
    let tb = initBoard(); let p = P1;
    for(let mv=0; mv<40; mv++){
      const ms = getLegalMoves(tb, p, p1parity);
      if(!ms.length){ p = (p===P1?P2:P1); if(!getLegalMoves(tb,p,p1parity).length) break; continue; }
      const m = ms[Math.floor(Math.random()*ms.length)];
      applyMove(tb, m.fr, m.fc, m.tr, m.tc, p);
      const t = applyLockOn(tb);
      if(checkFourOn(tb)) break;
      const d = Math.abs(evaluate(tb, P1) + evaluate(tb, P2));
      if(d > worst) worst = d;
      tested++;
      if(!t) p = (p===P1?P2:P1);
    }
  }
  if(worst > 1e-9){
    throw new Error('ANTISYMMETRIE VERLETZT (Δ='+worst+') — KI-Kern gesperrt. Heuristik prüfen!');
  }
  return { tested, worst };
  } finally {

    if(typeof globalThis!=='undefined') globalThis.PARITY_P1 = prev;
  }
}

const BENCH_REPS = 5;
function deviceBenchMs(){

  const cfg = { timeBudgetMs: 1e9, maxDepth: 1, minDepth: 1, rankPool: 1, blockRate: 1.0, minThinkMs: 0 };
  const prev = globalThis.PARITY_P1;
  globalThis.PARITY_P1 = 'odd';
  try {
    pickMove(initBoard(), P1, 'odd', cfg, []);
    const t = _now();
    for(let i = 0; i < BENCH_REPS; i++) pickMove(initBoard(), P1, 'odd', cfg, []);
    return Math.round(_now() - t);
  } finally { globalThis.PARITY_P1 = prev; }
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { pickMove, evaluate, negamax, antisymmetrySelfTest, SKILL_LEVELS, deviceBenchMs,
    HEURISTIC_VERSION,
    parityCtrlJS, asingleControlJS, doubleThreatJS,
    colHasThreat,
    hoheitJS,
    drawClockFactor, DRAW_CLOCK_SOFT,
    findImmediateWin, movesAllowingOpponentWin,
    _jitterOf, _setJitterForTest: (amp, seed) => { _jitterAmp = amp; _jitterSeed = seed >>> 0; } };
}
