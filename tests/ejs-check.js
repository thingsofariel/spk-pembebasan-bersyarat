const fs = require('fs');
const path = require('path');

const viewsRoot = path.join(__dirname, '..', 'src', 'views');

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walk(full));
    else if (entry.name.endsWith('.ejs')) results.push(full);
  }
  return results;
}

const files = walk(viewsRoot);
let errors = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);

  // 1. Check include() paths resolve
  const includeRe = /include\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = includeRe.exec(content))) {
    const target = path.join(dir, m[1] + (m[1].endsWith('.ejs') ? '' : '.ejs'));
    if (!fs.existsSync(target)) {
      console.log(`INCLUDE MISSING: ${path.relative(viewsRoot, file)} -> ${m[1]} (resolved: ${target})`);
      errors++;
    }
  }

  // 2. Check <% %> tag balance (count '<%' vs '%>' occurrences, treating <%= <%- <%# as '<%')
  const opens = (content.match(/<%/g) || []).length;
  const closes = (content.match(/%>/g) || []).length;
  if (opens !== closes) {
    console.log(`TAG IMBALANCE: ${path.relative(viewsRoot, file)} -- opens=${opens} closes=${closes}`);
    errors++;
  }

  // 3. Rough brace balance within <% %> blocks combined (JS control-flow blocks)
  const jsChunks = content.match(/<%[-=#]?([\s\S]*?)%>/g) || [];
  let braceDepth = 0;
  for (const chunk of jsChunks) {
    const inner = chunk.replace(/^<%[-=#]?/, '').replace(/%>$/, '');
    // skip pure output expressions with no braces intent issue; just tally braces
    for (const ch of inner) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
  }
  if (braceDepth !== 0) {
    console.log(`BRACE IMBALANCE: ${path.relative(viewsRoot, file)} -- net brace depth=${braceDepth}`);
    errors++;
  }
}

console.log(`\nChecked ${files.length} EJS files. Errors: ${errors}`);
process.exit(errors ? 1 : 0);
