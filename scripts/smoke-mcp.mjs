/**
 * Starts the built MCP server as a real process and talks to it over standard
 * input and output, the way an AI tool does.
 *
 * The server's spec (`__tests__/bugs/Issue774_mcpServer.spec.ts`) drives the
 * tools in-process and through the protocol handler directly, so it cannot see
 * what only goes wrong once the server is bundled and started by Node: the
 * shebang, the engine import resolving, the newline-delimited framing
 * on the real streams, a stray line on standard output corrupting the
 * protocol, and the process ending when the client closes its end. This is
 * that half, after `build` in `npm run verify`. Nothing here reaches the
 * network: the server starts with it off, its default.
 *
 * Usage:
 *   node scripts/smoke-mcp.mjs
 *
 * @module smoke-mcp
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "packages", "mcp", "dist", "solve-mcp.js");
const failures = [];

function check(label, fn) {
	try {
		fn();
		console.log(`  ok    ${label}`);
	} catch (error) {
		console.log(`  FAIL  ${label}`);
		console.log(`        ${error.message}`);
		failures.push(label);
	}
}

console.log("Smoke testing the built MCP server.\n");

if (!fs.existsSync(bin)) {
	console.error(`${path.relative(root, bin)} does not exist. Run npm run build first.`);
	process.exit(1);
}

check("the bundle starts with its shebang and imports the engine, and nothing else, rather than carrying it", () => {
	const text = fs.readFileSync(bin, "utf8");
	if (!text.startsWith("#!/usr/bin/env node\n")) throw new Error("no shebang on the first line");
	if (!/from "solve-engine"/.test(text)) throw new Error('no import from "solve-engine"');
	const others = [...text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1]).filter((name) => !/^solve-engine(\/|$)/.test(name));
	if (others.length > 0) throw new Error(`imports beyond the engine: ${[...new Set(others)].join(", ")}`);
	if (text.length > 100_000) throw new Error(`${text.length} characters: a dependency was bundled in`);
});

const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "pipe"] });
const answers = new Map();
const strays = [];
let stderr = "";
let buffer = "";
child.stderr.on("data", (chunk) => {
	stderr += chunk;
});
child.stdout.on("data", (chunk) => {
	buffer += chunk;
	let newline;
	while ((newline = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		try {
			const message = JSON.parse(line);
			if (message.id !== undefined) answers.set(message.id, message);
		} catch {
			strays.push(line);
		}
	}
});
const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
let nextId = 1;
/** Sends a request and waits for its answer, failing after ten seconds. */
async function request(method, params) {
	const id = nextId++;
	send({ jsonrpc: "2.0", id, method, params });
	const deadline = Date.now() + 10_000;
	while (!answers.has(id)) {
		if (Date.now() > deadline) throw new Error(`no answer to ${method} within ten seconds; stderr: ${stderr.trim()}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return answers.get(id);
}
const call = async (name, args) => (await request("tools/call", { name, arguments: args })).result;

const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
check("the handshake names the server and offers tools", () => {
	if (init.result?.serverInfo?.name !== "solve") throw new Error(JSON.stringify(init));
	if (!init.result.capabilities?.tools) throw new Error("no tools capability");
});

const list = await request("tools/list", {});
check("it lists the three tools", () => {
	const names = list.result.tools.map((t) => t.name).join(",");
	if (names !== "evaluate_expression,evaluate_document,check_document") throw new Error(names);
});

const expression = await call("evaluate_expression", { expression: "5 km in miles" });
check("an expression answers with structured content", () => {
	const s = expression.structuredContent;
	if (expression.isError || s.display !== "= 3.11 miles" || s.value.unit !== "miles" || s.ok !== true) throw new Error(JSON.stringify(expression));
});

const checks = await call("check_document", { document: ":price = 4\n:qty = 3\ncheck price * qty == 12\ncheck price == 5\ncheck 22/7 ≈ pi within 0.1%\n" });
check("a document's checks: 2 passed, 1 failed", () => {
	const s = checks.structuredContent;
	if (s.passed !== 2 || s.failed !== 1 || s.ok !== false) throw new Error(JSON.stringify(s));
});

const offline = await call("evaluate_expression", { expression: "weather in London" });
check("the network is off by default", () => {
	if (offline.structuredContent.code !== "NETWORK_DISABLED") throw new Error(JSON.stringify(offline.structuredContent));
});

const huge = await call("evaluate_document", { document: "1\n".repeat(100_001) });
const after = await call("evaluate_expression", { expression: "2 + 2" });
check("a document past the engine's limit is a coded refusal, and the next call is unaffected", () => {
	if (!huge.isError || huge.structuredContent.error.code !== "DOCUMENT_TOO_LARGE") throw new Error(JSON.stringify(huge.structuredContent));
	if (after.structuredContent.display !== "= 4") throw new Error(JSON.stringify(after.structuredContent));
});

const globalWrite = await call("evaluate_document", { document: "global :smoke = 42\n" });
check("global variables are not offered", () => {
	if (globalWrite.structuredContent.lines[0].code !== "NO_PREFIX_PARSELET") throw new Error(JSON.stringify(globalWrite.structuredContent));
});

check("nothing but protocol messages reached standard output", () => {
	if (strays.length > 0) throw new Error(`stray lines: ${JSON.stringify(strays.slice(0, 3))}`);
});

child.stdin.end();
const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
const end = await exited;
clearTimeout(timer);
check("the process exits when the client closes its end", () => {
	if (end.signal !== null) throw new Error(`killed by ${end.signal}: it did not exit on its own`);
	if (end.code !== 0) throw new Error(`exited ${end.code}; stderr: ${stderr.trim()}`);
});

if (failures.length > 0) {
	console.log(`\n${failures.length} check(s) failed.`);
	process.exit(1);
}
console.log("\nThe built server answers over standard input and output and exits as it should.");
