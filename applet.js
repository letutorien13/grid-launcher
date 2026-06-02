const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;

const STORAGE_PATH = GLib.get_home_dir() + '/.config/cinnamon_grid_launcher_data.json';
const POPUP_COLUMNS = 6;
const DISPLAY_GRID = 'grid';
const DISPLAY_LIST = 'list';

function AppListMenuItem(applet, app) {
    this._init(applet, app);
}

AppListMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(applet, app) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, { reactive: true, activate: true });

        this.applet = applet;
        this.app = app;
        this.appId = app.get_id();

        let icon = app.create_icon_texture(24);
        if (icon)
            this.addActor(icon, { span: 0 });

        this.label = new St.Label({ text: app.get_name() });
        this.addActor(this.label);
        this.actor.label_actor = this.label;

        this.connect('activate', function() {
            this.app.activate();
            this.applet.menu.close();
        });

        this.actor.connect('button-press-event', function(actor, event) {
            if (event.get_button() === 3) {
                this.applet._showAppContextMenu(this.actor, this.appId);
                return true;
            }
            return false;
        });
    }
};

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
        this.savedApps = data.apps || [];
        this.categoryName = data.name || "Grille d'applications";
        this.displayMode = data.displayMode === DISPLAY_LIST ? DISPLAY_LIST : DISPLAY_GRID;
        this.set_applet_tooltip(this.categoryName);

        this.launcherBox = new St.BoxLayout({ style_class: 'applet-box', reactive: true });
        this.actor.add_actor(this.launcherBox);

        this.gridIcon = new St.Table({ homogeneous: true, style_class: 'grid-icon-launcher' });
        this.launcherBox.add_actor(this.gridIcon);

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.categoryLabel = new St.Label({
            style_class: 'category-title-label',
            text: this.categoryName
        });

        this.popupGrid = new St.Table({
            homogeneous: true,
            style_class: 'popup-grid',
            style: 'width: 500; padding: 2 px; spacing-rows: 2 px; spacing-columns: 2 px;'
        });

        this.menuContentBox = new St.BoxLayout({ vertical: true });
        this.menuContentBox.add_actor(this.categoryLabel);
        this.menuContentBox.add_actor(this.popupGrid);

        this.menuSection = new PopupMenu.PopupMenuSection();
        this.menuSection.actor.add_actor(this.menuContentBox);
        this.menu.addMenuItem(this.menuSection);

        this._listMenuItems = [];

        this.menu.connect('open-state-changed', (menu, open) => {
            if (!open) this._closeAppContextMenu();
        });

        this.editNameMenuItem = new PopupMenu.PopupMenuItem("Renommer la catégorie");
        this._applet_context_menu.addMenuItem(this.editNameMenuItem);
        this.editNameMenuItem.connect('activate', () => this._renameCategory());

        this.sortByNameMenuItem = new PopupMenu.PopupMenuItem("Trier par nom");
        this._applet_context_menu.addMenuItem(this.sortByNameMenuItem);
        this.sortByNameMenuItem.connect('activate', () => this._sortAppsByName());

        this.toggleDisplayModeMenuItem = new PopupMenu.PopupMenuItem("");
        this._applet_context_menu.addMenuItem(this.toggleDisplayModeMenuItem);
        this.toggleDisplayModeMenuItem.connect('activate', () => this._toggleDisplayMode());
        this._updateDisplayModeMenuLabel();

        this.actor._delegate = this;
        this._refreshUI();
    },

    _updateDisplayModeMenuLabel: function() {
        if (!this.toggleDisplayModeMenuItem)
            return;
        let text = this.displayMode === DISPLAY_LIST
            ? "Afficher en mode grille"
            : "Afficher en mode liste";
        this.toggleDisplayModeMenuItem.label.set_text(text);
    },

    _toggleDisplayMode: function() {
        this.displayMode = this.displayMode === DISPLAY_LIST ? DISPLAY_GRID : DISPLAY_LIST;
        this._updateDisplayModeMenuLabel();
        this._saveData();
        this._refreshUI();
    },

    _clearListMenuItems: function() {
        if (!this._listMenuItems)
            return;
        for (let i = 0; i < this._listMenuItems.length; i++)
            this._listMenuItems[i].destroy();
        this._listMenuItems = [];
    },

    _updateCategoryLabel: function() {
        if (!this.categoryLabel)
            return;
        let name = (this.categoryName || '').trim();
        this.categoryLabel.text = name || "Grille d'applications";
    },

    _sortAppsByName: function() {
        if (!this.savedApps || this.savedApps.length < 2)
            return;

        let self = this;
        this.savedApps.sort(function(idA, idB) {
            let appA = self.appSystem.lookup_app(idA);
            let appB = self.appSystem.lookup_app(idB);
            let nameA = appA ? appA.get_name() : idA;
            let nameB = appB ? appB.get_name() : idB;
            return nameA.localeCompare(nameB);
        });

        this._saveData();
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
                        this._updateCategoryLabel();
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
        this._updateCategoryLabel();

        this._clearListMenuItems();

        this.gridIcon.destroy_all_children();
        this.popupGrid.destroy_all_children();

        let isListMode = this.displayMode === DISPLAY_LIST;
        if (isListMode)
            this.popupGrid.hide();
        else
            this.popupGrid.show();

        let loadedApps = [];
        this.savedApps.forEach(appId => {
            let app = this.appSystem.lookup_app(appId);
            if (app) loadedApps.push(app);
        });

        // Petite grille sur le panel (inchangée)
        for (let i = 0; i < 4; i++) {
            let row = Math.floor(i / 2);
            let col = i % 2;
            let bin = new St.Bin({ style_class: 'mini-icon-padding' });
            if (loadedApps[i]) {
                let icon = loadedApps[i].create_icon_texture(24);
                bin.set_child(icon);
            } else {
                let placeholder = new St.BoxLayout({ style_class: 'empty-slot' });
                bin.set_child(placeholder);
            }
            this.gridIcon.add(bin, { row: row, col: col });
        }

        if (isListMode) {
            for (let i = 0; i < loadedApps.length; i++) {
                let item = new AppListMenuItem(this, loadedApps[i]);
                this.menu.addMenuItem(item);
                this._listMenuItems.push(item);
            }
        } else {
            loadedApps.forEach(function(app, index) {
                let row = Math.floor(index / POPUP_COLUMNS);
                let col = index % POPUP_COLUMNS;
                let appId = app.get_id();

                let btn = new St.Button({
                    style_class: 'app-button',
                    reactive: true,
                    style: 'padding: 6px;'
                });

                btn.set_child(app.create_icon_texture(48));

                btn.connect('clicked', function() {
                    app.activate();
                    this.menu.close();
                }.bind(this));

                btn.connect('button-press-event', function(actor, event) {
                    if (event.get_button() === 3) {
                        this._showAppContextMenu(btn, appId);
                        return true;
                    }
                    return false;
                }.bind(this));

                this.popupGrid.add(btn, { row: row, col: col });
            }, this);
        }
    },

    on_applet_clicked: function() {
        if (this.savedApps.length > 0) {
            this.menu.toggle();
        }
    },

    _loadData: function() {
        let defaultData = { apps: [], name: "Grille d'applications", displayMode: DISPLAY_GRID };
        try {
            let file = Gio.File.new_for_path(STORAGE_PATH);
            if (file.query_exists(null)) {
                let [success, content] = file.load_contents(null);
                if (success) {
                    let json = JSON.parse(String(content));
                    let data = json[this.instance_id];
                    if (data) {
                        if (Array.isArray(data)) {
                            return {
                                apps: data,
                                name: "Grille d'applications",
                                displayMode: DISPLAY_GRID
                            };
                        }
                        if (!data.displayMode)
                            data.displayMode = DISPLAY_GRID;
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
            currentData[this.instance_id] = {
                apps: this.savedApps,
                name: this.categoryName,
                displayMode: this.displayMode
            };
            file.replace_contents(JSON.stringify(currentData), null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) {
            global.logError(e);
        }
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}
