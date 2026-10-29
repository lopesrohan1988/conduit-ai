<div align="center">

# 🛡️ ConduitAI

### OT Network Isolation, Hardware Data Diode Sizing & IEC 62443 Cutover Workbench

**Meta Global AI Developer Hackathon 2026** · **Problem Statement:** *Push the Frontier* · **Track:** *Indie Developer*

[![Meta Muse Wonder](https://img.shields.io/badge/Meta%20AI-Muse%20Wonder%20(live%20architect)-0668E1?style=for-the-badge&logo=meta&logoColor=white)](#-how-the-meta-models-are-used)
[![Meta SAM 3.1](https://img.shields.io/badge/Meta%20AI-SAM%203.1-0668E1?style=for-the-badge&logo=meta&logoColor=white)](#-how-the-meta-models-are-used)
[![Meta Muse Spark](https://img.shields.io/badge/Meta%20AI-Muse%20Spark-0668E1?style=for-the-badge&logo=meta&logoColor=white)](#-how-the-meta-models-are-used)
[![Meta Muse Voice](https://img.shields.io/badge/Meta%20AI-Muse%20Voice%20Transcribe-0668E1?style=for-the-badge&logo=meta&logoColor=white)](#-how-the-meta-models-are-used)
[![DuckDB](https://img.shields.io/badge/Scapy%20%2B%20DuckDB-Packet%20%26%20Firewall%20SQL-FFF000?style=for-the-badge&logo=duckdb&logoColor=black)](#-system-architecture)

</div>

---

## ⚡ 30-Second Overview

Power grids, water utilities and factories are still bridged from their Operational Technology (**OT**) control networks to corporate **IT** through software firewalls. Those firewalls get misconfigured, exploited, or bypassed by dual-homed servers and rogue 5G modems.

**Hardware data diodes**, one-way optical or FPGA links, are the standard fix for critical infrastructure (**IEC 62443 SL-4**). But dropping a diode into a live plant breaks it: historians, SCADA servers and PLCs poll each other in both directions. Today a senior OT architect spends **weeks** auditing traffic, inspecting cabinets, sizing hardware and planning which flows can cross, which must be reversed, and which must be cut.

**ConduitAI turns the read-only artifacts a plant can hand over into a cutover plan:** SPAN `.pcap` captures, firewall CSVs, switch CLI dumps, asset inventories, cabinet photos and field notes. It produces:

1. **A measured flow inventory.** Scapy decodes Layer-7 function codes (Modbus read vs. write, IEC-104 breaker commands, DNP3 operate, S7comm, CIP, OPC-UA, BACnet), and DuckDB aggregates 24 h of FortiGate / PAN-OS logs. Zones come from the switch audit's Purdue levels, so direction (IT→OT vs. OT→IT) is computed rather than guessed. Lateral-movement scanning is flagged.
2. **Shadow-asset discovery.** Switch ARP/MAC tables are reconciled against the documented inventory, with OUI enrichment.
3. **An architecture designed by Meta Muse Wonder and checked by a deterministic verifier.** Muse Wonder proposes a Green / Amber / Red tier and an action for every flow, plus the diode bill of materials and mounting. The verifier rejects any unsafe or infeasible proposal and sends the violations back for revision. Unsafe means an inbound session graded GREEN, or remote admin or lateral movement left connected. Infeasible means a protocol the chosen diode can't proxy, under-capacity, too many VLANs, or no physical space.
4. **A today-vs-proposed map**, built from each run: every connection the office network can open into the plant today, and what remains after the diodes go in.
5. **Proof against a hacked IT network.** Real control commands taken from public ICS captures (IEC-104 breaker commands, DNP3 operate, Modbus writes) are replayed down the exact paths the plant's traffic uses. Substation: **51 of 51** reach plant equipment today, **0 of 51** with the plan. Water plant: **11 of 11** today, **0 of 11** with the plan. The check can fail: a plan that leaves the water plant's cellular modem in place lets its commands through.
6. **Deliverables:** TX/RX proxy translation table, switch cutover CLI, `.drawio` topology, PDF report and IEC 62443 / NIST 800-82 / NERC CIP mapping.

---

## 📊 Measured Results

Every number below is computed by [`backend/scripts/run_eval_benchmark.py`](backend/scripts/run_eval_benchmark.py). The script runs the real pipeline on each scenario's raw files and only then scores the plan against [`benchmark_ground_truth.json`](data/evals/benchmark_ground_truth.json). The pipeline never reads ground truth. Full output: [**`docs/BENCHMARK_SCORECARD.md`**](docs/BENCHMARK_SCORECARD.md).

| Metric (2 plants, 13 labelled flows) | Rule engine only | **Muse Wonder + verifier** |
| :--- | :--- | :--- |
| Hardware BoM exact (archetypes + quantity) | 1/2 | **2/2** |
| Flow Green/Amber/Red tier correct | 13/13 | 13/13 |
| Critical violations severed at L1 | 4/4 | 4/4 |
| Unsafe passes (must-block flow graded GREEN) | 0 | 0 |
| Shadow / rogue assets found | 4/4 | 4/4 |

*The live column is one run; Muse Wonder's output varies a little between runs, so re-run `--live` to reproduce.*

- **Where the model adds value:** the water plant mixes PLC polling with camera streams. The rule engine picks one video diode; Muse Wonder picks a field diode for the PLCs plus a video diode for the cameras, which matches the answer key. The verifier, which also checks every rule-engine plan, flags the rule engine's kit: the video diode can't proxy the PLCs' Modbus TCP.
- **The verifier catches the model.** At the substation, Muse Wonder's first kit couldn't proxy IEC-104, the substation's main telemetry protocol. The verifier rejected it and the model fixed the kit on attempt 2. The Compatibility tab shows each attempt and its violations.
- **With only 13 labelled flows, these scores are a demo sanity check, not a statistical claim.**

> Both plants are synthetic (see *What is synthetic* below) and were written alongside the parsers. Treat perception scores (assets, shadows, peak Mbps) as regression tests, not generalisation evidence. The parsers are also run against **15 real public ICS captures** (CISA, UIUC ITI, Digital Bond): 13 yield Layer-7 decodes.

---

## 🔎 What Runs Live Today

| Stage | Status | Notes |
| :--- | :--- | :--- |
| Packet + firewall analysis (Scapy, DuckDB) | ✅ Real | Runs on any uploaded `.pcap` / FortiGate / PAN-OS CSV |
| Switch CLI + inventory reconciliation | ✅ Real (deterministic) | Cisco/Stratix, Hirschmann, Aruba, Moxa dumps + OUI table |
| Architect: Muse Wonder propose → verify | ✅ Live (`muse-wonder-1.0`) | 1–3 attempts, ~10–25 s at `ARCHITECT_REASONING_EFFORT=low`; falls back to the rule engine if no proposal is accepted. The fallback plan goes through the same verifier, and any violations are shown instead of hidden |
| Muse Voice Transcribe | ✅ Live for uploaded or recorded audio | Built-in scenarios use a sample transcript |
| SAM 3.1 cabinet measurement | ✅ Live (`sam-3.1` + `muse-spark-1.3`) | Empty rack units, free DIN-rail mm and rogue cellular modems are measured from SAM boxes, scaled by standard dimensions in the photo (see below). A gap between rack devices counts as free only after Muse Spark confirms its crop is empty. Responses are recorded under `data/cache/`, so offline runs replay real model output |
| SAM 3.1 on **real** photos | ⚠️ Fails safe, low coverage | On 17 real Wikimedia Commons photos: 2 of 11 enclosures measured, **0 false free-space claims**, 0 false modem alarms. Most real photos (angled, cluttered, doors in the way) come back "not measured". See [the real-photo check](docs/DATA_SOURCES_AND_BENCHMARK_METHODOLOGY.md#real-photo-check) |
| SAM 3.1 video tracking | ✅ Live, weak on the sample videos | 8 frames are sampled with PyAV, SAM runs on each and detections are linked into tracks. The two bundled walkthroughs are synthetic renders SAM barely recognises (detections in 2/8 and 5/8 frames), so they add little; real phone footage is needed |
| Network drawing vs. reality | ✅ Live (`sam-3.1` + `muse-spark-1.3`) | SAM finds every box on the customer's drawing and Muse Spark reads its name and IPs. The drawing is then compared with the hosts seen on the network: drawn devices never seen, and hosts on the network missing from the drawing (the water plant's cellular modem is one) |
| Muse Image rack card | ✅ Live endpoint | `POST /api/v1/visuals/rack-card` |
| Baseten `muse-spark-open-1026` | ⏸ Not configured | Switch parsing is deterministic; enrichment falls back to Muse Spark |
| Air-gapped Muse Glimmer mode | ⏸ Not configured | Requires a Glimmer endpoint; the UI marks it as simulated otherwise |
| Socket "digital twin" | ⚠️ Mechanism demo | Real `os.pipe()` one-way relay, but it cannot fail by construction, so it is not counted as evidence of plan correctness |

The workbench shows this too. Model pills say *sim* when an integration has no credentials. Every screen is labelled as either reference data or a live pipeline result. The architect panel shows the actual proposal / verdict trace.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Intake["1. Read-only customer artifacts"]
        I1["Network diagram"]
        I2["Cabinet photo / walkthrough video"]
        I3["Field voice note"]
        I4["Switch CLI dump + inventory CSV<br/>24h firewall CSV + SPAN .pcap"]
    end

    subgraph Perception["2. Perception (LangGraph nodes)"]
        V1["SAM 3.1 + Muse Spark vision<br/>→ rack / DIN space, modems, drawing vs. network"]
        ASR["Muse Voice Transcribe"]
        P1["Switch CLI + OUI reconciliation<br/>→ assets, shadows, Purdue zones"]
        T1["Scapy L7 + DuckDB telemetry<br/>→ flows, direction, peak Mbps, lateral movement"]
    end

    subgraph Design["3. Propose → verify"]
        ARCH["Muse Wonder proposes<br/>per-flow tier/action + BoM + mounting"]
        VER{"Deterministic verifier<br/>safety · protocol · capacity · VLAN · physical fit"}
        RULE["Rule engine fallback"]
    end

    subgraph Outputs["4. Workbench deliverables (Next.js)"]
        O0["Today-vs-proposed map + attack replay with real ICS commands"]
        O1["Green/Amber/Red cutover matrix + TX/RX proxy table"]
        O2["Diode BoM, sizing, switch cutover CLI"]
        O3[".drawio / PDF / .zip, compliance mapping"]
    end

    I1 & I2 --> V1
    I3 --> ASR
    I4 --> P1 & T1
    P1 -- zone map --> T1
    V1 & ASR & P1 & T1 --> ARCH
    ARCH --> VER
    VER -- "violations (≤3 attempts)" --> ARCH
    VER -- accepted --> O0 & O1 & O2 & O3
    VER -- "never accepted" --> RULE
    RULE -- "same verifier, violations shown" --> O0 & O1 & O2 & O3
```

### Green / Amber / Red Cutover Logic

```mermaid
flowchart LR
    FLOW["Observed cross-zone flow<br/>(src, dst, port, L7 function codes)"] --> DIR{"Who initiates?"}

    DIR -->|"OT → IT push<br/>Syslog, MQTT, SFTP, HTTPS, BACnet COV; RTSP pulled locally"| GREEN["🟢 GREEN: drop-in<br/>TX → RX proxy entry"]
    DIR -->|"IT → OT read poll<br/>Modbus FC 03/04, DNP3 class poll, IEC-104 interrogation, SNMP"| AMBER["🟡 AMBER: pull-to-push reversal<br/>Diode TX polls locally, pushes to RX replica"]
    DIR -->|"IT → OT dynamic ports / file share / write"| TYPE{"Protocol & intent"}

    TYPE -->|"OPC-DA DCOM, SMBv1"| RED_WRAP["🔴 RED: OPC-UA wrapper or SFTP relay first"]
    TYPE -->|"Signed MES recipe / EMS dispatch"| ARCH_D["🟣 ARCH_D gateway<br/>TCP SYN locked to OT side"]
    TYPE -->|"RDP, VNC, Telnet, inbound SSH,<br/>unsigned writes, lateral scanning, rogue bypass"| BLOCK["⛔ CRITICAL: sever at Layer 1/2"]
```

---

## 🧠 How the Meta Models Are Used

- **`Muse Wonder` (`muse-wonder-1.0`, Meta Model API): the architect.** It receives an evidence pack: every measured flow with its L7 detail, peak and sized bandwidth, VLANs, shadow assets, and cabinet/video constraints. It returns strict JSON: per-flow initiator / tier / action / rationale, a bill of materials with mounting, and a target security level. [`architect_llm_planner.py`](backend/app/agents/architect_llm_planner.py) verifies the proposal against catalog-driven rules and returns violations to the model for revision. Reasoning effort is configurable (`ARCHITECT_REASONING_EFFORT`).
- **`SAM 3.1`: physical survey.** Each cabinet photo gets one concept prompt per call ("patch panel", "rack server", "electrical cabinet", "steel bar", "cellular modem", "antenna", …). [`sam_geometry.py`](backend/app/agents/sam_geometry.py) turns the boxes into measurements using standards visible in the same photo, with no per-site constants:
  - **Rack units:** a 19-inch panel is 482.6 mm wide and 1U is 44.45 mm, so the gaps between segmented rack gear are sized in U. A gap counts as empty only when Muse Spark, shown that crop, confirms nothing is mounted there. On a real rack it correctly rejected 16 U of "gaps" that were cable managers.
  - **DIN rail:** exposed rail is 35 mm tall, so each free segment's length is measured in mm.
  - **Rogue modems:** a cellular modem counts only when it sits inside a segmented enclosure. Whiteboards and sketches are recognised as non-cabinet photos and skipped.

  These measurements feed the architect's evidence pack and the verifier's physical-fit check, and the UI draws SAM's boxes in the photo's own pixel coordinates.
- **`Muse Spark` (`muse-spark-1.3`): reads what SAM finds.** It reads the name and IPs in each box SAM segments on the customer's network drawing, and confirms whether each rack gap is really empty. It is also the fallback for switch-dump enrichment.
- **`Muse Voice Transcribe`:** live transcription of uploaded or browser-recorded field notes into structured observations.
- **`Muse Image`:** rack / DIN-rail placement card generation.
- **Air-gapped mode (`Muse Glimmer`) and Baseten** are wired in the model router but need their own endpoints / keys to run.

---

## 🏭 Two Demo Plants

| Plant | Profile | Key protocols, peak | What the client sees |
| :--- | :--- | :--- | :--- |
| **1. GridCore 220 kV Substation** | SEL / ABB / GE IEDs in a control-room rack | IEC-104, DNP3, Modbus, Syslog, 42 Mbps | Today an IT host can send an IEC-104 breaker-trip command and open SSH sessions into the substation. A field diode in the measured free rack space cuts both, while telemetry keeps flowing out |
| **2. AquaPure Water Treatment** | Chlorine dosing, ControlLogix, DIN-rail cabinets | EtherNet/IP CIP, Modbus, VNC, 65 Mbps | A cellular modem in the cabinet bypasses the firewall entirely. A diode alone isn't enough: the modem must be removed, and the PLC and camera traffic need two diodes |

---

## 🔌 Vendor-Neutral Hardware Catalog

Sizing runs against four archetypes in [`data/catalogs/hardware_catalog.json`](data/catalogs/hardware_catalog.json). Point `HARDWARE_CATALOG_PATH` at a vendor catalog with the same schema to quote real SKUs.

| Archetype | Class | Sustained | Form factor | Proxied protocols |
| :--- | :--- | :--- | :--- | :--- |
| `ARCH_A_FIELD_DIODE` | Industrial field protocol diode | 80 Mbps | DIN rail / compact wall | Modbus TCP, DNP3, IEC-104, Syslog, SFTP, HTTPS push |
| `ARCH_B_VIDEO_IOT_DIODE` | Edge video & IoT diode | 800 Mbps | ½-1U / DIN rail | RTSP, ONVIF, MQTT, BACnet telemetry, Syslog, HTTPS push |
| `ARCH_C_ENTERPRISE_1U_DIODE` | 1U multi-VLAN protocol-breaking diode | 850 Mbps | 1U rack | OPC-UA, SQL replication, SFTP, MQTT, Modbus TCP, DNP3, RTSP, SMTP, HTTPS, Syslog |
| `ARCH_D_BIDIRECTIONAL_GATEWAY` | Dual-stage OT-locked gateway | 800 Mbps | 1U rack | Adds signed recipe / setpoint dispatch, with the TCP SYN locked to the OT side |

---

## 🚀 Quickstart

**Prerequisites:** Python 3.12+ with [`uv`](https://docs.astral.sh/uv/), Node.js 20+.

```bash
cp .env.example .env          # set META_MODEL_API_KEY for the live Muse Wonder architect
cd backend && uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8008
```

```bash
cd frontend && npm install && npm run dev
```

Open **http://localhost:3000**. Pick one of the two demo plants and press **Run Analysis**. The default **Simple story** view walks through three plain-language steps (*What we found → Our fix → Proof*); **Engineer detail** shows every flow, rule, measurement and file. Alternatively, use **Upload** on each row of the Site Files checklist (traffic logs accept several files at once), then **Analyze Uploaded Files**.

**Reproduce the benchmark:**

```bash
cd backend
uv run python scripts/run_eval_benchmark.py          # rule engine, no API calls
uv run python scripts/run_eval_benchmark.py --live   # + Muse Wonder / verifier
uv run python scripts/check_real_photos.py           # SAM on real Commons photos
uv run pytest -q
```

---

## 📜 Provenance

- The git history starts on **2026-10-26**, the first day of the hackathon build window. Application code in [`backend/`](backend/) and [`frontend/`](frontend/) was written during the event.
- The real industrial captures in [`data/real_ics_captures/`](data/real_ics_captures/) come from public repositories: US CISA `cisagov`, UIUC ITI (CC-BY-4.0) and Digital Bond. Sources and SHA-256 checksums are listed in [`docs/DATA_SOURCES_AND_BENCHMARK_METHODOLOGY.md`](docs/DATA_SOURCES_AND_BENCHMARK_METHODOLOGY.md).

### What is synthetic

No real customer site was used. Everything in the two demo plants is generated:

| Artifact | How it was made |
| :--- | :--- |
| SPAN `.pcap` captures, firewall CSVs, switch CLI dumps, asset inventories | Generated by scripts in this repo, with protocol-valid packets and Layer-7 payloads |
| Cabinet and rack photos (`*.jpg` in `data/scenarios/`, `data/visuals/`) | AI-generated images, not photographs of real sites. SAM 3.1 measures them well; it does much worse on real photos, which is why the real-photo check exists |
| Network drawings (`*_diagram.png`) | Generated images |
| Walkthrough videos (`data/videos/*.mp4`) | Rendered by [`generate_rack_videos.py`](data/scripts/generate_rack_videos.py) |
| Field voice notes | Sample transcripts. Live transcription runs on audio you upload or record |
| Answer key (`benchmark_ground_truth.json`) | Written by the author alongside the scenarios |

## 📄 License

Released under the [MIT License](LICENSE).
