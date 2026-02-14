# CLAUDE.md – Tessella Ansible Kiosk-Provisioning

## Projektübersicht

Ansible-Konfiguration zur Provisionierung von Client-PCs als Kiosk-Displays für das Tessella Multi-Display-System. Der Tessella-Server selbst wird **nicht** von Ansible verwaltet – er läuft bereits.

## Ziel-Umgebung

| Eigenschaft        | MX Linux 25.1              | openSUSE                  |
|--------------------|----------------------------|---------------------------|
| Basis              | Debian 12 Bookworm         | openSUSE (Leap/Tumbleweed)|
| `ansible_os_family`| `Debian`                   | `Suse`                    |
| Paketmanager       | `apt`                      | `zypper`                  |
| Display-Manager    | LightDM                    | SDDM                     |
| Lokaler User       | `momo`                     | `ich`                     |
| Firefox-Paket      | `firefox-esr`              | `MozillaFirefox`          |
| Inventory-Gruppe   | `clients_mx`               | `clients_suse`            |

## Struktur

```
ansible/
├── CLAUDE.md                          # Diese Datei
├── README.md                          # Anleitung für Menschen
├── site.yml                           # Haupt-Playbook (nur Clients)
├── ansible.cfg                        # Ansible-Konfiguration
├── inventories/
│   └── hosts.yml.example              # Inventory-Template
├── group_vars/
│   └── all.yml                        # Globale Variablen
└── roles/
    ├── tessella-common/
    │   └── tasks/main.yml             # Updates, Grundpakete, SSH, Timezone
    └── tessella-client/
        ├── tasks/main.yml             # Kiosk-Konfiguration
        ├── handlers/main.yml          # Display-Manager Neustart
        └── templates/
            ├── tessella-kiosk.sh.j2          # Kiosk-Startskript
            ├── tessella-kiosk.desktop.j2     # Autostart für Kiosk
            ├── firefox-policies.json.j2      # Firefox Enterprise Policies
            ├── lightdm-autologin.conf.j2     # LightDM Autologin
            ├── sddm-autologin.conf.j2        # SDDM Autologin
            ├── disable-screensaver.desktop.j2
            ├── hide-cursor.desktop.j2
            └── mute-audio.desktop.j2
```

## Architektur-Entscheidungen

- **Nur Firefox** – kein Chromium. Firefox-ESR auf Debian, MozillaFirefox auf openSUSE.
- **Kein Server** – der Tessella-Server wird nicht von Ansible verwaltet.
- **Distro-Erkennung** via `ansible_os_family` (`Debian` vs `Suse`).
- **Display-Manager-Erkennung** via `stat` auf `/etc/lightdm` bzw `/etc/sddm.conf.d`.
- **Feature-Flags** – alle Features über Boolean-Variablen steuerbar.
- **FQCN** – alle Ansible-Module verwenden Fully Qualified Collection Names.
- **Kommentarsprache** – alle Task-Namen und Kommentare auf Deutsch.

## Variablen (group_vars/all.yml)

| Variable                               | Typ    | Default            | Beschreibung                         |
|----------------------------------------|--------|--------------------|--------------------------------------|
| `tessella_server_ip`                   | String | `192.168.1.100`    | IP-Adresse des Tessella-Servers      |
| `tessella_server_port`                 | Int    | `3000`             | Port des Tessella-Servers            |
| `tessella_server_url`                  | String | (abgeleitet)       | Vollständige Server-URL              |
| `tessella_client_kiosk_url`            | String | (abgeleitet)       | URL die Firefox im Kiosk öffnet      |
| `tessella_client_user`                 | String | (per Gruppe)       | Lokaler User auf dem Client          |
| `tessella_client_autologin`            | Bool   | `true`             | Automatisches Login aktivieren       |
| `tessella_client_hide_cursor`          | Bool   | `true`             | Mauszeiger verstecken                |
| `tessella_client_disable_screensaver`  | Bool   | `true`             | Bildschirmschoner deaktivieren       |
| `tessella_client_disable_power_management` | Bool | `true`          | Sleep/Suspend deaktivieren           |
| `tessella_client_mute_audio`           | Bool   | `true`             | Audio stummschalten                  |

## Kommandos

```bash
# Inventory vorbereiten
cp inventories/hosts.yml.example inventories/hosts.yml
# hosts.yml anpassen (IPs, Benutzernamen)

# Alle Clients provisionieren
ansible-playbook site.yml

# Nur MX Linux Clients
ansible-playbook site.yml --limit clients_mx

# Nur openSUSE Clients
ansible-playbook site.yml --limit clients_suse

# Einzelnen Host
ansible-playbook site.yml --limit display-mx-01

# Trockenlauf
ansible-playbook site.yml --check --diff
```

## Regeln für Änderungen

1. **Immer `ansible_os_family`** nutzen – nie Hostnamen oder Gruppennamen für Distro-Logik.
2. **Keine hardcodierten Benutzernamen** – immer `{{ tessella_client_user }}` verwenden.
3. **Keine Chromium-Referenzen** – ausschließlich Firefox.
4. **Keine Server-Rolle** – der Server wird nicht von Ansible verwaltet.
5. **FQCN** für alle Module (z.B. `ansible.builtin.apt`, `community.general.zypper`).
6. **Task-Kommentare auf Deutsch**.
7. **Feature-Flags** respektieren – neue Features immer mit Boolean-Variable absicherbar machen.
