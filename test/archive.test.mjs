import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('..', import.meta.url));

test('Download archive is reproducible and contains only allowlisted paths plus checksums', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'stem-cookbook-archive-'));
  try {
    const one = join(temp, 'one.zip'), two = join(temp, 'two.zip');
    await execute('python3', ['build_archive.py', '--output', one], { cwd });
    await execute('python3', ['build_archive.py', '--output', two], { cwd });
    assert.deepEqual(await readFile(one), await readFile(two));
    const script = 'import sys,zipfile,hashlib\nfrom build_archive import FILES\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names=z.namelist()\n assert set(names)=={"stem-agent-cookbook/"+name for name in FILES}|{"stem-agent-cookbook/SHA256SUMS"}\n for line in z.read("stem-agent-cookbook/SHA256SUMS").decode().splitlines():\n  expected,name=line.split("  ",1)\n  assert hashlib.sha256(z.read("stem-agent-cookbook/"+name)).hexdigest()==expected\n print("allowlist-and-hashes-pass")';
    const result = await execute('python3', ['-c', script, one], { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(result.stdout.trim(), 'allowlist-and-hashes-pass');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('Archive builder refuses replacing a cookbook source', async () => {
  const before = await readFile(join(cwd, 'README.md'));
  await assert.rejects(execute('python3', ['build_archive.py', '--output', join(cwd, 'README.md')], { cwd }));
  assert.deepEqual(await readFile(join(cwd, 'README.md')), before);
});
