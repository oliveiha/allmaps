'use strict';
var common = require('../common');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var async_completed = 0, async_expected = 0, unlink = [];
var skipSymlinks = false;

common.refreshTmpDir();

var root = '/';
if (common.isWindows) {
  // something like "C:\\"
  root = process.cwd().substr(0, 3);

  // On Windows, creating symlinks requires admin privileges.
  // We'll only try to run symlink test if we have enough privileges.
  try {
    exec('whoami /priv', function(err, o) {
      if (err || o.indexOf('SeCreateSymbolicLinkPrivilege') == -1) {
        skipSymlinks = true;
      }
      runTest();
    });
  } catch (er) {
    // better safe than sorry
    skipSymlinks = true;
    process.nextTick(runTest);
  }
} else {
  process.nextTick(runTest);
}


function tmp(p) {
  return path.join(common.tmpDir, p);
}

var targetsAbsDir = path.join(common.tmpDir, 'targets');
var tmpAbsDir = common.tmpDir;

// Set up targetsAbsDir and expected subdirectories
fs.mkdirSync(targetsAbsDir);
fs.mkdirSync(path.join(targetsAbsDir, 'nested-index'));
fs.mkdirSync(path.join(targetsAbsDir, 'nested-index', 'one'));
fs.mkdirSync(path.join(targetsAbsDir, 'nested-index', 'two'));

function asynctest(testBlock, args, callback, assertBlock) {
  async_expected++;
  testBlock.apply(testBlock, args.concat(function(err) {
    var ignoreError = false;
    if (assertBlock) {
      try {
        ignoreError = assertBlock.apply(assertBlock, arguments);
      }
      catch (e) {
        err = e;
      }
    }
    async_completed++;
    callback(ignoreError ? null : err);
  }));
}

// sub-tests:
function test_simple_error_callback(cb) {
  var ncalls = 0;

  fs.realpath('/this/path/does/not/exist', function(err, s) {
    assert(err);
    assert(!s);
    ncalls++;
    cb();
  });

  process.on('exit', function() {
    assert.equal(ncalls, 1);
  });
}

function test_simple_relative_symlink(callback) {
  console.log('test_simple_relative_symlink');
  if (skipSymlinks) {
    common.skip('symlink test (no privs)');
    return runNextTest();
  }
  const entry = common.tmpDir + '/symlink';
  const expected = common.tmpDir + '/cycles/root.js';
  [
    [entry, '../' + common.tmpDirName + '/cycles/root.js']
  ].forEach(function(t) {
    try {fs.unlinkSync(t[0]);} catch (e) {}
    console.log('fs.symlinkSync(%j, %j, %j)', t[1], t[0], 'file');
    fs.symlinkSync(t[1], t[0], 'file');
    unlink.push(t[0]);
  });
  var result = fs.realpathSync(entry);
  assert.equal(result, path.resolve(expected));
  asynctest(fs.realpath, [entry], callback, function(err, result) {
    assert.equal(result, path.resolve(expected));
  });
}

function test_simple_absolute_symlink(callback) {
  console.log('test_simple_absolute_symlink');

  // this one should still run, even if skipSymlinks is set,
  // because it uses a junction.
  var type = skipSymlinks ? 'junction' : 'dir';

  console.log('using type=%s', type);

  const entry = tmpAbsDir + '/symlink';
  const expected = common.fixturesDir + '/nested-index/one';
  [
    [entry, expected]
  ].forEach(function(t) {
    try {fs.unlinkSync(t[0]);} catch (e) {}
    console.error('fs.symlinkSync(%j, %j, %j)', t[1], t[0], type);
    fs.symlinkSync(t[1], t[0], type);
    unlink.push(t[0]);
  });
  var result = fs.realpathSync(entry);
  assert.equal(result, path.resolve(expected));
  asynctest(fs.realpath, [entry], callback, function(err, result) {
    assert.equal(result, path.resolve(expected));
  });
}

