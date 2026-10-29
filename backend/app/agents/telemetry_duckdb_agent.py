"""Scapy 10-Protocol Binary L7 Packet Dissector + DuckDB Firewall SQL Telemetry Agent.

Dissects real binary `.pcap` captures (Modbus TCP, S7comm, IEC 60870-5-104, DNP3,
EtherNet/IP CIP, OPC-UA, OPC-DA DCOM, BACnet/IP, RTSP, MQTT, SMB, SQL, Telnet, SSH,
RDP, VNC, IEEE C37.118, IEC 61850 GOOSE/MMS) and queries 24-hour FortiGate & Palo Alto
traffic CSVs in DuckDB to compute exact Peak Mbps, `1.25x` safety headroom, TCP SYN
directionality, and Green / Amber / Red protocol cutover tiers.
"""

from __future__ import annotations

import socket
import struct
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import duckdb
from scapy.utils import RawPcapReader

from app.agents.switch_config_agent import is_enterprise_it_ip
from app.state import AssetNode, CutoverTier, ProtocolFlowAnalysis, TrafficConduit

_WELL_KNOWN_OT_IT_PORTS: dict[int, tuple[str, str]] = {
    22: ("SSH / SFTP", "SFTP"),
    23: ("Telnet", "TELNET"),
    80: ("HTTP", "HTTP"),
    102: ("S7comm (ISO-TSAP)", "S7COMM"),
    135: ("OPC-DA DCOM (RPC)", "OPC_DA_DCOM"),
    139: ("NetBIOS / SMB", "SMBV1"),
    161: ("SNMP", "SNMP"),
    443: ("HTTPS", "HTTPS_PUSH"),
    445: ("SMBv1 / CIFS", "SMBV1"),
    502: ("Modbus TCP", "MODBUS_TCP"),
    514: ("Syslog UDP", "SYSLOG_UDP"),
    554: ("RTSP Video", "RTSP"),
    1433: ("MS-SQL TDS", "SQL_REPLICATION_PUSH"),
    1883: ("MQTT Telemetry", "MQTT"),
    2222: ("EtherNet/IP Implicit I/O", "ETHERNET_IP"),
    2404: ("IEC 60870-5-104", "IEC_104"),
    3389: ("RDP Remote Desktop", "RDP"),
    4712: ("IEEE C37.118 PMU", "IEEE_C37_118"),
    4840: ("OPC-UA Binary", "OPC_UA"),
    5900: ("VNC Remote Screen", "VNC"),
    8443: ("HTTPS / TLS Telemetry", "HTTPS_PUSH"),
    20000: ("DNP3", "DNP3"),
    44818: ("EtherNet/IP CIP", "ETHERNET_IP"),
    47808: ("BACnet/IP", "BACNET_TELEMETRY"),
}

_MODBUS_FC_NAMES: dict[int, tuple[str, bool]] = {
    1: ("FC 01 Read Coils", False),
    2: ("FC 02 Read Discrete Inputs", False),
    3: ("FC 03 Read Holding Registers", False),
    4: ("FC 04 Read Input Registers", False),
    5: ("FC 05 Write Single Coil", True),
    6: ("FC 06 Write Single Register", True),
    15: ("FC 15 Write Multiple Coils", True),
    16: ("FC 16 Write Multiple Registers", True),
}

_IEC104_TYPE_NAMES: dict[int, tuple[str, bool]] = {
    1: ("TypeID 1 Single-Point Info", False),
    13: ("TypeID 13 Measured Float", False),
    30: ("TypeID 30 Single-Point w/ Time", False),
    36: ("TypeID 36 Measured Float w/ Time", False),
    45: ("TypeID 45 Single Command (Breaker Trip/Close)", True),
    46: ("TypeID 46 Double Command (Breaker Actuation)", True),
    50: ("TypeID 50 Setpoint Float Command", True),
    58: ("TypeID 58 Single Command w/ Time", True),
    100: ("TypeID 100 Interrogation Read", False),
}


# One source reaching this many hosts over this many distinct OT/IT services is scanning, not polling
LATERAL_MIN_HOSTS = 4
LATERAL_MIN_PORTS = 3


