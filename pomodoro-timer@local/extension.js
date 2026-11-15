import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const MODES = {
    focus: {label: 'Focus', key: 'focus-minutes', rgb: [1.0, 0.42, 0.34]},
    short: {label: 'Short break', key: 'short-minutes', rgb: [0.37, 0.83, 0.55]},
    long: {label: 'Long break', key: 'long-minutes', rgb: [0.37, 0.83, 0.55]},
};
const PRESETS = [[15, 3], [25, 5], [50, 10]];

const fmt = secs => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * Pure timer state machine. One GLib timeout, alive only while running.
 * Remaining time is derived from a wall-clock end time, so it stays
 * correct across suspend and never drifts.
 */
class Timer {
    constructor(settings, onChange, onFinish) {
        this._settings = settings;
        this._onChange = onChange;
        this._onFinish = onFinish;
        this._src = 0;
        this._endMs = 0;
        this.mode = 'focus';
        this.running = false;
        this.sessionsDone = 0;
        this._fresh = true;
        this.remaining = this.total;
    }

    get total() {
        return this._settings.get_int(MODES[this.mode].key) * 60;
    }

    /** Stopped with the full length on the clock (nothing started yet). */
    get idle() {
        return !this.running && this._fresh;
    }

    start() {
        if (this.running)
            return;
        if (this.remaining <= 0)
            this.remaining = this.total;
        this._fresh = false;
        this._endMs = GLib.get_real_time() / 1000 + this.remaining * 1000;
        this.running = true;
        this._src = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._tick());
        this._onChange();
    }

    pause() {
        if (!this.running)
            return;
        this._clearSource();
        this.running = false;
        this._onChange();
    }

    reset() {
        this._clearSource();
        this.running = false;
        this._fresh = true;
        this.remaining = this.total;
        this._onChange();
    }

    setMode(mode) {
        this._clearSource();
        this.running = false;
        this.mode = mode;
        this._fresh = true;
        this.remaining = this.total;
        this._onChange();
    }

    /** Move on to the next phase (focus -> break -> focus). Does not start it. */
    next() {
        this._clearSource();
        this.running = false;
        if (this.mode === 'focus') {
            this.sessionsDone++;
            const n = this._settings.get_int('sessions-before-long');
            this.mode = this.sessionsDone % n === 0 ? 'long' : 'short';
        } else {
            this.mode = 'focus';
        }
        this._fresh = true;
        this.remaining = this.total;
        this._onChange();
    }

    /** Give a just-finished phase more time ("+5 min"). */
    extend(mode, secs, undoSessionCount) {
        if (undoSessionCount)
            this.sessionsDone = Math.max(0, this.sessionsDone - 1);
        this.mode = mode;
        this.remaining = secs;
        this.start();
    }

    /** Lengths changed in settings: refresh the display if nothing is in flight. */
    syncLengths() {
        if (!this.running && this._fresh) {
            this.remaining = this.total;
            this._onChange();
        }
    }

    _tick() {
        this.remaining = Math.ceil((this._endMs - GLib.get_real_time() / 1000) / 1000);
        if (this.remaining <= 0) {
            this.remaining = 0;
            this.running = false;
            this._src = 0;
            this._onFinish();
            return GLib.SOURCE_REMOVE;
        }
        this._onChange();
        return GLib.SOURCE_CONTINUE;
    }

    _clearSource() {
        if (this._src) {
            GLib.source_remove(this._src);
            this._src = 0;
        }
    }

    destroy() {
        this._clearSource();
    }
}