function test_deep_relative_file_symlink(callback) {
  console.log('test_deep_relative_file_symlink');
  if (skipSymlinks) {
    common.skip('symlink test (no privs)');
    return runNextTest();
  }

  var expected = path.join(common.fixturesDir, 'cycles', 'root.js');
  var linkData1 = path.relative(path.join(targetsAbsDir, 'nested-index', 'one'),
    expected);
  var linkPath1 = path.join(targetsAbsDir,
                            'nested-index', 'one', 'symlink1.js');
  try {fs.unlinkSync(linkPath1);} catch (e) {}
  fs.symlinkSync(linkData1, linkPath1, 'file');

  var linkData2 = '../one/symlink1.js';
  var entry = path.join(targetsAbsDir,
                        'nested-index', 'two', 'symlink1-b.js');
  try {fs.unlinkSync(entry);} catch (e) {}
  fs.symlinkSync(linkData2, entry, 'file');
  unlink.push(linkPath1);
  unlink.push(entry);

  assert.equal(fs.realpathSync(entry), path.resolve(expected));
  asynctest(fs.realpath, [entry], callback, function(err, result) {
    assert.equal(result, path.resolve(expected));
  });
}

function test_deep_relative_dir_symlink(callback) {
  console.log('test_deep_relative_dir_symlink');
  if (skipSymlinks) {
    common.skip('symlink test (no privs)');
    return runNextTest();
  }
  var expected = path.join(common.fixturesDir, 'cycles', 'folder');
  var path1b = path.join(targetsAbsDir, 'nested-index', 'one');
  var linkPath1b = path.join(path1b, 'symlink1-dir');
  var linkData1b = path.relative(path1b, expected);
  try {fs.unlinkSync(linkPath1b);} catch (e) {}
  fs.symlinkSync(linkData1b, linkPath1b, 'dir');

  var linkData2b = '../one/symlink1-dir';
  var entry = path.join(targetsAbsDir,
                        'nested-index', 'two', 'symlink12-dir');
  try {fs.unlinkSync(entry);} catch (e) {}
  fs.symlinkSync(linkData2b, entry, 'dir');
  unlink.push(linkPath1b);
  unlink.push(entry);

  assert.equal(fs.realpathSync(entry), path.resolve(expected));

  asynctest(fs.realpath, [entry], callback, function(err, result) {
    assert.equal(result, path.resolve(expected));
  });
}

function test_cyclic_link_protection(callback) {
  console.log('test_cyclic_link_protection');
  if (skipSymlinks) {
    common.skip('symlink test (no privs)');
    return runNextTest();
  }
  var entry = common.tmpDir + '/cycles/realpath-3a';
  [
    [entry, '../cycles/realpath-3b'],
    [common.tmpDir + '/cycles/realpath-3b', '../cycles/realpath-3c'],
    [common.tmpDir + '/cycles/realpath-3c', '../cycles/realpath-3a']
  ].forEach(function(t) {
    try {fs.unlinkSync(t[0]);} catch (e) {}
    fs.symlinkSync(t[1], t[0], 'dir');
    unlink.push(t[0]);
  });
  assert.throws(function() { fs.realpathSync(entry); });
  asynctest(fs.realpath, [entry], callback, function(err, result) {
    assert.ok(err && true);
    return true;
  });
}

function test_cyclic_link_overprotection(callback) {
  console.log('test_cyclic_link_overprotection');
  if (skipSymlinks) {
    common.skip('symlink test (no privs)');
    return runNextTest();
  }
  var cycles = common.tmpDir + '/cycles';
  var expected = fs.realpathSync(cycles);
  var folder = cycles + '/folder';
  var link = folder + '/cycles';
  var testPath = cycles;
  testPath += '/folder/cycles'.repeat(10);
  try {fs.unlinkSync(link);} catch (ex) {}
  fs.symlinkSync(cycles, link, 'dir');
  unlink.push(link);
  assert.equal(fs.realpathSync(testPath), path.resolve(expected));
  asynctest(fs.realpath, [testPath], callback, function(er, res) {
    assert.equal(res, path.resolve(expected));
  });
}

