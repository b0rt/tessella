# Tessella Kiosk – Ansible-Provisioning

Ansible-Konfiguration zur automatischen Einrichtung von Client-PCs als Kiosk-Displays für das [Tessella](../) Multi-Display-System.

> **Hinweis:** Der Tessella-Server wird **nicht** von Ansible verwaltet – er muss bereits laufen.

## Was wird konfiguriert?

- Firefox im Kiosk-Modus mit automatischem Start
- Autologin (LightDM oder SDDM)
- Firefox Enterprise Policies (keine Updates, keine Telemetrie, Homepage gelockt)
- Bildschirmschoner und DPMS deaktiviert
- Mauszeiger automatisch versteckt
- Audio stummgeschaltet
- Sleep/Suspend/Hibernate deaktiviert
- Grundpakete und SSH-Zugang

## Unterstützte Distributionen

| Distribution      | Basis           | Paketmanager | Display-Manager | Firefox-Paket     | Default-User |
|-------------------|-----------------|--------------|-----------------|-------------------|--------------|
| MX Linux 25.1     | Debian 12       | apt          | LightDM         | `firefox-esr`     | `momo`       |
| openSUSE          | openSUSE        | zypper       | SDDM            | `MozillaFirefox`  | `ich`        |

## Voraussetzungen

- Ansible >= 2.14 auf dem Steuerrechner (Controller)
- SSH-Zugang zu allen Client-PCs
- `sudo`-Rechte für den jeweiligen Benutzer auf den Clients
- Python 3 auf den Clients
- Tessella-Server läuft und ist im LAN erreichbar

### SSH-Schlüssel verteilen

```bash
# MX Linux Clients (User: momo)
ssh-copy-id momo@192.168.1.101
ssh-copy-id momo@192.168.1.102
ssh-copy-id momo@192.168.1.103

# openSUSE Clients (User: ich)
ssh-copy-id ich@192.168.1.111
ssh-copy-id ich@192.168.1.112
```

### sudo ohne Passwort (optional, empfohlen)

Auf jedem Client als root:

```bash
# MX Linux
echo "momo ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/tessella

# openSUSE
echo "ich ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/tessella
```

## Schnellstart

### 1. Inventory vorbereiten

```bash
cd ansible/
cp inventories/hosts.yml.example inventories/hosts.yml
```

Passe in `inventories/hosts.yml` die IP-Adressen an.

### 2. Server-IP setzen

In `group_vars/all.yml` die IP-Adresse des Tessella-Servers eintragen:

```yaml
tessella_server_ip: "192.168.1.100"
```

### 3. Playbook ausführen

```bash
# Alle Clients provisionieren
ansible-playbook site.yml

# Nur MX Linux Clients
ansible-playbook site.yml --limit clients_mx

# Nur openSUSE Clients
ansible-playbook site.yml --limit clients_suse

# Einzelnen Host provisionieren
ansible-playbook site.yml --limit display-mx-01

# Trockenlauf (keine Änderungen)
ansible-playbook site.yml --check --diff

# Mit sudo-Passwort-Abfrage
ansible-playbook site.yml --ask-become-pass
```

## Struktur

```
ansible/
├── CLAUDE.md                   # Projektkontext für Claude Code
├── README.md                   # Diese Datei
├── site.yml                    # Haupt-Playbook
├── ansible.cfg                 # Ansible-Konfiguration
├── inventories/
│   └── hosts.yml.example       # Inventory-Template
├── group_vars/
│   └── all.yml                 # Globale Variablen
└── roles/
    ├── tessella-common/        # System-Updates, Grundpakete, SSH, Timezone
    │   └── tasks/main.yml
    └── tessella-client/        # Kiosk-Konfiguration
        ├── tasks/main.yml
        ├── handlers/main.yml
        └── templates/
            ├── tessella-kiosk.sh.j2
            ├── tessella-kiosk.desktop.j2
            ├── firefox-policies.json.j2
            ├── lightdm-autologin.conf.j2
            ├── sddm-autologin.conf.j2
            ├── disable-screensaver.desktop.j2
            ├── hide-cursor.desktop.j2
            └── mute-audio.desktop.j2
```

## Feature-Flags

Alle Features können in `group_vars/all.yml` einzeln aktiviert/deaktiviert werden:

| Variable                               | Default | Beschreibung                    |
|----------------------------------------|---------|---------------------------------|
| `tessella_client_autologin`            | `true`  | Automatisches Login             |
| `tessella_client_hide_cursor`          | `true`  | Mauszeiger verstecken           |
| `tessella_client_disable_screensaver`  | `true`  | Bildschirmschoner deaktivieren  |
| `tessella_client_disable_power_management` | `true` | Sleep/Suspend deaktivieren    |
| `tessella_client_mute_audio`           | `true`  | Audio stummschalten             |
| `tessella_client_reboot_after_provision` | `false` | Neustart nach Provisionierung |

## Troubleshooting

### SSH-Verbindung schlägt fehl

```bash
# Verbindung testen
ansible all -m ansible.builtin.ping

# Mit ausführlicher Ausgabe
ansible all -m ansible.builtin.ping -vvv
```

### Firefox startet nicht im Kiosk-Modus

1. Prüfe ob das Kiosk-Skript vorhanden und ausführbar ist:
   ```bash
   ls -la /home/<user>/.local/bin/tessella-kiosk.sh
   ```

2. Prüfe ob der Tessella-Server erreichbar ist:
   ```bash
   curl -s http://192.168.1.100:3000/
   ```

3. Prüfe die Autostart-Datei:
   ```bash
   cat /home/<user>/.config/autostart/tessella-kiosk.desktop
   ```

### Autologin funktioniert nicht

1. Prüfe welcher Display-Manager aktiv ist:
   ```bash
   systemctl status display-manager.service
   ```

2. Prüfe die Konfiguration:
   ```bash
   # LightDM
   cat /etc/lightdm/lightdm.conf.d/50-tessella-autologin.conf

   # SDDM
   cat /etc/sddm.conf.d/tessella-autologin.conf
   ```

3. Display-Manager neu starten:
   ```bash
   sudo systemctl restart display-manager.service
   ```

### Bildschirm geht trotzdem aus

1. Prüfe ob DPMS deaktiviert ist:
   ```bash
   xset q | grep -A2 "DPMS"
   ```

2. Prüfe ob die systemd Sleep-Targets maskiert sind:
   ```bash
   systemctl status sleep.target suspend.target hibernate.target
   ```

### Playbook erneut ausführen

Das Playbook ist idempotent – es kann beliebig oft ausgeführt werden. Bereits korrekt konfigurierte Systeme werden nicht verändert.
