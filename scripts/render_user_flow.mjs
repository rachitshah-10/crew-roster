// Render the editable Mermaid source; no browser or CDN is required to view the result.
import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'crewcheck-mermaid-'));
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
const browserConfig = join(scratch, 'puppeteer.json');
writeFileSync(browserConfig, JSON.stringify(executablePath ? {executablePath} : {}));
const png = process.argv.includes('--png');
if (png) mkdirSync(resolve(root, 'artifacts'), {recursive: true});
const output = png ? 'artifacts/user-flow-mermaid.png' : 'docs/diagrams/user-flow.svg';
try {
  const result = spawnSync(process.execPath, [
    resolve(root, 'node_modules/@mermaid-js/mermaid-cli/src/cli.js'),
    '-i', 'docs/diagrams/user-flow.mmd', '-o', output,
    '-c', 'docs/diagrams/mermaid-config.json', '-p', browserConfig,
    '-b', '#f6f8fc', '-w', '1500', '-s', '2'
  ], {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Mermaid renderer exited with ${result.status}`);
  console.log(`Rendered ${output} from user-flow.mmd`);
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