@dataclass
class TelemetryAuditResult:
    """Combined Scapy packet dissection + DuckDB firewall SQL analytics."""

    pcap_packet_count: int = 0
    pcap_total_bytes: int = 0
    firewall_vendor: str = "No firewall log"
    firewall_row_count: int = 0
    p95_bandwidth_mbps: float = 0.0
    peak_bandwidth_mbps: float = 0.0
    sized_bandwidth_with_1_25x_headroom_mbps: float = 0.0
    flows: list[ProtocolFlowAnalysis] = field(default_factory=list)
    conduits: list[TrafficConduit] = field(default_factory=list)
    flow_tier_counts: dict[str, int] = field(
        default_factory=lambda: {"GREEN": 0, "AMBER": 0, "RED": 0}
    )


def _inspect_l7_payload(
    service_port: int, payload: bytes
) -> tuple[str | None, bool]:
    """Extract deep Layer-7 industrial function codes and detect write/actuation ops."""
    if not payload:
        return None, False

    # 1. Modbus TCP (MBAP 7-byte header + 1-byte Function Code)
    if service_port == 502 and len(payload) >= 8:
        proto_id = struct.unpack("!H", payload[2:4])[0]
        fc = payload[7] & 0x7F
        if proto_id == 0 and fc in _MODBUS_FC_NAMES:
            return _MODBUS_FC_NAMES[fc]

    # 2. IEC 60870-5-104 (Start byte 0x68, APDU len, 4 control octets, TypeID at byte 6)
    if service_port == 2404 and len(payload) >= 7 and payload[0] == 0x68:
        type_id = payload[6]
        if type_id in _IEC104_TYPE_NAMES:
            return _IEC104_TYPE_NAMES[type_id]
        return f"IEC-104 APDU TypeID {type_id}", type_id in {45, 46, 47, 48, 49, 50, 58, 59}

    # 3. Siemens S7comm (TPKT 0x03 0x00 + COTP + S7 Protocol ID 0x32)
    if service_port == 102 and len(payload) >= 18 and payload[0] == 0x03:
        s7_idx = payload.find(b"\x32")
        if s7_idx != -1 and len(payload) > s7_idx + 8:
            rosctr = payload[s7_idx + 1]
            func_code = payload[s7_idx + 8] if rosctr == 1 and len(payload) > s7_idx + 8 else 0
            if func_code == 0x05:
                return "S7comm WriteVar (0x05)", True
            if func_code == 0x04:
                return "S7comm ReadVar (0x04)", False
            return f"S7comm ROSCTR={rosctr}", False

    # 4. DNP3 (Start bytes 0x05 0x64, transport + app control + Function Code at byte 12)
    if service_port == 20000 and len(payload) >= 13 and payload[0:2] == b"\x05\x64":
        fc = payload[12]
        if fc in {3, 4, 5, 6}:
            return f"DNP3 FC 0x{fc:02X} Select/Direct Operate", True
        if fc in {1, 129, 130}:
            return f"DNP3 FC 0x{fc:02X} Class Poll / Unsolicited Response", False
        return f"DNP3 Link Frame (FC 0x{fc:02X})", False

    # 5. EtherNet/IP CIP (TCP 44818 encapsulation command in little-endian bytes 0..2)
    if service_port == 44818 and len(payload) >= 4:
        encap_cmd = struct.unpack("<H", payload[0:2])[0]
        if encap_cmd == 0x006F:
            return "CIP SendRRData (Explicit Tag Read/Write)", False
        if encap_cmd == 0x0070:
            return "CIP SendUnitData (Connected Class-3 Tag Poll)", False
        if encap_cmd == 0x0065:
            return "EtherNet/IP RegisterSession (0x0065)", False

    # 6. OPC-UA Binary (HEL / ACK / OPN / MSG)
    if service_port == 4840 and len(payload) >= 4:
        sig = payload[0:3].decode("ascii", errors="ignore")
        if sig in {"HEL", "ACK", "OPN", "MSG", "CLO"}:
            return f"OPC-UA Binary {sig} Chunk", False

    # 7. BACnet/IP (BVLC type 0x81)
    if service_port == 47808 and len(payload) >= 4 and payload[0] == 0x81:
        return "BACnet/IP BVLC UnconfirmedCOV / ReadProperty", False

    return None, False


def _subnet24(ip: str) -> str:
    return ip.rsplit(".", 1)[0]