function test_relative_input_cwd(callback) {
  console.log('test_relative_input_cwd');
  if (skipSymlinks) {
    common.skip('symlink test (no privs)');
    return runNextTest();
  }

  // we need to calculate the relative path to the tmp dir from cwd
  var entrydir = process.cwd();
  var entry = path.relative(entrydir,
      path.join(common.tmpDir + '/cycles/realpath-3a'));
  var expected = common.tmpDir + '/cycles/root.js';
  [
    [entry, '../cycles/realpath-3b'],
    [common.tmpDir + '/cycles/realpath-3b', '../cycles/realpath-3c'],
    [common.tmpDir + '/cycles/realpath-3c', 'root.js']
  ].forEach(function(t) {
    var fn = t[0];
    console.error('fn=%j', fn);
    try {fs.unlinkSync(fn);} catch (e) {}
    var b = path.basename(t[1]);
    var type = (b === 'root.js' ? 'file' : 'dir');
    console.log('fs.symlinkSync(%j, %j, %j)', t[1], fn, type);
    fs.symlinkSync(t[1], fn, 'file');
    unlink.push(fn);
  });

  var origcwd = process.cwd();
  process.chdir(entrydir);
  assert.equal(fs.realpathSync(entry), path.resolve(expected));
  asynctest(fs.realpath, [entry], callback, function(err, result) {
    process.chdir(origcwd);
    assert.equal(result, path.resolve(expected));
    return true;
  });
}

function test_deep_symlink_mix(callback) {
  console.log('test_deep_symlink_mix');
  if (common.isWindows) {
    // This one is a mix of files and directories, and it's quite tricky
    // to get the file/dir links sorted out correctly.
    common.skip('symlink test (no privs)');
    return runNextTest();
  }

  /*
  /tmp/node-test-realpath-f1 -> $tmpDir/node-test-realpath-d1/foo
  /tmp/node-test-realpath-d1 -> $tmpDir/node-test-realpath-d2
  /tmp/node-test-realpath-d2/foo -> $tmpDir/node-test-realpath-f2
  /tmp/node-test-realpath-f2
    -> $tmpDir/targets/nested-index/one/realpath-c
  $tmpDir/targets/nested-index/one/realpath-c
    -> $tmpDir/targets/nested-index/two/realpath-c
  $tmpDir/targets/nested-index/two/realpath-c -> $tmpDir/cycles/root.js
  $tmpDir/targets/cycles/root.js (hard)
  */
  var entry = tmp('node-test-realpath-f1');
  try { fs.unlinkSync(tmp('node-test-realpath-d2/foo')); } catch (e) {}
  try { fs.rmdirSync(tmp('node-test-realpath-d2')); } catch (e) {}
  fs.mkdirSync(tmp('node-test-realpath-d2'), 0o700);
  try {
    [
      [entry, common.tmpDir + '/node-test-realpath-d1/foo'],
      [tmp('node-test-realpath-d1'),
        common.tmpDir + '/node-test-realpath-d2'],
      [tmp('node-test-realpath-d2/foo'), '../node-test-realpath-f2'],
      [tmp('node-test-realpath-f2'), targetsAbsDir +
        '/nested-index/one/realpath-c'],
      [targetsAbsDir + '/nested-index/one/realpath-c', targetsAbsDir +
        '/nested-index/two/realpath-c'],
      [targetsAbsDir + '/nested-index/two/realpath-c',
        common.tmpDir + '/cycles/root.js']
    ].forEach(function(t) {
      try { fs.unlinkSync(t[0]); } catch (e) {}
      fs.symlinkSync(t[1], t[0]);
      unlink.push(t[0]);
    });
  } finally {
    unlink.push(tmp('node-test-realpath-d2'));
  }
  var expected = tmpAbsDir + '/cycles/root.js';
  assert.equal(fs.realpathSync(entry), path.resolve(expected));
  asynctest(fs.realpath, [entry], callback, function(err, result) {
    assert.equal(result, path.resolve(expected));
    return true;
  });
}

