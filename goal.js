/*
 * goal.js - goals, train/test split and collection schedules for the
 * "4 objects -> 6 compartments" placing task. Plain ES5 so it runs in old
 * mobile browsers; also a Node module and CLI.
 *
 * Goal: each object goes into a different compartment, 6*5*4*3 = 360 goals.
 * Goal code: the compartment ids of 充电器, 耳机盒, 骰子, 电池, in that order.
 *   "3152" = 充电器 -> 3, 耳机盒 -> 1, 骰子 -> 5, 电池 -> 2.
 *
 * Split: the 60 TEST_GOALS are held out, the other 300 goals are train goals.
 * Every object-compartment pair occurs in exactly 10 test goals.
 *
 * Schedules: train episodes 1..1800 form 6 rounds of 300, test episodes 1..180
 * form 3 rounds of 60. Each round is a random permutation of that split's goals,
 * so a full schedule gives every train goal 6 demonstrations and every test goal
 * 3, and every completed round adds one per goal. Each episode also gets a
 * random placement order, which is not part of the goal.
 *
 *   node goal.js split          > plan/split.csv
 *   node goal.js schedule train > plan/train_schedule.csv
 *   node goal.js schedule test  > plan/test_schedule.csv
 *
 * The plan depends on the OBJECTS order, HOLES ids, TEST_GOALS, REPEATS and
 * SCHEDULE_SEED. Don't change them after collection has started.
 */