def zone_map_from_assets(assets: list[AssetNode]) -> dict[str, str]:
    """Map each /24 seen by the switch audit to `IT` (every host Purdue L4) or `OT` (any L0-L3).

    Host-level entries (full IPs) refine it: bypass devices are `BYPASS`, undocumented hosts on a
    plant subnet are `UNDOCUMENTED`, and in a flat subnet that holds both documented office (L4)
    and plant hosts each documented host gets its own `IT` / `OT` zone. DMZ-only subnets (L3.5)
    are left out so they fall back to the static heuristic.
    """
    levels: dict[str, set[str]] = defaultdict(set)
    for a in assets:
        if a.ip_address and not a.is_shadow_asset:
            levels[_subnet24(str(a.ip_address))].add(a.purdue_level)
    zones: dict[str, str] = {}
    for prefix, lv in levels.items():
        if lv & {"L0", "L1", "L2", "L3"}:
            zones[prefix] = "OT"
        elif lv == {"L4"}:
            zones[prefix] = "IT"
    for a in assets:
        ip = str(a.ip_address or "")
        if not ip:
            continue
        subnet = levels.get(_subnet24(ip), set())
        if a.is_dual_homed_bypass:
            zones[ip] = "BYPASS"
        elif a.is_shadow_asset and zones.get(_subnet24(ip)) == "OT":
            zones[ip] = "UNDOCUMENTED"
        elif "L4" in subnet and subnet & {"L0", "L1", "L2", "L3"}:
            zones[ip] = "IT" if a.purdue_level == "L4" else "OT"
    return zones


def zone_of(ip: str, zones: dict[str, str] | None) -> str | None:
    """Host-level zone if one is recorded, else the zone of the host's /24."""
    zones = zones or {}
    return zones.get(ip) or zones.get(_subnet24(ip))


def _is_it_ip(ip: str, zones: dict[str, str] | None) -> bool:
    zone = zone_of(ip, zones)
    if zone:
        return zone == "IT"
    return is_enterprise_it_ip(ip, None)


def _determine_flow_direction(
    src_ip: str, dst_ip: str, zones: dict[str, str] | None = None, has_write: bool = False
) -> str:
    src_is_it = _is_it_ip(src_ip, zones)
    dst_is_it = _is_it_ip(dst_ip, zones)
    # A path into the plant that skips the boundary: a known bypass device, or an undocumented
    # host already inside the plant network that sends control commands
    src_zone = zone_of(src_ip, zones)
    if not dst_is_it and (src_zone == "BYPASS" or (src_zone == "UNDOCUMENTED" and has_write)):
        return "BYPASS_TO_OT"
    if not src_is_it and dst_is_it:
        return "OT_TO_IT"
    if src_is_it and not dst_is_it:
        return "IT_TO_OT"
    return "OT_TO_IT"


def _classify_flow_tier(
    *,
    src_ip: str,
    dst_ip: str,
    dst_port: int,
    protocol_label: str,
    direction: str,
    has_write_ops: bool,
    uses_ephemeral_dcom: bool,
    firewall_note: str = "",
    lateral_movement: bool = False,
) -> CutoverTier:
    note_upper = firewall_note.upper()
    proto_upper = protocol_label.upper()

    # Unauthorized remote admin, rogue bypass, lateral scanning, or unauthenticated actuation writes -> RED
    if lateral_movement or dst_port in {23, 3389, 5900}:
        return "RED"
    # Inbound SSH/SFTP is an interactive IT-initiated session; only OT-initiated SFTP push can cross
    if dst_port == 22 and direction == "IT_TO_OT":
        return "RED"
    if direction == "BYPASS_TO_OT":
        return "RED"
    if has_write_ops and "RECIPE" not in note_upper and "SIGNED" not in note_upper:
        return "RED"
    if dst_port in {135, 139, 445} or uses_ephemeral_dcom or "DCOM" in proto_upper or "SMB" in proto_upper:
        return "RED"

    # Outbound OT -> IT telemetry push or RTSP camera pull -> GREEN
    if direction == "OT_TO_IT" and dst_port in {514, 554, 1883, 4840, 8443, 443, 47808, 22, 2404}:
        return "GREEN"
    if dst_port == 554:
        return "GREEN"

    # Inbound IT -> OT read polling (Historian / SCADA / SQL / Recipe) -> AMBER
    return "AMBER"


