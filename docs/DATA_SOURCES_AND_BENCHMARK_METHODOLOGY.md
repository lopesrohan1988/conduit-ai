# ConduitAI: Data Sources and Benchmark Method

This page lists every dataset ConduitAI uses, says which parts are real and which are synthetic, and explains how the results in [`BENCHMARK_SCORECARD.md`](BENCHMARK_SCORECARD.md) are produced.

## 1. Why the demo plants are synthetic

Utilities and water operators don't publish their boundary traffic, firewall rules or cabinet layouts; in many places they're not allowed to. Public ICS captures exist, but each is a short single-protocol lab trace with no firewall log, switch config, drawing or cabinet photo to go with it. So ConduitAI uses two layers:

| Layer | What it is | Real? |
| :--- | :--- | :--- |
| Public ICS captures (`data/real_ics_captures/`) | 15 packet captures from CISA and UIUC ITI, 9,066 packets across 10 protocol families | **Real**, under BSD-3-Clause or CC-BY-4.0 |
| Demo plants 1 and 2 (`data/scenarios/`) | Two complete plants: SPAN capture, 24 h firewall log, switch dump, asset list, drawing, cabinet photos | **Synthetic**, generated for this project |
| Demo plant 3 (`data/scenarios/scenario_5_uowm_iec104/`) | 26,197 IEC-104 packets from a university grid testbed with a recorded attack, plus the asset list from the dataset's published topology | **Real**, CC-BY-4.0 (UOWM, Zenodo 7108614); answer key from the authors' own labels |
| Real-photo check (`data/evals/real_photo_check.json`) | 17 real cabinet and rack photos from Wikimedia Commons, downloaded on demand | **Real**, each under its own Commons licence |

The real captures do two jobs. They test the Layer-7 dissectors on traffic from real equipment, and they supply the control commands (breaker trips, DNP3 operate, Modbus writes) that the attack replay sends down each plant's paths.

## 2. Real public ICS captures

Every capture below is an unmodified copy of a file published under an open licence. [`data/scripts/verify_real_ics_captures.py`](../data/scripts/verify_real_ics_captures.py) re-downloads each one from its source and checks the SHA-256 recorded in [`REAL_PCAP_MANIFEST.json`](../data/real_ics_captures/REAL_PCAP_MANIFEST.json); all 15 match. 12 of the 15 yield Layer-7 decodes in ConduitAI's dissector (the S7comm-plus, small EtherNet/IP and C37.118 traces decode only at the transport layer).

