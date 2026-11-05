/**
 * Generated "hot command channel" code for each engine (see lab/bridge.ts for the protocol):
 * read vra_cmd.json, apply commands with id > last acknowledged, write vra_ack.json, and
 * publish telemetry in vra_state.json a few times per second.
 */

export const UEVR_LAB_LUA = `-- VRA Lab : canal de commande à chaud (UEVR)
-- Fichiers dans %APPDATA%\\UnrealVRMod\\<exe>\\data : vra_cmd.json (entrée), vra_ack.json, vra_state.json (sortie)
-- API : json.load_file / json.dump_file (dossier data), vr.set_mod_value, uevr.api:execute_command

local api = uevr.api
local vr = uevr.params.vr

local last_id = 0
local results = {}
local frame = 0
local fps_acc, fps_frames, fps = 0, 0, 0
local last_buttons = 0
local errors = {}
local view_pos = nil
local world_to_meters = nil

local function vec(v) return v and { x = v.x, y = v.y, z = v.z } or nil end
local function quat(q) return q and { x = q.x, y = q.y, z = q.z, w = q.w } or nil end

local function pose(index)
    local ok, p = pcall(function()
        local pos = UEVR_Vector3f.new()
        local rot = UEVR_Quaternionf.new()
        vr.get_pose(index, pos, rot)
        return { pos = vec(pos), rot = quat(rot) }
    end)
    return ok and p or nil
end

local function pawn_location()
    local ok, loc = pcall(function()
        local pawn = api:get_local_pawn(0)
        if pawn == nil then return nil end
        local l = pawn:K2_GetActorLocation()
        return { x = l.X or l.x, y = l.Y or l.y, z = l.Z or l.z }
    end)
    return ok and loc or nil
end

local handlers = {
    ping = function(a) return "pong" end,
    get_mod_value = function(a) return vr:get_mod_value(a.key) end,
    set_mod_value = function(a) vr.set_mod_value(a.key, tostring(a.value)); return vr:get_mod_value(a.key) end,
    exec = function(a) api:execute_command(a.command); return true end,
    snap_turn = function(a) vr.set_snap_turn_enabled(a.enabled == true); return vr.is_snap_turn_enabled() end,
    decoupled_pitch = function(a) vr.set_decoupled_pitch_enabled(a.enabled == true); return vr.is_decoupled_pitch_enabled() end,
    aim_method = function(a) vr.set_aim_method(tonumber(a.value)); return vr.get_aim_method() end,
    recenter = function(a) vr.recenter_view(); return true end,
    save_config = function(a) vr.save_config(); return true end,
}

local function process_commands()
    local doc = json.load_file("vra_cmd.json")
    if doc == nil or doc.commands == nil then return end
    local changed = false
    for _, c in ipairs(doc.commands) do
        if c.id and c.id > last_id then
            local h = handlers[c.op]
            local entry = { id = c.id, ok = false }
            if h == nil then
                entry.error = "op inconnue : " .. tostring(c.op)
            else
                local ok, res = pcall(h, c.args or {})
                entry.ok = ok
                if ok then entry.result = res else entry.error = tostring(res) end
            end
            table.insert(results, entry)
            if #results > 50 then table.remove(results, 1) end
            last_id = c.id
            changed = true
        end
    end
    if changed then json.dump_file("vra_ack.json", { last_id = last_id, results = results }, -1) end
end

local function publish_state()
    local st = {
        engine = "unreal",
        frame = frame,
        fps = fps,
        t = os and os.clock and os.clock() or frame,
        hmd_active = vr.is_hmd_active(),
        runtime = vr.is_openxr() and "openxr" or (vr.is_openvr() and "openvr" or "?"),
        using_controllers = vr.is_using_controllers(),
        hmd = pose(vr.get_hmd_index()),
        left = pose(vr.get_left_controller_index()),
        right = pose(vr.get_right_controller_index()),
        pawn_location = pawn_location(),
        view = view_pos,
        world_to_meters = world_to_meters,
        xinput_buttons = last_buttons,
        snap_turn = vr.is_snap_turn_enabled(),
        decoupled_pitch = vr.is_decoupled_pitch_enabled(),
        errors = errors,
    }
    json.dump_file("vra_state.json", st, -1)
end

uevr.sdk.callbacks.on_xinput_get_state(function(retval, user_index, state)
    last_buttons = state.Gamepad.wButtons
end)

-- Position de la vue dans le monde du jeu (unités Unreal) : sert au test d'échelle du monde.
uevr.sdk.callbacks.on_post_calculate_stereo_view_offset(function(device, view_index, wtm, position, rotation, is_double)
    if view_index == 0 then
        world_to_meters = wtm
        pcall(function() view_pos = { x = position.x, y = position.y, z = position.z } end)
    end
end)

uevr.sdk.callbacks.on_pre_engine_tick(function(engine, delta)
    frame = frame + 1
    fps_acc = fps_acc + delta
    fps_frames = fps_frames + 1
    if fps_acc >= 1.0 then
        fps = fps_frames / fps_acc
        fps_acc, fps_frames = 0, 0
    end
    if frame % 6 == 0 then
        local ok, err = pcall(process_commands)
        if not ok then table.insert(errors, tostring(err)); if #errors > 10 then table.remove(errors, 1) end end
    end
    if frame % 15 == 0 then pcall(publish_state) end
end)

print("[VRA Lab] pont à chaud UEVR actif")
`;

