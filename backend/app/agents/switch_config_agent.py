"""Multi-vendor Industrial Switch CLI & Asset Inventory Reconciliation Agent.

Parses Cisco IOS / Allen-Bradley Stratix, Hirschmann HiOS, ArubaOS-CX, and Moxa
Turbo Ring `show arp` / `show mac address-table` dumps, enriches MACs with
`oui_vendors.json`, reconciles against `asset_inventory.csv`, and flags
undocumented Shadow OT endpoints, dual-homed servers, and cellular routers (from the name a
device announces over LLDP). With no switch dump, hosts are discovered from the packet capture.
"""

from __future__ import annotations

import csv
import ipaddress
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from scapy.utils import RawPcapReader

from app.catalog_loader import lookup_oui_vendor
from app.clients.meta_models import MetaModelGateway, extract_json_object
from app.state import AssetNode, PurdueLevel, ShadowAssetAnomaly

_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_MAC_COLON_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")
_MAC_CISCO_RE = re.compile(r"\b[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\b")
_VLAN_TOKEN_RE = re.compile(r"\bvlan[\s_-]*(\d{1,4})\b", re.IGNORECASE)
_PAREN_HOST_RE = re.compile(r"\(([A-Za-z0-9._-]+)\)")
_LLDP_RE = re.compile(r"SysName:\s*(?P<name>[^|]+?)\s*\|.*?\bIP:\s*(?P<ip>(?:\d{1,3}\.){3}\d{1,3})", re.IGNORECASE)
# Cellular router product lines, matched against the name a device announces over LLDP
_CELLULAR_PRODUCT_RE = re.compile(
    r"oncell|airlink|cradlepoint|teltonika|\brut\d|inhand|ewon|digi[\s-]?(?:ix|wr|transport)|(?<![a-z])(?:lte|4g|5g)(?![a-z])",
    re.IGNORECASE,
)

# Corporate / IT / DMZ / WAN VLANs that normally hold enterprise consumers rather than OT inventory
_ENTERPRISE_IT_VLANS = {50, 60, 70, 80, 90, 100}


def normalize_mac(raw_mac: str) -> str:
    """Normalize Cisco dotted (`001b.1b9f.1015`) or hyphen/colon MACs to `XX:XX:XX:XX:XX:XX`."""
    hex_chars = re.sub(r"[^0-9A-Fa-f]", "", raw_mac).upper()
    if len(hex_chars) != 12:
        return raw_mac.strip().upper()
    return ":".join(hex_chars[i : i + 2] for i in range(0, 12, 2))


def is_enterprise_it_ip(ip_addr: str, vlan: int | None) -> bool:
    """Heuristic check distinguishing enterprise IT / WAN consumer IPs from OT cell subnets."""
    if ip_addr.startswith(("10.50.", "10.60.", "10.70.", "10.80.", "10.90.", "10.100.")):
        return True
    if vlan in {50, 70, 80, 90, 100} and ip_addr.startswith("10."):
        return True
    return False


def _infer_purdue_level(
    ip_addr: str,
    vlan: int | None,
    hostname: str | None,
    vendor_meta: dict[str, Any] | None,
) -> PurdueLevel:
    h_lower = (hostname or "").lower()
    if is_enterprise_it_ip(ip_addr, vlan):
        return "L4"
    if any(tok in h_lower for tok in ("fw-", "fg100", "fg200", "fg400", "pa450", "pa850", "esp")):
        return "L3.5"
    if any(tok in h_lower for tok in ("opc", "hist", "sql", "ews", "eng-ws", "batch-exec", "sftp")):
        return "L3"
    if any(tok in h_lower for tok in ("hmi", "pvplus", "tp1500", "scada", "sw0", "core", "ring", "xc208", "ie4000", "mach1040", "aruba")):
        return "L2"
    level = (vendor_meta or {}).get("typical_purdue_level")
    if level in {"L0", "L1", "L2", "L3", "L3.5", "L4"}:
        return level
    return "L1"


