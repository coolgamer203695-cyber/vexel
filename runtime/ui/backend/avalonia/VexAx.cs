// Vexel 2.2 Avalonia backend runtime.
// Generated Program.cs only calls this stable VexAx API. No Avalonia
// names appear in .vxl sources. Controls are created in code (no AXAML).

using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Themes.Fluent;
using Avalonia.Threading;
using Avalonia.VisualTree;

public static class VexAx {
    public static Window MainWindow;
    public static Canvas Root;
    public static bool WasShown;

    // Vexel 2.2 phase 3: every window is an independent runtime object.
    // MainWindow stays the FIRST created window (implicit `window`
    // compatibility); Cur is the latest window's root (default parent).
    public static List<Window> Windows = new List<Window>();
    public static Dictionary<Window, Canvas> Roots = new Dictionary<Window, Canvas>();
    public static Canvas Cur;
    public static List<Window> ShownWins = new List<Window>();

    public static void ApplyTheme(Application app) {
        app.Styles.Add(new FluentTheme());
    }

    public static Window NewWindow(object title) {
        Window f = new Window();
        f.Title = Display(title);
        // Vexel 3.0 Praxis: every window roots a widget tree.
        Praxis.Register("window", f.Title, f);
        f.Width = 800;
        f.Height = 600;
        Canvas root = new Canvas();
        f.Content = root;
        Windows.Add(f);
        Roots[f] = root;
        Cur = root;
        if (MainWindow == null) {
            MainWindow = f;
            Root = root;
        }
        // Deterministic shutdown: closing the last open window stops
        // every live timer and cancels every task so nothing outlives
        // the app or fires late.
        f.Closed += delegate {
            bool anyOpen = false;
            foreach (Window w in Windows) {
                if (w != f && w.IsVisible) { anyOpen = true; break; }
            }
            if (!anyOpen) {
                StopAllTimers();
                CancelAllTasks();
            }
            Snap();
        };
        return f;
    }

    public static Canvas RootOf(object win) {
        Window f = win as Window;
        if (f != null && Roots.ContainsKey(f)) return Roots[f];
        throw new VexAxErr("UI Error: That window no longer exists.");
    }

    public static Canvas CurrentRoot() {
        if (Cur == null) throw new VexAxErr("UI Error: Cannot place this yet — create a window first.");
        return Cur;
    }

    // Factories create DETACHED controls; AddTo parents them. This keeps
    // default parenting (latest window) and explicit `to` uniform.
    public static void AddTo(object parent, object child) {
        Control c = child as Control;
        if (c == null) throw new VexAxErr("UI Error: Nothing to add.");
        // Detach first: re-parenting (add X to Y) moves the control.
        try {
            Panel old = c.Parent as Panel;
            if (old != null) old.Children.Remove(c);
        } catch (Exception) { }
        // Vexel 3.0 Praxis: register the widget (idempotent) and track
        // structure; expose an automation name for assistive tech.
        try {
            string label = "";
            try { label = Display(GetText(child)); } catch (Exception) { }
            Praxis.Ensure(VexKind(c), label, c);
            object host = parent is Window ? (object)parent : (object)(parent as Control);
            Praxis.Reparent(c, host);
            try { Avalonia.Automation.AutomationProperties.SetName(c, label == "" ? VexKind(c) : label); } catch (Exception) { }
        } catch (Exception) { /* tree tracking never breaks layout */ }
        if (parent is Window) {
            RootOf(parent).Children.Add(c);
            return;
        }
        if (parent is Grid) {
            Grid g = (Grid)parent;
            int n = GridCounts.ContainsKey(g) ? GridCounts[g] : 0;
            int row = n / 2;
            int col = n % 2;
            while (g.RowDefinitions.Count <= row) g.RowDefinitions.Add(new RowDefinition(GridLength.Star));
            Grid.SetRow(c, row);
            Grid.SetColumn(c, col);
            g.Children.Add(c);
            GridCounts[g] = n + 1;
            return;
        }
        if (parent is ScrollViewer) {
            ScrollViewer sv = (ScrollViewer)parent;
            if (!ScrollInners.ContainsKey(sv)) {
                Canvas inner = new Canvas();
                inner.ClipToBounds = true;
                sv.Content = inner;
                ScrollInners[sv] = inner;
            }
            ScrollInners[sv].Children.Add(c);
            return;
        }
        if (parent is Panel) {
            ((Panel)parent).Children.Add(c);
            return;
        }
        // Vexel 3.0 Praxis: cards parent into their inner canvas.
        if (parent is Border) {
            Canvas inner;
            if (CardInners.TryGetValue(parent, out inner)) {
                inner.Children.Add(c);
                return;
            }
        }
        // `add a button to homeTab` parents into the tab page's canvas.
        if (parent is TabItem) {
            TabItem ti = (TabItem)parent;
            Panel p = ti.Content as Panel;
            if (p == null) {
                p = new Canvas();
                p.ClipToBounds = true;
                ti.Content = p;
            }
            p.Children.Add(c);
            return;
        }
        throw new VexAxErr("UI Error: Cannot add this element there.");
    }

    // `window.show` (implicit) and `name.show` (named) both land here.
    public static void ShowWin(object win) {
        Window f = win as Window;
        if (f == null) throw new VexAxErr("UI Error: The window has not been created yet.");
        if (!ShownWins.Contains(f)) ShownWins.Add(f);
        WasShown = true;
        f.Show();
        Snap();
    }

    public static void Shown() {
        if (MainWindow == null) throw new VexAxErr("UI Error: The window has not been created yet.");
        ShowWin(MainWindow);
    }

    public static Button NewButton(object title) {
        Button b = new Button();
        b.Content = Display(title);
        return b;
    }

    public static Label NewLabel(object title) {
        Label l = new Label();
        l.Content = Display(title);
        return l;
    }

    // ---------- phase 2 widgets ----------

    public static TextBox NewInput(object hint) {
        TextBox t = new TextBox();
        t.Width = 200;
        t.Watermark = Display(hint);
        return t;
    }

    public static TextBox NewOutput(object title) {
        TextBox t = new TextBox();
        t.Width = 300;
        t.Height = 120;
        t.AcceptsReturn = true;
        t.IsReadOnly = true;
        t.Text = Display(title);
        return t;
    }

    public static CheckBox NewCheckbox(object title) {
        CheckBox c = new CheckBox();
        c.Content = Display(title);
        return c;
    }

    public static Slider NewSlider() {
        Slider s = new Slider();
        s.Width = 200;
        s.Minimum = 0;
        s.Maximum = 100;
        return s;
    }

    // ---------- Vexel 3.0 Praxis controls (real core controls) ----------

    public static ToggleSwitch NewSwitch(object title) {
        ToggleSwitch s = new ToggleSwitch();
        s.Content = Display(title);
        return s;
    }

    public static RadioButton NewRadio(object title) {
        RadioButton r = new RadioButton();
        r.Content = Display(title);
        return r;
    }

    public static NumericUpDown NewNumeric() {
        NumericUpDown n = new NumericUpDown();
        n.Width = 200;
        n.Minimum = 0;
        n.Maximum = 100;
        n.Increment = 1;
        n.Value = 0;
        return n;
    }

    public static TextBox NewSearch(object hint) {
        TextBox t = new TextBox();
        t.Width = 200;
        string h = Display(hint);
        t.Watermark = h == "" ? "Search..." : h;
        return t;
    }

    public static Border NewCard(object title) {
        Border b = new Border();
        b.CornerRadius = new CornerRadius(12);
        b.Padding = new Thickness(4);
        b.BorderThickness = new Thickness(1);
        try { b.BorderBrush = new SolidColorBrush(Color.FromRgb(70, 70, 90)); } catch (Exception) { }
        Canvas inner = new Canvas();
        inner.ClipToBounds = true;
        b.Child = inner;
        string t = Display(title);
        if (t != "") {
            Label head = new Label();
            head.Content = t;
            head.FontSize = 18;
            head.FontWeight = FontWeight.Bold;
            Canvas.SetLeft(head, 12);
            Canvas.SetTop(head, 8);
            inner.Children.Add(head);
        }
        CardInners[b] = inner;
        return b;
    }

    private static Dictionary<object, Canvas> CardInners = new Dictionary<object, Canvas>();

    public static Canvas CardInner(object o) {
        Canvas inner;
        if (o != null && CardInners.TryGetValue(o, out inner)) return inner;
        throw new VexAxErr("UI Error: Only a card takes card children.");
    }

    public static DockPanel NewStatusbar(object title) {
        DockPanel d = new DockPanel();
        d.Height = 30;
        d.LastChildFill = true;
        try { d.Background = new SolidColorBrush(Color.FromRgb(30, 30, 40)); } catch (Exception) { }
        Label lab = new Label();
        lab.Content = Display(title);
        lab.VerticalAlignment = VerticalAlignment.Center;
        lab.Margin = new Thickness(10, 0, 0, 0);
        d.Children.Add(lab);
        StatusLabels[d] = lab;
        return d;
    }

    private static Dictionary<object, Label> StatusLabels = new Dictionary<object, Label>();

    public static void StatusText(object o, string text) {
        Label lab;
        if (o != null && StatusLabels.TryGetValue(o, out lab)) { lab.Content = text; return; }
        throw new VexAxErr("UI Error: Only a status bar takes status text.");
    }

    public static Border NewSeparator() {
        Border b = new Border();
        b.Height = 1;
        b.HorizontalAlignment = HorizontalAlignment.Stretch;
        try { b.Background = new SolidColorBrush(Color.FromRgb(90, 90, 110)); } catch (Exception) { }
        return b;
    }

    public static MenuFlyout NewContextMenu() {
        return new MenuFlyout();
    }

    public static MenuItem ContextAdd(object o, object text) {
        MenuFlyout m = o as MenuFlyout;
        if (m == null) throw new VexAxErr("UI Error: Only a context menu takes items.");
        MenuItem mi = new MenuItem();
        mi.Header = Display(text);
        m.Items.Add(mi);
        return mi;
    }

    public static void ContextShow(object o) {
        MenuFlyout m = o as MenuFlyout;
        if (m == null) throw new VexAxErr("UI Error: Only a context menu can show.");
        Control target = null;
        if (Cur != null) {
            foreach (Control c in Cur.Children) target = c;
        }
        if (target != null) m.ShowAt(target, true);
        else if (MainWindow != null) m.ShowAt(MainWindow);
        else throw new VexAxErr("UI Error: A context menu needs an open window.");
    }

    public static ProgressBar NewProgress(bool marquee) {
        ProgressBar p = new ProgressBar();
        p.Width = 200;
        p.Height = 23;
        p.Minimum = 0;
        p.Maximum = 100;
        if (marquee) p.IsIndeterminate = true;
        return p;
    }

    public static ComboBox NewDropdown() {
        ComboBox c = new ComboBox();
        c.Width = 200;
        c.ItemsSource = new List<object>();
        return c;
    }

    public static ListBox NewListbox() {
        ListBox l = new ListBox();
        l.Width = 200;
        l.Height = 120;
        l.ItemsSource = new List<object>();
        return l;
    }

    public static Image NewImage(object source) {
        Image img = new Image();
        img.Width = 200;
        img.Height = 150;
        string p = Display(source);
        if (p != "") LoadImage(img, p);
        return img;
    }

    public static void LoadImage(Image img, string path) {
        try {
            img.Source = new Bitmap(path);
        } catch (Exception) {
            throw new VexAxErr("UI Error: Could not load image '" + path + "'.");
        }
    }

    public static void DropAdd(object o, object val) {
        string s = Display(val);
        if (o is ComboBox) { ComboBoxItems((ComboBox)o).Add(s); return; }
        if (o is ListBox) { ListBoxItems((ListBox)o).Add(s); return; }
        throw new VexAxErr("UI Error: Cannot add items here.");
    }

    private static IList ComboBoxItems(ComboBox c) {
        IList list = c.ItemsSource as IList;
        if (list == null) { list = new List<object>(); c.ItemsSource = list; }
        return list;
    }

    private static IList ListBoxItems(ListBox l) {
        IList list = l.ItemsSource as IList;
        if (list == null) { list = new List<object>(); l.ItemsSource = list; }
        return list;
    }

    // `window.show` presents the window (mirrors the WinForms backend,
    // where show is the app-run trigger). (See ShowWin above.)

