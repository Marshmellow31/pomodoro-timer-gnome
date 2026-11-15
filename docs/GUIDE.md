# User guide

A walkthrough of Pomodoro Timer for GNOME Shell. For install steps see the [README](../README.md).

## Contents

1. [The Pomodoro method in 30 seconds](#the-pomodoro-method-in-30-seconds)
2. [The top bar pill](#the-top-bar-pill)
3. [The popup](#the-popup)
4. [Choosing timer lengths](#choosing-timer-lengths)
5. [Do Not Disturb](#do-not-disturb)
6. [When time is up](#when-time-is-up)
7. [Settings reference](#settings-reference)
8. [Troubleshooting](#troubleshooting)
9. [Development](#development)

## The Pomodoro method in 30 seconds

Work in short, focused blocks with breaks between them. The classic rhythm is 25 minutes of focus, a 5 minute break, and after four focus sessions a longer 15 minute break. This extension defaults to that rhythm, and every length is adjustable.

## The top bar pill

The pill sits next to the clock. It shows what the timer is doing at a glance:

| State | What you see | DND |
| --- | --- | --- |
| Idle | Hollow dot and the full length, e.g. `25:00` | Untouched |
| Focus running | Coral dot, countdown, moon icon | On |
| Paused | Grey dot, remaining time | Off |
| Break | Green dot, `Break 04:12` or `Long break 14:30` | Back to your setting |
| Time's up | Solid coral pill reading `Time's up`, pulses three times | Back to your setting |

Click the pill to open the popup. While idle, scroll up or down over it to change the current timer's length by one minute.

## The popup

- **Tabs** (Focus, Short break, Long break) switch the timer you are about to run. Switching stops any running timer and loads the new length.
- **The ring** shows the time left. It is coral for focus and green for breaks.
- **Start / Pause / Resume** controls the clock. **↻** resets the current timer to its full length. **⏭** skips to the next phase, counting a skipped focus session as done.
- **Session k of N** tells you where you are before the next long break.

## Choosing timer lengths

Under *Timer lengths* you can set each length:

- The **−** and **+** buttons move by 1 minute below 10, and snap to multiples of 5 above that (25 → 30 → 35).
- The **presets** `15 / 3`, `25 / 5` and `50 / 10` set the focus and short-break lengths together. The long break is left alone.
- Changes apply straight away if the timer has not started. A timer that is running or paused keeps its current clock, and the new length is used from the next phase.

Limits: focus 1 to 180 min, short break 1 to 60 min, long break 1 to 90 min. The number of focus sessions before a long break (default 4) is set with gsettings, see below.

## Do Not Disturb

With **Do Not Disturb while focusing** on (the default), the extension turns off notification banners while a focus timer runs.

- It does this through the standard GNOME setting `org.gnome.desktop.notifications show-banners`, the same one the quick settings DND toggle uses.
- Before changing it, the extension **saves your current value** and restores exactly that value afterwards. If you already had DND on, it stays on when the session ends.
- DND is released when you pause, reset, skip, switch tabs, when time is up, and when the extension is disabled.
- If the shell crashes during a session, the saved value is restored the next time the extension loads.
- Breaks never turn DND on.

Turn the option off in the popup if you want the timer without touching DND.

## When time is up

1. The pill turns solid, reads `Time's up` and pulses three times. The pulse clears when you open the popup or start a timer.
2. DND is released before the notification is sent.
3. A notification appears with three actions:
   - **Start next**: begins the next phase (a break after focus, focus after a break).
   - **+5 min**: gives the phase that just ended five more minutes.
   - **Stop**: leaves the next phase loaded but not running.

The notification is marked critical, so it is shown even if you have DND on yourself. There is no sound by default.

With **Auto-start next timer** on, the next phase starts by itself right after the alert.

## Settings reference

Everything common is in the popup. The rest can be changed with `gsettings`:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `focus-minutes` | int | 25 | Focus length |
| `short-minutes` | int | 5 | Short break length |
| `long-minutes` | int | 15 | Long break length |
| `sessions-before-long` | int | 4 | Focus sessions before a long break (2 to 10) |
| `auto-dnd` | bool | true | Turn on DND while focusing |
| `auto-start` | bool | false | Start the next timer automatically |
| `saved-show-banners` | int | -1 | Internal. The value to restore after DND (-1 means nothing saved) |

Because the schema is stored inside the extension folder, point `gsettings` at it:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/pomodoro-timer@local/schemas \
  set org.gnome.shell.extensions.pomodoro-timer sessions-before-long 3
```

## Troubleshooting

**The extension does not show up after installing.** On Wayland, log out and back in. Then check `gnome-extensions list | grep pomodoro`.

**State is `ERROR`.** Read the shell log:

```bash
gnome-extensions info pomodoro-timer@local | grep State
journalctl --since "5 min ago" -o cat _COMM=gnome-shell | grep -A6 pomodoro
```

If you just updated the files, log out and back in. GNOME caches an extension's JavaScript until the shell restarts, so a plain disable and enable will keep running the old code.

**DND did not come back.** Check the value, and set it yourself if needed:

```bash
gsettings get org.gnome.desktop.notifications show-banners
gsettings set org.gnome.desktop.notifications show-banners true
```

**The popup is not blurred.** The popup is translucent, so any blur has to come from another extension. In Blur my Shell, check that its panel-menu blur option is on. Without a blur extension the popup is still readable, just flatter.

**Reset everything to defaults.**

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/pomodoro-timer@local/schemas \
  reset-recursively org.gnome.shell.extensions.pomodoro-timer
```

## Development

Layout:

```
pomodoro-timer@local/
  extension.js      Timer, Indicator and the extension class
  stylesheet.css    pill and popup styling
  metadata.json     uuid and supported shell versions
  schemas/          gsettings schema (compiled by install.sh)
install.sh          install, link or uninstall
docs/GUIDE.md       this guide
```

Workflow:

1. `./install.sh --link` once, so the shell reads straight from your working copy.
2. Edit the files. Run `glib-compile-schemas pomodoro-timer@local/schemas` if you change the schema.
3. Check syntax quickly with `node --check --input-type=module < pomodoro-timer@local/extension.js`.
4. Reload the code. On a Wayland session this means logging out and back in. A faster loop is a nested shell, for example `dbus-run-session gnome-shell --devkit` on GNOME 49+ (needs `mutter-devkit`).
5. Watch the log with `journalctl -f -o cat /usr/bin/gnome-shell`.

When adding support for another GNOME version, add it to `shell-version` in `metadata.json` only after you have run it there.