@dataclass
class SwitchAuditResult:
    """Structured result of multi-vendor switch CLI & baseline inventory reconciliation."""

    switch_hostname: str = "OT-CORE-SWITCH"
    total_discovered_assets: int = 0
    documented_assets_count: int = 0
    assets: list[AssetNode] = field(default_factory=list)
    shadow_anomalies: list[ShadowAssetAnomaly] = field(default_factory=list)
    vlans_observed: list[int] = field(default_factory=list)
    free_rj45_ports_estimate: int = 6
    occupied_rj45_ports: int = 18
    llm_model_used: str | None = None
    llm_source_mode: str = "deterministic_cli_parser"


def parse_asset_inventory_csv(csv_path: str | Path | None) -> dict[str, dict[str, Any]]:
    """Load baseline documented OT assets keyed by IPv4 address."""
    if not csv_path:
        return {}
    path = Path(csv_path)
    if not path.exists():
        return {}

    inventory: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            ip = (row.get("ip_address") or row.get("ip") or "").strip()
            if ip:
                inventory[ip] = dict(row)
    return inventory


def parse_switch_cli_dump(
    switch_dump_path: str | Path | None,
    asset_inventory_csv_path: str | Path | None = None,
) -> SwitchAuditResult:
    """Parse Cisco/Stratix, Hirschmann, Aruba, and Moxa CLI dumps and reconcile inventory."""
    result = SwitchAuditResult()
    if not switch_dump_path:
        return result
    path = Path(switch_dump_path)
    if not path.exists():
        return result

    raw_text = path.read_text(encoding="utf-8", errors="replace")
    documented_by_ip = parse_asset_inventory_csv(asset_inventory_csv_path)

    # Extract switch prompt hostname
    prompt_match = re.search(r"^([A-Za-z0-9_-]+)#\s*show\b", raw_text, flags=re.MULTILINE)
    if prompt_match:
        result.switch_hostname = prompt_match.group(1)

    # First pass: collect MAC -> switch_port from MAC address tables
    mac_to_port: dict[str, str] = {}
    mac_to_vlan: dict[str, int] = {}
    in_mac_section = False

    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lower = line.lower()
        if "show mac" in lower:
            in_mac_section = True
            continue
        if lower.startswith(result.switch_hostname.lower() + "#") and "show mac" not in lower:
            in_mac_section = False

        if in_mac_section:
            mac_m = _MAC_COLON_RE.search(line) or _MAC_CISCO_RE.search(line)
            if not mac_m:
                continue
            norm_mac = normalize_mac(mac_m.group(0))
            tokens = line.split()
            if tokens and tokens[0].isdigit():
                mac_to_vlan[norm_mac] = int(tokens[0])
            # Extract interface token like Gi1/0/16, 1/1/24, 2/1, P9
            for tok in tokens:
                if re.match(r"^(?:Gi|Fa|Te|Eth|Po|P\d|\d+/\d+)", tok, re.IGNORECASE):
                    mac_to_port[norm_mac] = tok
                    break

    # Second pass: parse ARP lines (`show ip arp`, `show arp`, `show arp all-vrfs`)
    arp_entries: dict[str, dict[str, Any]] = {}
    mac_to_ips: dict[str, list[str]] = {}
    vlans_set: set[int] = set()

    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("!", "#", "Protocol", "IP Address", "IPv4 Address", "---")):
            continue
        ip_m = _IPV4_RE.search(line)
        mac_m = _MAC_COLON_RE.search(line) or _MAC_CISCO_RE.search(line)
        if not (ip_m and mac_m):
            continue

        ip_addr = ip_m.group(0)
        norm_mac = normalize_mac(mac_m.group(0))

        vlan_val: int | None = None
        vlan_m = _VLAN_TOKEN_RE.search(line)
        if vlan_m:
            vlan_val = int(vlan_m.group(1))
        else:
            # Hirschmann format: `10.220.10.29  00:30:A7:99:10:29  2/1  220  dynamic`
            tokens = line.split()
            for tok in tokens[2:6]:
                if tok.isdigit() and 1 <= int(tok) <= 4094:
                    vlan_val = int(tok)
                    break
        if vlan_val is None and norm_mac in mac_to_vlan:
            vlan_val = mac_to_vlan[norm_mac]
        if vlan_val is not None:
            vlans_set.add(vlan_val)

        # Port extraction (either inline or from MAC table)
        port_val = mac_to_port.get(norm_mac)
        if not port_val:
            for tok in line.split()[2:6]:
                if re.match(r"^(?:Gi|Fa|Te|P\d+|\d+/\d+(?:/\d+)?)$", tok, re.IGNORECASE):
                    port_val = tok
                    break

        host_m = _PAREN_HOST_RE.search(line)
        hostname = host_m.group(1) if host_m else None

        arp_entries[ip_addr] = {
            "ip_address": ip_addr,
            "mac_address": norm_mac,
            "vlan": vlan_val,
            "switch_port": port_val,
            "hostname": hostname,
            "raw_comment": line,
        }
        mac_to_ips.setdefault(norm_mac, []).append(ip_addr)

    lldp_names = {m.group("ip"): m.group("name").strip() for m in _LLDP_RE.finditer(raw_text)}
    _reconcile_endpoints(
        result,
        arp_entries,
        mac_to_ips,
        documented_by_ip,
        evidence_name=path.name,
        inventory_path=asset_inventory_csv_path,
        lldp_names=lldp_names,
    )
    result.vlans_observed = sorted(vlans_set)
    return result


