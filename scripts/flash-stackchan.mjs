import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readFirmwareTarget(configText, versionText) {
  const hostMatches = [...configText.matchAll(/constexpr char BRIDGE_HOST\[\] = "([^"]+)";/g)];
  const portMatches = [...configText.matchAll(/constexpr uint16_t BRIDGE_PORT = (\d+);/g)];
  const versionMatches = [...versionText.matchAll(/#define INDICATOR_FIRMWARE_VERSION "([^"]+)"/g)];
  if (hostMatches.length !== 1 || portMatches.length !== 1 || versionMatches.length !== 1) {
    throw new Error("无法唯一识别固件 bridge 地址、端口或版本。请检查本地配置格式。");
  }

  const host = hostMatches[0][1];
  const port = Number(portMatches[0][1]);
  const version = versionMatches[0][1];
  if (!host.endsWith(".local") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    throw new Error("BRIDGE_HOST 必须使用稳定的 .local 主机名，不能使用 DHCP IPv4 地址。");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("BRIDGE_PORT 必须是 1–65535 整数。");
  }
  if (!version) {
    throw new Error("固件版本不能为空。");
  }
  return { host, port, version };
}

export function parseArgs(args) {
  let port;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--check") {
      check = true;
    } else if (value === "--port" && args[index + 1]) {
      port = args[++index];
    } else {
      throw new Error("用法：npm run firmware:upload -- --port <串口> [--check]");
    }
  }
  if (!check && !port) {
    throw new Error("烧录必须通过 --port 指定已核对的设备串口。");
  }
  return { check, port };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const firmwareDirectory = join(root, "firmware", "stackchan");
  const configPath = join(firmwareDirectory, "include", "config.local.h");
  const versionPath = join(firmwareDirectory, "include", "firmware_version.h");
  const [configText, versionText] = await Promise.all([
    readFile(configPath, "utf8"),
    readFile(versionPath, "utf8"),
  ]);
  const target = readFirmwareTarget(configText, versionText);
  console.log(`[固件] 目标 ${target.host}:${target.port}；版本 ${target.version}`);
  if (options.check) {
    return 0;
  }

  const python = join(root, ".tmp", "hardware-venv", "bin", "python");
  const platformioDirectory = join(root, ".tmp", "platformio");
  const commands = [
    [python, ["-m", "platformio", "run", "-d", firmwareDirectory, "-e", "status-client"]],
    [
      python,
      [
        "-m",
        "platformio",
        "run",
        "-d",
        firmwareDirectory,
        "-e",
        "status-client",
        "-t",
        "upload",
        "--upload-port",
        options.port,
      ],
    ],
    [
      python,
      [
        join(root, "scripts", "read-device.py"),
        "--port",
        options.port,
        "--seconds",
        "15",
        "--expect",
        `firmware version=${target.version}`,
        "--expect",
        `status-client bridge=${target.host}:${target.port}`,
      ],
    ],
  ];
  for (const [command, commandArgs] of commands) {
    const result = spawnSync(command, commandArgs, {
      cwd: root,
      env: { ...process.env, PLATFORMIO_CORE_DIR: platformioDirectory },
      stdio: "inherit",
    });
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(`http://127.0.0.1:${target.port}/health`).catch(() => null);
    const health = response?.ok ? await response.json().catch(() => null) : null;
    if (Number.isInteger(health?.devices) && health.devices > 0) {
      console.log(`[固件] 后台已注册设备 ${health.devices} 台。`);
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error("[固件] 烧录完成，但后台未在 15 秒内观察到已注册固件设备。");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main().catch((error) => {
    console.error(`[固件] ${error instanceof Error ? error.message : "未知错误"}`);
    return 1;
  });
}
