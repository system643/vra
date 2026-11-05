// Fake VR game for the autopilot end-to-end test: speaks the VRA hot bridge (VRA_LAB_DIR),
// reads the simulated head pose written by the fake Meta XR Operator (FAKE_POSE_FILE).
// Flags: --crash-after=<ms>  --scale=<world scale error>
import fs from "node:fs";
import path from "node:path";

const flag = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : def;
};
const crashAfter = flag("crash-after", 0);
let scale = flag("scale", 1);
const dir = process.env.VRA_LAB_DIR;
const poseFile = process.env.FAKE_POSE_FILE;
if (!dir) process.exit(5);
fs.mkdirSync(dir, { recursive: true });
if (crashAfter) setTimeout(() => process.exit(3), crashAfter);

let frame = 0;
let last = 0;
const results = [];
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
// Windows: a rename over a file another process is reading can fail (EPERM) — skip that frame, like a real mod would.
const write = (f, o) => {
  const tmp = `${f}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(o));
    fs.renameSync(tmp, f);
  } catch {
    /* next frame */
  }
};

setInterval(() => {
  frame++;
  const doc = readJson(path.join(dir, "vra_cmd.json"));
  let changed = false;
  for (const c of doc?.commands ?? []) {
    if (c.id <= last) continue;
    let ok = true;
    let result = null;
    if (c.op === "ping") result = "pong";
    else if (c.op === "set_scale") scale = Number(c.args?.value ?? 1);
    else if (c.op === "save_config") result = "saved";
    else ok = false;
    results.push({ id: c.id, ok, result, ...(ok ? {} : { error: "op inconnue" }) });
    last = c.id;
    changed = true;
  }
  if (changed) write(path.join(dir, "vra_ack.json"), { last_id: last, results: results.slice(-40) });
  const pose = (poseFile && readJson(poseFile)) || { headY: 1.6, headX: 0 };
  write(path.join(dir, "vra_state.json"), { engine: "unity", frame, fps: 72, camera: { x: pose.headX * scale, y: pose.headY * scale, z: 0 } });
}, 30);
