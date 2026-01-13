#!/data/data/com.termux/files/usr/bin/node
import inquirer from 'inquirer';
import axios from 'axios';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Load package.json for version info
import pkg from "./package.json" with { type: "json" };

// Check CLI flags
const verbose = process.argv.includes("--verbose");
const showHelp = process.argv.includes("--help");
const showVersion = process.argv.includes("--version");

// History & JWT file paths
const historyFile = path.join(os.homedir(), ".api-cli-history.json");
const jwtFile = path.join(os.homedir(), ".api-cli-jwt.json");

function logVerbose(message) {
  if (verbose) {
    console.log(chalk.dim(`Verbose: ${message}`));
  }
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

// Load history
function loadHistory() {
  if (fs.existsSync(historyFile)) {
    try {
      return JSON.parse(fs.readFileSync(historyFile, "utf8"));
    } catch {
      return [];
    }
  }
  return [];
}

// Save history
function saveHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
}

// Load JWT
function loadJWT() {
  if (fs.existsSync(jwtFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(jwtFile, "utf8"));
      return data.token || null;
    } catch {
      return null;
    }
  }
  return null;
}

// Save JWT
function saveJWT(token) {
  fs.writeFileSync(jwtFile, JSON.stringify({ token }, null, 2));
  console.log(chalk.green("JWT saved successfully."));
}

// Execute a request object
async function executeRequest({ method, url, headers, body }) {
  try {
    const jwt = loadJWT();
    if (jwt) {
      headers = { ...headers, Authorization: `Bearer ${jwt}` };
      logVerbose("JWT attached to request headers.");
    }

    const start = Date.now();
    const response = await axios({ method, url, headers, data: body });
    const duration = Date.now() - start;

    console.log(chalk.green("\nResponse received:"));
    console.log(chalk.gray(JSON.stringify(response.data, null, 2)));

    logVerbose(`Request completed in ${duration} ms`);
    logVerbose(`Status code: ${response.status}`);

    saveHistory({
      timestamp: new Date().toISOString(),
      method,
      url,
      headers,
      body,
      status: response.status,
      duration
    });
  } catch (error) {
    console.error(chalk.red("\nError making request:"), chalk.red(error.message));
    if (verbose && error.response) {
      console.error(chalk.dim("Verbose: Error details →"), error.response.data);
    }
    saveHistory({
      timestamp: new Date().toISOString(),
      method,
      url,
      headers,
      body,
      status: error.response ? error.response.status : "ERROR",
      error: error.message
    });
  }
}

// Prompt user for new request
async function runRequest() {
  const { method } = await inquirer.prompt([
    { type: "list", name: "method", message: chalk.blue("Select HTTP method:"), choices: ["GET", "POST", "PUT", "DELETE"] }
  ]);
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
  const results = history.filter(entry => entry.method.includes(keyword.toUpperCase()) || entry.url.includes(keyword) || String(entry.status).includes(keyword));
  if (results.length === 0) return console.log(chalk.yellow("No matching entries."));
  console.log(chalk.cyan("\nSearch Results:"));
  results.forEach((entry, i) => console.log(chalk.gray(`${i + 1}. [${entry.timestamp}] ${entry.method} ${entry.url} (status: ${entry.status})`)));
}

// JWT mode
async function jwtMode() {
  const { token } = await inquirer.prompt([{ type: "input", name: "token", message: chalk.blue("Enter JWT token:") }]);
  saveJWT(token);
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
          "Set JWT token",
          "Help",
          "Version",
          "Exit"
        ]
      }
    ]);

    if (action === "Make new request") await runRequest();
    else if (action === "View history") console.log(chalk.cyan("\nRequest History:"), loadHistory());
    else if (action === "Re-run from history") await rerunHistory();
    else if (action === "Search history") await searchHistory();
    else if (action === "Set JWT token") await jwtMode();
    else if (action === "Help") printHelp();
    else if (action === "Version") printVersion();
    else keepGoing = false;
  }

  logVerbose("Program finished.");
  console.log(chalk.cyan("\nExiting httptmux. Goodbye!"));
}

main();