export const REFRAMEWORK_LAB_LUA = `-- VRA Lab : canal de commande à chaud (REFramework)
-- Fichiers dans <jeu>\\reframework\\data : vra_cmd.json, vra_ack.json, vra_state.json
-- API : json.load_file / json.dump_file (dossier data), re.on_frame, sdk.get_primary_camera

local last_id, results, frame = 0, {}, 0
local clock0 = os.clock()
local fps, fps_frames, fps_t = 0, 0, os.clock()

local function camera_position()
    local ok, p = pcall(function()
        local cam = sdk.get_primary_camera()
        if cam == nil then return nil end
        local pos = cam:call("get_GameObject"):call("get_Transform"):call("get_Position")
        return { x = pos.x, y = pos.y, z = pos.z }
    end)
    return ok and p or nil
end

local handlers = {
    ping = function(a) return "pong" end,
    get_state = function(a) return camera_position() end,
}

re.on_frame(function()
    frame = frame + 1
    fps_frames = fps_frames + 1
    local now = os.clock()
    if now - fps_t >= 1.0 then fps = fps_frames / (now - fps_t); fps_frames = 0; fps_t = now end
    if frame % 6 == 0 then
        local doc = json.load_file("vra_cmd.json")
        if doc and doc.commands then
            local changed = false
            for _, c in ipairs(doc.commands) do
                if c.id and c.id > last_id then
                    local h = handlers[c.op]
                    local entry = { id = c.id, ok = false }
                    if h then
                        local ok, res = pcall(h, c.args or {})
                        entry.ok = ok
                        if ok then entry.result = res else entry.error = tostring(res) end
                    else entry.error = "op inconnue : " .. tostring(c.op) end
                    table.insert(results, entry)
                    if #results > 50 then table.remove(results, 1) end
                    last_id = c.id
                    changed = true
                end
            end
            if changed then json.dump_file("vra_ack.json", { last_id = last_id, results = results }) end
        end
    end
    if frame % 15 == 0 then
        json.dump_file("vra_state.json", { engine = "re_engine", frame = frame, fps = fps, t = now - clock0, camera = camera_position() })
    end
end)
`;