def _reconcile_endpoints(
    result: SwitchAuditResult,
    arp_entries: dict[str, dict[str, Any]],
    mac_to_ips: dict[str, list[str]],
    documented_by_ip: dict[str, dict[str, Any]],
    *,
    evidence_name: str,
    inventory_path: str | Path | None,
    lldp_names: dict[str, str],
) -> None:
    """Reconcile every discovered endpoint against the documented `asset_inventory.csv`."""
    assets: list[AssetNode] = []
    shadow_anomalies: list[ShadowAssetAnomaly] = []
    documented_seen = 0
    anom_idx = 1

    for idx, (ip_addr, entry) in enumerate(arp_entries.items(), start=1):
        norm_mac = entry["mac_address"]
        vlan_val = entry["vlan"]
        oui_info = lookup_oui_vendor(norm_mac)
        doc_row = documented_by_ip.get(ip_addr)
        is_it_host = is_enterprise_it_ip(ip_addr, vlan_val) or bool(doc_row and doc_row.get("purdue_level") == "L4")

        vendor = (
            (doc_row.get("vendor") if doc_row else None)
            or (oui_info.get("vendor") if oui_info else None)
            or "Unknown vendor"
        )
        hostname = (doc_row.get("hostname") if doc_row else None) or entry["hostname"] or lldp_names.get(ip_addr)
        device_cat = (
            (doc_row.get("role") if doc_row else None)
            or (oui_info.get("default_device_category") if oui_info else None)
            or ("IT_SERVER" if is_it_host else "OT_ENDPOINT")
        )
        purdue = (
            doc_row["purdue_level"]
            if (doc_row and doc_row.get("purdue_level") in {"L0", "L1", "L2", "L3", "L3.5", "L4"})
            else _infer_purdue_level(ip_addr, vlan_val, hostname, oui_info)
        )

        # Dual-homed detection: single MAC holding multiple IPs across subnets
        sibling_ips = [other for other in mac_to_ips.get(norm_mac, []) if other != ip_addr]
        is_dual_homed = len(sibling_ips) > 0

        # An undocumented device announcing itself as a cellular router is a path around the firewall
        is_rogue_modem = doc_row is None and bool(_CELLULAR_PRODUCT_RE.search(lldp_names.get(ip_addr, "")))

        # Shadow OT Asset = in an OT VLAN (not Enterprise IT consumer) AND absent from asset_inventory.csv
        is_shadow = (doc_row is None) and (not is_it_host or is_rogue_modem)
        if not is_shadow:
            documented_seen += 1

        sources = [evidence_name]
        if doc_row is not None and inventory_path:
            sources.append(Path(inventory_path).name)

        assets.append(
            AssetNode(
                asset_id=(doc_row["asset_id"] if doc_row and doc_row.get("asset_id") else f"DISC-{idx:03d}"),
                ip_address=ip_addr,
                secondary_ips=sibling_ips,
                mac_address=norm_mac,
                oui_prefix=norm_mac[:8],
                vendor=vendor,
                hostname=hostname,
                device_category=device_cat,
                purdue_level=purdue,  # type: ignore[arg-type]
                vlan=vlan_val,
                switch_port=entry["switch_port"],
                documented_on_diagram=not is_shadow,
                is_shadow_asset=is_shadow,
                is_dual_homed_bypass=is_dual_homed or is_rogue_modem,
                discovery_sources=sources,
            )
        )

        if is_shadow or is_dual_homed or is_rogue_modem:
            port = entry["switch_port"]
            if is_rogue_modem:
                anom_type = "ROGUE_IT_BRIDGE"
                severity = "CRITICAL"
                action_text = (
                    f"CRITICAL AIR-GAP BYPASS: {lldp_names.get(ip_addr)} announces itself as a cellular router. "
                    f"Physically disconnect switch port {port or 'unknown'} ({ip_addr}) "
                    f"and lock the port with 802.1X / MAC sticky shutdown."
                )
            elif is_dual_homed:
                anom_type = "DUAL_HOMED_BYPASS_ASSET"
                severity = "CRITICAL"
                action_text = (
                    f"Disable secondary NIC bridging {ip_addr} <-> {', '.join(sibling_ips)} "
                    f"and route telemetry strictly through Hardware Data Diode TX."
                )
            else:
                anom_type = "UNDOCUMENTED_SHADOW_ASSET"
                severity = "HIGH"
                action_text = (
                    f"Audit undocumented {vendor} node ({hostname or ip_addr})"
                    + (f" on VLAN {vlan_val}" if vlan_val else "")
                    + (f" port {port}" if port else "")
                    + "; register it in the CMDB or remove it from the plant network."
                )

            shadow_anomalies.append(
                ShadowAssetAnomaly(
                    anomaly_id=f"ANOM-{anom_idx:02d}",
                    anomaly_type=anom_type,  # type: ignore[arg-type]
                    severity=severity,  # type: ignore[arg-type]
                    ip_addresses=[ip_addr, *sibling_ips],
                    mac_address=norm_mac,
                    vendor=vendor,
                    evidence_source=f"{evidence_name} ({'ARP/MAC port ' + port if port else 'seen in traffic'})",
                    remediation_action=action_text,
                )
            )
            anom_idx += 1

    occupied_ports = len({a.switch_port for a in assets if a.switch_port}) or min(len(assets), 24)
    total_switch_ports = 48 if occupied_ports > 24 else 24
    free_ports = max(2, total_switch_ports - occupied_ports)

    result.total_discovered_assets = len(assets)
    result.documented_assets_count = documented_seen
    result.assets = assets
    result.shadow_anomalies = shadow_anomalies
    result.occupied_rj45_ports = occupied_ports
    result.free_rj45_ports_estimate = free_ports


