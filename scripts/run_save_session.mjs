#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const venvWin = path.join(rootDir, ".venv", "Scripts", "python.exe");
const venvPosix = path.join(rootDir, ".venv", "bin", "python");

let pythonCmd = "python";
if (fs.existsSync(venvWin)) {
  pythonCmd = venvWin;
} else if (fs.existsSync(venvPosix)) {
  pythonCmd = venvPosix;
}

const scriptPath = path.join(__dirname, "save_letterboxd_session.py");
const args = [scriptPath, ...process.argv.slice(2)];

const proc = spawn(pythonCmd, args, {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONUNBUFFERED: "1",
  },
});

proc.on("exit", (code) => {
  process.exit(code ?? 0);
});
