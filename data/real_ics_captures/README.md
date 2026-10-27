# Real-World Industrial Control System (ICS / SCADA / OT) Packet Captures

This directory houses **15 authentic, publicly licensed, real-world OT packet captures** (`.pcap` and `.pcapng`) collected from physical programmable logic controllers (PLCs), power-grid substation remote terminal units (RTUs) and intelligent electronic devices (IEDs), synchrophasor PMUs, and building management controllers.

- **Total Verified Captures:** `15` files (`1,218,378` bytes / `1.16 MB` total — zero Git LFS required)
- **Total Verified Packets:** `9,792` packets validated end-to-end via `scapy.utils.PcapReader`
- **Distinct Industrial Protocol Families:** `10` (`Modbus TCP`, `Siemens S7comm-plus`, `Siemens S7comm`, `IEC 60870-5-104 (IEC-104)`, `DNP3`, `EtherNet/IP (CIP)`, `BACnet/IP`, `OPC-UA Binary`, `IEC 61850 (MMS & GOOSE)`, `IEEE C37.118 Synchrophasor`)
- **Machine-Readable Inventory:** [`REAL_PCAP_MANIFEST.json`](./REAL_PCAP_MANIFEST.json)
- **Reproducible Harvester Script:** [`../scripts/download_real_ics_pcaps.py`](../scripts/download_real_ics_pcaps.py)

---

## Catalog of Real Hardware Captures

