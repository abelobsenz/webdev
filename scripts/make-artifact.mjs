// Turns the single-file build (dist/index.html) into a page body suitable for
// hosts that supply their own <!doctype>/<head>/<body> skeleton (e.g. a
// claude.ai Artifact): title first, then fonts, styles, markup and the inline module.
import fs from 'fs';

const src = fs.readFileSync('dist/index.html', 'utf8');
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);
const title = (src.match(/<title>[\s\S]*?<\/title>/) || ['<title>Meridian</title>'])[0];
const links = pick(/<link\b[^>]*>/g).filter((l) => /fonts\.(googleapis|gstatic)\.com/.test(l));
const styles = pick(/<style\b[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script\b[^>]*>[\s\S]*?<\/script>/g);
const body = (src.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const out = [title, ...links, ...styles, body.trim(), ...scripts].join('\n');
fs.writeFileSync('dist/artifact.html', out);
console.log(`dist/artifact.html  ${(out.length / 1024).toFixed(0)} kB`);