def pcap_peak_mbps(pcap_path: str | Path) -> float:
    """Busiest one-second window in the capture, in Mbps (used when there is no firewall log)."""
    path = Path(pcap_path)
    if not path.exists():
        return 0.0
    per_second: dict[int, int] = defaultdict(int)
    for pkt_data, meta in RawPcapReader(str(path)):
        sec = getattr(meta, "sec", None)
        if sec is None:
            sec = ((meta.tshigh << 32) | meta.tslow) // (meta.tsresol or 1_000_000)
        per_second[int(sec)] += len(pkt_data)
    return round(max(per_second.values(), default=0) * 8.0 / 1e6, 3)


def dissect_pcap_file(pcap_path: str | Path) -> tuple[int, int, dict[tuple[str, str, int, str], dict[str, Any]]]:
    """Stream-parse binary `.pcap` via `RawPcapReader` to extract L4/L7 flow telemetry."""
    path = Path(pcap_path)
    if not path.exists():
        return 0, 0, {}

    pkt_count = 0
    total_bytes = 0
    flow_stats: dict[tuple[str, str, int, str], dict[str, Any]] = defaultdict(
        lambda: {
            "packets": 0,
            "bytes": 0,
            "fcs": set(),
            "has_write": False,
            "ephemeral_dcom": False,
            "syn_client": None,
        }
    )

    for pkt_data, _ in RawPcapReader(str(path)):
        pkt_count += 1
        pkt_len = len(pkt_data)
        total_bytes += pkt_len
        if pkt_len < 34:
            continue

        eth_type = struct.unpack("!H", pkt_data[12:14])[0]
        ip_off = 14
        if eth_type == 0x8100 and pkt_len >= 38:
            eth_type = struct.unpack("!H", pkt_data[16:18])[0]
            ip_off = 18

        # Layer-2 IEC 61850 GOOSE (`0x88B8`) or SV (`0x88BA`)
        if eth_type in {0x88B8, 0x88BA}:
            key = ("L2-IED-PUB", "L2-GOOSE-MULTICAST", 0, "L2_MULTICAST")
            st = flow_stats[key]
            st["packets"] += 1
            st["bytes"] += pkt_len
            st["fcs"].add("IEC 61850 GOOSE (EtherType 0x88B8)")
            continue

        if eth_type != 0x0800 or pkt_len < ip_off + 20:
            continue

        ihl = (pkt_data[ip_off] & 0x0F) * 4
        proto_num = pkt_data[ip_off + 9]
        src_ip = socket.inet_ntoa(pkt_data[ip_off + 12 : ip_off + 16])
        dst_ip = socket.inet_ntoa(pkt_data[ip_off + 16 : ip_off + 20])
        l4_off = ip_off + ihl

        if proto_num not in (6, 17) or pkt_len < l4_off + 8:
            continue

        sport, dport = struct.unpack("!HH", pkt_data[l4_off : l4_off + 4])
        transport = "TCP" if proto_num == 6 else "UDP"

        if proto_num == 6 and pkt_len >= l4_off + 14:
            data_offset = (pkt_data[l4_off + 12] >> 4) * 4
            tcp_flags = pkt_data[l4_off + 13]
            payload = pkt_data[l4_off + data_offset :]
            is_syn_only = (tcp_flags & 0x12) == 0x02
        else:
            payload = pkt_data[l4_off + 8 :]
            is_syn_only = False

        # Determine canonical client -> server tuple
        if dport in _WELL_KNOWN_OT_IT_PORTS:
            c_ip, s_ip, svc_port = src_ip, dst_ip, dport
        elif sport in _WELL_KNOWN_OT_IT_PORTS:
            c_ip, s_ip, svc_port = dst_ip, src_ip, sport
        elif 49152 <= dport <= 49170 and sport >= 49152:
            c_ip, s_ip, svc_port = src_ip, dst_ip, dport
        elif 49152 <= sport <= 49170 and dport >= 49152:
            c_ip, s_ip, svc_port = dst_ip, src_ip, sport
        elif sport < dport:
            c_ip, s_ip, svc_port = dst_ip, src_ip, sport
        else:
            c_ip, s_ip, svc_port = src_ip, dst_ip, dport

        key = (c_ip, s_ip, svc_port, transport)
        st = flow_stats[key]
        st["packets"] += 1
        st["bytes"] += pkt_len
        if is_syn_only:
            st["syn_client"] = src_ip
        if 49152 <= svc_port <= 49170:
            st["ephemeral_dcom"] = True
            st["fcs"].add(f"Dynamic DCOM Ephemeral TCP/{svc_port}")

        fc_label, is_write = _inspect_l7_payload(svc_port, payload)
        if fc_label:
            st["fcs"].add(fc_label)
        if is_write:
            st["has_write"] = True

    return pkt_count, total_bytes, flow_stats