| # | File | OT Protocol Family | Port / EtherType | Packets | Size | Real Hardware / Operational Context | Source Repository | License |
|---:|---|---|---|---:|---:|---|---|---|
| 1 | `modbus_schneider_modicon_plc.pcap` | **Modbus TCP** | `TCP/502` | 191 | 31.4 KB | Schneider Electric Modicon PLC register read/write & device identification | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/modicon/modicon_test.pcap) | `CC-BY-4.0` |
| 2 | `modbus_digitalbond_quickdraw_plc.pcap` | **Modbus TCP** | `TCP/502` | 350 | 27.1 KB | Digital Bond Quickdraw SCADA field trace of PLC coil/holding register polling & writes | [automayt/ICS-pcap](https://github.com/automayt/ICS-pcap/raw/master/MODBUS/digitalbond%20pcaps/modbus_test_data_part2/modbus_test_data_part2.pcap) | `Public Community Archive (Digital Bond Quickdraw / automayt/ICS-pcap)` |
| 3 | `s7comm_siemens_s7_1200_tia_ob1.pcap` | **Siemens S7comm-plus** | `TCP/102` | 149 | 19.4 KB | Siemens SIMATIC S7-1200 PLC & TIA Portal V12 engineering station uploading Organization Block OB1 (S7comm-plus 0x72) | [automayt/ICS-pcap](https://github.com/automayt/ICS-pcap/raw/master/S7/S7-1200-Uploading-OB1-TIAV12/S7-1200-Uploading-OB1-TIAV12.pcap) | `Public Community Archive (automayt/ICS-pcap)` |
| 4 | `s7comm_siemens_s7_400_wincc_prod.pcapng` | **Siemens S7comm** | `TCP/102` | 1,658 | 287.2 KB | Production Siemens SIMATIC S7-400 PLC polled continuously by Siemens WinCC SCADA HMI (.pcapng) | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/s7/wincc_s400_production.pcapng) | `CC-BY-4.0` |
| 5 | `s7comm_plus_siemens_s7_1500_cisa.pcap` | **Siemens S7comm-plus** | `TCP/102` | 262 | 32.7 KB | Siemens SIMATIC S7-1200/1500 next-generation S7comm-plus (0x72 OMS) session over ISO-on-TCP | [cisagov/icsnpp-s7comm](https://raw.githubusercontent.com/cisagov/icsnpp-s7comm/main/testing/traces/s7comm_plus.pcap) | `BSD-3-Clause` |
| 6 | `iec104_substation_rtu_diverse.pcap` | **IEC 60870-5-104 (IEC-104)** | `TCP/2404` | 173 | 13.6 KB | Power grid substation RTU telecontrol capture with STARTDT/TESTFR U-frames, S-frames & diverse ASDUs | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC60870-5-104/090813_diverse.pcap) | `CC-BY-4.0` |
| 7 | `iec104_substation_rtu_polling.pcap` | **IEC 60870-5-104 (IEC-104)** | `TCP/2404` | 105 | 9.9 KB | Substation SCADA master general interrogation & spontaneous RTU telemetry over TCP/2404 | [automayt/ICS-pcap](https://github.com/automayt/ICS-pcap/raw/master/IEC%2060870/iec104/iec104.pcap) | `Public Community Archive (automayt/ICS-pcap)` |
| 8 | `dnp3_substation_relay_cisa.pcap` | **DNP3** | `TCP/20000` | 834 | 112.7 KB | Utility substation master & outstation relay Class 0/1/2/3 polling, Unsolicited Responses & Direct Operate | [cisagov/icsnpp-dnp3](https://raw.githubusercontent.com/cisagov/icsnpp-dnp3/main/testing/traces/dnp3_example.pcap) | `BSD-3-Clause` |
| 9 | `dnp3_digitalbond_quickdraw_outstation.pcap` | **DNP3** | `TCP/20000` | 181 | 15.5 KB | Digital Bond Quickdraw substation DNP3 master-to-outstation read/write & integrity poll trace | [automayt/ICS-pcap](https://github.com/automayt/ICS-pcap/raw/master/DNP3/DNP3-TestDataPart1/DNP3-TestDataPart1.pcap) | `Public Community Archive (Digital Bond Quickdraw / automayt/ICS-pcap)` |
| 10 | `enip_controllogix5000_mode_change.pcap` | **EtherNet/IP (CIP)** | `TCP/44818` | 727 | 127.8 KB | Rockwell Automation Allen-Bradley ControlLogix 5000 PLC remote CPU mode change via RSLogix 5000 CIP | [automayt/ICS-pcap](https://github.com/automayt/ICS-pcap/raw/master/ETHERNET_IP/digitalbond%20pcaps/CL5000EIP-Remote-Mode-Change-Attempt/CL5000EIP-Remote-Mode-Change-Attempt.pcap) | `Public Community Archive (Digital Bond Quickdraw / automayt/ICS-pcap)` |
| 11 | `enip_cip_explicit_and_implicit_io_cisa.pcap` | **EtherNet/IP (CIP)** | `TCP/44818, UDP/2222` | 776 | 91.7 KB | ODVA / Rockwell EtherNet/IP explicit CIP messaging (TCP/44818), Class 1 implicit real-time I/O (UDP/2222) & LLDP | [cisagov/icsnpp-enip](https://raw.githubusercontent.com/cisagov/icsnpp-enip/main/testing/traces/enip_cip_example.pcap) | `BSD-3-Clause` |
| 12 | `bacnet_ip_building_controllers_cisa.pcap` | **BACnet/IP** | `UDP/47808` | 3,257 | 250.0 KB | Multi-controller BMS/HVAC network (40+ BACnet/IP field controllers) exchanging Who-Is, I-Am, ReadProperty & COV | [cisagov/icsnpp-bacnet](https://raw.githubusercontent.com/cisagov/icsnpp-bacnet/main/testing/traces/bacnet_example.pcap) | `BSD-3-Clause` |
| 13 | `opcua_binary_session_handshake_cisa.pcap` | **OPC-UA Binary** | `TCP/4840` | 411 | 81.6 KB | Industrial OPC Unified Architecture binary TCP session (HEL/ACK, OpenSecureChannel, CreateSession, Read/Browse) | [cisagov/icsnpp-opcua-binary](https://raw.githubusercontent.com/cisagov/icsnpp-opcua-binary/main/pcaps/opcua_with-gap_with-handshake.pcap) | `BSD-3-Clause` |
| 14 | `iec61850_substation_mms_and_goose.pcap` | **IEC 61850 (MMS & GOOSE)** | `TCP/102, EtherType/0x88b8` | 301 | 42.4 KB | Digital substation IED protection & control capture combining Layer-7 MMS (TCP/102) and Layer-2 multicast GOOSE (0x88b8) | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC61850/Sample_File_MMS_and_GOOSE.pcap) | `CC-BY-4.0` |
| 15 | `ieee_c37_118_synchrophasor_pmu.pcap` | **IEEE C37.118 Synchrophasor** | `TCP/4712` | 417 | 46.9 KB | Wide-area transmission grid Phasor Measurement Unit (PMU) streaming real-time synchrophasor frames to PDC | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/C37.118/C37.118_1PMU_TCP.pcap) | `CC-BY-4.0` |

---

## How ConduitAI Uses These Captures for Protocol Validation

Alongside ConduitAI's deterministic multi-source plant scenarios in `data/scenarios/`, these real-world captures serve as **ground-truth regression and interoperability fixtures** across our passive OT ingestion pipeline:

1. **Layer-7 Deep Packet Inspection (DPI) & Dissector Verification:**
   - **Manufacturing Zone (`scenario_1_manufacturing`):** Validates MBAP framing and function-code extraction on Schneider Modicon & Digital Bond **Modbus TCP** (`TCP/502`), ISO-on-TCP RFC 1006 / COTP PDU reassembly on **Siemens S7comm** (`0x32` on S7-1200/S7-400) and **S7comm-plus** (`0x72` on S7-1500), **EtherNet/IP CIP** explicit session commands (`TCP/44818`) plus implicit Class 1 real-time I/O (`UDP/2222`) on Rockwell Allen-Bradley ControlLogix 5000 PLCs, and **OPC-UA Binary** secure channel handshakes (`HEL`/`ACK`/`OPN`/`MSG` on `TCP/4840`).
   - **Electric Utility Substation Zone (`scenario_2_substation`):** Validates **IEC 60870-5-104** APCI `0x68` I/S/U-frame state tracking (`TCP/2404`), **DNP3** Data-Link `0x0564` CRC framing and Direct Operate / Class polling (`TCP/20000`), **IEC 61850** dual-stack substation traffic combining Layer-7 **MMS** (`TCP/102`) with Layer-2 multicast **GOOSE** (`EtherType 0x88b8`), and **IEEE C37.118** real-time PMU synchrophasor telemetry (`0xAA` sync frames on `TCP/4712`).
   - **Smart Building / BMS Zone (`scenario_3_smart_building`):** Validates **BACnet/IP** BVLC (`0x81`) broadcast/unicast device discovery (`Who-Is` / `I-Am`), `ReadPropertyMultiple`, and Change-of-Value (`COV`) flows across 40+ field HVAC controllers (`UDP/47808`).
2. **Container & Encapsulation Robustness:**
   - Exercises classic microsecond `libpcap` (`0xa1b2c3d4`), next-generation `pcapng` (`0x0a0d0d0a`, e.g., `s7comm_siemens_s7_400_wincc_prod.pcapng`), standard `Ethernet` (`LINKTYPE_ETHERNET=1`), and Linux cooked capture `SLL` (`LINKTYPE_LINUX_SLL=113`, e.g., `s7comm_plus_siemens_s7_1500_cisa.pcap`).
3. **Passive Asset & Conduit Graph Extraction:**
   - Confirms that ConduitAI accurately classifies master/HMI initiators vs. PLC/RTU/IED responders, extracts hardware vendor MAC OUIs where Layer-2 headers are present, and flags write/control operations (such as S7 `OB1` program upload, ControlLogix remote mode changes, and DNP3 Direct Operate commands) when synthesizing IEC 62443 zones, conduits, and firewall policy rules.

---

## Re-Running Harvest & Cryptographic Verification

To re-download and re-verify all 15 captures from upstream sources (including binary magic checks, SHA-256 checksum computation, and full Scapy packet parsing):

```bash
python data/scripts/download_real_ics_pcaps.py
```

## Upstream Attribution & Licensing

- **U.S. Cybersecurity and Infrastructure Security Agency (CISA) — ICSNPP** ([`cisagov/icsnpp-*`](https://github.com/cisagov/ICSNPP)): Distributed under the `BSD-3-Clause` license.
- **Information Trust Institute (ITI), University of Illinois Urbana-Champaign** ([`ITI/ICS-Security-Tools`](https://github.com/ITI/ICS-Security-Tools)): Distributed under the Creative Commons Attribution 4.0 International (`CC-BY-4.0`) license.
- **ICS-pcap Community Archive** ([`automayt/ICS-pcap`](https://github.com/automayt/ICS-pcap)): Curated public research captures originally published by Digital Bond (Quickdraw SCADA IDS project) and the ICS security research community.
