// Fake `metavr` CLI for tests. Logs every argv (JSON lines) to FAKE_METAVR_LOG and answers in JSON.
// FAKE_METAVR_MODE: ok (default) | sim_down | no_app | app_dead | quit_fail
// FAKE_METAVR_STATE: folder keeping the current recording target.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
if (process.env.FAKE_METAVR_LOG) fs.appendFileSync(process.env.FAKE_METAVR_LOG, JSON.stringify(argv) + "\n");
const mode = process.env.FAKE_METAVR_MODE ?? "ok";
const stateDir = process.env.FAKE_METAVR_STATE ?? process.cwd();
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const fail = (msg, code = 2) => {
  process.stderr.write(msg + "\n");
  process.exit(code);
};

let i = 0;
if (argv[i] === "--format") i += 2;
if (argv[i] !== "xrsim") fail(`groupe inattendu : ${argv[i]}`);
i++;
while (argv[i]?.startsWith("--")) i += 2;
if (argv[i] === "--help") {
  process.stdout.write("Usage: metavr xrsim <COMMAND>\n");
  process.exit(0);
}
const [group, cmd, ...rest] = argv.slice(i);
const has = (f) => rest.includes(f);
const val = (f) => rest[rest.indexOf(f) + 1];

if (mode === "sim_down" && group !== "app") fail("error: could not connect to XR Simulator frontend on port 33794 (connection refused)");

switch (`${group} ${cmd}`) {
  case "app ensure-running":
  case "app launch":
    out({ running: true, port: 33794 });
    break;
  case "app quit":
    if (mode === "quit_fail" && !has("--force")) fail("error: frontend did not exit in time");
    out({ quit: true, forced: has("--force") });
    break;
  case "runtime logs":
    out({ lines: ["[info] runtime started"] });
    break;
  case "runtime list":
    out({ apps: mode === "no_app" ? [] : [{ name: "FakeGame", pid: 1234 }] });
    break;
  case "runtime status":
    if (mode === "app_dead") fail("error: runtime not responding");
    out({ device: "Meta Quest 3", session_state: "FOCUSED" });
    break;
  case "runtime fps":
    out({ app_fps: 89.6 });
    break;
  case "runtime ping":
    out({ ok: true });
    break;
  case "record start": {
    const f = val("--output");
    fs.writeFileSync(path.join(stateDir, "fake-metavr-record.txt"), f);
    out({ recording: true, output: f });
    break;
  }
  case "record stop": {
    const p = path.join(stateDir, "fake-metavr-record.txt");
    const f = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (f) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, "fake mp4");
      fs.rmSync(p);
    }
    out({ recording: false, output: f });
    break;
  }
  default:
    if (["device", "input", "env", "layer", "record"].includes(group)) out({ ok: true, command: `${group} ${cmd}`, args: rest });
    else fail(`commande inconnue : ${group} ${cmd}`);
}
