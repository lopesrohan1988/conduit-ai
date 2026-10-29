# Real public ICS captures

15 packet captures from real industrial equipment and lab setups (9,066 packets, 10 protocol families), each an unmodified copy of a file published under an open licence:

- [cisagov ICSNPP](https://github.com/cisagov/ICSNPP) parsers' test traces, BSD-3-Clause
- [ITI/ICS-Security-Tools](https://github.com/ITI/ICS-Security-Tools) (University of Illinois), CC-BY-4.0

| File | Protocol | Packets | Source | Licence |
| :--- | :--- | --: | :--- | :--- |
| `modbus_schneider_modicon_plc.pcap` | Modbus TCP | 191 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/modicon/modicon_test.pcap) | CC-BY-4.0 |
| `modbus_scada_master_writes_iti.pcap` | Modbus TCP | 350 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/ModbusTCP/modbus_test_data_part2.pcap) | CC-BY-4.0 |
| `s7comm_snap7_client_cisa.pcap` | Siemens S7comm | 64 | [cisagov/icsnpp-s7comm](https://raw.githubusercontent.com/cisagov/icsnpp-s7comm/main/testing/traces/snap7.pcap) | BSD-3-Clause |
| `s7comm_siemens_s7_400_wincc_prod.pcapng` | Siemens S7comm | 1,658 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/s7/wincc_s400_production.pcapng) | CC-BY-4.0 |
| `s7comm_plus_siemens_s7_1500_cisa.pcap` | Siemens S7comm-plus | 262 | [cisagov/icsnpp-s7comm](https://raw.githubusercontent.com/cisagov/icsnpp-s7comm/main/testing/traces/s7comm_plus.pcap) | BSD-3-Clause |
| `iec104_substation_rtu_diverse.pcap` | IEC 60870-5-104 (IEC-104) | 173 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC60870-5-104/090813_diverse.pcap) | CC-BY-4.0 |
| `iec104_rtu_breaker_commands_iti.pcap` | IEC 60870-5-104 (IEC-104) | 147 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC60870-5-104/TestDissectIec104.pcap) | CC-BY-4.0 |
| `dnp3_substation_relay_cisa.pcap` | DNP3 | 834 | [cisagov/icsnpp-dnp3](https://raw.githubusercontent.com/cisagov/icsnpp-dnp3/main/testing/traces/dnp3_example.pcap) | BSD-3-Clause |
| `dnp3_master_operate_iti.pcap` | DNP3 | 214 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/bro/dnp3/dnp3.pcap) | CC-BY-4.0 |
| `enip_list_identity_session_iti.pcap` | EtherNet/IP (CIP) | 11 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/EthernetIP/enip_test.pcap) | CC-BY-4.0 |
| `enip_cip_explicit_and_implicit_io_cisa.pcap` | EtherNet/IP (CIP) | 776 | [cisagov/icsnpp-enip](https://raw.githubusercontent.com/cisagov/icsnpp-enip/main/testing/traces/enip_cip_example.pcap) | BSD-3-Clause |
| `bacnet_ip_building_controllers_cisa.pcap` | BACnet/IP | 3,257 | [cisagov/icsnpp-bacnet](https://raw.githubusercontent.com/cisagov/icsnpp-bacnet/main/testing/traces/bacnet_example.pcap) | BSD-3-Clause |
| `opcua_binary_session_handshake_cisa.pcap` | OPC-UA Binary | 411 | [cisagov/icsnpp-opcua-binary](https://raw.githubusercontent.com/cisagov/icsnpp-opcua-binary/main/pcaps/opcua_with-gap_with-handshake.pcap) | BSD-3-Clause |
| `iec61850_substation_mms_and_goose.pcap` | IEC 61850 (MMS & GOOSE) | 301 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC61850/Sample_File_MMS_and_GOOSE.pcap) | CC-BY-4.0 |
| `ieee_c37_118_synchrophasor_pmu.pcap` | IEEE C37.118 Synchrophasor | 417 | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/C37.118/C37.118_1PMU_TCP.pcap) | CC-BY-4.0 |

`REAL_PCAP_MANIFEST.json` records each file's SHA-256, packet count, time span and endpoints. To check every file against its upstream source:

```bash
python data/scripts/verify_real_ics_captures.py
```

ConduitAI uses these captures to test its Layer-7 dissectors and as the source of the real control commands in the attack replay.
