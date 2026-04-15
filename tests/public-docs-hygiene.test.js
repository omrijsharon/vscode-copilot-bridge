const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

function trackedFiles() {
  const output = execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith("docs-private/"));
}

function trackedPublicDocFiles() {
  return trackedFiles().filter((entry) =>
    entry === "README.md" ||
    entry.startsWith("docs/") ||
    entry.startsWith("relay-client/")
  );
}

function fileContents(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("tracked public docs and UI do not contain known real deployment literals", () => {
  const forbiddenPatterns = [
    /codex\.flying-agents\.com/i,
    /C:\\Users\\tamipinhasi/i,
    /C:\/Users\/tamipinhasi/i
  ];

  const hits = [];
  for (const relativePath of trackedPublicDocFiles()) {
    const content = fileContents(relativePath);
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        hits.push(`${relativePath}: ${pattern}`);
      }
    }
  }

  assert.deepEqual(hits, []);
});

test("tracked public docs and UI do not contain machine-specific executable paths", () => {
  const forbiddenPatterns = [
    /\.vscode\\extensions\\openai\.chatgpt-/i,
    /\.vscode\/extensions\/openai\.chatgpt-/i,
    /bin\\windows-x86_64\\codex\.exe/i,
    /bin\/windows-x86_64\/codex\.exe/i
  ];

  const hits = [];
  for (const relativePath of trackedPublicDocFiles()) {
    const content = fileContents(relativePath);
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        hits.push(`${relativePath}: ${pattern}`);
      }
    }
  }

  assert.deepEqual(hits, []);
});

test("tracked public docs keep approved placeholder values", () => {
  const requiredChecks = [
    {
      file: "README.md",
      pattern: /https:\/\/YOUR_PUBLIC_HOST/
    },
    {
      file: "docs/CLOUDFLARE_TUNNEL_SETUP.md",
      pattern: /codex\.YOUR_DOMAIN/
    },
    {
      file: "relay-client/operator.html",
      pattern: /Operator controls for pairing, sessions, alerts, and health\./
    },
    {
      file: "docs/REMOTE_ACCESS_SETUP.md",
      pattern: /start-codex-remote-stack\.ps1/
    }
  ];

  for (const check of requiredChecks) {
    assert.match(fileContents(check.file), check.pattern);
  }
});