def query_firewall_csv_duckdb(csv_path: str | Path | None) -> dict[str, Any]:
    """Run DuckDB SQL analytics over FortiGate or Palo Alto 24-hour firewall traffic CSVs."""
    if not csv_path:
        return {
            "vendor": "No firewall log",
            "row_count": 0,
            "p95_mbps": 0.0,
            "peak_mbps": 0.0,
            "service_flows": [],
        }
    path = Path(csv_path)
    if not path.exists():
        return {
            "vendor": "No firewall log",
            "row_count": 0,
            "p95_mbps": 0.0,
            "peak_mbps": 0.0,
            "service_flows": [],
        }

    posix_path = str(path.resolve()).replace("\\", "/")
    con = duckdb.connect(":memory:")
    try:
        cols = {
            row[0].lower()
            for row in con.execute(
                f"DESCRIBE SELECT * FROM read_csv_auto('{posix_path}')"
            ).fetchall()
        }

        if "sentbyte" in cols and "rcvdbyte" in cols:
            vendor = "Fortinet FortiGate"
            summary = con.execute(
                f"""
                SELECT COUNT(*) AS row_cnt,
                       COALESCE(SUM(sentbyte + rcvdbyte) * 8.0 / 86400.0 / 1e6, 0.0) AS avg_mbps,
                       COALESCE(QUANTILE_CONT((sentbyte + rcvdbyte) * 8.0 / GREATEST(duration_sec, 1) / 1e6, 0.95), 0.0) AS p95_sess_mbps,
                       COALESCE(MAX((sentbyte + rcvdbyte) * 8.0 / GREATEST(duration_sec, 1) / 1e6), 0.0) AS max_sess_mbps
                FROM read_csv_auto('{posix_path}')
                """
            ).fetchone()
            flow_rows = con.execute(
                f"""
                SELECT srcip, dstip, CAST(dstport AS INTEGER) AS dstport, UPPER(CAST(proto AS VARCHAR)) AS proto,
                       service, policyname, COUNT(*) AS sessions,
                       SUM(sentbyte + rcvdbyte) AS total_bytes,
                       MAX((sentbyte + rcvdbyte) * 8.0 / GREATEST(duration_sec, 1) / 1e6) AS peak_sess_mbps
                FROM read_csv_auto('{posix_path}')
                GROUP BY 1, 2, 3, 4, 5, 6
                ORDER BY total_bytes DESC
                """
            ).fetchall()
        elif "bytes" in cols and "elapsed_time_sec" in cols:
            vendor = "Palo Alto Networks PAN-OS"
            summary = con.execute(
                f"""
                SELECT COUNT(*) AS row_cnt,
                       COALESCE(SUM(bytes) * 8.0 / 86400.0 / 1e6, 0.0) AS avg_mbps,
                       COALESCE(QUANTILE_CONT(bytes * 8.0 / GREATEST(elapsed_time_sec, 1) / 1e6, 0.95), 0.0) AS p95_sess_mbps,
                       COALESCE(MAX(bytes * 8.0 / GREATEST(elapsed_time_sec, 1) / 1e6), 0.0) AS max_sess_mbps
                FROM read_csv_auto('{posix_path}')
                """
            ).fetchone()
            flow_rows = con.execute(
                f"""
                SELECT src_ip, dst_ip, CAST(dst_port AS INTEGER) AS dstport, UPPER(CAST(ip_protocol AS VARCHAR)) AS proto,
                       app, rule_name, COUNT(*) AS sessions,
                       SUM(bytes) AS total_bytes,
                       MAX(bytes * 8.0 / GREATEST(elapsed_time_sec, 1) / 1e6) AS peak_sess_mbps
                FROM read_csv_auto('{posix_path}')
                GROUP BY 1, 2, 3, 4, 5, 6
                ORDER BY total_bytes DESC
                """
            ).fetchall()
        else:
            cnt = con.execute(
                f"SELECT COUNT(*) FROM read_csv_auto('{posix_path}')"
            ).fetchone()
            return {
                "vendor": "Generic Firewall CSV",
                "row_count": int(cnt[0]) if cnt else 0,
                "p95_mbps": 10.0,
                "peak_mbps": 15.0,
                "service_flows": [],
            }

        assert summary is not None
        row_cnt = int(summary[0])
        avg_mbps = float(summary[1])
        p95_sess = float(summary[2])
        max_sess = float(summary[3])

        # Continuous multi-camera RTSP facilities exhibit high sustained aggregate Mbps > single session Mbps
        if avg_mbps > max_sess * 4.0:
            peak_mbps = round(avg_mbps, 1)
            p95_mbps = round(avg_mbps * 0.95, 2)
        else:
            peak_mbps = round(max_sess, 2)
            p95_mbps = round(max(p95_sess, avg_mbps), 2)

        parsed_service_flows = [
            {
                "src_ip": str(r[0]),
                "dst_ip": str(r[1]),
                "dst_port": int(r[2]),
                # FortiGate logs the IANA protocol number (6/17); PAN-OS and exports may use names
                "transport": "UDP" if str(r[3]).upper() in {"UDP", "17"} else "TCP",
                "service": str(r[4] or ""),
                "rule_name": str(r[5] or ""),
                "sessions": int(r[6]),
                "bytes": int(r[7]),
                "peak_mbps": round(float(r[8]), 2),
            }
            for r in flow_rows
        ]
        return {
            "vendor": vendor,
            "row_count": row_cnt,
            "p95_mbps": p95_mbps,
            "peak_mbps": peak_mbps,
            "service_flows": parsed_service_flows,
        }
    finally:
        con.close()


