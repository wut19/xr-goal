/*
 * goal.js - random per-episode goals for the "4 objects -> 6 compartments" task.
 * Plain ES5 so it runs in old mobile browsers; also usable from Node as a CLI.
 *
 * A goal puts each of the 4 objects into a different compartment and gives a
 * random placement order (6*5*4*3 assignments x 4! orders, all equally likely).
 * The goal depends only on (batch, episode): refreshing the page never re-rolls
 * it, and the goal of any recorded episode can be recomputed later:
 *
 *   node goal.js --batch K7Q2 --from 1 --to 200 > goals_K7Q2.csv
 *
 * Editing OBJECTS or HOLES changes the goals of existing batches, so export the
 * CSVs you need before changing them.
 */
var GoalGen = (function () {
  'use strict';

  var OBJECTS = [
    { id: 'charger', name: '充电器', img: 'img/charger.jpg' },
    { id: 'earbuds', name: '耳机盒', img: 'img/earbuds.jpg' },
    { id: 'die', name: '骰子', img: 'img/die.jpg' },
    { id: 'battery', name: '电池', img: 'img/battery.jpg' }
  ];

  // x, y: compartment centre on img/container.jpg, in % of image width / height.
  var HOLES = [
    { id: 1, name: '左上格', x: 22.2, y: 19.3 },
    { id: 2, name: '中上格', x: 56.5, y: 18.6 },
    { id: 3, name: '右上格', x: 82.8, y: 17.9 },
    { id: 4, name: '右中格', x: 85.5, y: 47.6 },
    { id: 5, name: '右下格', x: 85.8, y: 78.9 },
    { id: 6, name: '左下大格', x: 39.5, y: 67.6 }
  ];

  var BATCH_RE = /^[A-Z0-9_-]{1,20}$/;
  var MIN_EPISODE = 1;
  var MAX_EPISODE = 99999;

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

  function normBatch(s) {
    return String(s == null ? '' : s).trim().toUpperCase();
  }

  function isValidBatch(s) {
    return typeof s === 'string' && BATCH_RE.test(s);
  }

  function isValidEpisode(n) {
    return typeof n === 'number' && n % 1 === 0 && n >= MIN_EPISODE && n <= MAX_EPISODE;
  }

  function makeGoal(batch, episode) {
    batch = normBatch(batch);
    if (!isValidBatch(batch)) throw new Error('invalid batch: ' + batch);
    if (!isValidEpisode(episode)) throw new Error('invalid episode: ' + episode);

    var seed = cyrb128(batch + '|' + episode);
    var rand = sfc32(seed[0], seed[1], seed[2], seed[3]);
    for (var i = 0; i < 12; i++) rand(); // warm-up

    var holeOf = shuffle(range(HOLES.length), rand); // holeOf[k]: hole index of object k
    var order = shuffle(range(OBJECTS.length), rand); // object indices in placement order

    var steps = [];
    for (var s = 0; s < order.length; s++) {
      steps.push({ step: s + 1, object: OBJECTS[order[s]], hole: HOLES[holeOf[order[s]]] });
    }
    var emptyHoles = [];
    for (var h = OBJECTS.length; h < holeOf.length; h++) emptyHoles.push(HOLES[holeOf[h]]);
    emptyHoles.sort(function (a, b) { return a.id - b.id; });

    return { batch: batch, episode: episode, steps: steps, emptyHoles: emptyHoles };
  }

  function csvHeader() {
    var cols = ['batch', 'episode'];
    for (var i = 1; i <= OBJECTS.length; i++) cols.push('step' + i + '_object', 'step' + i + '_hole');
    return cols.join(',');
  }

  function csvRow(goal) {
    var cols = [goal.batch, goal.episode];
    for (var i = 0; i < goal.steps.length; i++) cols.push(goal.steps[i].object.id, goal.steps[i].hole.id);
    return cols.join(',');
  }

  return {
    OBJECTS: OBJECTS,
    HOLES: HOLES,
    MIN_EPISODE: MIN_EPISODE,
    MAX_EPISODE: MAX_EPISODE,
    normBatch: normBatch,
    isValidBatch: isValidBatch,
    isValidEpisode: isValidEpisode,
    makeGoal: makeGoal,
    csvHeader: csvHeader,
    csvRow: csvRow
  };
})();

// Node: export, and act as a CSV exporter when run directly.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GoalGen;
  if (typeof require === 'function' && require.main === module) {
    (function (argv) {
      function arg(name, def) {
        var i = argv.indexOf('--' + name);
        return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
      }
      var batch = GoalGen.normBatch(arg('batch', ''));
      var from = Number(arg('from', '1'));
      var to = Number(arg('to', '200'));
      if (!GoalGen.isValidBatch(batch) || !GoalGen.isValidEpisode(from) ||
          !GoalGen.isValidEpisode(to) || from > to) {
        process.stderr.write(
          'usage: node goal.js --batch CODE [--from 1] [--to 200] > goals.csv\n' +
          '  CODE: 1-20 characters from A-Z 0-9 _ - (case-insensitive)\n');
        process.exit(2);
      }
      var lines = [GoalGen.csvHeader()];
      for (var e = from; e <= to; e++) lines.push(GoalGen.csvRow(GoalGen.makeGoal(batch, e)));
      process.stdout.write(lines.join('\n') + '\n');
    })(process.argv.slice(2));
  }
}
