# Pomodoro Timer for GNOME Shell

A light Pomodoro timer that lives in your top bar. Pick your own focus and break lengths, let it switch **Do Not Disturb** on while you focus, and get a clear alert when time is up. The popup is translucent, so it picks up the glass look from extensions like [Blur my Shell](https://github.com/aunetx/blur-my-shell).

![GNOME Shell 51](https://img.shields.io/badge/GNOME%20Shell-51-4a86cf)
![License MIT](https://img.shields.io/badge/license-MIT-green)

```
 Activities            Mon 16 Nov  14:32  (● 17:48 ☾)             wifi  vol  battery
                                              │
                          ┌───────────────────┴──────────────┐
                          │ [ Focus ][ Short break ][ Long ] │
                          │            ◜ 17:48 ◝             │
                          │         Session 2 of 4           │
                          │      ↻     [ Pause ]     ⏭      │
                          │ TIMER LENGTHS                    │
                          │ Focus         −  25 min  +       │
                          │ Short break   −   5 min  +       │
                          │ Long break    −  15 min  +       │
                          │ [15 / 3] [25 / 5] [50 / 10]      │
                          │ Do Not Disturb while focusing  ◉ │
                          │ Auto-start next timer          ○ │
                          └──────────────────────────────────┘
```

## Features

- **Top bar pill** next to the clock: a coloured dot, the countdown, and a moon icon while DND is on.
- **Your own timer lengths**: step focus, short break and long break with −/+, use a preset (15/3, 25/5, 50/10), or scroll over the pill while idle.
- **Automatic Do Not Disturb** while a focus timer runs. Your previous setting is saved and restored, even after a crash.
- **Time's up alert**: the pill turns solid and pulses, and a notification offers *Start next*, *+5 min* and *Stop*.
- **Long breaks** after every N focus sessions (4 by default).
- **Auto-start** the next timer if you want a hands-off flow.
- **Light**: one 1-second timer that exists only while the clock is running, and the popup only redraws while it is open. No background processes, no dependencies.

## Install

Requirements: GNOME Shell 51 (see [Compatibility](#compatibility)), `glib-compile-schemas` (in `libglib2.0-bin` on Debian/Ubuntu, or `glib2` on Fedora and Arch).

```bash
git clone https://github.com/Marshmellow31/pomodoro-timer-gnome.git
cd pomodoro-timer-gnome
./install.sh
```

Then **log out and back in**. On Wayland, GNOME only discovers new extensions at login. After that, if the install script has not already enabled it:

```bash
gnome-extensions enable pomodoro-timer@local
```

For development, `./install.sh --link` symlinks the folder instead of copying it. To remove it, run `./install.sh --uninstall`.

## Quick use

| Do this | To get this |
| --- | --- |
| Click the pill | Open the popup |
| **Start** | Begin the selected timer (DND turns on for Focus) |
| **Pause / Resume** | Stop the clock; DND is released |
| ↻ | Reset the current timer |
| ⏭ | Skip to the next phase |
| Scroll over the pill (idle) | Change the current timer's length by 1 min |
| Toggle *Auto-start next timer* | Chain focus and breaks without clicking |

The full walkthrough, DND details, settings keys and troubleshooting are in the **[user guide](docs/GUIDE.md)**.

## Compatibility

Developed and tested on **GNOME Shell 51 (Wayland)**. The code uses the standard extension APIs from GNOME 46 onward, so older versions may work, but they are untested and not listed in `metadata.json`. If you try another version, add it to `shell-version` and open an issue or PR with the result.

## How it works

`extension.js` has three small pieces:

- `Timer`: a state machine (focus → break → focus) that derives the remaining time from a wall-clock end time, so it stays correct across suspend and never drifts.
- `Indicator`: the top bar pill and the popup, built from standard `St` widgets and styled by `stylesheet.css`.
- `PomodoroExtension`: wires them together, owns the DND logic, and sends the time's-up notification.

DND is computed from state rather than toggled by hand: it is on exactly when a focus timer is running and the option is enabled. Pause, skip, finish and disable all go through the same function, so DND cannot get stuck on.

## Contributing

Issues and pull requests are welcome. See the *Development* section of the [guide](docs/GUIDE.md#development) for how to test changes and read logs.

## License

[MIT](LICENSE)