var GoalGen = (function () {
  'use strict';

  // Bump together with "goal.js?v=" in index.html when the API changes.
  var VERSION = 3;

  // The order of OBJECTS defines the digits of a goal code.
  var OBJECTS = [
    { id: 'charger', name: '充电器', img: 'img/charger.jpg' },
    { id: 'earbuds', name: '耳机盒', img: 'img/earbuds.jpg' },
    { id: 'die', name: '骰子', img: 'img/die.jpg' },
    { id: 'battery', name: '电池', img: 'img/battery.jpg' }
  ];

  // id: digit used in goal codes. x, y: compartment centre on img/container.jpg,
  // in % of image width / height.
  var HOLES = [
    { id: 1, name: '左上格', x: 22.2, y: 19.3 },
    { id: 2, name: '中上格', x: 56.5, y: 18.6 },
    { id: 3, name: '右上格', x: 82.8, y: 17.9 },
    { id: 4, name: '右中格', x: 85.5, y: 47.6 },
    { id: 5, name: '右下格', x: 85.8, y: 78.9 },
    { id: 6, name: '左下大格', x: 39.5, y: 67.6 }
  ];

  // Held-out goals, drawn with `node goal.js new-split xr_icl-split-v1`.
  var TEST_GOALS = [
    '1356', '1426', '1452', '1465', '1543', '1546', '1562', '1625', '1632', '1643',
    '2146', '2315', '2341', '2356', '2361', '2416', '2514', '2536', '2641', '2654',
    '3164', '3215', '3254', '3256', '3265', '3412', '3456', '3461', '3514', '3624',
    '4125', '4251', '4253', '4263', '4315', '4326', '4532', '4613', '4632', '4635',
    '5132', '5134', '5143', '5163', '5234', '5342', '5361', '5412', '5462', '5623',
    '6124', '6134', '6143', '6215', '6245', '6321', '6451', '6521', '6523', '6531'
  ];

  var TEST_SIZE = 60;
  var REPEATS = { train: 6, test: 3 }; // demonstrations per goal
  var SCHEDULE_SEED = 'xr_icl-schedule-v1';
  // Seed prefix per split. The train prefix predates the test schedule; keep it.
  var SEEDS = { train: SCHEDULE_SEED, test: SCHEDULE_SEED + '|test' };

  // Math.imul is ES2015; fall back to a polyfill on old browsers.
  var imul = Math.imul || function (a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  };

  // cyrb128: string -> four 32-bit seeds (bryc, public domain).
  function cyrb128(str) {
    var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (var i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ imul(h1 ^ k, 597399067);
      h2 = h3 ^ imul(h2 ^ k, 2869860233);
      h3 = h4 ^ imul(h3 ^ k, 951274213);
      h4 = h1 ^ imul(h4 ^ k, 2716044179);
    }
    h1 = imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4);
    h2 ^= h1;
    h3 ^= h1;
    h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  // sfc32 PRNG; returns floats in [0, 1).
  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      var t = (a + b | 0) + d | 0;
      d = d + 1 | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = (c << 21 | c >>> 11);
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  function prng(seed) {
    var s = cyrb128(seed);
    var rand = sfc32(s[0], s[1], s[2], s[3]);
    for (var i = 0; i < 12; i++) rand(); // warm-up
    return rand;
  }

  function range(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(i);
    return a;
  }

  // Fisher-Yates, in place.
  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  var HOLE_INDEX = {}; // hole id (as string) -> index in HOLES
  for (var hi = 0; hi < HOLES.length; hi++) HOLE_INDEX[HOLES[hi].id] = hi;

  // All goal codes in lexicographic order.
  function allGoalCodes() {
    var out = [];
    function rec(prefix, used) {
      if (prefix.length === OBJECTS.length) {
        out.push(prefix);
        return;
      }
      for (var h = 0; h < HOLES.length; h++) {
        if (!used[h]) {
          used[h] = true;
          rec(prefix + HOLES[h].id, used);
          used[h] = false;
        }
      }
    }
    rec('', []);
    return out;
  }

  var ALL_GOALS = allGoalCodes();
  var IS_GOAL = {};
  for (var gi = 0; gi < ALL_GOALS.length; gi++) IS_GOAL[ALL_GOALS[gi]] = true;

  var IS_TEST = {};
  for (var ti = 0; ti < TEST_GOALS.length; ti++) {
    if (!IS_GOAL[TEST_GOALS[ti]] || IS_TEST[TEST_GOALS[ti]]) {
      throw new Error('goal.js: invalid or duplicate test goal ' + TEST_GOALS[ti]);
    }
    IS_TEST[TEST_GOALS[ti]] = true;
  }

  // Goals of each split, in lexicographic order.
  var GOALS = {
    train: ALL_GOALS.filter(function (c) { return !IS_TEST[c]; }),
    test: ALL_GOALS.filter(function (c) { return IS_TEST[c]; })
  };

  function isValidSplit(split) {
    return split === 'train' || split === 'test';
  }

  function totalEpisodes(split) {
    return GOALS[split].length * REPEATS[split];
  }

  var schedules = {};

  // Goal code of every episode of a split (index 0 = episode 1).
  function getSchedule(split) {
    if (schedules[split]) return schedules[split];
    var rand = prng(SEEDS[split] + '|rounds');
    var out = [], last = null;
    for (var r = 0; r < REPEATS[split]; r++) {
      var perm = shuffle(GOALS[split].slice(), rand);
      if (perm.length > 1 && perm[0] === last) { // never the same goal twice in a row
        var k = 1 + Math.floor(rand() * (perm.length - 1));
        var t = perm[0];
        perm[0] = perm[k];
        perm[k] = t;
      }
      out = out.concat(perm);
      last = perm[perm.length - 1];
    }
    schedules[split] = out;
    return out;
  }

  function isValidEpisode(split, n) {
    return isValidSplit(split) && typeof n === 'number' && n % 1 === 0 &&
      n >= 1 && n <= totalEpisodes(split);
  }

  function getEpisode(split, n) {
    if (!isValidEpisode(split, n)) throw new Error('invalid episode: ' + split + ' ' + n);
    var code = getSchedule(split)[n - 1];
    var roundSize = GOALS[split].length;
    var order = shuffle(range(OBJECTS.length), prng(SEEDS[split] + '|order|' + n));
    var steps = [], used = {};
    for (var s = 0; s < order.length; s++) {
      var hole = HOLES[HOLE_INDEX[code.charAt(order[s])]];
      steps.push({ step: s + 1, object: OBJECTS[order[s]], hole: hole });
      used[hole.id] = true;
    }
    return {
      split: split,
      episode: n,
      round: Math.floor((n - 1) / roundSize) + 1,
      indexInRound: (n - 1) % roundSize + 1,
      code: code,
      steps: steps,
      emptyHoles: HOLES.filter(function (h) { return !used[h.id]; })
    };
  }

  // Random split in which every object-compartment pair occurs in exactly
  // nTest / HOLES.length test goals. Used once to draw TEST_GOALS: start from a
  // random subset, then keep random test/train swaps that don't add imbalance.
  function newSplit(seed, nTest) {
    var nObj = OBJECTS.length, nHole = HOLES.length;
    if (nTest % nHole !== 0) throw new Error('nTest must be a multiple of ' + nHole);
    var target = nTest / nHole;
    var rand = prng(seed + '|split');
    var idx = shuffle(range(ALL_GOALS.length), rand);
    var test = idx.slice(0, nTest), rest = idx.slice(nTest);
    var cnt = [], i;
    for (i = 0; i < nObj * nHole; i++) cnt.push(0);

    function add(code, d) {
      for (var o = 0; o < nObj; o++) cnt[o * nHole + HOLE_INDEX[code.charAt(o)]] += d;
    }
    function cost() {
      var s = 0;
      for (var c = 0; c < cnt.length; c++) s += (cnt[c] - target) * (cnt[c] - target);
      return s;
    }

    for (i = 0; i < test.length; i++) add(ALL_GOALS[test[i]], 1);
    var cur = cost();
    for (var it = 0; cur > 0; it++) {
      if (it > 1000000) throw new Error('newSplit did not converge');
      var a = Math.floor(rand() * test.length), b = Math.floor(rand() * rest.length);
      add(ALL_GOALS[test[a]], -1);
      add(ALL_GOALS[rest[b]], 1);
      var next = cost();
      if (next <= cur) {
        var t = test[a];
        test[a] = rest[b];
        rest[b] = t;
        cur = next;
      } else {
        add(ALL_GOALS[rest[b]], -1);
        add(ALL_GOALS[test[a]], 1);
      }
    }
    return test.map(function (k) { return ALL_GOALS[k]; }).sort();
  }

  function splitCsv() {
    var lines = ['goal_code,split,' + OBJECTS.map(function (o) { return o.id + '_hole'; }).join(',')];
    for (var i = 0; i < ALL_GOALS.length; i++) {
      var c = ALL_GOALS[i];
      lines.push(c + ',' + (IS_TEST[c] ? 'test' : 'train') + ',' + c.split('').join(','));
    }
    return lines.join('\n') + '\n';
  }

  function scheduleCsv(split) {
    if (!isValidSplit(split)) throw new Error('invalid split: ' + split);
    var cols = ['episode', 'round', 'goal_code'];
    for (var i = 1; i <= OBJECTS.length; i++) cols.push('step' + i + '_object', 'step' + i + '_hole');
    var lines = [cols.join(',')];
    for (var n = 1; n <= totalEpisodes(split); n++) {
      var e = getEpisode(split, n), row = [e.episode, e.round, e.code];
      for (var s = 0; s < e.steps.length; s++) row.push(e.steps[s].object.id, e.steps[s].hole.id);
      lines.push(row.join(','));
    }
    return lines.join('\n') + '\n';
  }

  function splitInfo(split) {
    return {
      goals: GOALS[split].length,
      repeats: REPEATS[split],
      roundSize: GOALS[split].length,
      total: totalEpisodes(split)
    };
  }

  return {
    VERSION: VERSION,
    OBJECTS: OBJECTS,
    HOLES: HOLES,
    ALL_GOALS: ALL_GOALS.slice(),
    TRAIN_GOALS: GOALS.train.slice(),
    TEST_GOALS: GOALS.test.slice(),
    TEST_SIZE: TEST_SIZE,
    SPLITS: { train: splitInfo('train'), test: splitInfo('test') },
    isValidSplit: isValidSplit,
    isValidEpisode: isValidEpisode,
    getEpisode: getEpisode,
    getSchedule: function (split) { return getSchedule(split).slice(); },
    newSplit: newSplit,
    splitCsv: splitCsv,
    scheduleCsv: scheduleCsv
  };
})();

// Node: export, and act as a CLI when run directly.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GoalGen;
  if (typeof require === 'function' && require.main === module) {
    (function (argv) {
      if (argv[0] === 'split' && argv.length === 1) {
        process.stdout.write(GoalGen.splitCsv());
      } else if (argv[0] === 'schedule' && argv.length === 2 && GoalGen.isValidSplit(argv[1])) {
        process.stdout.write(GoalGen.scheduleCsv(argv[1]));
      } else if (argv[0] === 'new-split' && argv.length === 2 && argv[1]) {
        process.stdout.write(JSON.stringify(GoalGen.newSplit(argv[1], GoalGen.TEST_SIZE)) + '\n');
      } else {
        process.stderr.write(
          'usage:\n' +
          '  node goal.js split          > plan/split.csv\n' +
          '  node goal.js schedule train > plan/train_schedule.csv\n' +
          '  node goal.js schedule test  > plan/test_schedule.csv\n' +
          '  node goal.js new-split SEED   print a new balanced list of test goals\n' +
          '                                (only before collection starts)\n');
        process.exit(2);
      }
    })(process.argv.slice(2));
  }
}