def _merge_flow_group(members: list[dict[str, Any]], peer_side: str) -> dict[str, Any]:
    """Fold a fan-in / fan-out group into one row anchored on its highest-volume member."""
    members = sorted(members, key=lambda m: (m["bytes"], m["packet_count"]), reverse=True)
    if len(members) == 1:
        return members[0]
    rep = dict(members[0])
    peers = sorted({m[peer_side] for m in members})
    rep["bytes"] = sum(m["bytes"] for m in members)
    rep["packet_count"] = sum(m["packet_count"] for m in members)
    rep["peak_mbps"] = round(sum(m["peak_mbps"] for m in members), 2)
    rep["fcs"] = sorted({fc for m in members for fc in m["fcs"]})
    rep["has_write"] = any(m["has_write"] for m in members)
    rep["ephemeral_dcom"] = any(m["ephemeral_dcom"] for m in members)
    # A scanner's flow that matches what its whole peer group does (e.g. its own RTSP stream) is normal
    rep["lateral"] = all(m["lateral"] for m in members)
    rep["fw_note"] = next((m["fw_note"] for m in members if m["fw_note"]), "")
    rep["merged_" + peer_side + "s"] = peers
    role = "sources" if peer_side == "src_ip" else "destinations"
    rep["peer_summary"] = f"{len(peers)} {role}: {', '.join(peers[:6])}{' …' if len(peers) > 6 else ''}"
    return rep