    public static void SetProp(object o, string prop, object val) {
        if (o == null) throw new VexAxErr("UI Error: This element has not been created yet.");
        if (o is Window) {
            Window f = (Window)o;
            if (prop == "width") { f.Width = AsSize(val, prop); return; }
            if (prop == "height") { f.Height = AsSize(val, prop); return; }
            if (prop == "title" || prop == "text") { f.Title = Display(val); return; }
            if (prop == "opacity") { f.Opacity = AsOpacity(val); return; }
            if (prop == "x") { f.Position = new PixelPoint((int)AsDouble(val), f.Position.Y); return; }
            if (prop == "y") { f.Position = new PixelPoint(f.Position.X, (int)AsDouble(val)); return; }
            if (prop == "min_width") { f.MinWidth = AsSize(val, prop); return; }
            if (prop == "max_width") { f.MaxWidth = AsSize(val, prop); return; }
            if (prop == "min_height") { f.MinHeight = AsSize(val, prop); return; }
            if (prop == "max_height") { f.MaxHeight = AsSize(val, prop); return; }
            if (prop == "resizable") { f.CanResize = AsBool(val); return; }
            if (prop == "fullscreen") {
                f.WindowState = AsBool(val) ? WindowState.FullScreen : WindowState.Normal;
                return;
            }
            if (prop == "background") {
                Canvas root = RootOf(f);
                root.Background = ParseBrush(val);
                return;
            }
            if (prop == "text_color") {
                Canvas root = RootOf(f);
                IBrush b = ParseBrush(val);
                foreach (Control child in root.Children) {
                    try { SetBrushProp(child, "text_color", val); } catch (VexAxErr) { }
                }
                return;
            }
            throw new VexAxErr("UI Error: Cannot set '" + prop + "' on a window.");
        }
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Cannot set '" + prop + "' here.");
        if (prop == "x") { Canvas.SetLeft(c, AsDouble(val)); return; }
        if (prop == "y") { Canvas.SetTop(c, AsDouble(val)); return; }
        if (prop == "width") { c.Width = AsSize(val, prop); return; }
        if (prop == "height") { c.Height = AsSize(val, prop); return; }
        if (prop == "title" || prop == "text") {
            if (c is Button) { SetButtonText((Button)c, Display(val)); return; }
            if (c is Label) { ((Label)c).Content = Display(val); return; }
            if (c is TextBox) { ((TextBox)c).Text = Display(val); return; }
            if (c is CheckBox) { ((CheckBox)c).Content = Display(val); return; }
            if (c is ToggleSwitch) { ((ToggleSwitch)c).Content = Display(val); return; }
            if (c is RadioButton) { ((RadioButton)c).Content = Display(val); return; }
            Label slab;
            if (StatusLabels.TryGetValue(c, out slab)) { slab.Content = Display(val); return; }
            throw new VexAxErr("UI Error: Cannot set text here.");
        }
        // Vexel 3.0 Praxis: multiple selection on lists.
        if (prop == "multiple") {
            if (c is ListBox) {
                ((ListBox)c).SelectionMode = AsBool(val) ? SelectionMode.Multiple : SelectionMode.Single;
                return;
            }
            throw new VexAxErr("UI Error: Only lists take multiple selection.");
        }
        // ---------- phase 2 props ----------
        if (prop == "checked") {
            if (c is CheckBox) { ((CheckBox)c).IsChecked = AsBool(val); return; }
            if (c is ToggleSwitch) { ((ToggleSwitch)c).IsChecked = AsBool(val); return; }
            if (c is RadioButton) { ((RadioButton)c).IsChecked = AsBool(val); return; }
            throw new VexAxErr("UI Error: Cannot set checked here.");
        }
        // Vexel 3.0 Praxis: radio groups (same name acts as one).
        if (prop == "group") {
            if (c is RadioButton) { ((RadioButton)c).GroupName = Display(val); return; }
            throw new VexAxErr("UI Error: Only radio buttons take groups.");
        }
        // Vexel 3.0 Praxis: tooltips on any control.
        if (prop == "tooltip") {
            ToolTip.SetTip(c, Display(val));
            return;
        }
        // Vexel 3.0 Praxis: vector icons on buttons (see SetIcon).
        if (prop == "icon") {
            if (c is Button || c is MenuItem) { SetIcon(c, Display(val)); return; }
            throw new VexAxErr("UI Error: Only buttons and menu items take icons.");
        }
        if (prop == "value") {
            if (c is Slider) { ((Slider)c).Value = AsDouble(val); return; }
            if (c is ProgressBar) { ((ProgressBar)c).Value = AsDouble(val); return; }
            if (c is NumericUpDown) { ((NumericUpDown)c).Value = (decimal)AsDouble(val); return; }
            throw new VexAxErr("UI Error: Cannot set value here.");
        }
        if (prop == "minimum" || prop == "maximum") {
            double d = AsDouble(val);
            bool isMin = prop == "minimum";
            if (c is NumericUpDown) {
                NumericUpDown n = (NumericUpDown)c;
                if (isMin) n.Minimum = (decimal)d; else n.Maximum = (decimal)d;
                return;
            }
        }
        if (prop == "step") {
            if (c is NumericUpDown) { ((NumericUpDown)c).Increment = (decimal)Math.Max(0.01, AsDouble(val)); return; }
        }
        if (prop == "minimum" || prop == "maximum") {
            double d = AsDouble(val);
            bool isMin = prop == "minimum";
            if (c is Slider) {
                Slider s = (Slider)c;
                if (isMin) s.Minimum = d; else s.Maximum = d;
                return;
            }
            if (c is ProgressBar) {
                ProgressBar p = (ProgressBar)c;
                if (isMin) p.Minimum = d; else p.Maximum = d;
                return;
            }
            throw new VexAxErr("UI Error: Cannot set range here.");
        }
        if (prop == "step") {
            if (c is Slider) { ((Slider)c).TickFrequency = Math.Max(1.0, AsDouble(val)); return; }
            throw new VexAxErr("UI Error: Cannot set step here.");
        }
        if (prop == "selected_index") {
            long i = AsInt(val);
            if (c is ComboBox) { ((ComboBox)c).SelectedIndex = (int)i; return; }
            if (c is ListBox) { ((ListBox)c).SelectedIndex = (int)i; return; }
            throw new VexAxErr("UI Error: Cannot set selected_index here.");
        }
        if (prop == "placeholder") {
            if (c is TextBox) { ((TextBox)c).Watermark = Display(val); return; }
            throw new VexAxErr("UI Error: Cannot set placeholder here.");
        }
        if (prop == "password") {
            if (c is TextBox) { ((TextBox)c).PasswordChar = AsBool(val) ? '●' : default(char); return; }
            throw new VexAxErr("UI Error: Cannot set password here.");
        }
        if (prop == "source") {
            if (c is Image) { LoadImage((Image)c, Display(val)); return; }
            throw new VexAxErr("UI Error: Cannot set source here.");
        }
        if (prop == "visible") { c.IsVisible = AsBool(val); return; }
        if (prop == "enabled") { c.IsEnabled = AsBool(val); return; }
        if (prop == "font_size") {
            double s = AsDouble(val);
            if (s <= 0) throw new VexAxErr("Font size must be positive.");
            // Avalonia font props live on TextBlock (inherited); SetValue
            // propagates them into templated controls (Button, Label, ...).
            c.SetValue(TextBlock.FontSizeProperty, s);
            return;
        }
        if (prop == "bold") { c.SetValue(TextBlock.FontWeightProperty, AsBool(val) ? FontWeight.Bold : FontWeight.Normal); return; }
        if (prop == "italic") { c.SetValue(TextBlock.FontStyleProperty, AsBool(val) ? FontStyle.Italic : FontStyle.Normal); return; }
        // Vexel 2.2 phase 6: real per-control opacity (Avalonia renders it).
        if (prop == "opacity") { c.Opacity = AsOpacity(val); return; }
        // ---------- Vexel 2.2 parity: styling + remaining props ----------
        if (prop == "background" || prop == "text_color") { SetBrushProp(c, prop, val); return; }
        if (prop == "border" || prop == "border_width" || prop == "border_radius") {
            if (!(c is TemplatedControl)) throw new VexAxErr("UI Error: Cannot set '" + prop + "' on this element.");
            TemplatedControl tc = (TemplatedControl)c;
            if (prop == "border") {
                tc.BorderBrush = AsBool(val) ? (IBrush)ParseBrush("black") : null;
            } else if (prop == "border_width") {
                double bw = AsDouble(val);
                tc.BorderThickness = new Thickness(bw);
            } else {
                double br = AsDouble(val);
                tc.CornerRadius = new CornerRadius(br);
            }
            return;
        }
        if (prop == "padding") {
            if (c is TemplatedControl) { ((TemplatedControl)c).Padding = new Thickness(AsDouble(val)); return; }
            if (c is TextBlock) { ((TextBlock)c).Padding = new Thickness(AsDouble(val)); return; }
            throw new VexAxErr("UI Error: Cannot set padding here.");
        }
        if (prop == "margin") { c.Margin = new Thickness(AsDouble(val)); return; }
        if (prop == "alignment") {
            string a = Display(val).ToLowerInvariant();
            TextAlignment ta = a == "center" ? TextAlignment.Center : a == "right" ? TextAlignment.Right : TextAlignment.Left;
            c.SetValue(TextBlock.TextAlignmentProperty, ta);
            return;
        }
        if (prop == "font") {
            c.SetValue(TextBlock.FontFamilyProperty, new FontFamily(Display(val)));
            return;
        }
        // Vexel 2.2.1: responsive anchoring (see SetAnchor).
        if (prop == "anchor") { SetAnchor(c, val); return; }
        if (prop == "spacing") {
            if (c is StackPanel) { ((StackPanel)c).Spacing = AsDouble(val); return; }
            throw new VexAxErr("UI Error: Only stack containers take spacing.");
        }
        if (prop == "id") { RegisterId(c, Display(val)); return; }
        // Vexel 3.0 Praxis: accessibility description for assistive tech.
        if (prop == "description") {
            try { Avalonia.Automation.AutomationProperties.SetHelpText(c, Display(val)); } catch (Exception) { }
            Praxis.SetA11y(c, null, null, Display(val));
            return;
        }
        // Vexel 2.9: keyboard shortcuts (buttons, toolbar buttons, menu items).
        if (prop == "shortcut") {
            if (c is Button || c is MenuItem) { SetShortcut(c, Display(val)); return; }
            throw new VexAxErr("UI Error: Only buttons and menu items take shortcuts.");
        }
        if (prop == "selected") {
            VexTable vt;
            if (Tables.TryGetValue(c, out vt)) {
                int want = (int)AsDouble(val);
                TableSelectInner(c, want, true);
                return;
            }
        }
        if (prop == "selected") {
            string want = Display(val);
            if (c is ComboBox) {
                IList items = ComboBoxItems((ComboBox)c);
                for (int i = 0; i < items.Count; i++) {
                    if (Display(items[i]) == want) { ((ComboBox)c).SelectedIndex = i; return; }
                }
                throw new VexAxErr("UI Error: The dropdown has no item '" + want + "'.");
            }
            if (c is ListBox) {
                IList items = ListBoxItems((ListBox)c);
                for (int i = 0; i < items.Count; i++) {
                    if (Display(items[i]) == want) { ((ListBox)c).SelectedIndex = i; return; }
                }
                throw new VexAxErr("UI Error: The list has no item '" + want + "'.");
            }
            if (c is TabControl) {
                TabControl tabs = (TabControl)c;
                foreach (TabItem pg in tabs.Items) {
                    if (Display(pg.Header) == want) { tabs.SelectedItem = pg; return; }
                }
                throw new VexAxErr("UI Error: The tab bar has no tab '" + want + "'.");
            }
            if (c is TreeView) {
                TreeView tv = (TreeView)c;
                foreach (TreeViewItem n in tv.Items) {
                    if (Display(n.Header) == want) { tv.SelectedItem = n; return; }
                }
                throw new VexAxErr("UI Error: The tree has no node '" + want + "'.");
            }
            throw new VexAxErr("UI Error: Cannot set selected here.");
        }
        throw new VexAxErr("UI Error: Cannot set '" + prop + "' here.");
    }

    public static double AsOpacity(object v) {
        double d = AsDouble(v);
        if (d < 0 || d > 1) throw new VexAxErr("UI Error: Opacity must be between 0 and 1.");
        return d;
    }

    // Non-blocking animation on the UI thread (60fps). Easing comes
    // from the Praxis engine (linear default, smooth on request).
    public static void Animate(object o, object toX, object toY, object toW, object toH, object toOp, double seconds) {
        AnimateEase(o, toX, toY, toW, toH, toOp, seconds, "linear");
    }

    public static void AnimateEase(object o, object toX, object toY, object toW, object toH, object toOp, double seconds, object easeObj) {
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Cannot animate this element.");
        if (seconds <= 0) throw new VexAxErr("UI Error: Duration must be positive.");
        string ease = Display(easeObj);
        if (ease != "linear" && ease != "smooth") throw new VexAxErr("UI Error: Unknown easing '" + ease + "'. Use linear or smooth.");
        double? tx = toX == null ? (double?)null : AsDouble(toX);
        double? ty = toY == null ? (double?)null : AsDouble(toY);
        double? tw = toW == null ? (double?)null : AsSize(toW, "width");
        double? th = toH == null ? (double?)null : AsSize(toH, "height");
        double? top = toOp == null ? (double?)null : AsOpacity(toOp);
        double sx = OrZero(Canvas.GetLeft(c));
        double sy = OrZero(Canvas.GetTop(c));
        double sw = double.IsNaN(c.Width) ? c.Bounds.Width : c.Width;
        double sh = double.IsNaN(c.Height) ? c.Bounds.Height : c.Height;
        double so = c.Opacity;
        Avalonia.Threading.DispatcherTimer t = new Avalonia.Threading.DispatcherTimer();
        t.Interval = TimeSpan.FromMilliseconds(16);
        int steps = Math.Max(1, (int)(seconds * 60.0));
        int n = 0;
        t.Tick += delegate {
            n++;
            double raw = (double)n / (double)steps;
            if (raw > 1.0) raw = 1.0;
            double k = Praxis.EaseByName(ease, raw);
            if (tx.HasValue) Canvas.SetLeft(c, sx + (tx.Value - sx) * k);
            if (ty.HasValue) Canvas.SetTop(c, sy + (ty.Value - sy) * k);
            if (tw.HasValue) c.Width = sw + (tw.Value - sw) * k;
            if (th.HasValue) c.Height = sh + (th.Value - sh) * k;
            if (top.HasValue) c.Opacity = so + (top.Value - so) * k;
            if (raw >= 1.0) { try { t.Stop(); } catch (Exception) { } }
        };
        t.Start();
    }

    public static dynamic GetProp(object o, string prop) {
        if (o == null) throw new VexAxErr("UI Error: This element has not been created yet.");
        if (o is Window) {
            Window f = (Window)o;
            if (prop == "width") return (long)f.Width;
            if (prop == "height") return (long)f.Height;
            if (prop == "title" || prop == "text") return f.Title == null ? "" : f.Title;
            if (prop == "opacity") return f.Opacity;
            if (prop == "x") return (long)f.Position.X;
            if (prop == "y") return (long)f.Position.Y;
            if (prop == "min_width") return (long)f.MinWidth;
            if (prop == "max_width") return (long)f.MaxWidth;
            if (prop == "min_height") return (long)f.MinHeight;
            if (prop == "max_height") return (long)f.MaxHeight;
            throw new VexAxErr("UI Error: Cannot read '" + prop + "' here.");
        }
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Cannot read '" + prop + "' here.");
        if (prop == "x") return (long)OrZero(Canvas.GetLeft(c));
        if (prop == "y") return (long)OrZero(Canvas.GetTop(c));
        if (prop == "width") return (long)OrZero(c.Width);
        if (prop == "height") return (long)OrZero(c.Height);
        // Vexel 2.9: table selection reads before the generic text path.
        if (prop == "selected" || prop == "selected_index") {
            VexTable vt2;
            if (Tables.TryGetValue(c, out vt2)) return (long)vt2.Selected;
        }
        if (prop == "title" || prop == "text" || prop == "selected") return GetText(o);
        if (prop == "checked") {
            if (c is CheckBox) return ((CheckBox)c).IsChecked == true;
            if (c is ToggleSwitch) return ((ToggleSwitch)c).IsChecked == true;
            if (c is RadioButton) return ((RadioButton)c).IsChecked == true;
            throw new VexAxErr("UI Error: Cannot read checked here.");
        }
        if (prop == "value") {
            if (c is Slider) return ((Slider)c).Value;
            if (c is ProgressBar) return ((ProgressBar)c).Value;
            if (c is NumericUpDown) return (double)(((NumericUpDown)c).Value ?? 0);
            throw new VexAxErr("UI Error: Cannot read value here.");
        }
        // Vexel 3.0 Praxis: numeric bounds, radio groups, icon names,
        // multi-selection readouts.
        if (prop == "minimum") {
            if (c is NumericUpDown) return (double)((NumericUpDown)c).Minimum;
        }
        if (prop == "maximum") {
            if (c is NumericUpDown) return (double)((NumericUpDown)c).Maximum;
        }
        if (prop == "step") {
            if (c is NumericUpDown) return (double)((NumericUpDown)c).Increment;
        }
        if (prop == "group") {
            if (c is RadioButton) return ((RadioButton)c).GroupName == null ? "" : ((RadioButton)c).GroupName;
        }
        if (prop == "icon") {
            string iname;
            if (IconOf.TryGetValue(c, out iname)) return iname;
            return "";
        }
        if (prop == "selected_items") {
            if (c is ListBox) {
                List<dynamic> items = new List<dynamic>();
                foreach (object it in ((ListBox)c).SelectedItems) items.Add(Display(it));
                return items;
            }
        }
        if (prop == "selected_index") {
            if (c is ComboBox) return (long)((ComboBox)c).SelectedIndex;
            if (c is ListBox) return (long)((ListBox)c).SelectedIndex;
            throw new VexAxErr("UI Error: Cannot read selected_index here.");
        }

        if (prop == "placeholder") {
            if (c is TextBox) return ((TextBox)c).Watermark == null ? "" : ((TextBox)c).Watermark;
            throw new VexAxErr("UI Error: Cannot read placeholder here.");
        }
        // Vexel 3.0 Praxis: live focus state and accessibility text.
        if (prop == "focused") return c.IsKeyboardFocusWithin;
        if (prop == "description") {
            try {
                object d = Avalonia.Automation.AutomationProperties.GetHelpText(c);
                return d == null ? "" : d.ToString();
            } catch (Exception) { return ""; }
        }
        if (prop == "tooltip") {
            try {
                object tip = ToolTip.GetTip(c);
                return tip == null ? "" : tip.ToString();
            } catch (Exception) { return ""; }
        }
        if (prop == "opacity") return c.Opacity;
        if (prop == "id") return IdOf(c);
        throw new VexAxErr("UI Error: Cannot read '" + prop + "' here.");
    }

