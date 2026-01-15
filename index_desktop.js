#!/usr/bin/env node
import inquirer from 'inquirer';
import axios from 'axios';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Load package.json for version info
import pkg from "./package.json" with { type: "json" };

// CLI flags
const verbose = process.argv.includes("--verbose");
const showHelp = process.argv.includes("--help");
const showVersion = process.argv.includes("--version");

// Config paths
const historyFile = path.join(os.homedir(), ".api-cli-history.json");
const jwtFile = path.join(os.homedir(), ".api-cli-jwt.json");

function logVerbose(message) {
  if (verbose) console.log(chalk.dim(`Verbose: ${message}`));
}

// HELP text
function printHelp() {
  console.log(chalk.cyan("\nhttptmux CLI Help"));
  console.log(`
Usage: httptmux [options]

Options:
  --help       Show this help message
  --version    Show version number
  --verbose    Enable verbose logging

Interactive Menu Options:
  • Make new request
  • View history
  • Re-run from history
  • Search history
  • Clear history
  • Export history
  • Filter history
  • Set JWT token
  • Help
  • Version
  • Exit
`);
}

// VERSION text
function printVersion() {
  console.log(chalk.cyan(`\nhttptmux v${pkg.version}`));
}

// History helpers
function loadHistory() {
  if (fs.existsSync(historyFile)) {
    try { return JSON.parse(fs.readFileSync(historyFile, "utf8")); }
    catch { return []; }
  }
  return [];
}
function saveHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
}
function clearHistory() {
  fs.writeFileSync(historyFile, JSON.stringify([], null, 2));
  console.log(chalk.green("History cleared."));
}
function exportHistory(filePath = path.join(os.homedir(), "httptmux-history-export.json")) {
  const history = loadHistory();
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  console.log(chalk.green(`History exported to ${filePath}`));
}
async function filterHistoryPrompt() {
  const history = loadHistory();
  if (history.length === 0) return console.log(chalk.yellow("No history found."));
  const { status, since } = await inquirer.prompt([
    { type: "input", name: "status", message: chalk.blue("Filter by status code (or leave empty):") },
    { type: "input", name: "since", message: chalk.blue("Filter by date (YYYY-MM-DD or leave empty):") }
  ]);
  let results = history;
  if (status) results = results.filter(e => String(e.status) === status);
  if (since) results = results.filter(e => new Date(e.timestamp) >= new Date(since));
  if (results.length === 0) return console.log(chalk.yellow("No matching entries."));
  console.log(chalk.cyan("\nFiltered Results:"));
  results.forEach((entry, i) => console.log(chalk.gray(`${i + 1}. [${entry.timestamp}] ${entry.method} ${entry.url} (status: ${entry.status})`)));
}

// JWT helpers
function loadJWT() {
  if (fs.existsSync(jwtFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(jwtFile, "utf8"));
      return data.token || null;
    } catch { return null; }
  }
  return null;
}
function saveJWT(token) {
  fs.writeFileSync(jwtFile, JSON.stringify({ token }, null, 2));
  console.log(chalk.green("JWT saved successfully."));
  checkJWTExpiry(token);
}
function decodeJWT(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    return payload;
  } catch { return null; }
}
function checkJWTExpiry(token) {
  const payload = decodeJWT(token);
  if (payload && payload.exp) {
    const expiry = new Date(payload.exp * 1000);
    if (expiry < new Date()) {
      console.log(chalk.red("⚠️ JWT token has expired."));
    } else {
      const minutesLeft = Math.round((expiry - new Date()) / 60000);
      console.log(chalk.yellow(`JWT expires in ${minutesLeft} minutes.`));
    }
  }
}

// Error formatting
function formatError(error) {
  if (error.response) {
    return {
      status: error.response.status,
      data: error.response.data,
      message: error.message
    };
  }
  return { status: "ERROR", message: error.message };
}

// Execute a request
async function executeRequest({ method, url, headers, body }) {
  try {
    const jwt = loadJWT();
    if (jwt) {
      headers = { ...headers, Authorization: `Bearer ${jwt}` };
      logVerbose("JWT attached to request headers.");
      checkJWTExpiry(jwt);
    }

    const start = Date.now();
    const response = await axios({ method, url, headers, data: body });
    const duration = Date.now() - start;

    console.log(chalk.green("\nResponse received:"));
    console.log(chalk.gray(JSON.stringify(response.data, null, 2)));

    logVerbose(`Request completed in ${duration} ms`);
    logVerbose(`Status code: ${response.status}`);

    saveHistory({ timestamp: new Date().toISOString(), method, url, headers, body, status: response.status, duration });
  } catch (error) {
    const formatted = formatError(error);
    console.error(chalk.red("\nRequest failed:"), chalk.red(formatted.message));
    if (verbose && formatted.data) console.error(chalk.dim("Verbose: Error details →"), formatted.data);
    saveHistory({ timestamp: new Date().toISOString(), method, url, headers, body, status: formatted.status, error: formatted.message });
  }
}

