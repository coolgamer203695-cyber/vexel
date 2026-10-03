// Praxis — the Vexel-native UI and application engine (Vexel 3.0).
//
// Architecture: Vexel programs talk only to Vexel syntax. The compiler
// emits calls into VexAx (the backend renderer). VexAx delegates UI
// structure, layout computation, focus tracking, accessibility
// metadata, animation easing and icon art to this layer, so the engine
// can outlive any single renderer backend.
//
// This file has no Vexel syntax in it and exposes no backend types to
// Vexel programmers; everything here is consumed through VexAx.

using System;
using System.Collections.Generic;

public static class Praxis
{
    public const string EngineVersion = "3.0";

    // ---------- widget tree ----------

    public class Node
    {
        public int Id;
        public string Kind = "";
        public string Label = "";
        public int Parent = -1;
        public List<int> Children = new List<int>();
        public double X, Y, W, H;
        public bool Visible = true;
        public bool Enabled = true;
        public bool Focused;
        public string Role = "";
        public string Description = "";
        public string Value = "";
        public bool Selected;
    }

    private static int NextId = 1;
    private static Dictionary<int, Node> Nodes = new Dictionary<int, Node>();
    private static Dictionary<object, int> HandleToId = new Dictionary<object, int>();

    public static int Register(string kind, string label, object handle) {
        Node n = new Node { Id = NextId++, Kind = kind ?? "", Label = label ?? "" };
        Nodes[n.Id] = n;
        if (handle != null) HandleToId[handle] = n.Id;
        return n.Id;
    }

    public static void Reparent(object handle, object parentHandle) {
        int id, pid;
        if (!HandleToId.TryGetValue(handle, out id)) return;
        Node n = Nodes[id];
        if (n.Parent >= 0 && Nodes.ContainsKey(n.Parent)) Nodes[n.Parent].Children.Remove(id);
        n.Parent = -1;
        if (parentHandle != null && HandleToId.TryGetValue(parentHandle, out pid) && Nodes.ContainsKey(pid)) {
            n.Parent = pid;
            if (!Nodes[pid].Children.Contains(id)) Nodes[pid].Children.Add(id);
        }
    }

    public static void SetBounds(object handle, double x, double y, double w, double h) {
        int id;
        if (!HandleToId.TryGetValue(handle, out id)) return;
        Node n = Nodes[id];
        n.X = x; n.Y = y; n.W = w; n.H = h;
    }

    public static void SetFlags(object handle, bool visible, bool enabled) {
        int id;
        if (!HandleToId.TryGetValue(handle, out id)) return;
        Nodes[id].Visible = visible;
        Nodes[id].Enabled = enabled;
    }

    public static void NoteFocus(object handle, bool focused) {
        foreach (Node n in Nodes.Values) n.Focused = false;
        int id;
        if (focused && HandleToId.TryGetValue(handle, out id)) Nodes[id].Focused = true;
    }

    public static int FocusedId() {
        foreach (Node n in Nodes.Values) if (n.Focused) return n.Id;
        return -1;
    }

    public static void SetText(object handle, string label, string value) {
        int id;
        if (!HandleToId.TryGetValue(handle, out id)) return;
        if (label != null) Nodes[id].Label = label;
        if (value != null) Nodes[id].Value = value;
    }

    public static Node Get(object handle) {
        int id;
        if (handle != null && HandleToId.TryGetValue(handle, out id) && Nodes.ContainsKey(id)) return Nodes[id];
        return null;
    }

    public static List<int> ChildrenOf(object handle) {
        Node n = Get(handle);
        if (n == null) return new List<int>();
        return new List<int>(n.Children);
    }

    public static int Count() { return Nodes.Count; }

    // Idempotent registration: re-parented controls keep one node.
    public static int Ensure(string kind, string label, object handle) {
        int id;
        if (handle != null && HandleToId.TryGetValue(handle, out id) && Nodes.ContainsKey(id)) {
            if (label != null && label != "") Nodes[id].Label = label;
            return id;
        }
        return Register(kind, label, handle);
    }

    // ---------- layout engine (deterministic, parent-relative) ----------

    // Proportional sizing against an explicit parent size. No hidden
    // offsets: the caller passes the parent content size, never more.
    public static double Proportional(double parentSize, double pct) {
        if (!(parentSize > 0)) return 0;
        return Math.Max(0, parentSize * pct / 100.0);
    }

    // Fill: occupy the parent from the control's offset to the edge.
    public static double Fill(double parentSize, double offset) {
        if (!(parentSize > 0)) return 0;
        return Math.Max(0, parentSize - Math.Max(0, offset));
    }

    public static double Clamp(double v, double min, double max) {
        if (v < min) return min;
        if (max > min && v > max) return max;
        return v;
    }

    public static bool Overlaps(double ax, double ay, double aw, double ah,
                                double bx, double by, double bw, double bh) {
        if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
        return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
    }

