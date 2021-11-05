"use strict";

const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const GObject = imports.gi.GObject;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Podman = Me.imports.modules.podman;
const Logger = Me.imports.modules.logger;

let containersMenu;


/**
 * enable is the entry point called by gnome-shell
 */
// eslint-disable-next-line no-unused-vars
function enable() {
    Logger.info("enabling containers extension");
    Podman.discoverPodmanVersion();
    containersMenu = new ContainersMenu();
    Logger.debug(containersMenu);
    containersMenu.renderMenu();
    Main.panel.addToStatusArea("containers-menu", containersMenu);
}

/** disable is called when the main extension menu is closed **/
// eslint-disable-next-line no-unused-vars
function disable() {
    Logger.info("disabling containers extension");
    containersMenu.destroy();
}

/** createIcon is just a convenience shortcut for standard icons
 *
 * @param {string} name is icon name
 * @param {string} styleClass is style_class
 */
function createIcon(name, styleClass) {
    return new St.Icon({icon_name: name, style_class: styleClass, icon_size: "14"});
}

var ContainersMenu = GObject.registerClass(
    {
        GTypeName: "ContainersMenu",
    },
    class ContainersMenu extends PanelMenu.Button {
        _init() {
            super._init(0.0, "Containers");
            this.menu.box.add_style_class_name("containers-extension-menu");
            const hbox = new St.BoxLayout({style_class: "panel-status-menu-box"});
            const gicon = Gio.icon_new_for_string(`${Me.path}/podman-icon.png`);
            const icon = new St.Icon({gicon, icon_size: "24"});

            hbox.add_child(icon);
            this.add_child(hbox);
            this.connect("button_press_event", () => {
                if (this.menu.isOpen) {
                    this.menu.removeAll();
                    this.renderMenu();
                }
            });
        }

        renderMenu() {
            try {
                const containers = Podman.getContainers();
                Logger.info(`found ${containers.length} containers`);
                if (containers.length > 0) {
                    containers.forEach(container => {
                        Logger.debug(container.toString());
                        const subMenu = new ContainerSubMenuMenuItem(container, container.name);
                        this.menu.addMenuItem(subMenu);
                    });
                } else {
                    this.menu.addMenuItem(new PopupMenu.PopupMenuItem("No containers detected"));
                }
            } catch (err) {
                const errMsg = "Error occurred when fetching containers";
                this.menu.addMenuItem(new PopupMenu.PopupMenuItem(errMsg));
                Logger.info(`${errMsg}: ${err}`);
            }
            this.show();
        }
    });


var PopupMenuItem = GObject.registerClass(
    {
        GTypeName: "PopupMenuItem",
    },
    class extends PopupMenu.PopupMenuItem {
        _init(label, value) {
            if (value === undefined) {
                super._init(label);
            } else {
                super._init(`${label}: ${value}`);
                this.connect("button_press_event", setClipboard.bind(this, value));
            }
            this.add_style_class_name("containers-extension-subMenuItem");
            this.add_style_class_name(label.toLowerCase());
        }
    });

var ContainerMenuItem = GObject.registerClass(
    {
        GTypeName: "ContainerMenuItem",
    },
    class extends PopupMenuItem {
        _init(containerName, commandLabel, commandFunc) {
            super._init(commandLabel);
            this.containerName = containerName;
            this.connect("activate", () => commandFunc());
        }
    });

var ContainerSubMenuMenuItem = GObject.registerClass(
    {
        GTypeName: "ContainerSubMenuMenuItem",
    },
    class extends PopupMenu.PopupSubMenuMenuItem {
        _init(container) {
            super._init(container.name);
            const actions = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            const details = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(actions);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(details);

            const startBtn = addButton(actions, () => container.start(), "media-playback-start-symbolic");
            const stopBtn = addButton(actions, () => container.stop(), "media-playback-stop-symbolic");
            const restartBtn = addButton(actions, () => container.restart(), "system-reboot-symbolic");
            const deleteBtn = addButton(actions, () => container.rm(), "user-trash-symbolic.symbolic");
            const pauseBtn = addButton(
                actions,
                () => {
                    if (container.status.split(" ")[0] === "running") {
                        container.pause();
                    }
                    if (container.status.split(" ")[0] === "paused") {
                        container.unpause();
                    }
                },
                "media-playback-pause-symbolic"
            );
            pauseBtn.toggle_mode = true;

            switch (container.status.split(" ")[0]) {
            case "Exited":
            case "exited":
            case "Created":
            case "created":
            case "configured":
            case "stopped": {
                stopBtn.reactive = false;
                pauseBtn.reactive = false;
                this.insert_child_at_index(createIcon("media-playback-stop-symbolic", "status-stopped"), 1);
                break;
            }
            case "Up":
            case "running": {
                startBtn.reactive = false;
                deleteBtn.reactive = false;
                pauseBtn.checked = false;
                this.insert_child_at_index(createIcon("media-playback-start-symbolic", "status-running"), 1);
                break;
            }
            case "Paused":
            case "paused": {
                this.insert_child_at_index(createIcon("media-playback-pause-symbolic", "status-paused"), 1);
                break;
            }
            default:
                this.insert_child_at_index(createIcon("action-unavailable-symbolic", "status-undefined"), 1);
                break;
            }

            details.actor.add_child(new ContainerMenuItem(container.name, "Logs", () => container.logs()));
            details.actor.add_child(new ContainerMenuItem(container.name, "Top", () => container.watchTop()));
            details.actor.add_child(new ContainerMenuItem(container.name, "Shell", () => container.shell()));
            details.actor.add_child(new ContainerMenuItem(container.name, "Statistics", () => container.stats()));

            details.actor.add_child(new PopupMenu.PopupSeparatorMenuItem());
            details.actor.add_child(new PopupMenuItem("Status", container.status));
            if (container.startedAt !== null) {
                details.actor.add_child(new PopupMenuItem("Started", container.startedAt));
            }
            details.actor.add_child(new PopupMenuItem("Image", container.image));
            details.actor.add_child(new PopupMenuItem("Command", container.command));
            details.actor.add_child(new PopupMenuItem("Created", container.createdAt));
            details.actor.add_child(new PopupMenuItem("Ports", container.ports));
            const ipAddrMenuItem = new PopupMenuItem("IP Address", "");
            details.actor.add_child(ipAddrMenuItem);
            this.inspected = false;

            // add more stats and info - inspect - SLOW
            this.connect("button_press_event", () => {
                if (!this.inspected) {
                    container.inspect();
                    this.inspected = true;
                    ipAddrMenuItem.label.set_text(`${ipAddrMenuItem.label.text} ${container.ipAddress}`);
                }
            });
        }
    });

/** set clipboard with @param text
 *
 * @param {string} text to set the clipboard with*/
function setClipboard(text) {
    St.Clipboard.get_default().set_text(St.ClipboardType.PRIMARY, text);
}

/** adds a button to item and returns it
 *
 * @param item that the created button is added to
 * @param command is the actions to executoed when clicking the button
 * @param isconName is the icon name
 * */
function addButton(item, command, iconName) {
    const btn = new St.Button({
        reactive: true,
        can_focus: true,
        track_hover: true,
        style_class: "button",
        style: "padding-right: 10px; padding-left: 10px;",
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
    btn.child = new St.Icon({
        icon_name: iconName,
        icon_size: 14,
    });
    btn.connect("clicked", () => {
        command();
    });
    item.actor.add_child(btn);
    return btn;
}

