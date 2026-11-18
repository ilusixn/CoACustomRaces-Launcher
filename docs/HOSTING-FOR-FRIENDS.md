# Hosting for friends

Your friends connect to the server this launcher created on your PC. For that to work, three things must be true on the
**host** PC. The Server page (Overview > "Network for friends") checks all of them and can fix the firewall.

## 1. The server listens on a reachable address

The server package listens on `127.0.0.1` only, which nobody else can reach. From launcher 1.0.4 the launcher opens the
login and world servers to every address (`BindIP = "0.0.0.0"` in `Settings/authserver.conf.template` and
`Settings/worldserver.conf.template`) every time you Start the server with a LAN, Hamachi, Tailscale or other host
address, and closes them again in Local mode. MySQL and RA always stay on `127.0.0.1`.

Restart the server after changing the realm mode; the launcher says when that is needed.

## 2. The server hands out the right address

The auth server tells every player which address to connect the world to (`acore_auth.realmlist.address`). The
launcher sets it from **Realmlist**:

- **LAN / Hamachi / Tailscale**: the address of this PC on that network.
- **Join a friend** is for someone else's server. To host with an address this PC cannot recognise (ZeroTier, Radmin,
  a public IP, a DNS name), choose Join a friend, type the address and tick
  "This is the address of my own server (I host with it)".

Friends open the launcher, Realmlist, **Join a friend**, and type the host's address. Before Play, the launcher tests
`<address>:3724` for 3 seconds and tells them if nothing answers (they can still play anyway).

## 3. Windows Firewall lets the server in

Windows creates allow rules per program and per network type. A VPN adapter (Tailscale, Hamachi) is often classified
**Public**, while the first-run prompt often only ticks **Private**, so the VPN peers stay blocked even though the same
network worked with another server tool that has its own rules.

The Server page lists, per port, which network types are allowed. **Allow through Windows Firewall** asks Windows for
permission once (UAC) and adds four inbound rules, all network types:

| Rule | What |
|---|---|
| `CoA Custom Races server (auth)` | TCP login port (default 3724) |
| `CoA Custom Races server (world)` | TCP world port (default 8085) |
| `CoA Custom Races server (authserver.exe)` | the program in your server folder |
| `CoA Custom Races server (worldserver.exe)` | the program in your server folder |

**Remove rules** deletes exactly those four. If you decline the Windows prompt nothing changes. If you move the server,
press Allow again so the program rules follow the new folder (the check reports outdated rules).

Behind a router with a public IP, forward the login and world TCP ports to this PC as well.

## Quick checklist when a friend cannot connect

1. Same VPN on both PCs; the friend can ping the host's address.
2. Server page > Network for friends: all lines green after Start.
3. Realm address in the list equals what the friend typed.
4. Ports in `Settings/repack.json` (default 3724 / 8085) are the ones allowed.