    // ---------- animation easing (UI thread timers stay in VexAx) ----------

    public static double EaseLinear(double t) {
        if (t < 0) return 0;
        if (t > 1) return 1;
        return t;
    }

    // Smoothstep in/out: gentle start and stop, no overshoot.
    public static double EaseSmooth(double t) {
        if (t < 0) return 0;
        if (t > 1) return 1;
        return t * t * (3.0 - 2.0 * t);
    }

    public static double EaseByName(string name, double t) {
        if (string.Equals(name, "smooth", StringComparison.OrdinalIgnoreCase)) return EaseSmooth(t);
        return EaseLinear(t);
    }

    // ---------- accessibility metadata ----------

    public static void SetA11y(object handle, string role, string label, string description) {
        int id;
        if (!HandleToId.TryGetValue(handle, out id)) return;
        Node n = Nodes[id];
        if (role != null) n.Role = role;
        if (label != null) n.Label = label;
        if (description != null) n.Description = description;
    }

    public static string A11yReport(object handle) {
        Node n = Get(handle);
        if (n == null) return "unknown";
        return n.Kind + "|" + n.Label + "|" + n.Description + "|" +
               (n.Enabled ? "enabled" : "disabled") + "|" +
               (n.Visible ? "visible" : "hidden") + "|" +
               (n.Selected ? "selected" : "unselected");
    }

    // ---------- render-command log (GPU-ready abstraction) ----------

    public class RenderCmd {
        public string Op = "";
        public double X, Y, W, H;
        public string Text = "";
        public string Detail = "";
    }

    private static List<RenderCmd> RenderLog = new List<RenderCmd>();

    public static void LogRect(double x, double y, double w, double h, string detail) {
        RenderLog.Add(new RenderCmd { Op = "rect", X = x, Y = y, W = w, H = h, Detail = detail ?? "" });
        if (RenderLog.Count > 4096) RenderLog.RemoveRange(0, RenderLog.Count - 4096);
    }

    public static void LogText(double x, double y, string text, string detail) {
        RenderLog.Add(new RenderCmd { Op = "text", X = x, Y = y, Text = text ?? "", Detail = detail ?? "" });
        if (RenderLog.Count > 4096) RenderLog.RemoveRange(0, RenderLog.Count - 4096);
    }

    public static int RenderCount() { return RenderLog.Count; }

    public static void RenderClear() { RenderLog.Clear(); }

    // ---------- icons (built-in vector registry, no downloads) ----------

    private static Dictionary<string, string> Icons = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { "save", "M3,3 H13 V11 H3 Z M5,3 V7 H11 V3 M5,13 V9 H11 V13" },
        { "open", "M2,5 H8 L10,7 H14 V13 H2 Z" },
        { "search", "M7,2 A5,5 0 1,0 7,12 A5,5 0 1,0 7,2 M11,11 L15,15" },
        { "settings", "M8,2 V4 M8,12 V14 M2,8 H4 M12,8 H14 M4,4 L5.5,5.5 M10.5,10.5 L12,12 M12,4 L10.5,5.5 M5.5,10.5 L4,12" },
        { "add", "M8,2 V14 M2,8 H14" },
        { "delete", "M3,3 L13,13 M13,3 L3,13" },
        { "play", "M4,2 L13,8 L4,14 Z" },
        { "pause", "M4,2 H6.5 V14 H4 Z M9.5,2 H12 V14 H9.5 Z" },
        { "close", "M3,3 L13,13 M13,3 L3,13" },
        { "check", "M2,8.5 L6.5,13 L14,3.5" },
        { "warning", "M8,1.5 L15,13.5 H1 Z M8,6 V10 M8,11.5 V12.5" },
        { "info", "M8,1.5 A6.5,6.5 0 1,0 8,14.5 A6.5,6.5 0 1,0 8,1.5 M8,7 V11 M8,4.5 V5.5" },
        { "edit", "M3,13 L4,9 L10,3 L13,6 L7,12 Z" },
        { "refresh", "M13,8 A5,5 0 1,1 8,3 M8,3 L8,3 M3,3 V6 H6" },
        { "folder", "M1.5,4 H7 L8.5,6 H14.5 V12.5 H1.5 Z" },
        { "star", "M8,1.5 L10,6 L15,6 L11,9 L12.5,14 L8,11 L3.5,14 L5,9 L1,6 L6,6 Z" },
    };

    public static bool HasIcon(string name) {
        return name != null && Icons.ContainsKey(name.Trim());
    }

    public static string IconPath(string name) {
        if (name == null) return null;
        string key = name.Trim();
        string d;
        if (Icons.TryGetValue(key, out d)) return d;
        return null;
    }

    public static string IconNames() {
        List<string> names = new List<string>(Icons.Keys);
        names.Sort(StringComparer.OrdinalIgnoreCase);
        return string.Join(",", names.ToArray());
    }
}