const Indicator = GObject.registerClass(
class PomodoroIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Pomodoro Timer', false);
        this._ext = ext;
        this._timer = ext.timer;
        this._settings = ext.settings;
        this._done = false;
        this._gone = false;

        this._buildPill();
        this._buildMenu();

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._done = false;
                this.opacity = 255;
            }
            this.refresh();
        });
        this.connect('scroll-event', (_a, ev) => this._onScroll(ev));
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            // Ignore our own bookkeeping writes (saved-show-banners etc.).
            if (key.endsWith('-minutes') || key === 'sessions-before-long')
                this._timer.syncLengths();
            this.refresh();
        });
        this.refresh();
    }

    _buildPill() {
        this._pill = new St.BoxLayout({style_class: 'pomo-pill', y_align: Clutter.ActorAlign.CENTER});
        this._dot = new St.Widget({y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'pomo-pill-label', y_align: Clutter.ActorAlign.CENTER});
        this._dndIcon = new St.Icon({icon_name: 'notifications-disabled-symbolic', style_class: 'pomo-pill-icon'});
        this._pill.add_child(this._dot);
        this._pill.add_child(this._label);
        this._pill.add_child(this._dndIcon);
        this.add_child(this._pill);
    }

    _item(child) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'pomo-item'});
        child.x_expand = true;
        item.add_child(child);
        this.menu.addMenuItem(item);
        return item;
    }

    _iconButton(icon, name, cb) {
        const b = new St.Button({
            style_class: 'pomo-circle', can_focus: true, accessible_name: name,
            child: new St.Icon({icon_name: icon, icon_size: 16}),
        });
        b.connect('clicked', cb);
        return b;
    }

    _buildMenu() {
        this.menu._boxPointer.add_style_class_name('pomo-boxpointer');

        // Mode tabs
        const tabs = new St.BoxLayout({style_class: 'pomo-tabs'});
        this._tabs = {};
        for (const mode of Object.keys(MODES)) {
            const b = new St.Button({label: MODES[mode].label, style_class: 'pomo-tab', can_focus: true, x_expand: true});
            b.connect('clicked', () => this._timer.setMode(mode));
            tabs.add_child(b);
            this._tabs[mode] = b;
        }
        this._item(tabs);

        // Ring
        const holder = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: 180, height: 180, x_align: Clutter.ActorAlign.CENTER,
        });
        this._ring = new St.DrawingArea({x_expand: true, y_expand: true});
        this._ring.connect('repaint', area => this._paintRing(area));
        const center = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        this._big = new St.Label({style_class: 'pomo-big-time'});
        this._sub = new St.Label({style_class: 'pomo-sub'});
        center.add_child(this._big);
        center.add_child(this._sub);
        holder.add_child(this._ring);
        holder.add_child(center);
        this._item(holder);

        // Controls
        const controls = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 12px;'});
        controls.add_child(this._iconButton('view-refresh-symbolic', 'Reset', () => this._timer.reset()));
        this._main = new St.Button({style_class: 'pomo-primary', can_focus: true});
        this._main.connect('clicked', () => {
            if (this._timer.running)
                this._timer.pause();
            else
                this._timer.start();
        });
        controls.add_child(this._main);
        controls.add_child(this._iconButton('media-skip-forward-symbolic', 'Skip to next', () => {
            this._timer.next();
        }));
        this._item(controls);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Lengths
        const lengths = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: 'spacing: 8px;'});
        lengths.add_child(new St.Label({text: 'TIMER LENGTHS', style_class: 'pomo-section-title'}));
        this._values = {};
        const rows = [['focus', 'Focus', 1, 180, 5], ['short', 'Short break', 1, 60, 1], ['long', 'Long break', 1, 90, 5]];
        for (const [mode, label, min, max, step] of rows)
            lengths.add_child(this._stepRow(mode, label, min, max, step));

        const presets = new St.BoxLayout({style: 'spacing: 6px;'});
        this._chips = [];
        for (const [f, s] of PRESETS) {
            const chip = new St.Button({label: `${f} / ${s}`, style_class: 'pomo-chip', can_focus: true, x_expand: true});
            chip.connect('clicked', () => {
                this._settings.set_int('focus-minutes', f);
                this._settings.set_int('short-minutes', s);
            });
            presets.add_child(chip);
            this._chips.push([chip, f, s]);
        }
        lengths.add_child(presets);
        this._item(lengths);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Toggles
        const dnd = new PopupMenu.PopupSwitchMenuItem('Do Not Disturb while focusing', this._settings.get_boolean('auto-dnd'));
        dnd.connect('toggled', (_i, state) => {
            this._settings.set_boolean('auto-dnd', state);
            this._ext.applyDnd();
        });
        this.menu.addMenuItem(dnd);
        const auto = new PopupMenu.PopupSwitchMenuItem('Auto-start next timer', this._settings.get_boolean('auto-start'));
        auto.connect('toggled', (_i, state) => this._settings.set_boolean('auto-start', state));
        this.menu.addMenuItem(auto);
    }

    _stepRow(mode, label, min, max, step) {
        const key = MODES[mode].key;
        const row = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Label({text: label, style_class: 'pomo-row-label', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const mk = (text, name, delta) => {
            const b = new St.Button({label: text, style_class: 'pomo-step', can_focus: true, accessible_name: `${name} ${label.toLowerCase()} length`});
            b.connect('clicked', () => {
                const v = this._settings.get_int(key);
                // 1-minute steps below 10, otherwise snap to multiples of `step` (25 -> 30 -> 35).
                let target;
                if (delta > 0)
                    target = v < 10 ? v + 1 : (Math.floor(v / step) + 1) * step;
                else
                    target = v <= 10 ? v - 1 : (Math.ceil(v / step) - 1) * step;
                this._settings.set_int(key, Math.min(max, Math.max(min, target)));
            });
            return b;
        };
        row.add_child(mk('−', 'Decrease', -1));
        const value = new St.Label({style_class: 'pomo-value', y_align: Clutter.ActorAlign.CENTER});
        this._values[mode] = value;
        row.add_child(value);
        row.add_child(mk('+', 'Increase', 1));
        return row;
    }

    _paintRing(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const r = Math.min(w, h) / 2 - 8;
        const [R, G, B] = MODES[this._timer.mode].rgb;
        cr.setLineWidth(9);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
        cr.stroke();
        const frac = Math.max(0, Math.min(1, this._timer.remaining / this._timer.total));
        if (frac > 0) {
            cr.setSourceRGBA(R, G, B, 1);
            cr.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac);
            cr.stroke();
        }
        cr.$dispose();
    }

    _onScroll(ev) {
        if (this._timer.running)
            return Clutter.EVENT_PROPAGATE;
        const dir = ev.get_scroll_direction();
        const key = MODES[this._timer.mode].key;
        const v = this._settings.get_int(key);
        if (dir === Clutter.ScrollDirection.UP)
            this._settings.set_int(key, Math.min(180, v + 1));
        else if (dir === Clutter.ScrollDirection.DOWN)
            this._settings.set_int(key, Math.max(1, v - 1));
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }

    setDone(done) {
        this._done = done;
        this.refresh();
        if (done)
            this._pulse(3);
    }

    _pulse(times) {
        const step = i => {
            if (this._gone || i >= times) {
                if (!this._gone)
                    this.opacity = 255;
                return;
            }
            this.ease({
                opacity: 110, duration: 450, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    if (this._gone)
                        return;
                    this.ease({
                        opacity: 255, duration: 450, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: () => step(i + 1),
                    });
                },
            });
        };
        step(0);
    }

    refresh() {
        if (this._gone)
            return;
        const t = this._timer;
        if (t.running)
            this._done = false;

        // Pill
        let text = fmt(t.remaining);
        if (t.mode !== 'focus')
            text = `${t.mode === 'long' ? 'Long break' : 'Break'} ${text}`;
        if (this._done)
            text = "Time's up";
        this._label.text = text;

        const dotState = t.running ? t.mode : (t.idle ? 'idle' : 'paused');
        this._dot.style_class = `pomo-dot pomo-dot-${dotState}`;
        this._dot.visible = !this._done;
        this._dndIcon.visible = this._ext.dndActive;
        if (this._done)
            this.add_style_class_name('pomodoro-done');
        else
            this.remove_style_class_name('pomodoro-done');

        // Popup (only worth updating while it is visible)
        if (!this.menu.isOpen)
            return;
        this._big.text = fmt(t.remaining);
        const n = this._settings.get_int('sessions-before-long');
        this._sub.text = t.mode === 'focus'
            ? `Session ${(t.sessionsDone % n) + 1} of ${n}`
            : (t.mode === 'long' ? 'Long break' : 'Short break');
        this._main.label = t.running ? 'Pause' : (t.idle ? 'Start' : 'Resume');
        if (t.mode === 'focus')
            this._main.remove_style_class_name('pomo-primary-break');
        else
            this._main.add_style_class_name('pomo-primary-break');
        for (const [mode, b] of Object.entries(this._tabs))
            b.checked = mode === t.mode;
        for (const [mode, label] of Object.entries(this._values))
            label.text = `${this._settings.get_int(MODES[mode].key)} min`;
        const f = this._settings.get_int('focus-minutes');
        const s = this._settings.get_int('short-minutes');
        for (const [chip, cf, cs] of this._chips)
            chip.checked = cf === f && cs === s;
        this._ring.queue_repaint();
    }

    destroy() {
        this._gone = true;
        this.remove_all_transitions();
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = 0;
        super.destroy();
    }
});