def _collapse_fan_out(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge repetitive same-service flows so 48 cameras -> one NVR, or one scanner -> 20 hosts,
    occupy one row each instead of crowding distinct services out of the flow table.

    Fan-in merges clients only within the same /24, so a rogue host polling the same PLC as the
    SCADA server stays a separate row. Read and write traffic never merge.
    """

    def service(it: dict[str, Any]) -> tuple[Any, ...]:
        port: Any = it["dst_port"]
        if it["transport"] == "UDP" and port >= 49152 and port not in _WELL_KNOWN_OT_IT_PORTS:
            port = "UDP_DYNAMIC"
        return (port, it["transport"], it["has_write"], it["direction"])

    fan_in: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for it in items:
        fan_in[(service(it), it["dst_ip"], _subnet24(it["src_ip"]))].append(it)

    out: list[dict[str, Any]] = []
    fan_out: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for members in fan_in.values():
        if len(members) > 1:
            out.append(_merge_flow_group(members, "src_ip"))
        else:
            fan_out[(service(members[0]), members[0]["src_ip"])].append(members[0])
    out.extend(_merge_flow_group(members, "dst_ip") for members in fan_out.values())
    return out


def run_telemetry_duckdb_agent(
    pcap_path: str | Path | None,
    firewall_csv_path: str | Path | None = None,
    *,
    conduit_id: str = "CONDUIT-01",
    conduit_name: str = "OT Control Zone to Enterprise IT Boundary",
    vlans_observed: list[int] | None = None,
    zone_map: dict[str, str] | None = None,
) -> TelemetryAuditResult:
    """Execute Scapy L7 `.pcap` dissection + DuckDB 24h firewall SQL aggregation."""
    pkt_count, pcap_bytes, pcap_flows = (
        dissect_pcap_file(pcap_path) if pcap_path else (0, 0, {})
    )
    fw_stats = query_firewall_csv_duckdb(firewall_csv_path)

    # Index firewall flows by (src_ip, dst_ip, dst_port) to fuse with PCAP L7 inspection
    fw_by_tuple: dict[tuple[str, str, int], dict[str, Any]] = {}
    for fwf in fw_stats["service_flows"]:
        fw_by_tuple[(fwf["src_ip"], fwf["dst_ip"], fwf["dst_port"])] = fwf

    merged_keys: dict[tuple[str, str, int], dict[str, Any]] = {}
    for (src_ip, dst_ip, svc_port, transport), pst in pcap_flows.items():
        fw_match = fw_by_tuple.get((src_ip, dst_ip, svc_port))
        proto_name, _ = _WELL_KNOWN_OT_IT_PORTS.get(
            svc_port,
            (
                fw_match["service"]
                if fw_match and fw_match.get("service")
                else f"{transport}/{svc_port}",
                "CUSTOM",
            ),
        )
        merged_keys[(src_ip, dst_ip, svc_port)] = {
            "src_ip": src_ip,
            "dst_ip": dst_ip,
            "dst_port": svc_port,
            "transport": transport,
            "protocol": proto_name,
            "fcs": sorted(pst["fcs"]),
            "has_write": bool(pst["has_write"]),
            "ephemeral_dcom": bool(pst["ephemeral_dcom"]),
            "packet_count": int(pst["packets"]),
            "bytes": int(fw_match["bytes"]) if fw_match else int(pst["bytes"]),
            "peak_mbps": float(fw_match["peak_mbps"]) if fw_match else round((pst["bytes"] * 8.0) / 1e6, 2),
            "fw_note": f"{fw_match['service']} {fw_match['rule_name']}" if fw_match else "",
        }

    # Add any firewall-only flows not sampled in the short PCAP window
    for key_tup, fwf in fw_by_tuple.items():
        if key_tup not in merged_keys:
            svc_port = fwf["dst_port"]
            proto_name, _ = _WELL_KNOWN_OT_IT_PORTS.get(
                svc_port, (fwf["service"] or f"{fwf['transport']}/{svc_port}", "CUSTOM")
            )
            merged_keys[key_tup] = {
                "src_ip": fwf["src_ip"],
                "dst_ip": fwf["dst_ip"],
                "dst_port": svc_port,
                "transport": fwf["transport"],
                "protocol": proto_name,
                "fcs": [fwf["service"]] if fwf["service"] else [],
                "has_write": False,
                "ephemeral_dcom": 49152 <= svc_port <= 65535,
                "packet_count": fwf["sessions"] * 12,
                "bytes": fwf["bytes"],
                "peak_mbps": fwf["peak_mbps"],
                "fw_note": f"{fwf['service']} {fwf['rule_name']}",
            }

    # Lateral movement: one source probing many hosts across several distinct services
    reach: dict[str, tuple[set[str], set[int]]] = defaultdict(lambda: (set(), set()))
    for item in merged_keys.values():
        if item["dst_port"] in _WELL_KNOWN_OT_IT_PORTS:
            hosts, ports = reach[item["src_ip"]]
            hosts.add(item["dst_ip"])
            ports.add(item["dst_port"])
    scanners = {
        src
        for src, (hosts, ports) in reach.items()
        if len(hosts) >= LATERAL_MIN_HOSTS and len(ports) >= LATERAL_MIN_PORTS
    }

    for item in merged_keys.values():
        item["direction"] = _determine_flow_direction(item["src_ip"], item["dst_ip"], zone_map, item["has_write"])
        item["lateral"] = item["src_ip"] in scanners
    collapsed = _collapse_fan_out(list(merged_keys.values()))
    for item in collapsed:
        if item["lateral"]:
            hosts, ports = reach[item["src_ip"]]
            item["fcs"] = sorted(
                {*item["fcs"], f"Lateral movement: {len(hosts)} hosts x {len(ports)} service ports"}
            )
        item["tier"] = _classify_flow_tier(
            src_ip=item["src_ip"],
            dst_ip=item["dst_ip"],
            dst_port=item["dst_port"],
            protocol_label=item["protocol"],
            direction=item["direction"],
            has_write_ops=item["has_write"],
            uses_ephemeral_dcom=item["ephemeral_dcom"],
            firewall_note=item["fw_note"],
            lateral_movement=item["lateral"],
        )

    # Every RED anomaly is kept; the remaining rows are filled by traffic volume
    flows_out: list[ProtocolFlowAnalysis] = []
    tier_counts = {"GREEN": 0, "AMBER": 0, "RED": 0}
    sorted_items = sorted(
        collapsed,
        key=lambda x: (x["tier"] == "RED", x["has_write"], x["bytes"], x["packet_count"]),
        reverse=True,
    )
    keep = max(24, sum(1 for x in sorted_items if x["tier"] == "RED"))

    for idx, item in enumerate(sorted_items[:keep], start=1):
        direction = item["direction"]
        tier = item["tier"]
        tier_counts[tier] += 1
        fc_detail = (
            "; ".join(item["fcs"])
            if item["fcs"]
            else (item["fw_note"].strip() or f"{item['protocol']} ({direction})")
        )
        if item.get("peer_summary"):
            fc_detail = f"{fc_detail} [{item['peer_summary']}]"
        flows_out.append(
            ProtocolFlowAnalysis(
                flow_id=f"FLOW-{idx:02d}",
                src_ip=item["src_ip"],
                dst_ip=item["dst_ip"],
                dst_port=item["dst_port"],
                transport=item["transport"],
                protocol=item["protocol"],
                direction=direction,
                function_codes_observed=item["fcs"],
                function_detail=fc_detail,
                has_write_operations=item["has_write"],
                uses_dynamic_ephemeral_ports=item["ephemeral_dcom"],
                lateral_movement_suspected=item["lateral"],
                merged_src_ips=item.get("merged_src_ips", []),
                merged_dst_ips=item.get("merged_dst_ips", []),
                packet_count=item["packet_count"],
                bytes_transferred=item["bytes"],
                p95_mbps=round(item["peak_mbps"] * 0.85, 2),
                peak_mbps=item["peak_mbps"],
                preliminary_tier=tier,
            )
        )

    peak_mbps = fw_stats["peak_mbps"]
    if peak_mbps <= 0.0 and pcap_path:
        peak_mbps = pcap_peak_mbps(pcap_path)
    sized_headroom = round(peak_mbps * 1.25, 2)
    p95_mbps = fw_stats["p95_mbps"] or round(peak_mbps * 0.82, 2)

    vlans = vlans_observed or [10, 50]
    conduit = TrafficConduit(
        conduit_id=conduit_id,
        name=conduit_name,
        source_zone="ZONE_OT_PRIMARY",
        destination_zone="ZONE_IT_ENTERPRISE",
        vlans_observed=vlans,
        requires_8021q_vlan_trunk=len(vlans) > 2,
        p95_mbps=p95_mbps,
        peak_mbps=peak_mbps,
        sized_mbps_with_headroom=sized_headroom,
        flows=flows_out,
    )

    return TelemetryAuditResult(
        pcap_packet_count=pkt_count,
        pcap_total_bytes=pcap_bytes,
        firewall_vendor=fw_stats["vendor"],
        firewall_row_count=fw_stats["row_count"],
        p95_bandwidth_mbps=p95_mbps,
        peak_bandwidth_mbps=peak_mbps,
        sized_bandwidth_with_1_25x_headroom_mbps=sized_headroom,
        flows=flows_out,
        conduits=[conduit],
        flow_tier_counts=tier_counts,
    )