    private static double OrZero(double d) { return double.IsNaN(d) ? 0.0 : d; }

    // Vexel 3.0 Praxis: buttons with icons keep their label aside so
    // title/text reads and writes keep working through SetButtonText.
    private static Dictionary<object, TextBlock> IconLabels = new Dictionary<object, TextBlock>();
    private static Dictionary<object, string> IconOf = new Dictionary<object, string>();

    public static void SetButtonText(Button b, string text) {
        TextBlock lab;
        if (IconLabels.TryGetValue(b, out lab)) { lab.Text = text; return; }
        b.Content = text;
    }

    private static Avalonia.Controls.Shapes.Path IconGlyph(string path, Control host, double size) {
        Avalonia.Controls.Shapes.Path glyph = new Avalonia.Controls.Shapes.Path();
        glyph.Data = StreamGeometry.Parse(path);
        glyph.Width = size; glyph.Height = size;
        glyph.Stretch = Stretch.Uniform;
        glyph.VerticalAlignment = VerticalAlignment.Center;
        // Follow the host's themed foreground so icons read on any theme.
        try { glyph.Bind(Avalonia.Controls.Shapes.Shape.FillProperty, new Avalonia.Data.Binding("Foreground") { Source = host }); } catch (Exception) { }
        return glyph;
    }

    public static void SetIcon(object o, string name) {
        string path = Praxis.IconPath(name);
        if (path == null) throw new VexAxErr("UI Error: Unknown icon '" + name + "'. Available: " + Praxis.IconNames() + ".");
        IconOf[o] = name.Trim().ToLowerInvariant();
        if (o is Button) {
            Button b = (Button)o;
            string label = "";
            TextBlock old;
            if (IconLabels.TryGetValue(b, out old)) label = old.Text == null ? "" : old.Text;
            else if (b.Content is string) label = (string)b.Content;
            else if (b.Content != null) label = b.Content.ToString();
            TextBlock lab = new TextBlock();
            lab.Text = label;
            lab.VerticalAlignment = VerticalAlignment.Center;
            lab.Margin = new Thickness(6, 0, 0, 0);
            StackPanel row = new StackPanel();
            row.Orientation = Orientation.Horizontal;
            row.Children.Add(IconGlyph(path, b, 16));
            row.Children.Add(lab);
            b.Content = row;
            IconLabels[b] = lab;
            return;
        }
        if (o is MenuItem) {
            MenuItem mi = (MenuItem)o;
            string label = mi.Header == null ? "" : mi.Header.ToString();
            TextBlock lab = new TextBlock();
            lab.Text = label;
            lab.VerticalAlignment = VerticalAlignment.Center;
            lab.Margin = new Thickness(6, 0, 0, 0);
            StackPanel row = new StackPanel();
            row.Orientation = Orientation.Horizontal;
            row.Children.Add(IconGlyph(path, mi, 14));
            row.Children.Add(lab);
            mi.Header = row;
            return;
        }
        throw new VexAxErr("UI Error: Only buttons and menu items take icons.");
    }

    public static string GetText(object o) {
        if (o is TextBox) return ((TextBox)o).Text == null ? "" : ((TextBox)o).Text;
        if (o is Button) {
            TextBlock lab;
            if (IconLabels.TryGetValue((Button)o, out lab)) return lab.Text == null ? "" : lab.Text;
            return ((Button)o).Content == null ? "" : ((Button)o).Content.ToString();
        }
        if (o is Label) return ((Label)o).Content == null ? "" : ((Label)o).Content.ToString();
        if (o is CheckBox) return ((CheckBox)o).Content == null ? "" : ((CheckBox)o).Content.ToString();
        if (o is ComboBox) {
            ComboBox c = (ComboBox)o;
            return c.SelectedItem == null ? "" : c.SelectedItem.ToString();
        }
        if (o is ListBox) {
            ListBox l = (ListBox)o;
            return l.SelectedItem == null ? "" : l.SelectedItem.ToString();
        }
        if (o is TabControl) {
            TabItem pg = ((TabControl)o).SelectedItem as TabItem;
            return pg == null ? "" : Display(pg.Header);
        }
        if (o is TreeView) {
            TreeViewItem n = ((TreeView)o).SelectedItem as TreeViewItem;
            return n == null ? "" : Display(n.Header);
        }
        if (o is Control) return ((Control)o).Name == null ? "" : ((Control)o).Name;
        return o == null ? "" : o.ToString();
    }

    // Zero-argument methods (button.focus, window.close, ...).
    public static void DoMethod(object o, string method) {
        if (o == null) throw new VexAxErr("UI Error: This element has not been created yet.");
        if (o is MenuFlyout) {
            if (method == "show") { ContextShow(o); return; }
            throw new VexAxErr("UI Error: Unknown action '" + method + "'.");
        }
        if (o is Window) {
            Window f = (Window)o;
            if (method == "close") { f.Close(); return; }
            if (method == "hide") { f.Hide(); return; }
            if (method == "minimize") { f.WindowState = WindowState.Minimized; return; }
            if (method == "maximize") { f.WindowState = WindowState.Maximized; return; }
            if (method == "restore") { f.WindowState = WindowState.Normal; return; }
            if (method == "focus") { f.Focus(); return; }
            throw new VexAxErr("UI Error: Unknown action '" + method + "'.");
        }
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Unknown action '" + method + "'.");
        if (method == "show") { c.IsVisible = true; return; }
        if (method == "hide") { c.IsVisible = false; return; }
        if (method == "focus") { c.Focus(); return; }
        if (method == "center") { CenterIn(c, null); return; }
        if (method == "clear") {
            if (c is TextBox) { ((TextBox)c).Text = ""; return; }
            if (c is ComboBox) { ((ComboBox)c).ItemsSource = new List<object>(); return; }
            if (c is ListBox) { ((ListBox)c).ItemsSource = new List<object>(); return; }
            if (c is TreeView) { ((TreeView)c).Items.Clear(); return; }
            if (c is TabControl) { ((TabControl)c).Items.Clear(); return; }
            VexTable vt;
            if (Tables.TryGetValue(c, out vt)) { TableClear(c); return; }
            throw new VexAxErr("UI Error: Cannot clear this element.");
        }
        throw new VexAxErr("UI Error: Unknown action '" + method + "'.");
    }

    // ---------- events (phase 2) ----------

    // Real hover: fires after the pointer rests ~400ms (WinForms
    // MouseHover semantics), cancelled when the pointer leaves.
    public static void OnHover(Control c, Action<object> handler) {
        if (c == null) throw new VexAxErr("UI Error: Nothing to hover.");
        Avalonia.Threading.DispatcherTimer t = null;
        c.PointerEntered += delegate {
            try { if (t != null) t.Stop(); } catch (Exception) { }
            t = new Avalonia.Threading.DispatcherTimer();
            t.Interval = TimeSpan.FromMilliseconds(400);
            t.Tick += delegate {
                try { t.Stop(); } catch (Exception) { }
                handler(c);
            };
            t.Start();
        };
        c.PointerExited += delegate {
            try { if (t != null) t.Stop(); } catch (Exception) { }
        };
    }

    public static Dictionary<string, object> MakeEvent(object target) {
        Dictionary<string, object> ev = new Dictionary<string, object>();
        ev["target"] = target;
        return ev;
    }

    public static Dictionary<string, object> MakeKeyEvent(string key, object target) {
        Dictionary<string, object> ev = MakeEvent(target);
        ev["key"] = key == null ? "" : key;
        return ev;
    }

    public static dynamic EvGet(object ev, string field) {
        Dictionary<string, object> d = ev as Dictionary<string, object>;
        if (d != null && d.ContainsKey(field)) return d[field];
        throw new VexAxErr("UI Error: This event has no '" + field + "'.");
    }

    public static void FillPointer(Dictionary<string, object> ev, object sender, PointerEventArgs e) {
        try {
            Control c = sender as Control;
            Point p = c != null ? e.GetPosition(c) : new Point(0, 0);
            ev["x"] = (long)p.X;
            ev["y"] = (long)p.Y;
        } catch (Exception) { ev["x"] = 0L; ev["y"] = 0L; }
        string btn = "None";
        try {
            Control c2 = sender as Control;
            var props = e.GetCurrentPoint(c2).Properties;
            if (props.PointerUpdateKind == PointerUpdateKind.LeftButtonPressed
                || props.PointerUpdateKind == PointerUpdateKind.LeftButtonReleased
                || props.IsLeftButtonPressed) btn = "Left";
            else if (props.PointerUpdateKind == PointerUpdateKind.RightButtonPressed
                || props.PointerUpdateKind == PointerUpdateKind.RightButtonReleased
                || props.IsRightButtonPressed) btn = "Right";
            else if (props.PointerUpdateKind == PointerUpdateKind.MiddleButtonPressed
                || props.PointerUpdateKind == PointerUpdateKind.MiddleButtonReleased
                || props.IsMiddleButtonPressed) btn = "Middle";
        } catch (Exception) { }
        ev["button"] = btn;
    }

    public static bool IsTrue(object v) {
        if (v == null) return false;
        if (v is bool) return (bool)v;
        if (v is long) return (long)v != 0;
        if (v is int) return (int)v != 0;
        if (v is double) return (double)v != 0;
        if (v is string) return ((string)v).Length > 0;
        return true;
    }

    public static dynamic ChangeValue(object sender) {
        if (sender is TextBox) return GetText(sender);
        if (sender is CheckBox) return ((CheckBox)sender).IsChecked == true;
        if (sender is ToggleSwitch) return ((ToggleSwitch)sender).IsChecked == true;
        if (sender is RadioButton) return ((RadioButton)sender).IsChecked == true;
        if (sender is NumericUpDown) return (double)(((NumericUpDown)sender).Value ?? 0);
        if (sender is Slider) return ((Slider)sender).Value;
        if (sender is ComboBox) {
            ComboBox c = (ComboBox)sender;
            return c.SelectedItem == null ? "" : c.SelectedItem.ToString();
        }
        if (sender is ListBox) {
            ListBox l = (ListBox)sender;
            return l.SelectedItem == null ? "" : l.SelectedItem.ToString();
        }
        return "";
    }

    // Vexel 2.9: keyboard shortcuts. Specs look like "Ctrl+S",
    // "Ctrl+Shift+O", "Alt+F4" or plain "F5". Firing raises Click on the
    // control so the same handlers run as a mouse click.
    private class VexShortcut {
        public Avalonia.Input.Key Key;
        public Avalonia.Input.KeyModifiers Mods;
        public Control Target;
        public Window Host;
    }
    private static List<VexShortcut> Shortcuts = new List<VexShortcut>();

    public static void SetShortcut(object o, object specObj) {
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Only buttons and menu items take shortcuts.");
        string spec = Display(specObj);
        Avalonia.Input.KeyModifiers mods = Avalonia.Input.KeyModifiers.None;
        string keyPart = spec;
        int plus = spec.LastIndexOf('+');
        string modPart = plus >= 0 ? spec.Substring(0, plus) : "";
        if (plus >= 0) keyPart = spec.Substring(plus + 1);
        foreach (string m in modPart.Split(new char[] { '+' }, System.StringSplitOptions.RemoveEmptyEntries)) {
            string t = m.Trim().ToLowerInvariant();
            if (t == "ctrl" || t == "control") mods |= Avalonia.Input.KeyModifiers.Control;
            else if (t == "shift") mods |= Avalonia.Input.KeyModifiers.Shift;
            else if (t == "alt") mods |= Avalonia.Input.KeyModifiers.Alt;
            else if (t == "meta" || t == "win" || t == "cmd") mods |= Avalonia.Input.KeyModifiers.Meta;
            else throw new VexAxErr("UI Error: Unknown shortcut modifier '" + m.Trim() + "' in '" + spec + "'. Use Ctrl, Shift, Alt or Meta.");
        }
        Avalonia.Input.Key key;
        try {
            key = (Avalonia.Input.Key)System.Enum.Parse(typeof(Avalonia.Input.Key), keyPart.Trim(), true);
        } catch (Exception) {
            throw new VexAxErr("UI Error: Unknown shortcut key '" + keyPart.Trim() + "' in '" + spec + "'.");
        }
        Window host = WindowOfControl(c);
        Shortcuts.Add(new VexShortcut { Key = key, Mods = mods, Target = c, Host = host });
        // Per-window tunneling handler; one subscription per host window.
        if (!ShortcutWindows.Contains(host)) {
            ShortcutWindows.Add(host);
            host.KeyDown += ShortcutFired;
        }
    }

    private static List<Window> ShortcutWindows = new List<Window>();

    private static Window WindowOfControl(Control c) {
        Control cur = c;
        while (cur != null) {
            if (cur is Window w) return w;
            cur = cur.Parent as Control;
            if (cur == null && c.Parent is Window pw) return pw;
        }
        if (MainWindow != null) return MainWindow;
        if (Windows.Count > 0) return Windows[Windows.Count - 1];
        throw new VexAxErr("UI Error: Shortcuts need a window. Add: create a window titled \"...\".");
    }

