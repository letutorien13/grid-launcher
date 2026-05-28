const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;

const STORAGE_PATH = GLib.get_home_dir() + '/.config/cinnamon_grid_launcher_data.json';

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id);

        this.instance_id = instance_id;
        this.orientation = orientation;
        this.appSystem = Cinnamon.AppSystem.get_default();

        this._contextMenuActor = null;
        this._stageSignalId = null;
        this._originalContains = null;

        let data = this._loadData();
        this.savedApps = data.apps;
        this.categoryName = data.name;

        this.set_applet_tooltip(this.categoryName);

        this.launcherBox = new St.BoxLayout({ style_class: 'applet-box', reactive: true });
        this.actor.add_actor(this.launcherBox);

        this.gridIcon = new St.Table({ homogeneous: true, style_class: 'grid-icon-launcher' });
        this.launcherBox.add_actor(this.gridIcon);

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.popupGrid = new St.Table({ homogeneous: true, style_class: 'popup-grid' });
        let menuSection = new PopupMenu.PopupMenuSection();
        menuSection.actor.add_actor(this.popupGrid);
        this.menu.addMenuItem(menuSection);

        this.menu.connect('open-state-changed', (menu, open) => {
            if (!open) this._closeAppContextMenu();
        });

        this.editNameMenuItem = new PopupMenu.PopupMenuItem("Renommer la catégorie");
        this._applet_context_menu.addMenuItem(this.editNameMenuItem);
        this.editNameMenuItem.connect('activate', () => this._renameCategory());

        this.actor._delegate = this;
        this._refreshUI();
    },

    _renameCategory: function() {
        try {
            let proc = new Gio.Subprocess({
                argv: ['zenity', '--entry', '--title=Grid Launcher', '--text=Nom de la catégorie :', '--entry-text=' + this.categoryName],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (obj, res) => {
                let [success, stdout, stderr] = obj.communicate_utf8_finish(res);
                if (success && stdout) {
                    let newName = stdout.trim();
                    if (newName) {
                        this.categoryName = newName;
                        this.set_applet_tooltip(this.categoryName);
                        this._saveData();
                    }
                }
            });
        } catch (e) {
            global.logError(e);
        }
    },

    _showAppContextMenu: function(sourceActor, appId) {
        this._closeAppContextMenu();

        this._contextMenuActor = new St.BoxLayout({
            style_class: 'custom-context-menu',
            vertical: true,
            reactive: true
        });

        let removeItem = new St.Button({
            style_class: 'custom-context-item',
            label: "Retirer l'icône",
            reactive: true,
            x_align: St.Align.START
        });

        removeItem.connect('clicked', () => {
            this.savedApps = this.savedApps.filter(id => id !== appId);
            this._saveData();
            this._closeAppContextMenu();
            this._refreshUI();
        });

        this._contextMenuActor.add_actor(removeItem);
        Main.uiGroup.add_actor(this._contextMenuActor);

        let [x, y] = sourceActor.get_transformed_position();
        let [w, h] = sourceActor.get_transformed_size();
        this._contextMenuActor.set_position(x, y + h + 2);

        this._originalContains = this.menu.actor.contains;
        this.menu.actor.contains = (descendant) => {
            if (this._contextMenuActor && (descendant === this._contextMenuActor || this._contextMenuActor.contains(descendant))) {
                return true;
            }
            return this._originalContains.call(this.menu.actor, descendant);
        };

        this._stageSignalId = global.stage.connect('button-press-event', (stage, event) => {
            let target = event.get_source();
            if (target !== this._contextMenuActor && !this._contextMenuActor.contains(target)) {
                this._closeAppContextMenu();
            }
        });
    },

    _closeAppContextMenu: function() {
        if (this._originalContains) {
            this.menu.actor.contains = this._originalContains;
            this._originalContains = null;
        }
        if (this._contextMenuActor) {
            if (this._stageSignalId) {
                global.stage.disconnect(this._stageSignalId);
                this._stageSignalId = null;
            }
            Main.uiGroup.remove_actor(this._contextMenuActor);
            this._contextMenuActor.destroy();
            this._contextMenuActor = null;
        }
    },

    handleDragOver: function(source, actor, x, y, time) {
        return true;
    },

    acceptDrop: function(source, actor, x, y, time) {
        let appId = null;
        if (source && source.app && typeof source.app.get_id === 'function') {
            appId = source.app.get_id();
        } else if (source && typeof source.get_app_id === 'function') {
            appId = source.get_app_id();
        } else if (source && source.id) {
            appId = source.id;
        }

        if (appId) {
            if (!this.savedApps.includes(appId)) {
                this.savedApps.push(appId);
                this._saveData();
                this._refreshUI();
            }
            return true;
        }
        return false;
    },

    _refreshUI: function() {
        this.gridIcon.destroy_all_children();
        this.popupGrid.destroy_all_children();

        let loadedApps = [];
        this.savedApps.forEach(appId => {
            let app = this.appSystem.lookup_app(appId);
            if (app) loadedApps.push(app);
        });

        for (let i = 0; i < 4; i++) {
            let row = Math.floor(i / 2);
            let col = i % 2;
            let bin = new St.Bin({ style_class: 'mini-icon-padding' });

            if (loadedApps[i]) {
                let icon = loadedApps[i].create_icon_texture(24);
                bin.set_child(icon);
            } else {
                let placeholder = new St.BoxLayout({
                    style_class: 'empty-slot',
                });
                bin.set_child(placeholder);
            }
            this.gridIcon.add(bin, { row: row, col: col });
        }

        loadedApps.forEach((app, index) => {
            let row = Math.floor(index / 3);
            let col = index % 3;
            let appId = app.get_id();

            let btn = new St.Button({ style_class: 'app-button', reactive: true });
            let icon = app.create_icon_texture(48);
            btn.set_child(icon);

            btn.connect('clicked', () => {
                app.activate();
                this.menu.close();
            });

            btn.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 3) {
                    this._showAppContextMenu(btn, appId);
                    return true;
                }
                return false;
            });

            this.popupGrid.add(btn, { row: row, col: col });
        });
    },

    on_applet_clicked: function() {
        if (this.savedApps.length > 0) {
            this.menu.toggle();
        }
    },

    _loadData: function() {
        let defaultData = { apps: [], name: "Grille d'applications" };
        try {
            let file = Gio.File.new_for_path(STORAGE_PATH);
            if (file.query_exists(null)) {
                let [success, content] = file.load_contents(null);
                if (success) {
                    let json = JSON.parse(String(content));
                    let data = json[this.instance_id];
                    if (data) {
                        if (Array.isArray(data)) return { apps: data, name: "Grille d'applications" };
                        return data;
                    }
                }
            }
        } catch (e) {
            global.logError(e);
        }
        return defaultData;
    },

    _saveData: function() {
        try {
            let file = Gio.File.new_for_path(STORAGE_PATH);
            let currentData = {};
            if (file.query_exists(null)) {
                let [success, content] = file.load_contents(null);
                if (success) {
                    currentData = JSON.parse(String(content));
                }
            }
            currentData[this.instance_id] = { apps: this.savedApps, name: this.categoryName };
            file.replace_contents(JSON.stringify(currentData), null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) {
            global.logError(e);
        }
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}
