#!/usr/bin/env node
// Stand-in for `python3` in runner tests: records the script it was asked to run; FAKE_PY_EXIT fails it.
process.stdout.write('PY ' + process.argv.slice(2).join(' ') + '\n');
process.exit(Number(process.env.FAKE_PY_EXIT || 0));
