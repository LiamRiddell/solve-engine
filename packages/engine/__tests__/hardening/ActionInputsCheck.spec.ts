import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * `scripts/check-action-inputs.mjs` (#691): a workflow's `with:` inputs must be
 * ones the action declares, since GitHub ignores an undeclared input rather than
 * failing the step. Run over fixture checkouts through its `--root` option, so
 * each case is a real workflow file read the way the script reads the repo's.
 */

const SCRIPT = path.resolve(__dirname, "../../../../scripts/check-action-inputs.mjs");
const PIN = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const MANIFEST = { [PIN]: { source: "action.yml", inputs: ["cache", "node-version"] } };

const roots: string[] = [];

/** A throwaway checkout holding one workflow and, unless left out, the manifest. */
function checkout(workflow: string, manifest: object | null = MANIFEST): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "action-inputs-"));
	roots.push(root);
	fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
	fs.writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), workflow);
	if (manifest !== null) fs.writeFileSync(path.join(root, ".github", "action-inputs.json"), JSON.stringify(manifest));
	return root;
}

function run(root: string): { status: number | null; out: string } {
	const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: "utf8" });
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

const step = (withBlock: string) => `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ${PIN}
${withBlock}
      - run: npm test
`;

describe("the inputs a workflow passes", () => {
	test("declared ones pass", () => {
		const result = run(checkout(step("        with:\n          node-version: 22\n          cache: npm")));
		expect(result.status).toBe(0);
		expect(result.out).toMatch(/2 with: input\(s\) across 1 action reference/);
	});

	test("an undeclared one fails, naming the file, the line and the inputs the action has", () => {
		const result = run(checkout(step("        with:\n          node_version: 22")));
		expect(result.status).toBe(1);
		expect(result.out).toContain(`ci.yml:5  ${PIN} declares no input "node_version" (it declares: cache, node-version)`);
	});

	test("with: before uses: in the same step is read", () => {
		const workflow = `jobs:
  build:
    steps:
      - name: Node
        with:
          nodeversion: 22
        uses: ${PIN}
`;
		expect(run(checkout(workflow)).out).toContain(`declares no input "nodeversion"`);
	});

	test("a multi-line value, comments and blank lines inside with: are not read as inputs", () => {
		const workflow = step(`        with:
          # the version CI runs
          node-version: |
            22
            cache: not-a-key

          cache: npm`);
		const result = run(checkout(workflow));
		expect(result.status).toBe(0);
		expect(result.out).toMatch(/2 with: input\(s\)/);
	});

	test("the next step's with: is not this step's", () => {
		const workflow = `jobs:
  build:
    steps:
      - uses: ${PIN}
      - uses: ./local-action
        with:
          anything: 1
`;
		expect(run(checkout(workflow)).status).toBe(0);
	});
});

describe("the list of each action's inputs", () => {
	test("a pin it does not list fails, so moving a pin means refreshing it", () => {
		const result = run(checkout(step("        with:\n          node-version: 22"), {}));
		expect(result.status).toBe(1);
		expect(result.out).toContain(`${PIN} is not in .github/action-inputs.json: refresh it with --update`);
	});

	test("an entry no workflow uses fails as stale", () => {
		const manifest = { ...MANIFEST, "actions/checkout@0000000000000000000000000000000000000000": { source: "action.yml", inputs: [] } };
		const result = run(checkout(step(""), manifest));
		expect(result.status).toBe(1);
		expect(result.out).toContain("lists actions/checkout@0000000000000000000000000000000000000000, which no workflow uses");
	});

	test("a missing list fails every reference rather than passing", () => {
		expect(run(checkout(step("        with:\n          node-version: 22"), null)).status).toBe(1);
	});

	test("local and container actions are not listed", () => {
		const workflow = `jobs:
  build:
    steps:
      - uses: ./.github/actions/setup
        with:
          x: 1
      - uses: docker://alpine:3.20
`;
		expect(run(checkout(workflow, {})).status).toBe(0);
	});
});

describe("the repository's own workflows", () => {
	test("pass against the committed list", () => {
		const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
		expect(result.status).toBe(0);
	});
});
