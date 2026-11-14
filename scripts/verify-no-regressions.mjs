#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const t0 = Date.now();
const failures = [];
const passes = [];

function pass(gate, msg) {
  passes.push(`[PASS] ${gate}: ${msg}`);
}

function fail(gate, msg) {
  failures.push(`[FAIL] ${gate}: ${msg}`);
}

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      walkFiles(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

// ============================================================================
// GATE 1: Incremental TypeScript Type Check (tsc --noEmit)
// ============================================================================
try {
  const cacheDir = path.join(ROOT, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const tsBuildInfo = path.join(cacheDir, 'huellas-tsc.tsbuildinfo');
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '--noEmit', '--incremental', '--tsBuildInfoFile', tsBuildInfo],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }
  );
  pass('Gate 1 (TypeScript)', 'tsc --noEmit (0 errors)');
} catch (err) {
  const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
  fail('Gate 1 (TypeScript)', `tsc --noEmit failed:\n${out.slice(0, 2000)}`);
}

// ============================================================================
// GATE 2: JSX/JS AST Undeclared-Identifier Check + Chrome Extension Syntax
// ============================================================================
try {
  const tsMod = await import('typescript');
  const ts = tsMod.default || tsMod;

  const KNOWN_GLOBALS = new Set([
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
    'fetch', 'Headers', 'Request', 'Response', 'alert', 'confirm', 'prompt', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
    'cancelAnimationFrame', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData',
    'AbortController', 'Promise', 'Object', 'Array', 'Math', 'Number', 'String', 'Boolean',
    'Date', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Error', 'TypeError',
    'SyntaxError', 'RangeError', 'Intl', 'Symbol', 'BigInt', 'Reflect', 'Proxy', 'process',
    'globalThis', 'Infinity', 'NaN', 'undefined', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
    'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'atob', 'btoa',
    'structuredClone', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'HTMLElement',
    'HTMLVideoElement', 'HTMLCanvasElement', 'Image', 'Audio', 'AudioContext',
    'webkitAudioContext', 'MediaRecorder', 'Worker', 'Int8Array', 'Uint8Array',
    'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
    'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'DataView',
    'TextEncoder', 'TextDecoder', 'React', 'arguments', '__BUILD_TIMESTAMP__',
  ]);

  const jsxFiles = walkFiles(path.join(ROOT, 'src'), (f) => /\.(jsx|mjs)$/.test(f));
  let astIssues = 0;

  if (jsxFiles.length > 0) {
    const program = ts.createProgram(jsxFiles, {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      noEmit: true,
      allowSyntheticDefaultImports: true,
    });

    const collectBindingNames = (nameNode, scopeSet) => {
      if (!nameNode) return;
      if (ts.isIdentifier(nameNode)) {
        scopeSet.add(nameNode.text);
      } else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
        for (const el of nameNode.elements) {
          if (ts.isBindingElement(el)) collectBindingNames(el.name, scopeSet);
        }
      }
    };

    const declareInScope = (stmt, scopeSet) => {
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) collectBindingNames(d.name, scopeSet);
      } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
        scopeSet.add(stmt.name.text);
      } else if (ts.isImportDeclaration(stmt) && stmt.importClause) {
        const ic = stmt.importClause;
        if (ic.name) scopeSet.add(ic.name.text);
        if (ic.namedBindings) {
          if (ts.isNamespaceImport(ic.namedBindings)) {
            scopeSet.add(ic.namedBindings.name.text);
          } else if (ts.isNamedImports(ic.namedBindings)) {
            for (const spec of ic.namedBindings.elements) scopeSet.add(spec.name.text);
          }
        }
      }
    };

    for (const file of jsxFiles) {
      const sf = program.getSourceFile(file);
      if (!sf) continue;
      const diag = ts.getPreEmitDiagnostics(program, sf).filter((d) => d.category === ts.DiagnosticCategory.Error);
      if (diag.length > 0) {
        astIssues++;
        fail('Gate 2 (JSX AST)', `${path.relative(ROOT, file)}: ${ts.flattenDiagnosticMessageText(diag[0].messageText, ' ')}`);
        continue;
      }

      const scopes = [new Set(KNOWN_GLOBALS)];
      for (const s of sf.statements) declareInScope(s, scopes[0]);

      const isDeclared = (name) => scopes.some((sc) => sc.has(name));

      const isReferenceRead = (node) => {
        const p = node.parent;
        if (!p) return false;
        if (ts.isImportClause(p) || ts.isImportSpecifier(p) || ts.isNamespaceImport(p)) return false;
        if (ts.isExportSpecifier(p)) return false;
        if (ts.isBindingElement(p) && (p.name === node || p.propertyName === node)) return false;
        if (ts.isVariableDeclaration(p) && p.name === node) return false;
        if (ts.isParameter(p) && p.name === node) return false;
        if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === node) return false;
        if ((ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === node) return false;
        if (ts.isPropertyAssignment(p) && p.name === node) return false;
        if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
        if (ts.isQualifiedName(p) && p.right === node) return false;
        if (ts.isJsxAttribute(p) && p.name === node) return false;
        if (ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p)) return false;
        if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === node) {
          if (/^[a-z]/.test(node.text)) return false;
        }
        return true;
      };

      const visit = (node) => {
        let pushedScope = false;
        if (
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node)
        ) {
          const fnScope = new Set();
          if (node.name && ts.isIdentifier(node.name)) fnScope.add(node.name.text);
          for (const param of node.parameters || []) collectBindingNames(param.name, fnScope);
          if (node.body && ts.isBlock(node.body)) {
            for (const s of node.body.statements) declareInScope(s, fnScope);
          }
          scopes.push(fnScope);
          pushedScope = true;
        } else if (ts.isBlock(node)) {
          const blockScope = new Set();
          for (const s of node.statements) declareInScope(s, blockScope);
          scopes.push(blockScope);
          pushedScope = true;
        } else if (ts.isCatchClause(node) && node.variableDeclaration) {
          const cScope = new Set();
          collectBindingNames(node.variableDeclaration.name, cScope);
          scopes.push(cScope);
          pushedScope = true;
        } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
          const fScope = new Set();
          if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
            for (const d of node.initializer.declarations) collectBindingNames(d.name, fScope);
          }
          scopes.push(fScope);
          pushedScope = true;
        }

        if (ts.isIdentifier(node) && isReferenceRead(node) && !isDeclared(node.text)) {
          const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          astIssues++;
          fail(
            'Gate 2 (JSX AST)',
            `${path.relative(ROOT, file)}:${line + 1}:${character + 1} undeclared identifier "${node.text}"`
          );
        }

        ts.forEachChild(node, visit);
        if (pushedScope) scopes.pop();
      };

      visit(sf);
    }
  }

  const extFiles = walkFiles(path.join(ROOT, 'chrome-extension'), (f) => f.endsWith('.js'));
  for (const extFile of extFiles) {
    try {
      const code = fs.readFileSync(extFile, 'utf8');
      new vm.Script(code, { filename: extFile });
    } catch (err) {
      astIssues++;
      fail('Gate 2 (Extension JS)', `${path.relative(ROOT, extFile)} syntax error: ${err.message}`);
    }
  }

  if (astIssues === 0) {
    pass('Gate 2 (JSX AST & Extension JS)', `${jsxFiles.length} JSX/MJS file(s) & ${extFiles.length} extension JS file(s) clean`);
  }
} catch (err) {
  fail('Gate 2 (JSX AST & Extension JS)', `Unexpected AST check error: ${err.message}`);
}