// Prompt user for new request
async function runRequest() {
  const { method } = await inquirer.prompt([{ type: "list", name: "method", message: chalk.blue("Select HTTP method:"), choices: ["GET", "POST", "PUT", "DELETE"] }]);
  const { url } = await inquirer.prompt([{ type: "input", name: "url", message: chalk.blue("Enter API URL:") }]);
  const { headersInput } = await inquirer.prompt([{ type: "input", name: "headersInput", message: chalk.yellow("Enter headers as JSON (or leave empty):") }]);
  let bodyInput = "";
  if (method === "POST" || method === "PUT") {
    const bodyAnswer = await inquirer.prompt([{ type: "input", name: "bodyInput", message: chalk.yellow("Enter request body as JSON (or leave empty):") }]);
    bodyInput = bodyAnswer.bodyInput;
  }

  let headers = {};
  let body = {};
  try { if (headersInput) headers = JSON.parse(headersInput); } catch { console.log(chalk.yellow("Invalid JSON for headers.")); }
  try { if (bodyInput) body = JSON.parse(bodyInput); } catch { console.log(chalk.yellow("Invalid JSON for body.")); }

  await executeRequest({ method, url, headers, body });
}

// Re-run from history
async function rerunHistory() {
  const history = loadHistory();
  if (history.length === 0) return console.log(chalk.yellow("No history found."));
  const choices = history.map((entry, i) => ({ name: `${i + 1}. [${entry.timestamp}] ${entry.method} ${entry.url} (status: ${entry.status})`, value: i }));
  const { index } = await inquirer.prompt([{ type: "list", name: "index", message: chalk.blue("Select a request to re-run:"), choices }]);
  const entry = history[index];
  console.log(chalk.cyan(`\nRe-running: ${entry.method} ${entry.url}`));
  await executeRequest(entry);
}

// Search/filter history
async function searchHistory() {
  const history = loadHistory();
  if (history.length === 0) return console.log(chalk.yellow("No history found."));
  const { keyword } = await inquirer.prompt([{ type: "input", name: "keyword", message: chalk.blue("Enter keyword to search (method, URL, status):") }]);
  const results = history.filter(entry =>
    entry.method.includes(keyword.toUpperCase()) ||
    entry.url.includes(keyword) ||
    String(entry.status).includes(keyword)
  );
  if (results.length === 0) return console.log(chalk.yellow("No matching entries."));
  console.log(chalk.cyan("\nSearch Results:"));
  results.forEach((entry, i) => console.log(chalk.gray(`${i + 1}. [${entry.timestamp}] ${entry.method} ${entry.url} (status: ${entry.status})`)));
}

// JWT mode
async function jwtMode() {
  const current = loadJWT();
  if (current) {
    console.log(chalk.cyan("Current JWT:"));
    const payload = decodeJWT(current);
    console.log(chalk.gray(JSON.stringify({ tokenPreview: `${current.slice(0, 12)}...`, payload }, null, 2)));
    checkJWTExpiry(current);
  }

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: chalk.blue("JWT actions:"),
    choices: ["Set new token", "Remove token", "Back"]
  }]);

  if (action === "Set new token") {
    const { token } = await inquirer.prompt([{ type: "input", name: "token", message: chalk.blue("Enter JWT token:") }]);
    if (!token || !token.includes(".")) {
      console.log(chalk.red("Invalid JWT format."));
      return;
    }
    saveJWT(token);
  } else if (action === "Remove token") {
    if (fs.existsSync(jwtFile)) fs.unlinkSync(jwtFile);
    console.log(chalk.green("JWT removed."));
  } else {
    // Back
  }
}

// Main loop
async function main() {
  if (showHelp) return printHelp();
  if (showVersion) return printVersion();

  console.log(chalk.cyan("httptmux"));

  let keepGoing = true;
  while (keepGoing) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: chalk.blue("Choose an action:"),
        choices: [
          "Make new request",
          "View history",
          "Re-run from history",
          "Search history",
          "Clear history",
          "Export history",
          "Filter history",
          "Set JWT token",
          "Help",
          "Version",
          "Exit"
        ]
      }
    ]);

    if (action === "Make new request") await runRequest();
    else if (action === "View history") {
      const history = loadHistory();
      if (history.length === 0) console.log(chalk.yellow("No history found."));
      else history.forEach((entry, i) => console.log(chalk.gray(`${i + 1}. [${entry.timestamp}] ${entry.method} ${entry.url} (status: ${entry.status})`)));
    }
    else if (action === "Re-run from history") await rerunHistory();
    else if (action === "Search history") await searchHistory();
    else if (action === "Clear history") clearHistory();
    else if (action === "Export history") {
      const { filePath } = await inquirer.prompt([{ type: "input", name: "filePath", message: chalk.blue("Export file path (default in HOME):") }]);
      exportHistory(filePath && filePath.trim() ? filePath.trim() : undefined);
    }
    else if (action === "Filter history") await filterHistoryPrompt();
    else if (action === "Set JWT token") await jwtMode();
    else if (action === "Help") printHelp();
    else if (action === "Version") printVersion();
    else keepGoing = false;
  }

  logVerbose("Program finished.");
  console.log(chalk.cyan("\nExiting httptmux. Goodbye!"));
}

main().catch(err => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