/** C# bridge for the BepInEx plugin. Mono uses JsonUtility, IL2CPP (CoreCLR) uses System.Text.Json. */
export function unityLabBridgeCs(runtime: "mono" | "il2cpp"): string {
  const json =
    runtime === "mono"
      ? {
          usings: "",
          readCmds: "JsonUtility.FromJson<CmdFile>(text)",
          write: "JsonUtility.ToJson(obj)",
        }
      : {
          usings: "using System.Text.Json;\n",
          readCmds: "JsonSerializer.Deserialize<CmdFile>(text, new JsonSerializerOptions { IncludeFields = true })",
          write: "JsonSerializer.Serialize(obj, obj.GetType(), new JsonSerializerOptions { IncludeFields = true })",
        };
  return `
    // ───────── VRA Lab : canal de commande à chaud ─────────
    // Dossier : variable VRA_LAB_DIR (posée par lab_launch), sinon BepInEx/vra_lab.
    [System.Serializable] public class Cmd { public int id; public string op; public CmdArgs args; }
    [System.Serializable] public class CmdArgs { public string value; public string key; }
    [System.Serializable] public class CmdFile { public Cmd[] commands; }
    [System.Serializable] public class AckEntry { public int id; public bool ok; public string result; public string error; }
    [System.Serializable] public class AckFile { public int last_id; public AckEntry[] results; }
    [System.Serializable] public class Vec { public float x, y, z; }
    [System.Serializable] public class StateFile { public string engine = "unity"; public int frame; public float fps; public float t; public string scene; public Vec camera; public Vec camera_euler; public int canvases; public float hud_distance; public bool hud_world; public float camera_parent_scale; }

    internal static class VraLab
    {
        static string _dir;
        static int _lastId;
        static readonly System.Collections.Generic.List<AckEntry> Results = new System.Collections.Generic.List<AckEntry>();
        static System.DateTime _lastRead = System.DateTime.MinValue;
        static int _frame;
        static float _fpsT, _fps; static int _fpsN;
        public static float CameraParentScale = 1f;

        static string Dir()
        {
            if (_dir != null) return _dir;
            var env = System.Environment.GetEnvironmentVariable("VRA_LAB_DIR");
            _dir = string.IsNullOrEmpty(env) ? System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "vra_lab") : env;
            System.IO.Directory.CreateDirectory(_dir);
            return _dir;
        }

        static void Write(string name, object obj)
        {
            var path = System.IO.Path.Combine(Dir(), name);
            System.IO.File.WriteAllText(path + ".tmp", ${json.write});
            if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
            System.IO.File.Move(path + ".tmp", path);
        }

        static string Apply(Cmd c)
        {
            var v = c.args != null ? c.args.value : null;
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            switch (c.op)
            {
                case "ping": return "pong";
                case "hud_world": HudToWorldValue(v == "true" || v == "True"); return v;
                case "hud_distance": HudDistanceValue(float.Parse(v, inv)); return v;
                case "camera_parent_scale":
                    CameraParentScale = float.Parse(v, inv);
                    var cam = Camera.main;
                    if (cam != null && cam.transform.parent != null) cam.transform.parent.localScale = Vector3.one * CameraParentScale;
                    return v;
                case "time_scale": Time.timeScale = float.Parse(v, inv); return v;
                default: throw new System.Exception("op inconnue : " + c.op);
            }
        }

        public static System.Action<bool> HudToWorldValue = _ => { };
        public static System.Action<float> HudDistanceValue = _ => { };
        public static System.Func<bool> HudWorldGetter = () => false;
        public static System.Func<float> HudDistanceGetter = () => 0f;

        public static void Tick()
        {
            _frame++;
            _fpsN++; _fpsT += Time.unscaledDeltaTime;
            if (_fpsT >= 1f) { _fps = _fpsN / _fpsT; _fpsN = 0; _fpsT = 0f; }
            try
            {
                var cmdPath = System.IO.Path.Combine(Dir(), "vra_cmd.json");
                if (_frame % 6 == 0 && System.IO.File.Exists(cmdPath))
                {
                    var stamp = System.IO.File.GetLastWriteTimeUtc(cmdPath);
                    if (stamp != _lastRead)
                    {
                        _lastRead = stamp;
                        var text = System.IO.File.ReadAllText(cmdPath);
                        var file = ${json.readCmds};
                        var changed = false;
                        if (file != null && file.commands != null)
                            foreach (var c in file.commands)
                            {
                                if (c.id <= _lastId) continue;
                                var e = new AckEntry { id = c.id };
                                try { e.result = Apply(c); e.ok = true; } catch (System.Exception ex) { e.error = ex.Message; }
                                Results.Add(e); if (Results.Count > 50) Results.RemoveAt(0);
                                _lastId = c.id; changed = true;
                            }
                        if (changed) Write("vra_ack.json", new AckFile { last_id = _lastId, results = Results.ToArray() });
                    }
                }
                if (_frame % 15 == 0)
                {
                    var cam = Camera.main;
                    var st = new StateFile
                    {
                        frame = _frame, fps = _fps, t = Time.realtimeSinceStartup,
                        scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene().name,
                        canvases = Object.FindObjectsOfType<Canvas>().Length,
                        hud_world = HudWorldGetter(), hud_distance = HudDistanceGetter(), camera_parent_scale = CameraParentScale,
                    };
                    if (cam != null)
                    {
                        var p = cam.transform.position; var r = cam.transform.eulerAngles;
                        st.camera = new Vec { x = p.x, y = p.y, z = p.z };
                        st.camera_euler = new Vec { x = r.x, y = r.y, z = r.z };
                    }
                    Write("vra_state.json", st);
                }
            }
            catch (System.Exception) { /* le pont ne doit jamais faire planter le jeu */ }
        }
    }
`;
}

