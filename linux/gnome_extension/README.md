# GNOME Push-to-Talk Backend

This folder contains a GNOME Shell extension that acts as a GNOME-specific hotkey backend for the Linux Qt shell.

Current behaviour:

- it registers a GNOME Shell shortcut through an extension-local GSettings schema
- the shortcut toggles native push-to-talk in the local Qt shell over `http://127.0.0.1:39667`
- it is intended for Ubuntu GNOME 46 / Wayland where the active portal stack does not expose `org.freedesktop.portal.GlobalShortcuts`

Current limitation:

- this is a **toggle backend**, not a true hold/release backend
- it is GNOME-specific and does not help on KDE, Sway, Hyprland, or other shells

Install:

```bash
bash linux/gnome_extension/install.sh
```

After installation, restart the Qt shell and check the control panel:

- `Hotkey backend` should report the GNOME extension backend as active
- the `Shortcut` row should show the configured accelerator

The Qt shell control panel can now update the GNOME shortcut directly. The manual `gsettings` command below is only needed if you want to change it outside the shell.

To change the shortcut:

```bash
gsettings set org.gnome.shell.extensions.assistant-ptt push-to-talk-shortcut "['F8']"
```

You may need to log out and back in if GNOME Shell does not reload the extension cleanly.