export default class PomodoroExtension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this._desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this.dndActive = false;
        this._lastFinished = null;

        // A previous shell crash may have left DND forced on: put it back first.
        this._restoreBanners();

        this.timer = new Timer(
            this.settings,
            () => {
                this.applyDnd();
                this._indicator?.refresh();
            },
            () => this._onFinish());

        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'center');
    }

    disable() {
        this.timer?.destroy();
        this.timer = null;
        this._restoreBanners();
        this._source?.destroy();
        this._source = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._desktop = null;
        this.settings = null;
    }

    /** DND is on exactly while a focus timer runs (and the option is enabled). */
    applyDnd() {
        const want = !!this.timer && this.timer.running && this.timer.mode === 'focus'
            && this.settings.get_boolean('auto-dnd');
        if (want && !this.dndActive) {
            if (this.settings.get_int('saved-show-banners') === -1)
                this.settings.set_int('saved-show-banners', this._desktop.get_boolean('show-banners') ? 1 : 0);
            this._desktop.set_boolean('show-banners', false);
            this.dndActive = true;
        } else if (!want && this.dndActive) {
            this._restoreBanners();
        }
    }

    _restoreBanners() {
        const saved = this.settings.get_int('saved-show-banners');
        if (saved !== -1) {
            this._desktop.set_boolean('show-banners', saved === 1);
            this.settings.set_int('saved-show-banners', -1);
        }
        this.dndActive = false;
    }

    _onFinish() {
        const t = this.timer;
        const finished = t.mode;
        const undoCount = finished === 'focus';
        t.next();            // moves to the next phase, stopped
        this.applyDnd();     // releases DND before we notify
        this._lastFinished = {finished, undoCount};
        this._indicator.setDone(true);
        this._notify(finished, t.mode);
        if (this.settings.get_boolean('auto-start'))
            t.start();
    }

    _notify(finished, next) {
        if (!this._source) {
            this._source = new MessageTray.Source({title: 'Pomodoro', iconName: 'alarm-symbolic'});
            this._source.connect('destroy', () => { this._source = null; });
            Main.messageTray.add(this._source);
        }
        const nextMins = this.settings.get_int(MODES[next].key);
        const title = finished === 'focus' ? 'Focus session done' : 'Break is over';
        const body = finished === 'focus'
            ? `Nice work. Time for a ${nextMins} min ${next === 'long' ? 'long' : 'short'} break.`
            : `Ready for the next ${nextMins} min focus session?`;
        const n = new MessageTray.Notification({
            source: this._source, title, body,
            urgency: MessageTray.Urgency.CRITICAL, // shows even if the user has DND on
        });
        n.addAction(next === 'focus' ? `Start ${nextMins} min focus` : `Start ${nextMins} min break`, () => this.timer?.start());
        n.addAction('+5 min', () => {
            const info = this._lastFinished;
            if (info)
                this.timer?.extend(info.finished, 300, info.undoCount);
        });
        n.addAction('Stop', () => this.timer?.reset());
        this._source.addNotification(n);
    }
}