    private static void ShortcutFired(object sender, Avalonia.Input.KeyEventArgs e) {
        Window host = sender as Window;
        foreach (VexShortcut s in new List<VexShortcut>(Shortcuts)) {
            if (s.Host != host) continue;
            if (s.Key == e.Key && s.Mods == (e.KeyModifiers & (Avalonia.Input.KeyModifiers.Control | Avalonia.Input.KeyModifiers.Shift | Avalonia.Input.KeyModifiers.Alt | Avalonia.Input.KeyModifiers.Meta))) {
                try {
                    if (s.Target is Button) ((Button)s.Target).RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
                    else if (s.Target is MenuItem) ((MenuItem)s.Target).RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(MenuItem.ClickEvent));
                } catch (Exception) { }
                e.Handled = true;
                Snap();
                return;
            }
        }
    }

    // ---------- timers with handles (phase 4) ----------

    // DispatcherTimer ticks on the UI thread: timed bodies touch
    // controls as safely as click handlers do.
    public class VexTimer {
        private Avalonia.Threading.DispatcherTimer t;
        public string State = "running"; // running | completed | cancelled | failed
        public string Error = "";
        internal VexTimer(Avalonia.Threading.DispatcherTimer timer) { t = timer; }
        public void Cancel() {
            if (State == "cancelled" || State == "completed") return;
            try { t.Stop(); } catch (Exception) { }
            State = "cancelled";
            UntrackTimer(this);
            Snap();
        }
        internal void Finish(bool ok, string err) {
            if (State == "cancelled" || State == "completed") return;
            try { t.Stop(); } catch (Exception) { }
            if (ok) { State = "completed"; } else { State = "failed"; Error = err == null ? "" : err; }
            UntrackTimer(this);
            Snap();
        }
        public override string ToString() { return "timer (" + State + ")"; }
    }

    private static List<VexTimer> ActiveTimers = new List<VexTimer>();

    private static void TrackTimer(VexTimer h) { ActiveTimers.Add(h); }

    private static void UntrackTimer(VexTimer h) { ActiveTimers.Remove(h); }

    public static dynamic TimerStart(double seconds, bool once, Action body) {
        if (seconds <= 0) throw new VexAxErr("Timer interval must be positive.");
        Avalonia.Threading.DispatcherTimer t = new Avalonia.Threading.DispatcherTimer();
        t.Interval = TimeSpan.FromSeconds(Math.Max(0.001, seconds));
        VexTimer h = new VexTimer(t);
        TrackTimer(h);
        t.Tick += delegate {
            try {
                body();
            } catch (Exception ex) {
                VexAxErr ve = ex as VexAxErr;
                h.Finish(false, ve != null ? ve.Message : "Timer failed: " + ex.Message);
                Snap();
                return;
            }
            if (once) h.Finish(true, null);
            Snap();
        };
        t.Start();
        return h;
    }

    public static void TimerCancel(object o) {
        VexTimer h = o as VexTimer;
        if (h == null) throw new VexAxErr("UI Error: timer.cancel needs a timer (from timer = every ... or timer = after ...).");
        h.Cancel();
    }

    internal static void StopAllTimers() {
        VexTimer[] live = ActiveTimers.ToArray();
        foreach (VexTimer h in live) {
            try { h.Cancel(); } catch (Exception) { }
        }
    }

    // ---------- background tasks + HTTP (phase 7) ----------
    // Task bodies run on worker threads (LongRunning). The ONLY safe
    // handoff to the UI thread is polling handle.state/result/error
    // from a timer: locked fields, no shared mutation, no marshaling.
    // UI touches from a worker fail the task with guidance instead.

    public class VexAxCancel : Exception { }

    [ThreadStatic]
    private static CancellationToken TaskTokenNow;

    internal static void ThrowIfCancelled() {
        CancellationToken tok = TaskTokenNow;
        if (tok.CanBeCanceled && tok.IsCancellationRequested) throw new VexAxCancel();
    }

    // wait honors cancellation when running inside a task (chunked
    // sleep); elsewhere it is a plain blocking sleep, as before.
    public static void WaitSeconds(double seconds) {
        if (seconds < 0) throw new VexAxErr("Wait needs a non-negative number of seconds.");
        CancellationToken tok = TaskTokenNow;
        if (!tok.CanBeCanceled) {
            System.Threading.Thread.Sleep((int)(seconds * 1000.0));
            return;
        }
        int ms = (int)(seconds * 1000.0);
        int waited = 0;
        while (waited < ms) {
            if (tok.IsCancellationRequested) throw new VexAxCancel();
            int slice = Math.Min(100, ms - waited);
            System.Threading.Thread.Sleep(slice);
            waited += slice;
        }
        if (tok.IsCancellationRequested) throw new VexAxCancel();
    }

    public class VexTask {
        private readonly object gate = new object();
        public string State = "pending"; // pending | running | completed | failed | cancelled
        public string Error = "";
        private Func<dynamic> resultGetter;
        private CancellationTokenSource cts = new CancellationTokenSource();
        internal VexTask(Func<dynamic> getter) { resultGetter = getter; }
        internal CancellationToken Token { get { return cts.Token; } }
        internal void SetRunning() { lock (gate) { if (State == "pending") State = "running"; } Snap(); }
        internal void SetDone(string s, string err) {
            lock (gate) {
                if (State == "cancelled") return; // cancel won the race; keep it
                State = s;
                Error = err == null ? "" : err;
            }
            Snap();
        }
        public void Cancel() {
            try { cts.Cancel(); } catch (Exception) { }
            lock (gate) { if (State == "pending") State = "cancelled"; }
            Snap();
        }
        public dynamic GetResult() {
            lock (gate) {
                try { return resultGetter(); }
                catch (Exception) { return null; }
            }
        }
        public override string ToString() { return "task (" + State + ")"; }
    }

    private static List<VexTask> ActiveTasks = new List<VexTask>();

    private static void TrackTask(VexTask h) { ActiveTasks.Add(h); }

    public static dynamic TaskRun(Action body, Func<dynamic> resultGetter) {
        VexTask h = new VexTask(resultGetter);
        TrackTask(h);
        System.Threading.Tasks.Task.Factory.StartNew(delegate {
            if (h.Token.IsCancellationRequested) { h.SetDone("cancelled", null); return; }
            h.SetRunning();
            TaskTokenNow = h.Token;
            try {
                body();
                h.SetDone("completed", null);
            } catch (VexAxCancel) {
                h.SetDone("cancelled", null);
            } catch (Exception ex) {
                VexAxErr ve = ex as VexAxErr;
                string msg = ve != null ? ve.Message : "Task failed: " + ex.Message;
                if (msg.ToLowerInvariant().Contains("thread")) {
                    msg += " (A task cannot touch UI. Poll handle.state from a timer instead.)";
                }
                h.SetDone("failed", msg);
            } finally {
                TaskTokenNow = default(CancellationToken);
            }
        }, CancellationToken.None, System.Threading.Tasks.TaskCreationOptions.LongRunning, System.Threading.Tasks.TaskScheduler.Default);
        return h;
    }

    public static void TaskCancel(object o) {
        VexTask h = o as VexTask;
        if (h == null) throw new VexAxErr("UI Error: task.cancel needs a task (from task name { ... }).");
        h.Cancel();
    }

    public static string TaskState(object o) {
        VexTask h = o as VexTask;
        if (h == null) throw new VexAxErr("UI Error: task.state needs a task (from task name { ... }).");
        return h.State;
    }

    public static dynamic TaskResult(object o) {
        VexTask h = o as VexTask;
        if (h == null) throw new VexAxErr("UI Error: task.result needs a task (from task name { ... }).");
        return h.GetResult();
    }

    public static dynamic TaskError(object o) {
        VexTask h = o as VexTask;
        if (h == null) throw new VexAxErr("UI Error: task.error needs a task (from task name { ... }).");
        Dictionary<string, object> e = new Dictionary<string, object>();
        e["message"] = h.Error;
        e["type"] = h.State == "failed" ? "RuntimeError" : "";
        return e;
    }

    internal static void CancelAllTasks() {
        VexTask[] live = ActiveTasks.ToArray();
        foreach (VexTask h in live) {
            try { h.Cancel(); } catch (Exception) { }
        }
    }

    // ---------- processes (2.2.1) ----------
    // Launched async: output/error stream in while the app stays live.
    // Poll `running`, then read `exit`/`stdout`/`stderr` (locked).
    public class VexProcess {
        private readonly object gate = new object();
        private System.Diagnostics.Process p;
        private System.Text.StringBuilder outBuf = new System.Text.StringBuilder();
        private System.Text.StringBuilder errBuf = new System.Text.StringBuilder();
        private bool exited = false;
        private bool killed = false;
        private int code = -1;
        internal VexProcess(System.Diagnostics.Process proc) {
            p = proc;
            p.EnableRaisingEvents = true;
            p.OutputDataReceived += delegate(object _s, System.Diagnostics.DataReceivedEventArgs e) {
                if (e.Data == null) return;
                lock (gate) { outBuf.AppendLine(e.Data); }
            };
            p.ErrorDataReceived += delegate(object _s, System.Diagnostics.DataReceivedEventArgs e) {
                if (e.Data == null) return;
                lock (gate) { errBuf.AppendLine(e.Data); }
            };
            p.Exited += delegate {
                lock (gate) {
                    exited = true;
                    try { code = p.ExitCode; } catch (Exception) { code = -1; }
                }
            };
        }
        internal void Begin() {
            p.Start();
            try { p.BeginOutputReadLine(); } catch (Exception) { }
            try { p.BeginErrorReadLine(); } catch (Exception) { }
        }
        public bool Running { get { lock (gate) { return !exited && !killed; } } }
        public long Exit { get { lock (gate) { return exited ? (long)code : -1L; } } }
        public string Out { get { lock (gate) { return outBuf.ToString(); } } }
        public string Err { get { lock (gate) { return errBuf.ToString(); } } }
        public void Kill() {
            lock (gate) { if (exited || killed) return; killed = true; }
            try { p.Kill(); } catch (Exception) { }
        }
        public override string ToString() { return "process"; }
    }

    public static dynamic ProcStart(object exeObj, params object[] argObjs) {
        string exe = Display(exeObj);
        if (exe == "") throw new VexAxErr("Process needs a program, e.g. process \"cmd.exe\", \"/c\", \"echo hi\".");
        System.Diagnostics.ProcessStartInfo si = new System.Diagnostics.ProcessStartInfo();
        si.FileName = exe;
        si.UseShellExecute = false;
        si.RedirectStandardOutput = true;
        si.RedirectStandardError = true;
        si.CreateNoWindow = true;
        foreach (object a in argObjs) si.ArgumentList.Add(Display(a));
        System.Diagnostics.Process proc = new System.Diagnostics.Process();
        proc.StartInfo = si;
        VexProcess h = new VexProcess(proc);
        try {
            h.Begin();
        } catch (Exception ex) {
            try { proc.Dispose(); } catch (Exception) { }
            throw new VexAxErr("Could not start process '" + exe + "' (" + ex.Message + ").");
        }
        return h;
    }

    public static void ProcKill(object o) {
        VexProcess h = o as VexProcess;
        if (h == null) throw new VexAxErr("UI Error: process.kill needs a process (from process \"exe\", ...).");
        h.Kill();
    }

    private static readonly System.Net.Http.HttpClient Http =
        new System.Net.Http.HttpClient() { Timeout = System.Threading.Timeout.InfiniteTimeSpan };

    public static double HttpDefaultTimeoutSecs = 30.0;

    // Blocking call: safe on workers AND the UI thread (HttpClient
    // continuations don't capture the UI context). Errors are VexAxErr.
    public static dynamic HttpGet(object urlObj) {
        return HttpRequest("GET", urlObj, null, null);
    }

    public static void HttpSetTimeout(object secsObj) {
        double secs = AsDouble(secsObj);
        if (!(secs > 0)) throw new VexAxErr("http timeout needs a positive number of seconds.");
        HttpDefaultTimeoutSecs = secs;
    }

    private static string HttpBodyText(object body, out string contentType) {
        contentType = null;
        if (body == null) return "";
        if (body is string s) return s;
        if (body is VexObj || body is Dictionary<string, object> || (body is System.Collections.IList && !(body is string))) {
            contentType = "application/json";
            return System.Text.Json.JsonSerializer.Serialize(ToJsonVal(body));
        }
        return Display(body);
    }

    private static void HttpAddHeaders(System.Net.Http.HttpRequestMessage req, object headers) {
        if (headers == null) return;
        if (headers is Dictionary<string, object> dict) {
            foreach (var kv in dict) {
                try { req.Headers.TryAddWithoutValidation(kv.Key, Display(kv.Value)); } catch (Exception) { }
            }
            return;
        }
        if (headers is VexObj vo) {
            foreach (var kv in vo.Fields) {
                try { req.Headers.TryAddWithoutValidation(kv.Key, Display(kv.Value)); } catch (Exception) { }
            }
            return;
        }
        throw new VexAxErr("HTTP headers must be an object.");
    }

    // Vexel 2.9: full-method requests sharing the GET core behavior.
    public static dynamic HttpRequest(string method, object urlObj, object body, object headers) {
        string url = Display(urlObj);
        Uri uri;
        try {
            uri = new Uri(url);
            if (uri.Scheme != "http" && uri.Scheme != "https") throw new Exception("only http/https");
        } catch (Exception) {
            throw new VexAxErr("HTTP Error: Invalid URL '" + url + "'.");
        }
        CancellationTokenSource timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(HttpDefaultTimeoutSecs));
        CancellationTokenSource linked;
        CancellationToken taskTok = TaskTokenNow;
        if (taskTok.CanBeCanceled) linked = CancellationTokenSource.CreateLinkedTokenSource(timeoutCts.Token, taskTok);
        else linked = timeoutCts;
        try {
            System.Net.Http.HttpResponseMessage resp;
            try {
                if (method == "GET" || method == "DELETE") {
                    using (System.Net.Http.HttpRequestMessage req = new System.Net.Http.HttpRequestMessage(new System.Net.Http.HttpMethod(method), uri)) {
                        HttpAddHeaders(req, headers);
                        resp = Http.SendAsync(req, linked.Token).GetAwaiter().GetResult();
                    }
                } else {
                    string ctype;
                    string text = HttpBodyText(body, out ctype);
                    using (System.Net.Http.StringContent content = new System.Net.Http.StringContent(text ?? "")) {
                        if (ctype != null) content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(ctype);
                        using (System.Net.Http.HttpRequestMessage req = new System.Net.Http.HttpRequestMessage(new System.Net.Http.HttpMethod(method), uri)) {
                            req.Content = content;
                            HttpAddHeaders(req, headers);
                            resp = Http.SendAsync(req, linked.Token).GetAwaiter().GetResult();
                        }
                    }
                }
            } catch (OperationCanceledException) {
                if (taskTok.CanBeCanceled && taskTok.IsCancellationRequested) throw new VexAxCancel();
                throw new VexAxErr("HTTP Error: Request to '" + url + "' timed out.");
            } catch (Exception ex) {
                throw new VexAxErr("HTTP Error: Could not reach '" + url + "' (" + ex.Message + ").");
            }
            string text2 = "";
            try { text2 = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult(); }
            catch (Exception) { }
            Dictionary<string, object> headers2 = new Dictionary<string, object>();
            try {
                foreach (var h in resp.Headers) headers2[h.Key.ToLowerInvariant()] = string.Join(", ", h.Value);
                if (resp.Content != null) {
                    foreach (var h in resp.Content.Headers) headers2[h.Key.ToLowerInvariant()] = string.Join(", ", h.Value);
                }
            } catch (Exception) { }
            Dictionary<string, object> r = new Dictionary<string, object>();
            r["status"] = (long)((int)resp.StatusCode);
            r["text"] = text2;
            r["body"] = text2;
            r["headers"] = headers2;
            return r;
        } finally {
            try { linked.Dispose(); } catch (Exception) { }
            try { timeoutCts.Dispose(); } catch (Exception) { }
        }
    }

    // Reads a field from a plain object (HTTP responses, JSON objects).
    public static dynamic FieldGet(object o, string field) {
        if (o is VexProcess) {
            VexProcess h = (VexProcess)o;
            if (field == "running") return h.Running;
            if (field == "exit") return h.Exit;
            if (field == "stdout") return h.Out;
            if (field == "stderr") return h.Err;
            throw new VexAxErr("UI Error: A process has running, exit, stdout, stderr (and kill).");
        }
        if (o is VexObj) {
            VexObj vo = (VexObj)o;
            if (vo.Fields.ContainsKey(field)) return vo.Fields[field];
            throw new VexAxErr("UI Error: This object has no '" + field + "'.");
        }
        Dictionary<string, object> d = o as Dictionary<string, object>;
        if (d != null) {
            if (d.ContainsKey(field)) return d[field];
            throw new VexAxErr("UI Error: This object has no '" + field + "'.");
        }
        throw new VexAxErr("UI Error: Cannot read '" + field + "' here.");
    }

    // ---------- containers (phase 5) ----------
    // Manual x/y is exact inside panel/scroll canvases (child coords are
    // parent-relative: screen = parent + child). Stack/grid children are
    // arranged by the container; their x/y is ignored (documented).

    private static Dictionary<object, int> GridCounts = new Dictionary<object, int>();
    private static Dictionary<ScrollViewer, Canvas> ScrollInners = new Dictionary<ScrollViewer, Canvas>();

    public static Canvas NewPanel() {
        Canvas c = new Canvas();
        c.Width = 300;
        c.Height = 200;
        c.ClipToBounds = true;
        return c;
    }

    public static StackPanel NewStack(bool horizontal) {
        StackPanel s = new StackPanel();
        s.Orientation = horizontal ? Orientation.Horizontal : Orientation.Vertical;
        if (horizontal) { s.Width = 360; s.Height = 34; } else { s.Width = 300; s.Height = 250; }
        return s;
    }

    public static Grid NewGrid() {
        Grid g = new Grid();
        g.Width = 300;
        g.Height = 200;
        g.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
        g.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
        return g;
    }

    public static ScrollViewer NewScroll() {
        ScrollViewer sv = new ScrollViewer();
        sv.Width = 300;
        sv.Height = 200;
        Canvas inner = new Canvas();
        inner.Width = 300;
        inner.Height = 200;
        inner.ClipToBounds = true;
        sv.Content = inner;
        ScrollInners[sv] = inner;
        return sv;
    }

    // ---------- responsive anchoring (2.2.1) ----------
    // `b.anchor = "right"` / `"bottom right"` / `"left right"` (stretch).
    // Default (unset) is top+left: explicit x/y never move. Distances to
    // anchored edges track the parent size like WinForms Anchor.
    private class AnchorRule { public Control C; public bool L, T, R, B; }
    private static Dictionary<Control, List<AnchorRule>> AnchorRules = new Dictionary<Control, List<AnchorRule>>();
    private static Dictionary<Control, Size> AnchorParentSize = new Dictionary<Control, Size>();
    private static HashSet<Control> AnchorHooked = new HashSet<Control>();

    public static void SetAnchor(object o, object specObj) {
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Only controls take anchor.");
        string spec = Display(specObj).Trim().ToLowerInvariant();
        bool l = false, t = false, r = false, b = false;
        if (spec == "") throw new VexAxErr("UI Error: Anchor needs edges, e.g. anchor = \"right\" or \"bottom right\".");
        foreach (string part in spec.Split(new char[] { ' ', ',', ';' }, StringSplitOptions.RemoveEmptyEntries)) {
            if (part == "left") l = true;
            else if (part == "right") r = true;
            else if (part == "top") t = true;
            else if (part == "bottom") b = true;
            else if (part == "none") { l = false; t = false; r = false; b = false; }
            else throw new VexAxErr("UI Error: Unknown anchor edge '" + part + "'. Use left, right, top, bottom (e.g. \"bottom right\").");
        }
        if (!l && !r) l = true;
        if (!t && !b) t = true;
        Control parent = c.Parent as Control;
        if (parent == null) throw new VexAxErr("UI Error: Anchor needs a placed element (parent it first).");
        List<AnchorRule> rules;
        if (!AnchorRules.TryGetValue(parent, out rules)) {
            rules = new List<AnchorRule>();
            AnchorRules[parent] = rules;
        }
        for (int i = rules.Count - 1; i >= 0; i--) {
            if (Object.ReferenceEquals(rules[i].C, c)) rules.RemoveAt(i);
        }
        rules.Add(new AnchorRule { C = c, L = l, T = t, R = r, B = b });
        AnchorParentSize[parent] = new Size(parent.Bounds.Width, parent.Bounds.Height);
        if (!AnchorHooked.Contains(parent)) {
            AnchorHooked.Add(parent);
            parent.PropertyChanged += delegate(object _s, AvaloniaPropertyChangedEventArgs _e) {
                if (_e.Property == Control.BoundsProperty) ApplyAnchors(parent);
            };
        }
    }

    private static void ApplyAnchors(Control parent) {
        List<AnchorRule> rules;
        if (!AnchorRules.TryGetValue(parent, out rules) || rules.Count == 0) return;
        // Baseline from before first layout is meaningless (0x0): adopt
        // the first real size instead of shifting everything by it.
        if (!AnchorParentSize.ContainsKey(parent) || AnchorParentSize[parent].Width <= 0 || AnchorParentSize[parent].Height <= 0) {
            AnchorParentSize[parent] = new Size(parent.Bounds.Width, parent.Bounds.Height);
            return;
        }
        Size prev = AnchorParentSize[parent];
        double dW = parent.Bounds.Width - prev.Width;
        double dH = parent.Bounds.Height - prev.Height;
        AnchorParentSize[parent] = new Size(parent.Bounds.Width, parent.Bounds.Height);
        if (dW == 0 && dH == 0) return;
        foreach (AnchorRule rl in rules.ToArray()) {
            Control c = rl.C;
            if (c == null) continue;
            try {
                if (dW != 0) {
                    if (rl.R && !rl.L) Canvas.SetLeft(c, OrZero(Canvas.GetLeft(c)) + dW);
                    else if (rl.L && rl.R) c.Width = Math.Max(0, OrZero(c.Width) + dW);
                }
                if (dH != 0) {
                    if (rl.B && !rl.T) Canvas.SetTop(c, OrZero(Canvas.GetTop(c)) + dH);
                    else if (rl.T && rl.B) c.Height = Math.Max(0, OrZero(c.Height) + dH);
                }
            } catch (Exception) { }
        }
    }

    public static bool AsBool(object v) {
        if (v is bool) return (bool)v;
        if (v is string) {
            string s = ((string)v).Trim().ToLowerInvariant();
            if (s == "true") return true;
            if (s == "false") return false;
        }
        throw new VexAxErr("Cannot convert to true/false here.");
    }

    public static long AsInt(object v) {
        if (v is long) return (long)v;
        if (v is int) return (long)(int)v;
        if (v is double) return (long)(double)v;
        if (v is string) {
            long l;
            if (long.TryParse((string)v, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out l)) return l;
        }
        throw new VexAxErr("An integer is needed here.");
    }

    public static dynamic Add(object a, object b) {
        if (a is string || b is string) return Display(a) + Display(b);
        if (a is double || b is double || a is float || b is float || a is decimal || b is decimal) {
            return AsDouble(a) + AsDouble(b);
        }
        return AsInt(a) + AsInt(b);
    }

    public static dynamic Sub(object a, object b) { return AsDouble(a) - AsDouble(b); }
    public static dynamic Mul(object a, object b) { return AsDouble(a) * AsDouble(b); }
    public static dynamic Div(object a, object b) {
        double d = AsDouble(b);
        if (d == 0) throw new VexAxErr("Cannot divide by zero.");
        return AsDouble(a) / d;
    }

    public static dynamic Rem(object a, object b) { return AsDouble(a) % AsDouble(b); }

    public static bool Eq(object a, object b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        if ((a is double || a is long || a is int) && (b is double || b is long || b is int)) {
            return AsDouble(a) == AsDouble(b);
        }
        return Display(a) == Display(b);
    }

    public static void JsonWrite(object val, string path) {
        try {
            object conv = ToJsonVal(val);
            string json = System.Text.Json.JsonSerializer.Serialize(conv, new System.Text.Json.JsonSerializerOptions { WriteIndented = false });
            System.IO.File.WriteAllText(path, json);
        } catch (Exception ex) {
            throw new VexAxErr("UI Error: Could not write JSON (" + ex.Message + ").");
        }
    }

    private static object ToJsonVal(object v) {
        if (v is VexObj) {
            VexObj vo = (VexObj)v;
            Dictionary<string, object> d = new Dictionary<string, object>();
            foreach (var kv in vo.Fields) d[kv.Key] = ToJsonVal(kv.Value);
            return d;
        }
        if (v is Dictionary<string, object>) {
            Dictionary<string, object> src = (Dictionary<string, object>)v;
            Dictionary<string, object> d2 = new Dictionary<string, object>();
            foreach (var kv in src) d2[kv.Key] = ToJsonVal(kv.Value);
            return d2;
        }
        if (v is IList && !(v is string)) {
            IList lst = (IList)v;
            List<object> outL = new List<object>();
            foreach (object e in lst) outL.Add(ToJsonVal(e));
            return outL;
        }
        return v;
    }

    public static dynamic JsonRead(string path) {
        try {
            string text = System.IO.File.ReadAllText(path);
            using (System.Text.Json.JsonDocument doc = System.Text.Json.JsonDocument.Parse(text)) {
                return JsonToVex(doc.RootElement);
            }
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("UI Error: Could not read JSON (" + ex.Message + ").");
        }
    }

    // Vexel 2.9: terminal sessions (persistent working directory per app).
    private static string TermDir = null;
    private static string TermCwd() {
        if (TermDir == null) {
            try { TermDir = System.IO.Directory.GetCurrentDirectory(); }
            catch (Exception) { TermDir = "."; }
        }
        return TermDir;
    }
    public static void TermCd(string dir) {
        string target;
        try {
            target = System.IO.Path.IsPathRooted(dir) ? dir : System.IO.Path.Combine(TermCwd(), dir);
            string full = System.IO.Path.GetFullPath(target);
            if (!System.IO.Directory.Exists(full)) throw new VexAxErr("cd: directory not found: " + dir);
            TermDir = full;
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("cd: cannot change to '" + dir + "' (" + ex.Message + ").");
        }
    }
    private static void TermExec(string cmd, out string stdoutText, out string stderrText) {
        string shell, flag;
        if (System.OperatingSystem.IsWindows()) { shell = "cmd"; flag = "/C"; }
        else { shell = "sh"; flag = "-c"; }
        System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo(shell, flag + " \"" + cmd.Replace("\"", "\\\"") + "\"");
        psi.WorkingDirectory = TermCwd();
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        try {
            using (System.Diagnostics.Process p = System.Diagnostics.Process.Start(psi)) {
                stdoutText = p.StandardOutput.ReadToEnd();
                stderrText = p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode != 0) {
                    string tail = (stderrText ?? "").Trim();
                    throw new VexAxErr("run exited with code " + p.ExitCode + ": " + cmd + (tail.Length > 0 ? " (" + tail + ")" : ""));
                }
            }
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("run: cannot execute '" + cmd + "' (" + ex.Message + ").");
        }
    }
    public static void TermRun(string cmd) {
        string so, se;
        TermExec(cmd, out so, out se);
        if (!string.IsNullOrEmpty(so)) Console.Write(so);
        if (!string.IsNullOrEmpty(se)) Console.Error.Write(se);
    }
    public static dynamic TermRunCapture(string cmd) {
        string so, se;
        TermExec(cmd, out so, out se);
        if (!string.IsNullOrEmpty(se)) Console.Error.Write(se);
        return so;
    }

    // Vexel 2.9: filesystem (files + directories). Errors are VexAxErr.
    // Vexel 2.9: command-line arguments after the program itself.
    public static dynamic Args() {
        string[] all = System.Environment.GetCommandLineArgs();
        List<dynamic> list = new List<dynamic>();
        // Skip argv[0] (and a possible `dotnet exec` launcher pair).
        int start = 1;
        if (all.Length > 1 && all[0].EndsWith("dotnet.exe", System.StringComparison.OrdinalIgnoreCase) && all[1].EndsWith(".dll", System.StringComparison.OrdinalIgnoreCase)) start = 2;
        for (int i = start; i < all.Length; i++) list.Add(all[i]);
        return list;
    }

    public static void FileWrite(string text, string path) {
        try { System.IO.File.WriteAllText(path, text); }
        catch (Exception ex) { throw new VexAxErr("Cannot write file '" + path + "' (" + ex.Message + ")."); }
    }
    public static void FileAppend(string text, string path) {
        try { System.IO.File.AppendAllText(path, text); }
        catch (Exception ex) { throw new VexAxErr("Cannot append to file '" + path + "' (" + ex.Message + ")."); }
    }
    public static dynamic FileRead(string path) {
        try { return System.IO.File.ReadAllText(path); }
        catch (Exception) { throw new VexAxErr("File not found: " + path); }
    }
    public static void FileDelete(string path) {
        try { System.IO.File.Delete(path); }
        catch (Exception ex) { throw new VexAxErr("Cannot delete file '" + path + "' (" + ex.Message + ")."); }
    }
    public static void FileCopy(string from, string to) {
        try { System.IO.File.Copy(from, to, true); }
        catch (Exception ex) { throw new VexAxErr("Cannot copy file '" + from + "' to '" + to + "' (" + ex.Message + ")."); }
    }
    public static void FileMove(string from, string to) {
        try {
            if (System.IO.File.Exists(to)) System.IO.File.Delete(to);
            System.IO.File.Move(from, to);
        } catch (Exception ex) { throw new VexAxErr("Cannot move file '" + from + "' to '" + to + "' (" + ex.Message + ")."); }
    }
    public static dynamic FileExists(string path) {
        return System.IO.File.Exists(path);
    }
    public static dynamic FileSize(string path) {
        try {
            System.IO.FileInfo fi = new System.IO.FileInfo(path);
            if (!fi.Exists) throw new VexAxErr("File not found: " + path);
            return (long)fi.Length;
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("Cannot read file '" + path + "' (" + ex.Message + ").");
        }
    }
    public static void DirCreate(string path) {
        try { System.IO.Directory.CreateDirectory(path); }
        catch (Exception ex) { throw new VexAxErr("Cannot create directory '" + path + "' (" + ex.Message + ")."); }
    }
    public static void DirDelete(string path) {
        try { System.IO.Directory.Delete(path, true); }
        catch (Exception ex) { throw new VexAxErr("Cannot delete directory '" + path + "' (" + ex.Message + ")."); }
    }
    public static dynamic DirExists(string path) {
        return System.IO.Directory.Exists(path);
    }
    public static dynamic DirList(string path) {
        try {
            List<dynamic> names = new List<dynamic>();
            foreach (string e in System.IO.Directory.GetFileSystemEntries(path)) names.Add(System.IO.Path.GetFileName(e));
            names.Sort();
            return names;
        } catch (Exception) { throw new VexAxErr("Directory not found: " + path); }
    }
    private static void CopyDirRecursive(string from, string to) {
        System.IO.Directory.CreateDirectory(to);
        foreach (string d in System.IO.Directory.GetDirectories(from)) CopyDirRecursive(d, System.IO.Path.Combine(to, System.IO.Path.GetFileName(d)));
        foreach (string f in System.IO.Directory.GetFiles(from)) System.IO.File.Copy(f, System.IO.Path.Combine(to, System.IO.Path.GetFileName(f)), true);
    }
    public static void DirCopy(string from, string to) {
        try {
            if (!System.IO.Directory.Exists(from)) throw new VexAxErr("Directory not found: " + from);
            CopyDirRecursive(from, to);
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("Cannot copy directory '" + from + "' to '" + to + "' (" + ex.Message + ").");
        }
    }
    public static void DirMove(string from, string to) {
        try {
            if (!System.IO.Directory.Exists(from)) throw new VexAxErr("Directory not found: " + from);
            System.IO.Directory.Move(from, to);
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("Cannot move directory '" + from + "' to '" + to + "' (" + ex.Message + ").");
        }
    }

    private static dynamic JsonToVex(System.Text.Json.JsonElement el) {
        switch (el.ValueKind) {
            case System.Text.Json.JsonValueKind.String: return el.GetString();
            case System.Text.Json.JsonValueKind.Number: {
                long l;
                if (el.TryGetInt64(out l)) return l;
                return el.GetDouble();
            }
            case System.Text.Json.JsonValueKind.True: return true;
            case System.Text.Json.JsonValueKind.False: return false;
            case System.Text.Json.JsonValueKind.Null: return null;
            case System.Text.Json.JsonValueKind.Array: {
                List<dynamic> list = new List<dynamic>();
                foreach (System.Text.Json.JsonElement item in el.EnumerateArray()) list.Add(JsonToVex(item));
                return list;
            }
            case System.Text.Json.JsonValueKind.Object: {
                Dictionary<string, object> dict = new Dictionary<string, object>();
                foreach (System.Text.Json.JsonProperty p in el.EnumerateObject()) dict[p.Name] = JsonToVex(p.Value);
                return dict;
            }
            default: return null;
        }
    }

    public static void PrintFile(string path) {
        try {
            Console.Write(System.IO.File.ReadAllText(path));
        } catch (Exception) {
            throw new VexAxErr("File not found: " + path);
        }
    }

    public static dynamic CharAt(object baseVal, object idxVal) {
        // Lists yield elements (mirrors Rust vex_char_at); strings yield characters.
        if (baseVal is IList && !(baseVal is string)) {
            IList l = (IList)baseVal;
            long li = AsInt(idxVal);
            if (li < 0 || li >= l.Count) throw new VexAxErr("Index out of bounds: " + li + " (length " + l.Count + ").");
            return l[(int)li];
        }
        string s = Display(baseVal);
        long i = AsInt(idxVal);
        if (i < 0 || i >= s.Length) throw new VexAxErr("Index out of bounds: " + i + " (length " + s.Length + ").");
        return s[(int)i].ToString();
    }

    public static Dictionary<string, object> MakeError(Exception ex) {
        Dictionary<string, object> e = new Dictionary<string, object>();
        VexAxErr ve = ex as VexAxErr;
        e["message"] = ve != null ? ve.Message : "UI Error: " + ex.Message;
        e["type"] = "RuntimeError";
        return e;
    }

    public static dynamic Rand(object loVal, object hiVal) {
        long lo = AsInt(loVal);
        long hi = AsInt(hiVal);
        if (hi < lo) throw new VexAxErr("Invalid range.");
        return (long)(new Random().NextDouble() * (hi - lo + 1)) + lo;
    }

    public static double AsDouble(object v) {
        if (v is double) return (double)v;
        if (v is float) return (double)(float)v;
        if (v is long) return (double)(long)v;
        if (v is int) return (double)(int)v;
        if (v is decimal) return (double)(decimal)v;
        if (v is string) {
            double d;
            if (double.TryParse((string)v, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out d)) return d;
            throw new VexAxErr("Cannot convert \"" + (string)v + "\" to a number.");
        }
        if (v is bool) throw new VexAxErr("Cannot convert a boolean to a number.");
        throw new VexAxErr("Cannot convert a value to a number.");
    }

    public static double AsSize(object v, string prop) {
        double d = AsDouble(v);
        if (d < 0) throw new VexAxErr("UI Error: " + (prop == "width" ? "Width" : "Height") + " cannot be negative.");
        return d;
    }

    public static string Display(object v) {
        if (v == null) return "";
        if (v is string) return (string)v;
        if (v is bool) return ((bool)v) ? "true" : "false";
        if (v is double) return ((double)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
        // Error objects print as their message.
        if (v is Dictionary<string, object>) {
            Dictionary<string, object> d = (Dictionary<string, object>)v;
            if (d.ContainsKey("message") && d.ContainsKey("type")) return Display(d["message"]);
        }
        return v.ToString();
    }

    // ---------- shared input/output buffer ----------

    public static dynamic Output = "";

    public static string AskInput(object prompt) {
        Console.Write(Display(prompt));
        try {
            string line = Console.ReadLine();
            return line == null ? "" : line;
        } catch (Exception) { return ""; }
    }

    // ---------- live runtime inspector (2.2.1) ----------
    // Set VEXEL_AX_SNAPSHOT=<path> and the runtime writes live UI state
    // as JSON (windows, controls with bounds/visibility/opacity, timer
    // and task states) on show/close/event/timer/task transitions.
    // Zero cost when unset (one null check per hook).
    private static readonly string SnapPath =
        System.Environment.GetEnvironmentVariable("VEXEL_AX_SNAPSHOT");

    public static void Snap() {
        string p = SnapPath;
        if (string.IsNullOrEmpty(p)) return;
        try {
            System.Text.StringBuilder sb = new System.Text.StringBuilder();
            sb.Append("{\"windows\":[");
            bool firstW = true;
            List<Window> wins;
            lock (Windows) { wins = new List<Window>(Windows); }
            // Controls may only be touched on the UI thread; workers
            // still record timers/tasks below.
            bool uiSafe = false;
            try {
                uiSafe = Avalonia.Threading.Dispatcher.UIThread != null
                    && Avalonia.Threading.Dispatcher.UIThread.CheckAccess();
            } catch (Exception) { uiSafe = false; }
            foreach (Window w in wins) {
                bool vis = false;
                double ww = 0, wh = 0;
                try {
                    if (!uiSafe) continue;
                    vis = w.IsVisible;
                    ww = w.Width; wh = w.Height;
                } catch (Exception) { continue; }
                if (!firstW) sb.Append(',');
                firstW = false;
                sb.Append("{\"title\":").Append(JsonStr(w.Title));
                sb.Append(",\"w\":").Append(Dbl(ww));
                sb.Append(",\"h\":").Append(Dbl(wh));
                sb.Append(",\"visible\":").Append(vis ? "true" : "false");
                sb.Append(",\"controls\":[");
                try {
                    Canvas root = null;
                    if (Roots.ContainsKey(w)) root = Roots[w];
                    else if (w.Content is Canvas) root = (Canvas)w.Content;
                    if (root != null) SnapKids(sb, root);
                } catch (Exception) { }
                sb.Append("]}");
            }
            sb.Append("],\"timers\":[");
            bool firstT = true;
            List<VexTimer> timers;
            lock (ActiveTimers) { timers = new List<VexTimer>(ActiveTimers); }
            foreach (VexTimer t in timers) {
                if (!firstT) sb.Append(',');
                firstT = false;
                sb.Append("{\"state\":").Append(JsonStr(t.State)).Append("}");
            }
            sb.Append("],\"tasks\":[");
            bool firstK = true;
            List<VexTask> tasks;
            lock (ActiveTasks) { tasks = new List<VexTask>(ActiveTasks); }
            foreach (VexTask k in tasks) {
                if (!firstK) sb.Append(',');
                firstK = false;
                sb.Append("{\"state\":").Append(JsonStr(k.State)).Append("}");
            }
            sb.Append("]}");
            System.IO.File.WriteAllText(p, sb.ToString());
        } catch (Exception) { /* inspector must never break the app */ }
    }

    private static string JsonStr(string s) {
        if (s == null) return "null";
        return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
    }

    private static string Dbl(double d) {
        if (double.IsNaN(d) || double.IsInfinity(d)) return "0";
        return d.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    private static string VexKind(Control c) {
        // Vexel 2.9: tables are ScrollViewers backed by VexTable state.
        if (c != null && Tables.ContainsKey(c)) return "table";
        if (c is ToggleSwitch) return "switch";
        if (c is RadioButton) return "radio";
        if (c is NumericUpDown) return "numeric";
        if (c is Border) {
            if (c != null && CardInners.ContainsKey(c)) return "card";
            return "separator";
        }
        if (c is DockPanel) {
            Label _sl;
            if (c != null && StatusLabels.TryGetValue(c, out _sl)) return "statusbar";
        }
        if (c is Button) return "button";
        if (c is Label) return "text";
        if (c is TextBox) {
            TextBox t = (TextBox)c;
            if (t.IsReadOnly && t.AcceptsReturn) return "output";
            return "input";
        }
        if (c is CheckBox) return "checkbox";
        if (c is Slider) return "slider";
        if (c is ProgressBar) return ((ProgressBar)c).IsIndeterminate ? "spinner" : "progress";
        if (c is ComboBox) return "dropdown";
        if (c is ListBox) return "listbox";
        if (c is Image) return "image";
        if (c is Menu) return "menu";
        if (c is TabControl) return "tabbar";
        if (c is TreeView) return "tree";
        if (c is StackPanel) return "toolbar";
        if (c is ScrollViewer) return "scroll";
        if (c is Grid) return "grid";
        if (c is Canvas) return "panel";
        return "control";
    }

    private static void SnapKids(System.Text.StringBuilder sb, Panel parent) {
        bool first = true;
        Control[] kids;
        try { kids = new Control[parent.Children.Count]; parent.Children.CopyTo(kids, 0); }
        catch (Exception) { return; }
        foreach (Control c in kids) {
            if (c == null) continue;
            double x = 0, y = 0, w = 0, h = 0, op = 1;
            bool vis = true;
            string text = "";
            try {
                x = OrZero(Canvas.GetLeft(c));
                y = OrZero(Canvas.GetTop(c));
                w = OrZero(c.Width);
                h = OrZero(c.Height);
                vis = c.IsVisible;
                op = c.Opacity;
                text = Display(GetText(c));
            } catch (Exception) { }
            // Vexel 3.0 Praxis: keep the widget tree fresh and record a
            // render command per control (GPU-ready abstraction log).
            try {
                Praxis.Ensure(VexKind(c), text, c);
                Praxis.SetBounds(c, x, y, w, h);
                Praxis.SetFlags(c, vis, true);
                Praxis.LogRect(x, y, w, h, VexKind(c));
                if (text != "") Praxis.LogText(x, y, text, VexKind(c));
            } catch (Exception) { }
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"kind\":").Append(JsonStr(VexKind(c)));
            sb.Append(",\"text\":").Append(JsonStr(text));
            sb.Append(",\"x\":").Append(Dbl(x));
            sb.Append(",\"y\":").Append(Dbl(y));
            sb.Append(",\"w\":").Append(Dbl(w));
            sb.Append(",\"h\":").Append(Dbl(h));
            sb.Append(",\"visible\":").Append(vis ? "true" : "false");
            sb.Append(",\"opacity\":").Append(Dbl(op));
            sb.Append("}");
        }
    }

    // ---------- menus, toolbars, tabs, tables, trees ----------

    public static Menu NewMenu(object title) {
        Menu m = new Menu();
        MenuItem top = new MenuItem();
        top.Header = Display(title);
        m.Items.Add(top);
        return m;
    }

    // Toolbars have no Avalonia-core equivalent: a horizontal strip of
    // real buttons (themed natively), positioned like any widget.
    public static StackPanel NewToolbar() {
        StackPanel s = new StackPanel();
        s.Orientation = Orientation.Horizontal;
        s.Width = 800;
        s.Height = 34;
        return s;
    }

    public static Button AddToolbarButton(object o, object title) {
        StackPanel s = o as StackPanel;
        if (s == null) throw new VexAxErr("UI Error: Only a toolbar takes buttons.");
        Button b = new Button();
        b.Content = Display(title);
        s.Children.Add(b);
        return b;
    }

    // Vexel 2.9: toolbar separators (visual dividers) and labeled groups
    // (a titled strip that takes buttons exactly like a toolbar).
    public static void AddToolbarSeparator(object o) {
        StackPanel s = o as StackPanel;
        if (s == null) throw new VexAxErr("UI Error: Only a toolbar takes separators.");
        Separator sep = new Separator();
        sep.Width = 8;
        s.Children.Add(sep);
    }

    public static object AddToolbarGroup(object o, object title) {
        StackPanel s = o as StackPanel;
        if (s == null) throw new VexAxErr("UI Error: Only a toolbar takes groups.");
        StackPanel group = new StackPanel();
        group.Orientation = Orientation.Vertical;
        Label caption = new Label();
        caption.Content = Display(title);
        caption.FontSize = 11;
        group.Children.Add(caption);
        StackPanel strip = new StackPanel();
        strip.Orientation = Orientation.Horizontal;
        group.Children.Add(strip);
        s.Children.Add(group);
        return strip;
    }

    // Vexel 2.9: data tables are built from core controls (ScrollViewer
    // + rows of labels) so they render with the bundled Fluent theme.
    // (The DataGrid package's theme resources are version-fragile and
    // rendered nothing.) The handle is the ScrollViewer; per-table state
    // lives in Tables. Same Vexel API: columns, rows, selected, change.
    public class VexTable {
        public ScrollViewer View = new ScrollViewer();
        public StackPanel Rows = new StackPanel();
        public List<string> Columns = new List<string>();
        public List<List<object>> Data = new List<List<object>>();
        public int Selected = -1;
        public List<Action> ChangeHandlers = new List<Action>();
        public double FontSize = 14;
    }
    private static Dictionary<object, VexTable> Tables = new Dictionary<object, VexTable>();

    private static VexTable TableOf(object o) {
        VexTable t;
        if (o != null && Tables.TryGetValue(o, out t)) return t;
        throw new VexAxErr("UI Error: Only a table takes columns and rows.");
    }

    public static object NewTable() {
        VexTable t = new VexTable();
        t.Rows.Orientation = Orientation.Vertical;
        t.Rows.Spacing = 0;
        t.View.Content = t.Rows;
        t.View.HorizontalScrollBarVisibility = ScrollBarVisibility.Auto;
        t.View.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        t.View.Width = 400;
        t.View.Height = 200;
        Tables[t.View] = t;
        return t.View;
    }

    private static double TableColWidth(VexTable t) {
        int n = Math.Max(1, t.Columns.Count);
        double w = t.View.Width;
        if (double.IsNaN(w)) w = 400;
        return Math.Max(100, w / n);
    }

    private static StackPanel TableRowPanel(VexTable t, List<object> cells, bool header, bool selected, int index) {
        StackPanel row = new StackPanel();
        row.Orientation = Orientation.Horizontal;
        row.Spacing = 0;
        // Transparent (not null) background: null brushes are invisible
        // to hit-testing, so rows would never receive clicks.
        row.Background = new SolidColorBrush(Colors.Transparent);
        if (selected) row.Background = new SolidColorBrush(Color.FromRgb(59, 110, 210));
        double cw = TableColWidth(t);
        for (int i = 0; i < t.Columns.Count; i++) {
            object cell = i < cells.Count ? cells[i] : "";
            Label lab = new Label();
            lab.Content = Display(cell);
            lab.Width = cw;
            lab.Height = 26;
            lab.FontSize = t.FontSize;
            if (header) lab.FontWeight = FontWeight.Bold;
            lab.VerticalContentAlignment = VerticalAlignment.Center;
            lab.Padding = new Thickness(6, 0, 6, 0);
            row.Children.Add(lab);
        }
        if (!header) {
            int idx = index;
            row.PointerPressed += delegate {
                TableSelectInner(TableHandle(t), idx, true);
            };
        }
        return row;
    }

    private static object TableHandle(VexTable t) {
        foreach (var kv in Tables) if (kv.Value == t) return kv.Key;
        return t.View;
    }

    private static void RenderTable(VexTable t) {
        t.Rows.Children.Clear();
        if (t.Columns.Count > 0) {
            List<object> head = new List<object>();
            foreach (string c in t.Columns) head.Add(c);
            t.Rows.Children.Add(TableRowPanel(t, head, true, false, -1));
        }
        for (int i = 0; i < t.Data.Count; i++) {
            t.Rows.Children.Add(TableRowPanel(t, t.Data[i], false, i == t.Selected, i));
        }
    }

    public static void TableColumn(object o, object name) {
        VexTable t = TableOf(o);
        t.Columns.Add(Display(name));
        RenderTable(t);
    }

    public static void TableRow(object o, object rowVal) {
        VexTable t = TableOf(o);
        List<object> cells = new List<object>();
        if (rowVal is IList && !(rowVal is string)) {
            foreach (object x in (IList)rowVal) cells.Add(x);
        } else cells.Add(rowVal);
        t.Data.Add(cells);
        RenderTable(t);
    }

    public static void TableClear(object o) {
        VexTable t = TableOf(o);
        t.Data.Clear();
        t.Selected = -1;
        RenderTable(t);
    }

    public static long TableSelected(object o) {
        return TableOf(o).Selected;
    }

    public static void TableSelect(object o, int index) {
        TableSelectInner(o, index, true);
    }

    private static void TableSelectInner(object o, int index, bool fire) {
        VexTable t = TableOf(o);
        if (index < -1 || index >= t.Data.Count) throw new VexAxErr("UI Error: Table row " + index + " is out of range.");
        t.Selected = index;
        RenderTable(t);
        if (fire) {
            foreach (Action a in new List<Action>(t.ChangeHandlers)) {
                try { a(); } catch (Exception) { }
            }
        }
        Snap();
    }

    public static void TableOnChange(object o, Action handler) {
        TableOf(o).ChangeHandlers.Add(handler);
    }

    public static TabControl NewTabbar() {
        TabControl t = new TabControl();
        t.Width = 300;
        t.Height = 200;
        return t;
    }

    public static TreeView NewTree() {
        TreeView t = new TreeView();
        t.Width = 200;
        t.Height = 150;
        return t;
    }

    // `menu.add "Open"` / `tabs.add "Home"` / `tree.add "Node"` (and
    // `node.add "Child"`) create and attach a child item, returned so
    // event handlers can be attached to it.
    public static object AddChildItem(object o, object text) {
        string s = Display(text);
        if (o is MenuFlyout) return ContextAdd(o, s);
        if (o is Menu) {
            Menu m = (Menu)o;
            if (m.Items.Count == 0) {
                MenuItem top = new MenuItem();
                top.Header = s;
                m.Items.Add(top);
                return top;
            }
            MenuItem topItem = (MenuItem)m.Items[0];
            MenuItem mi = new MenuItem();
            mi.Header = s;
            topItem.Items.Add(mi);
            return mi;
        }
        if (o is MenuItem) {
            MenuItem mi = new MenuItem();
            mi.Header = s;
            ((MenuItem)o).Items.Add(mi);
            return mi;
        }
        if (o is TreeView) return AddNode((TreeView)o, s);
        if (o is TreeViewItem) return AddNode((TreeViewItem)o, s);
        if (o is TabControl) return AddTab((TabControl)o, s);
        throw new VexAxErr("UI Error: Cannot add items here.");
    }

    public static TreeViewItem AddNode(object o, string text) {
        TreeViewItem n = new TreeViewItem();
        n.Header = text;
        if (o is TreeView) ((TreeView)o).Items.Add(n);
        else if (o is TreeViewItem) ((TreeViewItem)o).Items.Add(n);
        else throw new VexAxErr("UI Error: Cannot add a node here.");
        return n;
    }

    public static TabItem AddTab(TabControl tabs, string text) {
        TabItem pg = new TabItem();
        pg.Header = text;
        Canvas c = new Canvas();
        c.ClipToBounds = true;
        pg.Content = c;
        tabs.Items.Add(pg);
        return pg;
    }

    public static void RemoveItem(object o, object idx) {
        int i = (int)AsInt(idx);
        if (o is ComboBox) {
            IList items = ComboBoxItems((ComboBox)o);
            if (i < 0 || i >= items.Count) throw new VexAxErr("Index out of bounds: " + i + ".");
            items.RemoveAt(i);
            return;
        }
        if (o is ListBox) {
            IList items = ListBoxItems((ListBox)o);
            if (i < 0 || i >= items.Count) throw new VexAxErr("Index out of bounds: " + i + ".");
            items.RemoveAt(i);
            return;
        }
        throw new VexAxErr("UI Error: Cannot remove items from this element.");
    }

    // ---------- lists and structs ----------

    public static List<dynamic> NewList(params object[] items) {
        List<dynamic> l = new List<dynamic>();
        foreach (object i in items) l.Add(i);
        return l;
    }

    public static dynamic IdxGet(object o, object idx) {
        if (o is Dictionary<string, object>) {
            Dictionary<string, object> d = (Dictionary<string, object>)o;
            string k = Display(idx);
            if (d.ContainsKey(k)) return d[k];
            throw new VexAxErr("UI Error: This object has no '" + k + "'.");
        }
        int i = (int)AsInt(idx);
        if (o is IList) {
            IList l = (IList)o;
            if (i < 0 || i >= l.Count) throw new VexAxErr("Index out of bounds: " + i + " (length " + l.Count + ").");
            return l[i];
        }
        if (o is string) return CharAt(o, idx);
        throw new VexAxErr("UI Error: Cannot index this value.");
    }

    public static void IdxSet(object o, object idx, object val) {
        int i = (int)AsInt(idx);
        if (o is IList) {
            IList l = (IList)o;
            if (i < 0 || i >= l.Count) throw new VexAxErr("Index out of bounds: " + i + " (length " + l.Count + ").");
            l[i] = val;
            return;
        }
        throw new VexAxErr("UI Error: Cannot index this value.");
    }

    public static void ListAdd(object o, object val) {
        if (o is IList) { ((IList)o).Add(val); return; }
        throw new VexAxErr("UI Error: Cannot add to this value.");
    }

    public static void ListRemove(object o, object idx) {
        int i = (int)AsInt(idx);
        if (o is IList) {
            IList l = (IList)o;
            if (i < 0 || i >= l.Count) throw new VexAxErr("Index out of bounds: " + i + " (length " + l.Count + ").");
            l.RemoveAt(i);
            return;
        }
        throw new VexAxErr("UI Error: Cannot remove from this value.");
    }

    public static long Len(object o) {
        if (o is string) return (long)((string)o).Length;
        if (o is IList) return (long)((IList)o).Count;
        throw new VexAxErr("UI Error: Cannot take the length of this value.");
    }

    // Structs and anonymous objects share one lightweight type; JSON
    // objects come back as Dictionary and FieldGet/FieldSet cover both.
    public class VexObj {
        public readonly string TypeName;
        public readonly Dictionary<string, object> Fields = new Dictionary<string, object>();
        public VexObj(string tn) { TypeName = tn == null ? "" : tn; }
        public override string ToString() {
            List<string> keys = new List<string>(Fields.Keys);
            keys.Sort(System.StringComparer.Ordinal);
            List<string> parts = new List<string>();
            foreach (string k in keys) parts.Add(k + "=" + VexAx.Display(Fields[k]));
            string body = string.Join(", ", parts.ToArray());
            return TypeName == "" ? "{ " + body + " }" : TypeName + " { " + body + " }";
        }
    }

    public static dynamic StructNew(string typeName, Dictionary<string, object> fields) {
        VexObj o = new VexObj(typeName);
        foreach (KeyValuePair<string, object> kv in fields) o.Fields[kv.Key] = kv.Value;
        return o;
    }

    public static void FieldSet(object o, string field, object val) {
        if (o is VexObj) { ((VexObj)o).Fields[field] = val; return; }
        if (o is Dictionary<string, object>) { ((Dictionary<string, object>)o)[field] = val; return; }
        throw new VexAxErr("UI Error: Cannot set a field on this value.");
    }

    // ---------- styles and themes ----------

    public static IBrush ParseBrush(object val) {
        string s = Display(val);
        if (s == "") throw new VexAxErr("UI Error: A color is needed here.");
        try {
            return Brush.Parse(s);
        } catch (Exception) {
            throw new VexAxErr("UI Error: Unknown color '" + s + "'. Use a name (blue, white) or hex (#FF0000).");
        }
    }

    private static void SetBrushProp(Control c, string prop, object val) {
        IBrush b = ParseBrush(val);
        if (prop == "background") {
            if (c is TemplatedControl) { ((TemplatedControl)c).Background = b; return; }
            if (c is TextBlock) { ((TextBlock)c).Background = b; return; }
            if (c is Canvas) { ((Canvas)c).Background = b; return; }
            if (c is Panel) { ((Panel)c).Background = b; return; }
        } else if (prop == "text_color") {
            if (c is TemplatedControl) { ((TemplatedControl)c).Foreground = b; return; }
            if (c is TextBlock) { ((TextBlock)c).Foreground = b; return; }
        }
        throw new VexAxErr("UI Error: Cannot set '" + prop + "' on this element.");
    }

    // Styles and themes are plain property maps; applying one sets each
    // property on the target. Explicit control props still win because
    // they are set later in program order.
    public static Dictionary<string, object> MakeStyle(Dictionary<string, object> fields) { return fields; }
    public static Dictionary<string, object> MakeTheme(Dictionary<string, object> fields) { return fields; }

    public static void ApplyStyle(object o, object styleObj) {
        Dictionary<string, object> s = styleObj as Dictionary<string, object>;
        if (s == null) throw new VexAxErr("UI Error: Unknown style.");
        foreach (KeyValuePair<string, object> kv in s) SetProp(o, kv.Key, kv.Value);
    }

    public static void ApplyThemeByName(Window win, object nameOrTheme) {
        Dictionary<string, object> t = nameOrTheme as Dictionary<string, object>;
        if (t != null) { ApplyThemeDict(win, t); return; }
        string n = Display(nameOrTheme).ToLowerInvariant();
        // Built-in themes also flip the application variant so controls
        // created AFTER this call inherit matching defaults (otherwise
        // labels would stay dark-mode white on a light background).
        if (n == "dark" || n == "light") {
            try {
                var app = Avalonia.Application.Current;
                if (app != null) app.RequestedThemeVariant = n == "dark"
                    ? Avalonia.Styling.ThemeVariant.Dark
                    : Avalonia.Styling.ThemeVariant.Light;
            } catch (Exception) { }
        }
        if (n == "dark") ApplyThemeDict(win, DarkTheme());
        else if (n == "light") ApplyThemeDict(win, LightTheme());
        else throw new VexAxErr("UI Error: Unknown theme '" + n + "'.");
    }

    private static Dictionary<string, object> DarkTheme() {
        Dictionary<string, object> t = new Dictionary<string, object>();
        t["background"] = "#1E1E1E";
        t["text_color"] = "#FFFFFF";
        return t;
    }

    private static Dictionary<string, object> LightTheme() {
        Dictionary<string, object> t = new Dictionary<string, object>();
        t["background"] = "#FFFFFF";
        t["text_color"] = "#000000";
        return t;
    }

    private static void ApplyThemeDict(Window win, Dictionary<string, object> t) {
        if (win == null) return;
        Canvas root;
        try { root = RootOf(win); } catch (VexAxErr) { return; }
        if (root == null) return;
        if (t.ContainsKey("background")) {
            root.Background = ParseBrush(t["background"]);
        }
        // Recolor supported controls; ones that cannot take a property
        // are simply left alone (themes affect what they can).
        foreach (Control child in root.Children) {
            foreach (KeyValuePair<string, object> kv in t) {
                if (kv.Key == "text_color" || kv.Key == "font_size" || kv.Key == "bold" || kv.Key == "italic") {
                    try { SetProp(child, kv.Key, kv.Value); } catch (VexAxErr) { }
                }
            }
        }
    }

    // ---------- ids / find / remove ----------

    private static Dictionary<string, object> Ids = new Dictionary<string, object>();

    public static void RegisterId(object o, string id) {
        if (Ids.ContainsKey(id)) throw new VexAxErr("UI Error: Duplicate id '" + id + "'.");
        Ids[id] = o;
    }

    public static object FindById(string id) {
        if (Ids.ContainsKey(id)) return Ids[id];
        throw new VexAxErr("UI Error: No element has id '" + id + "'.");
    }

    private static string IdOf(object o) {
        foreach (KeyValuePair<string, object> kv in Ids) if (kv.Value == o) return kv.Key;
        return "";
    }

    public static void RemoveIt(object o) {
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Cannot remove this element.");
        List<string> dead = new List<string>();
        foreach (KeyValuePair<string, object> kv in Ids) if (kv.Value == c) dead.Add(kv.Key);
        foreach (string k in dead) Ids.Remove(k);
        try {
            Panel p = c.Parent as Panel;
            if (p != null) p.Children.Remove(c);
        } catch (Exception) { }
    }

    // ---------- geometry helpers ----------

    public static void CenterIn(object o, object inTarget) {
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Cannot center this element.");
        Control parent = inTarget as Control;
        if (parent == null) parent = c.Parent as Control;
        if (parent == null) parent = Cur;
        if (parent == null) throw new VexAxErr("UI Error: Cannot center this element (no parent).");
        double pw, ph;
        if (parent is Window) {
            Size cs = ((Window)parent).ClientSize;
            pw = cs.Width;
            ph = cs.Height;
        } else {
            pw = OrZero(parent.Width) > 0 ? parent.Width : OrZero(parent.Bounds.Width);
            ph = OrZero(parent.Height) > 0 ? parent.Height : OrZero(parent.Bounds.Height);
        }
        double w = OrZero(c.Width) > 0 ? c.Width : OrZero(c.Bounds.Width);
        double h = OrZero(c.Height) > 0 ? c.Height : OrZero(c.Bounds.Height);
        Canvas.SetLeft(c, Math.Max(0, (pw - w) / 2.0));
        Canvas.SetTop(c, Math.Max(0, (ph - h) / 2.0));
    }

    public static void SetMinMax(object o, string which, string dim, object val) {
        double v = AsSize(val, dim);
        if (o is Window) {
            Window f = (Window)o;
            bool isMin = which == "min";
            if (dim == "width") { if (isMin) f.MinWidth = v; else f.MaxWidth = v; }
            else { if (isMin) f.MinHeight = v; else f.MaxHeight = v; }
            return;
        }
        throw new VexAxErr("UI Error: Minimum/maximum sizes apply to the window.");
    }

    public static long PercentNow(object baseObj, object pct) {
        double p = AsDouble(pct);
        Control c = baseObj as Control;
        if (c != null) return (long)(OrZero(c.Bounds.Width) * p / 100.0);
        if (baseObj is Window) return (long)(((Window)baseObj).ClientSize.Width * p / 100.0);
        throw new VexAxErr("UI Error: Percentages need a window or container.");
    }

    // Percent/fill sizes track the window: re-applied on every resize.
    private class SizeRule { public Control C; public string Prop; public double Pct; public bool Fill; }
    private static Dictionary<Window, List<SizeRule>> SizeRules = new Dictionary<Window, List<SizeRule>>();
    private static HashSet<Window> HookedWindows = new HashSet<Window>();

    private static Window WindowOf(Control c) { return c.GetVisualRoot() as Window; }

    // Vexel 3.0 Praxis: sizes resolve against the immediate parent
    // content area (container children must not inherit window sizes —
    // that overflowed parents and caused stray horizontal scrolling).
    private static void ParentSize(Control c, out double pw, out double ph) {
        Control parent = c.Parent as Control;
        if (parent is Window) {
            pw = ((Window)parent).ClientSize.Width;
            ph = ((Window)parent).ClientSize.Height;
            return;
        }
        if (parent != null) {
            pw = Praxis.Fill(OrZero(parent.Width) > 0 ? parent.Width : OrZero(parent.Bounds.Width), 0);
            ph = Praxis.Fill(OrZero(parent.Height) > 0 ? parent.Height : OrZero(parent.Bounds.Height), 0);
            if (pw > 0 && ph > 0) return;
        }
        Window w = WindowOf(c);
        if (w != null) {
            pw = w.ClientSize.Width;
            ph = w.ClientSize.Height;
            return;
        }
        pw = 0; ph = 0;
    }

    private static void ApplySizeRule(Window w, SizeRule r) {
        double pw, ph;
        ParentSize(r.C, out pw, out ph);
        if (pw <= 0 || ph <= 0) { pw = w.ClientSize.Width; ph = w.ClientSize.Height; }
        if (r.Prop == "width") {
            double v = r.Fill ? Praxis.Fill(pw, OrZero(Canvas.GetLeft(r.C))) : Praxis.Proportional(pw, r.Pct);
            r.C.Width = Math.Max(0, v);
        } else {
            double v = r.Fill ? Praxis.Fill(ph, OrZero(Canvas.GetTop(r.C))) : Praxis.Proportional(ph, r.Pct);
            r.C.Height = Math.Max(0, v);
        }
    }

    private static void AddSizeRule(Control c, string prop, double pct, bool fill) {
        Window w = WindowOf(c);
        if (w == null) throw new VexAxErr("UI Error: Percent/fill sizes need a window.");
        List<SizeRule> rules;
        if (!SizeRules.TryGetValue(w, out rules)) {
            rules = new List<SizeRule>();
            SizeRules[w] = rules;
        }
        SizeRule r = new SizeRule { C = c, Prop = prop, Pct = pct, Fill = fill };
        rules.Add(r);
        ApplySizeRule(w, r);
        if (!HookedWindows.Contains(w)) {
            HookedWindows.Add(w);
            w.SizeChanged += delegate {
                List<SizeRule> rr;
                if (SizeRules.TryGetValue(w, out rr)) foreach (SizeRule x in rr) ApplySizeRule(w, x);
            };
        }
    }

    public static void SetPercent(object o, string prop, object pct) {
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Percent sizes need an element.");
        AddSizeRule(c, prop, AsDouble(pct), false);
    }

    public static void SetFill(object o, string prop) {
        Control c = o as Control;
        if (c == null) throw new VexAxErr("UI Error: Fill sizes need an element.");
        AddSizeRule(c, prop, 100.0, true);
    }

    // ---------- dialogs, pickers, clipboard ----------

    private static Window DialogHost() {
        if (ShownWins.Count > 0) return ShownWins[ShownWins.Count - 1];
        if (Windows.Count > 0) return Windows[Windows.Count - 1];
        return MainWindow;
    }

    public static void ShowMsg(object text) { MsgBox(Display(text), "Message", false); }
    public static void ShowWarn(object text) { MsgBox(Display(text), "Warning", false); }
    public static bool AskYesNo(object text) { return MsgBox(Display(text), "Confirm", true); }
    // Vexel 3.0 Praxis aliases: `confirm` is a Yes/No dialog, `prompt`
    // is a text input dialog (""/cancel distinction preserved).
    public static bool Confirm(object text) { return AskYesNo(text); }
    public static string Prompt(object text) { return InputBox(Display(text)); }
    // Vexel 3.0 Praxis notifications: non-blocking toast overlay that
    // auto-dismisses. Never blocks the UI thread; modal dialogs above
    // still work because toasts are independent windows.
    public static void Notify(string kind, object text, double seconds) {
        string msg = Display(text);
        string k = (kind == null ? "info" : kind.ToLowerInvariant());
        if (k != "info" && k != "success" && k != "warning" && k != "error") k = "info";
        if (!(seconds > 0)) seconds = 3.5;
        if (seconds > 30) seconds = 30;
        try {
            Window host = DialogHost();
            Window toast = new Window();
            toast.Title = "";
            toast.Width = 320;
            toast.Height = 90;
            toast.CanResize = false;
            toast.ShowInTaskbar = false;
            toast.Topmost = true;
            toast.WindowStartupLocation = WindowStartupLocation.Manual;
            try {
                if (host != null) {
                    PixelPoint hp = host.Position;
                    Size hs = host.ClientSize;
                    toast.Position = new PixelPoint(hp.X + Math.Max(0, (int)(hs.Width - 340)), hp.Y + 40);
                }
            } catch (Exception) { }
            Border frame = new Border();
            frame.CornerRadius = new CornerRadius(10);
            frame.Padding = new Thickness(12);
            frame.BorderThickness = new Thickness(1);
            string accent = k == "success" ? "#3FB950" : k == "warning" ? "#D29922" : k == "error" ? "#F85149" : "#58A6FF";
            try {
                frame.Background = new SolidColorBrush(Color.FromRgb(30, 30, 40));
                frame.BorderBrush = new SolidColorBrush(Color.Parse(accent));
            } catch (Exception) { }
            TextBlock tb = new TextBlock();
            tb.Text = msg;
            tb.TextWrapping = TextWrapping.Wrap;
            frame.Child = tb;
            toast.Content = frame;
            try { Praxis.LogText(0, 0, msg, "notify:" + k); } catch (Exception) { }
            toast.Show();
            Avalonia.Threading.DispatcherTimer t = new Avalonia.Threading.DispatcherTimer();
            t.Interval = TimeSpan.FromSeconds(seconds);
            t.Tick += delegate { try { t.Stop(); } catch (Exception) { } try { toast.Close(); } catch (Exception) { } };
            t.Start();
        } catch (Exception ex) {
            throw new VexAxErr("UI Error: Cannot show notification (" + ex.Message + ").");
        }
    }

    // Real modal dialogs: ShowDialog runs a nested event loop, so the
    // call blocks until the user answers without freezing the UI.
    // Avalonia's ShowDialog is async (fire-and-forget returns at once),
    // so pump a nested dispatcher loop until the dialog closes.
    private static void PumpUntilClosed(Window dlg) {
        if (Dispatcher.UIThread == null) throw new VexAxErr("UI Error: Dialogs need the UI thread.");
        CancellationTokenSource cts = new CancellationTokenSource();
        EventHandler closed = null;
        closed = delegate { try { cts.Cancel(); } catch (Exception) { } };
        dlg.Closed += closed;
        try { Dispatcher.UIThread.MainLoop(cts.Token); }
        catch (OperationCanceledException) { }
        finally { try { dlg.Closed -= closed; } catch (Exception) { } try { cts.Dispose(); } catch (Exception) { } }
    }
    private static bool MsgBox(string text, string title, bool question) {
        Window host = DialogHost();
        if (host == null) throw new VexAxErr("UI Error: Dialogs need an open window.");
        Window dlg = new Window();
        dlg.Title = title;
        dlg.Width = 400;
        dlg.Height = 160;
        dlg.CanResize = false;
        dlg.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        TextBlock tb = new TextBlock();
        tb.Text = text;
        tb.TextWrapping = TextWrapping.Wrap;
        tb.MaxWidth = 360;
        tb.Margin = new Thickness(12);
        bool result = false;
        Button ok = new Button();
        ok.Content = question ? "Yes" : "OK";
        ok.HorizontalAlignment = HorizontalAlignment.Center;
        ok.Click += (s, e) => { result = true; dlg.Close(); };
        StackPanel sp = new StackPanel();
        sp.Margin = new Thickness(8);
        sp.Children.Add(tb);
        sp.Children.Add(ok);
        if (question) {
            Button no = new Button();
            no.Content = "No";
            no.HorizontalAlignment = HorizontalAlignment.Center;
            no.Click += (s, e) => { result = false; dlg.Close(); };
            sp.Children.Add(no);
        }
        dlg.Content = sp;
        dlg.ShowDialog(host);
        PumpUntilClosed(dlg);
        return result;
    }
    // Real modal text input: OK returns the typed text, Cancel/close
    // returns "" (documented cancel signal, same as pickers).
    private static string InputBox(string prompt) {
        Window host = DialogHost();
        if (host == null) throw new VexAxErr("UI Error: Dialogs need an open window.");
        Window dlg = new Window();
        dlg.Title = "Input";
        dlg.Width = 400;
        dlg.Height = 180;
        dlg.CanResize = false;
        dlg.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        TextBlock tb = new TextBlock();
        tb.Text = prompt;
        tb.TextWrapping = TextWrapping.Wrap;
        tb.MaxWidth = 360;
        tb.Margin = new Thickness(12, 12, 12, 4);
        TextBox input = new TextBox();
        input.Margin = new Thickness(12, 4, 12, 4);
        input.Width = 360;
        bool ok = false;
        Button okBtn = new Button();
        okBtn.Content = "OK";
        okBtn.Margin = new Thickness(0, 4, 8, 0);
        okBtn.Click += (s, e) => { ok = true; dlg.Close(); };
        Button cancelBtn = new Button();
        cancelBtn.Content = "Cancel";
        cancelBtn.Margin = new Thickness(0, 4, 0, 0);
        cancelBtn.Click += (s, e) => { ok = false; dlg.Close(); };
        StackPanel btns = new StackPanel();
        btns.Orientation = Orientation.Horizontal;
        btns.HorizontalAlignment = HorizontalAlignment.Center;
        btns.Children.Add(okBtn);
        btns.Children.Add(cancelBtn);
        StackPanel sp = new StackPanel();
        sp.Children.Add(tb);
        sp.Children.Add(input);
        sp.Children.Add(btns);
        dlg.Content = sp;
        try { input.Focus(); } catch (Exception) { }
        dlg.ShowDialog(host);
        PumpUntilClosed(dlg);
        if (!ok) return "";
        return input.Text == null ? "" : input.Text;
    }

    public static string PickFile() { return Browser("Open File", true); }
    public static string PickFolder() { return Browser("Open Folder", false); }

    // A real, synchronous browser (nested event loop). An empty result
    // means the user cancelled — that is distinct from a real error,
    // which surfaces as a Vexel error instead.
    private static string Browser(string title, bool files) {
        Window host = DialogHost();
        if (host == null) throw new VexAxErr("UI Error: Pickers need an open window.");
        string dir = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        string chosen = null;
        Window dlg = new Window();
        dlg.Title = title;
        dlg.Width = 480;
        dlg.Height = 380;
        dlg.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        TextBlock path = new TextBlock { Text = dir, Margin = new Thickness(8) };
        Button up = new Button { Content = "Up" };
        ListBox list = new ListBox { Margin = new Thickness(8), Height = 220 };
        Button open = new Button { Content = "Open", Margin = new Thickness(8) };
        Button cancel = new Button { Content = "Cancel", Margin = new Thickness(8) };
        Action fill = delegate {
            list.ItemsSource = null;
            List<string> items = new List<string>();
            items.Add("..");
            try {
                if (files) {
                    items.AddRange(System.IO.Directory.GetFiles(dir));
                    items.AddRange(System.IO.Directory.GetDirectories(dir));
                } else {
                    items.AddRange(System.IO.Directory.GetDirectories(dir));
                }
            } catch (Exception) { }
            list.ItemsSource = items;
            path.Text = dir;
        };
        up.Click += (s, e) => {
            System.IO.DirectoryInfo p = System.IO.Directory.GetParent(dir);
            if (p != null) { dir = p.FullName; fill(); }
        };
        list.DoubleTapped += (s, e) => {
            string sel = list.SelectedItem as string;
            if (sel == null) return;
            if (sel == "..") {
                System.IO.DirectoryInfo p = System.IO.Directory.GetParent(dir);
                if (p != null) { dir = p.FullName; fill(); }
                return;
            }
            if (System.IO.Directory.Exists(sel)) { dir = sel; fill(); return; }
            if (files && System.IO.File.Exists(sel)) { chosen = sel; dlg.Close(); }
        };
        open.Click += (s, e) => {
            string sel = list.SelectedItem as string;
            if (sel == null || sel == "..") return;
            if (files && System.IO.File.Exists(sel)) { chosen = sel; dlg.Close(); return; }
            if (!files && System.IO.Directory.Exists(sel)) { chosen = sel; dlg.Close(); return; }
            if (System.IO.Directory.Exists(sel)) { dir = sel; fill(); }
        };
        cancel.Click += (s, e) => { chosen = null; dlg.Close(); };
        StackPanel sp = new StackPanel();
        sp.Children.Add(path);
        sp.Children.Add(up);
        sp.Children.Add(list);
        StackPanel btns = new StackPanel { Orientation = Orientation.Horizontal };
        btns.Children.Add(open);
        btns.Children.Add(cancel);
        sp.Children.Add(btns);
        dlg.Content = sp;
        fill();
        dlg.ShowDialog(host);
        PumpUntilClosed(dlg);
        return chosen == null ? "" : chosen;
    }

    public static string PickColor() {
        Window host = DialogHost();
        if (host == null) throw new VexAxErr("UI Error: Pickers need an open window.");
        Window dlg = new Window();
        dlg.Title = "Pick a color";
        dlg.Width = 300;
        dlg.Height = 180;
        dlg.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        TextBox hex = new TextBox { Text = "#FF0000", Margin = new Thickness(12) };
        Button ok = new Button { Content = "OK", Margin = new Thickness(12) };
        Button cancel = new Button { Content = "Cancel", Margin = new Thickness(12) };
        string chosen = null;
        ok.Click += (s, e) => {
            try {
                Brush.Parse(hex.Text);
                chosen = hex.Text;
                dlg.Close();
            } catch (Exception) { hex.Text = "Use #RRGGBB"; }
        };
        cancel.Click += (s, e) => { chosen = null; dlg.Close(); };
        StackPanel sp = new StackPanel();
        sp.Children.Add(hex);
        StackPanel btns = new StackPanel { Orientation = Orientation.Horizontal };
        btns.Children.Add(ok);
        btns.Children.Add(cancel);
        sp.Children.Add(btns);
        dlg.Content = sp;
        dlg.ShowDialog(host);
        PumpUntilClosed(dlg);
        return chosen == null ? "" : chosen;
    }

    private static Avalonia.Input.Platform.IClipboard VexClipboard() {
        if (MainWindow == null) throw new VexAxErr("UI Error: Clipboard needs a window.");
        TopLevel tl = TopLevel.GetTopLevel(MainWindow);
        if (tl == null || tl.Clipboard == null) throw new VexAxErr("UI Error: Clipboard is unavailable.");
        return tl.Clipboard;
    }

    public static void ClipboardSet(object val) {
        try {
            VexClipboard().SetTextAsync(Display(val)).GetAwaiter().GetResult();
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("UI Error: Clipboard is unavailable (" + ex.Message + ").");
        }
    }

    public static string ClipboardGet() {
        try {
            string s = VexClipboard().GetTextAsync().GetAwaiter().GetResult();
            return s == null ? "" : s;
        } catch (VexAxErr) { throw; } catch (Exception ex) {
            throw new VexAxErr("UI Error: Clipboard is unavailable (" + ex.Message + ").");
        }
    }
}

public class VexAxErr : Exception {
    public VexAxErr(string message) : base(message) { }
}
