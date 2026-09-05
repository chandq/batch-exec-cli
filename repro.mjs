import { $ } from 'zx';

console.log('platform', process.platform, 'node', process.version);
console.log(
  'zx default shell:',
  JSON.stringify($.shell),
  'prefix:',
  JSON.stringify($.prefix),
  'postfix:',
  JSON.stringify($.postfix)
);
$.verbose = true;
try {
  const r = await $`node ./src/cli.js --help`;
  console.log('EXIT', r.exitCode);
  console.log('STDOUT<<' + r.stdout + '>>');
} catch (e) {
  console.log('THREW exit', e.exitCode);
  console.log('STDERR bytes', JSON.stringify(Buffer.from(e.stderr, 'utf8')));
}