function test_non_symlinks(callback) {
  console.log('test_non_symlinks');
  var entrydir = path.dirname(tmpAbsDir);
  var entry = tmpAbsDir.substr(entrydir.length + 1) + '/cycles/root.js';
  var expected = tmpAbsDir + '/cycles/root.js';
  var origcwd = process.cwd();
  process.chdir(entrydir);
  assert.equal(fs.realpathSync(entry), path.resolve(expected));
  asynctest(fs.realpath, [entry], callback, function(err, result) {
    process.chdir(origcwd);
    assert.equal(result, path.resolve(expected));
    return true;
  });
}

var upone = path.join(process.cwd(), '..');
function test_escape_cwd(cb) {
  console.log('test_escape_cwd');
  asynctest(fs.realpath, ['..'], cb, function(er, uponeActual) {
    assert.equal(upone, uponeActual,
                 'realpath("..") expected: ' + path.resolve(upone) +
                 ' actual:' + uponeActual);
  });
}
var uponeActual = fs.realpathSync('..');
assert.equal(upone, uponeActual,
             'realpathSync("..") expected: ' + path.resolve(upone) +
             ' actual:' + uponeActual);


// going up with .. multiple times
// .
// `-- a/
//     |-- b/
//     |   `-- e -> ..
//     `-- d -> ..
// realpath(a/b/e/d/a/b/e/d/a) ==> a
function test_up_multiple(cb) {
  console.error('test_up_multiple');
  if (skipSymlinks) {
    common.skip('symlink test (no privs)');
    return runNextTest();
  }
  function cleanup() {
    ['a/b',
      'a'
    ].forEach(function(folder) {
      try {fs.rmdirSync(tmp(folder));} catch (ex) {}
    });
  }
  function setup() {
    cleanup();
  }
  setup();
  fs.mkdirSync(tmp('a'), 0o755);
  fs.mkdirSync(tmp('a/b'), 0o755);
  fs.symlinkSync('..', tmp('a/d'), 'dir');
  unlink.push(tmp('a/d'));
  fs.symlinkSync('..', tmp('a/b/e'), 'dir');
  unlink.push(tmp('a/b/e'));

  var abedabed = tmp('abedabed'.split('').join('/'));
  var abedabed_real = tmp('');

  var abedabeda = tmp('abedabeda'.split('').join('/'));
  var abedabeda_real = tmp('a');

  assert.equal(fs.realpathSync(abedabeda), abedabeda_real);
  assert.equal(fs.realpathSync(abedabed), abedabed_real);
  fs.realpath(abedabeda, function(er, real) {
    if (er) throw er;
    assert.equal(abedabeda_real, real);
    fs.realpath(abedabed, function(er, real) {
      if (er) throw er;
      assert.equal(abedabed_real, real);
      cb();
      cleanup();
    });
  });
}


// absolute symlinks with children.
// .
// `-- a/
//     |-- b/
//     |   `-- c/
//     |       `-- x.txt
//     `-- link -> /tmp/node-test-realpath-abs-kids/a/b/
// realpath(root+'/a/link/c/x.txt') ==> root+'/a/b/c/x.txt'
function test_abs_with_kids(cb) {
  console.log('test_abs_with_kids');

  // this one should still run, even if skipSymlinks is set,
  // because it uses a junction.
  var type = skipSymlinks ? 'junction' : 'dir';

  console.log('using type=%s', type);

  var root = tmpAbsDir + '/node-test-realpath-abs-kids';
  function cleanup() {
    ['/a/b/c/x.txt',
      '/a/link'
    ].forEach(function(file) {
      try {fs.unlinkSync(root + file);} catch (ex) {}
    });
    ['/a/b/c',
      '/a/b',
      '/a',
      ''
    ].forEach(function(folder) {
      try {fs.rmdirSync(root + folder);} catch (ex) {}
    });
  }
  function setup() {
    cleanup();
    ['',
      '/a',
      '/a/b',
      '/a/b/c'
    ].forEach(function(folder) {
      console.log('mkdir ' + root + folder);
      fs.mkdirSync(root + folder, 0o700);
    });
    fs.writeFileSync(root + '/a/b/c/x.txt', 'foo');
    fs.symlinkSync(root + '/a/b', root + '/a/link', type);
  }
  setup();
  var linkPath = root + '/a/link/c/x.txt';
  var expectPath = root + '/a/b/c/x.txt';
  var actual = fs.realpathSync(linkPath);
  // console.log({link:linkPath,expect:expectPath,actual:actual},'sync');
  assert.equal(actual, path.resolve(expectPath));
  asynctest(fs.realpath, [linkPath], cb, function(er, actual) {
    // console.log({link:linkPath,expect:expectPath,actual:actual},'async');
    assert.equal(actual, path.resolve(expectPath));
    cleanup();
  });
}