export const GODOT_LAB_GD = `extends Node
## VRA Lab : canal de commande à chaud (Godot 4).
## Dossier : variable d'environnement VRA_LAB_DIR (posée par lab_launch), sinon user://vra_lab.

var _dir := ""
var _last_id := 0
var _results: Array = []
var _frame := 0

func _ready() -> void:
	_dir = OS.get_environment("VRA_LAB_DIR")
	if _dir == "":
		_dir = ProjectSettings.globalize_path("user://vra_lab")
	DirAccess.make_dir_recursive_absolute(_dir)
	print("[VRA Lab] pont à chaud Godot actif : ", _dir)

func _write(name: String, data) -> void:
	var f := FileAccess.open(_dir.path_join(name), FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))

func _apply(c: Dictionary):
	var a: Dictionary = c.get("args", {})
	match c.get("op", ""):
		"ping":
			return "pong"
		"world_scale":
			XRServer.world_scale = float(a.get("value", 1.0))
			return XRServer.world_scale
		"recenter":
			XRServer.center_on_hmd(XRServer.RESET_BUT_KEEP_TILT, true)
			return true
		_:
			push_error("op inconnue")
			return null

func _process(_delta: float) -> void:
	_frame += 1
	var cmd_path := _dir.path_join("vra_cmd.json")
	if _frame % 6 == 0 and FileAccess.file_exists(cmd_path):
		var doc = JSON.parse_string(FileAccess.get_file_as_string(cmd_path))
		var changed := false
		if doc is Dictionary and doc.has("commands"):
			for c in doc["commands"]:
				if int(c.get("id", 0)) <= _last_id:
					continue
				var res = _apply(c)
				_results.append({"id": int(c["id"]), "ok": res != null, "result": res})
				if _results.size() > 50:
					_results.pop_front()
				_last_id = int(c["id"])
				changed = true
		if changed:
			_write("vra_ack.json", {"last_id": _last_id, "results": _results})
	if _frame % 15 == 0:
		var st := {"engine": "godot", "frame": _frame, "fps": Engine.get_frames_per_second(), "world_scale": XRServer.world_scale}
		var cam := get_viewport().get_camera_3d()
		if cam:
			var p := cam.global_position
			st["camera"] = {"x": p.x, "y": p.y, "z": p.z}
		_write("vra_state.json", st)
`;
