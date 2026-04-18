import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const KEYBINDING_NAME = 'push-to-talk-shortcut';
const IPC_BASE_URL = 'http://127.0.0.1:39667';


export default class AssistantPushToTalkExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.assistant-ptt');
        this._httpSession = new Soup.Session();

        Main.wm.addKeybinding(
            KEYBINDING_NAME,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            this._handleShortcut.bind(this),
        );
    }

    disable() {
        if (this._settings !== null) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
        }

        this._settings = null;
        this._httpSession = null;
    }

    _handleShortcut() {
        this._postJson('/push-to-talk/toggle', {});
    }

    _postJson(path, payload) {
        if (this._httpSession === null) {
            return;
        }

        const message = Soup.Message.new('POST', `${IPC_BASE_URL}${path}`);
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        message.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(bytes),
        );

        this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (_session, result) => {
                try {
                    this._httpSession.send_and_read_finish(result);
                } catch (error) {
                    console.error(`[assistant-ptt] request failed: ${error}`);
                    Main.notify(
                        'Assistant Push-to-Talk',
                        'The local Qt shell did not accept the hotkey command.',
                    );
                }
            },
        );
    }
}