function test_lying_cache_liar(cb) {
  var n = 2;

  // this should not require *any* stat calls, since everything
  // checked by realpath will be found in the cache.
  console.log('test_lying_cache_liar');
  var cache = { '/foo/bar/baz/bluff': '/foo/bar/bluff',
                '/1/2/3/4/5/6/7': '/1',
                '/a': '/a',
                '/a/b': '/a/b',
                '/a/b/c': '/a/b',
                '/a/b/d': '/a/b/d' };
  if (common.isWindows) {
    var wc = {};
    Object.keys(cache).forEach(function(k) {
      wc[ path.resolve(k) ] = path.resolve(cache[k]);
    });
    cache = wc;
  }

  var bluff = path.resolve('/foo/bar/baz/bluff');
  var rps = fs.realpathSync(bluff, cache);
  assert.equal(cache[bluff], rps);
  var nums = path.resolve('/1/2/3/4/5/6/7');
  var called = false; // no sync cb calling!
  fs.realpath(nums, cache, function(er, rp) {
    called = true;
    assert.equal(cache[nums], rp);
    if (--n === 0) cb();
  });
  assert(called === false);

  const test = path.resolve('/a/b/c/d');
  const expect = path.resolve('/a/b/d');
  var actual = fs.realpathSync(test, cache);
  assert.equal(expect, actual);
  fs.realpath(test, cache, function(er, actual) {
    assert.equal(expect, actual);
    if (--n === 0) cb();
  });
}

// ----------------------------------------------------------------------------

var tests = [
  test_simple_error_callback,
  test_simple_relative_symlink,
  test_simple_absolute_symlink,
  test_deep_relative_file_symlink,
  test_deep_relative_dir_symlink,
  test_cyclic_link_protection,
  test_cyclic_link_overprotection,
  test_relative_input_cwd,
  test_deep_symlink_mix,
  test_non_symlinks,
  test_escape_cwd,
  test_abs_with_kids,
  test_lying_cache_liar,
  test_up_multiple
];
var numtests = tests.length;
var testsRun = 0;
function runNextTest(err) {
  if (err) throw err;
  var test = tests.shift();
  if (!test) {
    return console.log(numtests +
                       ' subtests completed OK for fs.realpath');
  }
  testsRun++;
  test(runNextTest);
}


assert.equal(root, fs.realpathSync('/'));
fs.realpath('/', function(err, result) {
  assert.equal(null, err);
  assert.equal(root, result);
});


function runTest() {
  var tmpDirs = ['cycles', 'cycles/folder'];
  tmpDirs.forEach(function(t) {
    t = tmp(t);
    fs.mkdirSync(t, 0o700);
  });
  fs.writeFileSync(tmp('cycles/root.js'), "console.error('roooot!');");
  console.error('start tests');
  runNextTest();
}


process.on('exit', function() {
  assert.equal(numtests, testsRun);
  unlink.forEach(function(path) { try {fs.unlinkSync(path);} catch (e) {} });
  assert.equal(async_completed, async_expected);
});