def discover_assets_from_pcap(
    pcap_path: str | Path | None,
    asset_inventory_csv_path: str | Path | None = None,
) -> SwitchAuditResult:
    """Without a switch dump, list the hosts seen in the capture (source IP + MAC) and reconcile them.

    Only private (RFC 1918) addresses are kept: those are the site's own hosts.
    """
    result = SwitchAuditResult(switch_hostname="no switch dump (hosts seen in the capture)")
    if not pcap_path or not Path(pcap_path).exists():
        return result
    entries: dict[str, dict[str, Any]] = {}
    mac_to_ips: dict[str, list[str]] = {}
    vlans: set[int] = set()
    for data, _ in RawPcapReader(str(pcap_path)):
        if len(data) < 34:
            continue
        eth_type, off, vlan = struct.unpack("!H", data[12:14])[0], 14, None
        if eth_type == 0x8100:
            vlan = struct.unpack("!H", data[14:16])[0] & 0x0FFF
            eth_type, off = struct.unpack("!H", data[16:18])[0], 18
        if eth_type != 0x0800:
            continue
        src = ".".join(str(b) for b in data[off + 12 : off + 16])
        if src in entries or not ipaddress.ip_address(src).is_private:
            continue
        mac = normalize_mac(data[6:12].hex(":"))
        entries[src] = {"ip_address": src, "mac_address": mac, "vlan": vlan, "switch_port": None, "hostname": None}
        mac_to_ips.setdefault(mac, []).append(src)
        if vlan is not None:
            vlans.add(vlan)
    _reconcile_endpoints(
        result,
        dict(sorted(entries.items(), key=lambda kv: ipaddress.ip_address(kv[0]))),
        mac_to_ips,
        parse_asset_inventory_csv(asset_inventory_csv_path),
        evidence_name=Path(pcap_path).name,
        inventory_path=asset_inventory_csv_path,
        lldp_names={},
    )
    result.vlans_observed = sorted(vlans)
    return result


