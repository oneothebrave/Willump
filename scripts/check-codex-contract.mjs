import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeNames = ["TurnStatus", "ThreadActiveFlag"];

function unionMembers(source, name) {
  const pattern = new RegExp(`\\bexport\\s+type\\s+${name}\\s*=\\s*([^;]+);`);
  const declaration = source.match(pattern)?.[1];
  if (!declaration) {
    return null;
  }

  const members = declaration
    .split("|")
    .map((member) => member.trim())
    .filter(Boolean);
  if (!members.length || members.some((member) => !/^"[^"\\]*"$/.test(member))) {
    return null;
  }
  return members.sort();
}

export function assertContractMatches(contract, generated) {
  for (const name of typeNames) {
    const actual = unionMembers(generated[name] ?? "", name);
    const expected = unionMembers(contract, name);
    if (!actual || !expected || actual.join("|") !== expected.join("|")) {
      throw new Error(
        `Codex contract changed: ${name}. Review mapping and fixtures before upgrading.`,
      );
    }
  }
}

async function main() {
  const schemaRoot = join(root, ".tmp", "contract-schema");
  await mkdir(schemaRoot, { recursive: true });
  // A fresh directory prevents stale generated types from masking schema changes.
  const schema = await mkdtemp(join(schemaRoot, "run-"));
  try {
    const args = ["app-server", "generate-ts", "--out", basename(schema)];
    // npm installs codex as a .cmd shim on Windows; cmd handles both that and codex.exe.
    const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "codex";
    const commandArgs =
      process.platform === "win32" ? ["/d", "/s", "/c", `codex ${args.join(" ")}`] : args;
    const result = spawnSync(command, commandArgs, { cwd: schemaRoot, stdio: "inherit" });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }

    const contract = await readFile(join(root, "server", "sources", "codex", "contract.ts"), "utf8");
    const generated = {};
    for (const name of typeNames) {
      generated[name] = await readFile(join(schema, "v2", `${name}.ts`), "utf8");
    }
    assertContractMatches(contract, generated);
    console.log("Codex contract matches installed app-server schema.");
  } finally {
    await rm(schema, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