| # | Capture | Protocol | Packets | What it contains | Source | Licence |
| --: | :--- | :--- | --: | :--- | :--- | :--- |
| 1 | [`modbus_schneider_modicon_plc.pcap`](../data/real_ics_captures/modbus_schneider_modicon_plc.pcap) | Modbus TCP | 191 | Schneider Electric Modicon PLC register read/write & device identification | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/modicon/modicon_test.pcap) | CC-BY-4.0 |
| 2 | [`modbus_scada_master_writes_iti.pcap`](../data/real_ics_captures/modbus_scada_master_writes_iti.pcap) | Modbus TCP | 350 | SCADA master polling coils and registers (FC 01-04) interleaved with write commands (FC 05/06/15/16) | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/ModbusTCP/modbus_test_data_part2.pcap) | CC-BY-4.0 |
| 3 | [`s7comm_snap7_client_cisa.pcap`](../data/real_ics_captures/s7comm_snap7_client_cisa.pcap) | Siemens S7comm | 64 | Snap7 client session against an S7 PLC (COTP connect, S7 setup and reads) | [cisagov/icsnpp-s7comm](https://raw.githubusercontent.com/cisagov/icsnpp-s7comm/main/testing/traces/snap7.pcap) | BSD-3-Clause |
| 4 | [`s7comm_siemens_s7_400_wincc_prod.pcapng`](../data/real_ics_captures/s7comm_siemens_s7_400_wincc_prod.pcapng) | Siemens S7comm | 1,658 | Production Siemens SIMATIC S7-400 PLC polled continuously by Siemens WinCC SCADA HMI (.pcapng) | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/s7/wincc_s400_production.pcapng) | CC-BY-4.0 |
| 5 | [`s7comm_plus_siemens_s7_1500_cisa.pcap`](../data/real_ics_captures/s7comm_plus_siemens_s7_1500_cisa.pcap) | Siemens S7comm-plus | 262 | Siemens SIMATIC S7-1200/1500 next-generation S7comm-plus (0x72 OMS) session over ISO-on-TCP | [cisagov/icsnpp-s7comm](https://raw.githubusercontent.com/cisagov/icsnpp-s7comm/main/testing/traces/s7comm_plus.pcap) | BSD-3-Clause |
| 6 | [`iec104_substation_rtu_diverse.pcap`](../data/real_ics_captures/iec104_substation_rtu_diverse.pcap) | IEC 60870-5-104 (IEC-104) | 173 | Power grid substation RTU telecontrol capture with STARTDT/TESTFR U-frames, S-frames & diverse ASDUs | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC60870-5-104/090813_diverse.pcap) | CC-BY-4.0 |
| 7 | [`iec104_rtu_breaker_commands_iti.pcap`](../data/real_ics_captures/iec104_rtu_breaker_commands_iti.pcap) | IEC 60870-5-104 (IEC-104) | 147 | IEC-104 master/RTU session with single and double commands (TypeID 45/46) and measured values | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC60870-5-104/TestDissectIec104.pcap) | CC-BY-4.0 |
| 8 | [`dnp3_substation_relay_cisa.pcap`](../data/real_ics_captures/dnp3_substation_relay_cisa.pcap) | DNP3 | 834 | Utility substation master & outstation relay Class 0/1/2/3 polling, Unsolicited Responses & Direct Operate | [cisagov/icsnpp-dnp3](https://raw.githubusercontent.com/cisagov/icsnpp-dnp3/main/testing/traces/dnp3_example.pcap) | BSD-3-Clause |
| 9 | [`dnp3_master_operate_iti.pcap`](../data/real_ics_captures/dnp3_master_operate_iti.pcap) | DNP3 | 214 | DNP3 master/outstation session with reads and Select/Direct Operate commands | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/bro/dnp3/dnp3.pcap) | CC-BY-4.0 |
| 10 | [`enip_list_identity_session_iti.pcap`](../data/real_ics_captures/enip_list_identity_session_iti.pcap) | EtherNet/IP (CIP) | 11 | EtherNet/IP encapsulation session (RegisterSession, ListIdentity, CIP requests) | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/EthernetIP/enip_test.pcap) | CC-BY-4.0 |
| 11 | [`enip_cip_explicit_and_implicit_io_cisa.pcap`](../data/real_ics_captures/enip_cip_explicit_and_implicit_io_cisa.pcap) | EtherNet/IP (CIP) | 776 | ODVA / Rockwell EtherNet/IP explicit CIP messaging (TCP/44818), Class 1 implicit real-time I/O (UDP/2222) & LLDP | [cisagov/icsnpp-enip](https://raw.githubusercontent.com/cisagov/icsnpp-enip/main/testing/traces/enip_cip_example.pcap) | BSD-3-Clause |
| 12 | [`bacnet_ip_building_controllers_cisa.pcap`](../data/real_ics_captures/bacnet_ip_building_controllers_cisa.pcap) | BACnet/IP | 3,257 | Multi-controller BMS/HVAC network (40+ BACnet/IP field controllers) exchanging Who-Is, I-Am, ReadProperty & COV | [cisagov/icsnpp-bacnet](https://raw.githubusercontent.com/cisagov/icsnpp-bacnet/main/testing/traces/bacnet_example.pcap) | BSD-3-Clause |
| 13 | [`opcua_binary_session_handshake_cisa.pcap`](../data/real_ics_captures/opcua_binary_session_handshake_cisa.pcap) | OPC-UA Binary | 411 | Industrial OPC Unified Architecture binary TCP session (HEL/ACK, OpenSecureChannel, CreateSession, Read/Browse) | [cisagov/icsnpp-opcua-binary](https://raw.githubusercontent.com/cisagov/icsnpp-opcua-binary/main/pcaps/opcua_with-gap_with-handshake.pcap) | BSD-3-Clause |
| 14 | [`iec61850_substation_mms_and_goose.pcap`](../data/real_ics_captures/iec61850_substation_mms_and_goose.pcap) | IEC 61850 (MMS & GOOSE) | 301 | Digital substation IED protection & control capture combining Layer-7 MMS (TCP/102) and Layer-2 multicast GOOSE (0x88b8) | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/IEC61850/Sample_File_MMS_and_GOOSE.pcap) | CC-BY-4.0 |
| 15 | [`ieee_c37_118_synchrophasor_pmu.pcap`](../data/real_ics_captures/ieee_c37_118_synchrophasor_pmu.pcap) | IEEE C37.118 Synchrophasor | 417 | Wide-area transmission grid Phasor Measurement Unit (PMU) streaming real-time synchrophasor frames to PDC | [ITI/ICS-Security-Tools](https://raw.githubusercontent.com/ITI/ICS-Security-Tools/master/pcaps/C37.118/C37.118_1PMU_TCP.pcap) | CC-BY-4.0 |

The ITI repository redistributes some captures that originated elsewhere (for example Digital Bond test data and Zeek test traces); they are used here under the ITI repository's CC-BY-4.0 licence, with the source path linked for each file.

## 3. The demo plants

| Plant | Folder | What's in it |
| :--- | :--- | :--- |
| GridCore 220 kV substation | `data/scenarios/scenario_2_substation/` | IEC-104, DNP3, Modbus and Syslog traffic; Palo Alto log; Hirschmann switch dump; 19-inch rack photo; network drawing |
| AquaPure water treatment | `data/scenarios/scenario_4_water_treatment/` | EtherNet/IP, Modbus, VNC and HTTPS traffic; FortiGate log; Stratix switch dump; DIN-rail cabinet photo; photo of a rogue cellular modem; network drawing |
| UOWM IEC-104 testbed (real traffic) | `data/scenarios/scenario_5_uowm_iec104/` | Real IEC-104 capture and an asset list transcribed from the dataset's Figure 1; no firewall log, switch dump, drawing or photos exist, and none is invented. See [its README](../data/scenarios/scenario_5_uowm_iec104/README.md) for attribution, the merge and the modelling choices |

How the synthetic plants (1 and 2) were made:

- **Packet captures, firewall logs, switch dumps and asset lists** were generated by the author with protocol-valid packets and Layer-7 payloads. The water plant's layout follows the published architecture of the SUTD SWaT testbed; no SWaT data is used and no SWaT names appear in the files.
- **Cabinet and rack photos** are AI-generated images. **Network drawings** are generated images.
- **Walkthrough videos** are rendered by [`generate_rack_videos.py`](../data/scripts/generate_rack_videos.py). SAM 3.1 detects little in them, so they add little evidence.
- **The answer key** [`benchmark_ground_truth.json`](../data/evals/benchmark_ground_truth.json) was written by the author alongside the scenarios. The pipeline never reads it; only the scorer does.

Because the plants and the parsers were written by the same person, perception scores on them (assets, shadow devices, peak Mbps) are regression tests, not evidence that the parsers generalise.

## 4. Recorded model output

Live calls to SAM 3.1 and Muse Spark are recorded under [`data/cache/`](../data/cache/), keyed by the image's SHA-256, the prompt and (for Muse Spark) the region. Runs without an API key replay those recordings and are labelled `recorded_sam31` / `recorded_muse_spark` in the UI; an image with no recording comes back as `unavailable`, never as an invented result. Muse Wonder's architect output is not recorded: without a key, the rule engine designs the plan and the same verifier checks it.

## 5. What the benchmark measures

[`backend/scripts/run_eval_benchmark.py`](../backend/scripts/run_eval_benchmark.py) runs the full pipeline on each plant's raw files and only then compares the plan with the answer key:

| Metric | Meaning |
| :--- | :--- |
| Assets and shadow devices found | Hosts discovered from the switch and traffic, and how many of the undocumented ones were caught |
| Peak bandwidth | Measured peak Mbps from the firewall log, within tolerance of the answer key |
| Flow tier correct | Each labelled flow graded Green / Amber / Red as in the answer key |
| Critical flows severed | Every flow the answer key marks as must-cut is cut at Layer 1 |
| Unsafe passes | Must-block flows graded Green (should be 0) |
| Hardware BoM exact | Diode archetypes and quantities match the answer key |

It also runs every real capture through the dissector and reports which ones yield Layer-7 decodes. Two further checks are separate scripts: [`check_real_photos.py`](../backend/scripts/check_real_photos.py) (below) and the attack replay, which runs inside each pipeline result.

**What is not claimed:** the socket "digital twin" in the UI is a mechanism demo that cannot fail by construction, so it is not counted as evidence. Video tracking accuracy is not measured, because the rendered videos have no meaningful ground truth.

### Real-photo check

The demo plants' cabinet photos are AI-generated, and SAM 3.1 measures them well. To find out how it does on real equipment, [`backend/scripts/check_real_photos.py`](../backend/scripts/check_real_photos.py) runs the same cabinet inspection on 17 real photos from Wikimedia Commons (racks, DIN-rail cabinets, and photos with no enclosure as controls). The images are not stored in this repo: the script downloads them from Commons, and the recorded SAM 3.1 and Muse Spark outputs are replayed unless `--live` is passed. Labels in [`real_photo_check.json`](../data/evals/real_photo_check.json) were written by the project author from looking at each photo; empty U is labelled only where it can be counted.

| Photo | Label | Result | Licence |
|---|---|---|---|
| [Patch_Panel.jpg](https://commons.wikimedia.org/wiki/File:Patch_Panel.jpg) | wall network enclosure | not measured (recorded_sam31) | CC BY-SA 3.0, Agott at English Wikipedia |
| [Patchpanel.JPG](https://commons.wikimedia.org/wiki/File:Patchpanel.JPG) | 19-inch rack, 0 empty U | 19-inch rack, 0 empty U (recorded_sam31) | CC BY 2.5, Florian Lindner |
| [Patchpanel1.jpg](https://commons.wikimedia.org/wiki/File:Patchpanel1.jpg) | 19-inch rack | not measured (recorded_sam31) | CC BY-SA 4.0, Yasser hesham |
| [Cisco_SVX_4300_series_19_rack.jpg](https://commons.wikimedia.org/wiki/File:Cisco_SVX_4300_series_19%22_rack.jpg) | 19-inch rack | not measured (recorded_sam31) | CC BY 2.0, ftzdomino |
| [Layout_and_identifying_fiber_optic_cables_for_a_power_substa.jpg](https://commons.wikimedia.org/wiki/File:Layout_and_identifying_fiber_optic_cables_for_a_power_substation_in_Queens._(CS179,_11-07-2019)_(49034201261).jpg) | 19-inch rack | not measured (recorded_sam31) | CC BY 2.0, MTA Capital Construction Mega Projects |
| [Layout_and_installation_of_fiber_optic_cable_in_a_communicat.jpg](https://commons.wikimedia.org/wiki/File:Layout_and_installation_of_fiber_optic_cable_in_a_communication_rack_in_Queens._(49281750862).jpg) | 19-inch rack | not measured (recorded_sam31) | CC BY 2.0, MTA Capital Construction Mega Projects |
| [Netzwerkschrank_in_19_-Ausf_hrung.jpg](https://commons.wikimedia.org/wiki/File:Netzwerkschrank_in_19%22-Ausf%C3%BChrung.jpg) | 19-inch rack | not measured (recorded_sam31) | CC BY-SA 4.0, Achimsh |
| [Rack_Cabinet_EASV.jpg](https://commons.wikimedia.org/wiki/File:Rack_Cabinet,_EASV.jpg) | 19-inch rack | not measured (recorded_sam31) | CC BY-SA 2.0, Kent Madsen |
| [SDH_Racks.jpg](https://commons.wikimedia.org/wiki/File:SDH_Racks.jpg) | 19-inch rack | not measured (recorded_sam31) | CC BY-SA 3.0, Deasington |
| [48_GPIO_Ethernet_interface.jpg](https://commons.wikimedia.org/wiki/File:48_GPIO_Ethernet_interface.jpg) | no enclosure | not measured (recorded_sam31) | CC BY-SA 4.0, Lambtron |
| [Components_for_DIN_rail.JPG](https://commons.wikimedia.org/wiki/File:Components_for_DIN_rail.JPG) | no enclosure | not measured (recorded_sam31) | CC BY-SA 3.0, Dmitry G |
| [Light_circuit_protection_against_residual_current.JPG](https://commons.wikimedia.org/wiki/File:Light_circuit_protection_against_residual_current.JPG) | no enclosure | not measured (recorded_sam31) | CC BY-SA 3.0, Dmitry G |
| [PLC_Panasonic_FP-XH_C30T.jpg](https://commons.wikimedia.org/wiki/File:PLC_Panasonic_FP-XH_C30T.jpg) | DIN-rail cabinet | 19-inch rack, 0 empty U (recorded_sam31) | CC BY-SA 4.0, Angga Panca Alam Anugrah |
| [Smart-meter-gateway.jpg](https://commons.wikimedia.org/wiki/File:Smart-meter-gateway.jpg) | DIN-rail cabinet | not measured (recorded_sam31) | CC BY-SA 4.0, Pichiciago |
| [DIGIDIM_router2.jpg](https://commons.wikimedia.org/wiki/File:DIGIDIM_router2.jpg) | no enclosure | not measured (recorded_sam31) | CC BY-SA 3.0, Symppis |
| [DIN_rail.JPG](https://commons.wikimedia.org/wiki/File:DIN_rail.JPG) | no enclosure | not measured (recorded_sam31) | Public domain, Dmitry G |
| [I3_Engineering_Atom_Hydrogen_controller.jpg](https://commons.wikimedia.org/wiki/File:I3_Engineering_Atom_Hydrogen_controller.jpg) | no enclosure | not measured (recorded_sam31) | CC BY-SA 4.0, I3mikev |

Enclosure photos measured: 2 of 11
False free-space claims: 0
False cellular-modem alarms: 0 of 17 photos

**What this shows:**

- **It fails safe.** No photo produced a false free-space claim and none produced a false cellular-modem alarm. Two fixes made that true:
  - **A Muse Spark check on rack gaps.** On `Patchpanel.JPG` (a full rack), SAM missed several cable-covered panels, and the geometry first reported **16 empty U**. Muse Spark looked at each gap and identified horizontal cable managers, so the result is now 0 U, which is correct.
  - **No measurement without evidence.** Racks shot at an angle used to come back as "DIN cabinet, 0 mm free rail". An enclosure with no rail, rack device or modem found is now reported as not measured.
- **Coverage is low.** Only 2 of 11 enclosure photos are measured, and one of those (`PLC_Panasonic_FP-XH_C30T.jpg`) is mistyped as a rack because SAM tags rows of terminal blocks as "patch panels" (it reports no free space, so the plan is not misled). SAM 3.1 finds rack gear reliably only in frontal, uncluttered shots.
- **For a site survey:** ask for straight-on photos of each open cabinet with the whole rack or rail in frame, and expect an engineer to confirm space that is reported as not measured.

## 6. Catalogs

- [`hardware_catalog.json`](../data/catalogs/hardware_catalog.json): four vendor-neutral diode archetypes with throughput, protocols, mounting and price. Point `HARDWARE_CATALOG_PATH` at a vendor catalog with the same schema to quote real SKUs.
- [`oui_vendors.json`](../data/catalogs/oui_vendors.json): MAC address prefixes of industrial vendors, used to name devices found in switch tables.
- [`iec62443_controls.json`](../data/catalogs/iec62443_controls.json): the IEC 62443-3-3, NIST SP 800-82, NERC CIP-005 and MITRE ATT&CK for ICS references used in the compliance mapping.