async def run_switch_config_agent(
    switch_dump_path: str | Path | None,
    asset_inventory_csv_path: str | Path | None = None,
    *,
    pcap_path: str | Path | None = None,
    gateway: MetaModelGateway | None = None,
    use_live_llm: bool = False,
) -> SwitchAuditResult:
    """Execute deterministic CLI + OUI reconciliation, optionally enriched via Baseten/Meta Spark.

    With no switch dump, hosts are discovered from the packet capture instead.
    """
    if switch_dump_path and Path(switch_dump_path).exists():
        audit = parse_switch_cli_dump(switch_dump_path, asset_inventory_csv_path)
    else:
        audit = discover_assets_from_pcap(pcap_path, asset_inventory_csv_path)
    if not use_live_llm or gateway is None or not audit.shadow_anomalies:
        return audit

    # Enrich remediation prescriptions via Baseten `muse-spark-open-1026` (or `muse-spark-1.3` fallback)
    compact_shadows = [a.model_dump() for a in audit.shadow_anomalies]
    prompt = (
        f"Switch `{audit.switch_hostname}` audit discovered {audit.total_discovered_assets} endpoints "
        f"across VLANs {audit.vlans_observed} and {len(audit.shadow_anomalies)} shadow/bypass anomalies:\n"
        f"{compact_shadows}\n"
        "Return strict JSON: {\"switch_cutover_summary\": \"one-sentence IOS/HiOS port-lockdown note\"}"
    )
    llm_res = await gateway.chat_baseten_open(
        [{"role": "user", "content": prompt}],
        max_tokens=2048,
    )
    audit.llm_model_used = str(llm_res.get("model") or "")
    audit.llm_source_mode = str(llm_res.get("source_mode") or "deterministic_cli_parser")
    parsed = extract_json_object(llm_res.get("content", ""))
    if parsed and parsed.get("switch_cutover_summary") and audit.shadow_anomalies:
        note = str(parsed["switch_cutover_summary"]).strip()
        if note:
            audit.shadow_anomalies[0].remediation_action = (
                f"{audit.shadow_anomalies[0].remediation_action} [{note}]"
            )
    return audit