// ============================================================================
// GATE 3: Frontend <-> Backend API Route Parity
// ============================================================================
try {
  const backendFiles = [
    path.join(ROOT, 'server.ts'),
    ...walkFiles(path.join(ROOT, 'server'), (f) => f.endsWith('.ts')),
  ].filter((f) => fs.existsSync(f));

  const exactRoutes = new Set();
  const prefixRoutes = new Set();

  const normalizeBackendPath = (rawPath) =>
    rawPath
      .split('?')[0]
      .replace(/\/+/g, '/')
      .replace(/\/:[^/]+/g, '/:param')
      .replace(/\/$/, '') || '/';

  for (const bf of backendFiles) {
    const content = fs.readFileSync(bf, 'utf8');
    const routeRe = /\b(?:app|router)\.(get|post|put|patch|delete|all|use)\s*\(\s*(['"`])(\/(?:api|tts-files)[^'"`]*)\2/g;
    let m;
    while ((m = routeRe.exec(content)) !== null) {
      const method = m[1].toLowerCase();
      const norm = normalizeBackendPath(m[3]);
      if (method === 'use' || norm.includes('*')) {
        prefixRoutes.add(norm.replace(/\/\*.*$/, ''));
      } else {
        exactRoutes.add(norm);
      }
    }
  }

  const srcFiles = walkFiles(path.join(ROOT, 'src'), (f) => /\.(ts|tsx|js|jsx)$/.test(f));
  const missingRoutes = [];

  const matchesBackendRoute = (frontendPath) => {
    const norm = frontendPath
      .replace(/\$\{[^}]+\}/g, ':param')
      .split('?')[0]
      .replace(/\/+/g, '/')
      .replace(/\/$/, '') || '/';

    if (norm.startsWith('/tts-files')) {
      for (const p of prefixRoutes) {
        if (norm === p || norm.startsWith(p + '/')) return true;
      }
    }
    if (exactRoutes.has(norm)) return true;

    const normSegs = norm.split('/');
    for (const r of exactRoutes) {
      const rSegs = r.split('/');
      if (rSegs.length !== normSegs.length) continue;
      if (rSegs.every((seg, i) => seg === normSegs[i] || seg === ':param' || normSegs[i] === ':param')) {
        return true;
      }
    }
    for (const p of prefixRoutes) {
      if (norm === p || norm.startsWith(p + '/')) return true;
    }
    return false;
  };

  for (const sf of srcFiles) {
    const rel = path.relative(ROOT, sf);
    const lines = fs.readFileSync(sf, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      const callRe = /(?:['"`])((?:\/|\$\{[^}]+\}\/)api\/[a-zA-Z0-9_\-\/:.${}?=&]+)(?:['"`])/g;
      let m;
      while ((m = callRe.exec(line)) !== null) {
        let ep = m[1].replace(/^\$\{[^}]+\}/, '');
        if (!ep.startsWith('/api/')) continue;
        ep = ep.split('?')[0];
        if (ep.endsWith('/')) continue; // base prefix literal
        if (!matchesBackendRoute(ep)) {
          missingRoutes.push(`${rel}:${idx + 1} -> ${ep}`);
        }
      }
    });
  }

  if (missingRoutes.length > 0) {
    fail(
      'Gate 3 (API Route Parity)',
      `Unmatched frontend API paths (${missingRoutes.length}):\n  ${missingRoutes.join('\n  ')}`
    );
  } else {
    pass('Gate 3 (API Route Parity)', `${exactRoutes.size} backend routes + ${prefixRoutes.size} prefixes verified across src/`);
  }
} catch (err) {
  fail('Gate 3 (API Route Parity)', err.message);
}

// ============================================================================
// GATE 4: Cross-Environment Anti-Leak, Transitions & Atomic Persistence
// ============================================================================
try {
  const gate4Issues = [];

  const srcFiles = walkFiles(path.join(ROOT, 'src'), (f) => /\.(ts|tsx|js|jsx)$/.test(f));
  const allowedLocal4200File = (rel, line) => {
    if (rel === 'src/utils/webStudioBridge.ts') return true;
    if (/^\s*(\/\/|\*)/.test(line)) return true;
    if (/servidor local http:\/\/localhost:4200/.test(line)) return true;
    // Only inside getMacMediaBridgeBases / getEditorMediaBridgeBases / equality check
    if (
      /'http:\/\/localhost:4200',/.test(line) ||
      /===\s*'http:\/\/localhost:4200'/.test(line) ||
      /\^http:\\\/\\\/\(localhost\|127/.test(line)
    ) {
      return true;
    }
    return false;
  };

  for (const sf of srcFiles) {
    const rel = path.relative(ROOT, sf);
    const lines = fs.readFileSync(sf, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/(?:localhost|127\.0\.0\.1):4200/.test(line) && !allowedLocal4200File(rel, line)) {
        gate4Issues.push(`${rel}:${idx + 1}: unguarded localhost:4200 literal -> ${line.trim()}`);
      }
    });
  }

  const capCutText = fs.readFileSync(path.join(ROOT, 'src', 'components', 'CapCutEditor.tsx'), 'utf8');
  const capCutLines = capCutText.split(/\r?\n/);
  capCutLines.forEach((line, idx) => {
    if (/fade_black/.test(line) && !/normalizeEditorClipTransition|t === 'fade_black'/.test(line)) {
      gate4Issues.push(`src/components/CapCutEditor.tsx:${idx + 1}: forbidden transition 'fade_black'`);
    }
  });

  const serverText = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
  const serverLines = serverText.split(/\r?\n/);
  serverLines.forEach((line, idx) => {
    if (/fs\.writeFileSync\(\s*(?:DOCS_FILE|EDITOR_CLIENT_STATE_FILE|docsMirrorPath)\b/.test(line)) {
      gate4Issues.push(`server.ts:${idx + 1}: non-atomic fs.writeFileSync -> ${line.trim()}`);
    }
  });

  if (gate4Issues.length > 0) {
    fail('Gate 4 (Anti-Leak & Persistence)', gate4Issues.join('\n  '));
  } else {
    pass('Gate 4 (Anti-Leak & Persistence)', 'Zero raw localhost:4200 leaks, zero fade_black literals, 100% atomic DOCS_FILE writes');
  }
} catch (err) {
  fail('Gate 4 (Anti-Leak & Persistence)', err.message);
}

// ============================================================================
// GATE 5: documentaries.json Invariants (J1 - J5)
// ============================================================================
try {
  const dataPath = path.join(ROOT, 'data', 'documentaries.json');
  const publicPath = path.join(ROOT, 'docs', 'data', 'documentaries.json');
  const dataDocs = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const publicDocs = JSON.parse(fs.readFileSync(publicPath, 'utf8'));
  const jErrors = [];

  if (!Array.isArray(dataDocs) || !Array.isArray(publicDocs) || dataDocs.length === 0) {
    jErrors.push('J1: Both documentaries.json files must be non-empty arrays');
  } else {
    // J1: Exact same project IDs & clip counts
    if (dataDocs.length !== publicDocs.length) {
      jErrors.push(`J1: Project count mismatch data=${dataDocs.length} vs docs/data=${publicDocs.length}`);
    }
    const minLen = Math.min(dataDocs.length, publicDocs.length);
    for (let i = 0; i < minLen; i++) {
      const d = dataDocs[i];
      const p = publicDocs[i];
      if (d.id !== p.id) {
        jErrors.push(`J1: Project[${i}] id mismatch data=${d.id} vs docs/data=${p.id}`);
      }
      const dClips = Array.isArray(d.clips) ? d.clips.length : 0;
      const pClips = Array.isArray(p.clips) ? p.clips.length : 0;
      if (dClips !== pClips) {
        jErrors.push(`J1: Project ${d.id} clips count mismatch data=${dClips} vs docs/data=${pClips}`);
      }
      if (d.id === 'doc-video-77-huellas' && dClips < 143) {
        jErrors.push(`J1: Regression in doc-video-77-huellas clip count (${dClips} < 143)`);
      }
    }

    const checkList = [
      { label: 'data/documentaries.json', list: dataDocs, isPublic: false },
      { label: 'docs/data/documentaries.json', list: publicDocs, isPublic: true },
    ];

    for (const { label, list, isPublic } of checkList) {
      for (const doc of list) {
        // J2: No legacy productionType
        if (doc.productionType === 'SHORT_9X16' || doc.productionType === 'REELS_9X16') {
          jErrors.push(`J2 (${label}): Doc ${doc.id} has legacy productionType=${doc.productionType}`);
        }
        // J5: No lowercase "use nano banana 2.1"
        if (
          (typeof doc.operationalHeader === 'string' && /\buse nano banana 2\.1\b/.test(doc.operationalHeader)) ||
          (typeof doc.rawClipsText === 'string' && /\buse nano banana 2\.1\b/.test(doc.rawClipsText))
        ) {
          jErrors.push(`J5 (${label}): Doc ${doc.id} has lowercase "use nano banana 2.1"`);
        }
        // J3 & J4 on references and clips
        const badUrlRe = /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|[a-z0-9-]+\.trycloudflare\.com)\/api\/flow\/serve-folder-file\b/i;
        for (const ref of doc.references || []) {
          if (typeof ref?.imageUrl === 'string') {
            if (badUrlRe.test(ref.imageUrl)) {
              jErrors.push(`J3 (${label}): Doc ${doc.id} ref ${ref.tag} leaked local/tunnel URL`);
            }
            if (isPublic && ref.imageUrl.startsWith('data:') && ref.imageUrl.length > 60000) {
              jErrors.push(`J4 (${label}): Doc ${doc.id} ref ${ref.tag} leaked >60KB data URI`);
            }
          }
        }
        for (const c of doc.clips || []) {
          if (typeof c?.imagePreviewUrl === 'string') {
            if (badUrlRe.test(c.imagePreviewUrl)) {
              jErrors.push(`J3 (${label}): Doc ${doc.id} clip ${c.clipNumber} leaked local/tunnel imagePreviewUrl`);
            }
            if (isPublic && c.imagePreviewUrl.startsWith('data:') && c.imagePreviewUrl.length > 60000) {
              jErrors.push(`J4 (${label}): Doc ${doc.id} clip ${c.clipNumber} leaked >60KB data URI`);
            }
          }
          if (isPublic && Array.isArray(c?.videoFrames) && c.videoFrames.length > 0) {
            jErrors.push(`J4 (${label}): Doc ${doc.id} clip ${c.clipNumber} leaked non-empty videoFrames`);
          }
        }
      }
    }

    // J5: operationalHeader parity
    for (let i = 0; i < minLen; i++) {
      if ((dataDocs[i].operationalHeader || '') !== (publicDocs[i].operationalHeader || '')) {
        jErrors.push(`J5: operationalHeader mismatch for ${dataDocs[i].id}`);
      }
    }
  }

  if (jErrors.length > 0) {
    fail('Gate 5 (JSON Invariants J1-J5)', jErrors.slice(0, 15).join('\n  '));
  } else {
    pass('Gate 5 (JSON Invariants J1-J5)', `${dataDocs.length} docs synchronized and verified`);
  }
} catch (err) {
  fail('Gate 5 (JSON Invariants J1-J5)', err.message);
}

// ============================================================================
// GATE 6: Global UI & Render Rules (Actualizado + Acceso Privado Enter)
// ============================================================================
try {
  const g6Issues = [];
  const viteCfg = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
  if (!viteCfg.includes('__BUILD_TIMESTAMP__') || !viteCfg.includes('America/New_York') || !viteCfg.includes('en-US')) {
    g6Issues.push('vite.config.ts missing __BUILD_TIMESTAMP__ with America/New_York & en-US MM/DD/YYYY');
  }

  const appTsx = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8');
  const actualizadoMatches = appTsx.match(/Actualizado:\s*\{LAST_UPDATED_TEXT\}/g) || [];
  if (actualizadoMatches.length < 2) {
    g6Issues.push(`src/App.tsx must render "Actualizado: {LAST_UPDATED_TEXT}" in both Acceso Privado & main view (found ${actualizadoMatches.length})`);
  }
  const loginMarkerIdx = appTsx.indexOf('PASSWORD SCREEN (ACCESO PRIVADO)');
  const submitBtnRegion =
    loginMarkerIdx >= 0 ? appTsx.slice(loginMarkerIdx, loginMarkerIdx + 3000) : '';
  if (!submitBtnRegion.includes('onSubmit={handleLogin}')) {
    g6Issues.push('Acceso Privado missing <form onSubmit={handleLogin}>');
  }
  if (!submitBtnRegion.includes('type="submit"')) {
    g6Issues.push('Acceso Privado missing <button type="submit">');
  }
  if (submitBtnRegion.includes('onClick={() => handleLogin()}')) {
    g6Issues.push('Acceso Privado <button type="submit"> has duplicate onClick={() => handleLogin()}');
  }
  if (!submitBtnRegion.includes('onKeyDown=')) {
    g6Issues.push('Acceso Privado password input missing onKeyDown Enter handler');
  }

  if (g6Issues.length > 0) {
    fail('Gate 6 (Global UI & Render)', g6Issues.join('\n  '));
  } else {
    pass('Gate 6 (Global UI & Render)', 'Vite NY timestamp, dual Actualizado badge & Acceso Privado Enter verified');
  }
} catch (err) {
  fail('Gate 6 (Global UI & Render)', err.message);
}

for (const line of passes) console.log(line);
for (const line of failures) console.error(line);
console.log(`\n[verify-no-regressions] Completed in ${Date.now() - t0}ms — ${passes.length}/6 passed, ${failures.length} failed.`);
process.exit(failures.length > 0 ? 1 : 0);
