# UOWM IEC-104 testbed (real traffic)

The third demo plant is built from real, publicly licensed traffic instead of generated data.

**Source:** *IEC 60870-5-104 Intrusion Detection Dataset*, ITHACA group, University of Western Macedonia. Zenodo record [7108614](https://zenodo.org/records/7108614), licensed **CC-BY-4.0**. Authors: P. Radoglou-Grammatikis, T. Lagkas, V. Argyriou, P. Sarigiannidis.

Please cite: P. Radoglou-Grammatikis et al., "Modeling, Detecting, and Mitigating Threats Against Industrial Healthcare Systems: A Combined Software Defined Networking and Reinforcement Learning Approach", *IEEE Transactions on Industrial Informatics*, vol. 18, no. 3, pp. 2041-2052, 2022, doi:10.1109/TII.2021.3093905.

## What was taken

| File | How it was made |
| :--- | :--- |
| `rtu_span_capture.pcap` | The seven RTU-side `*_iec104_only.pcap` captures from `20200428_UOWM_IEC104_Dataset_c_sc_na_1.7z` (the C_SC_NA_1 unauthorised single-command attack), merged in time order without other changes. 26,197 packets over 4.2 hours. |
| `asset_inventory.csv` | Transcribed from Figure 1 of the dataset's ReadMe: the five IEC servers that the figure lists with addresses, plus the QTester104 HMI. The figure also draws two "real RTU devices" without addresses, so they are not in the list. |

Nothing else (firewall log, switch dump, drawing, photos, video, voice note) exists for this testbed, and none is invented. The pipeline runs on the capture and the asset list alone.

## Modelling choices

- The testbed is one flat 192.168.1.0/24 network. The QTester104 HMI plays the role of the remote control centre (outside the plant boundary, Purdue L4 in the asset list), and the RTUs are the plant. This is the same arrangement as the synthetic substation, where the regional control centre polls the RTUs over IEC-104.
- The three attack machines are, in the dataset's words, malicious insiders on the same network. ConduitAI finds them as undocumented hosts that send control commands into plant devices, which it treats like any other path that skips the boundary.

## Answer key

The answer key in `data/evals/benchmark_ground_truth.json` (`scenario_5_uowm_iec104`) comes only from the dataset:

- **Flows:** the authors label each flow `NORMAL` or `c_sc_na_1`. Attack flows (from .27, .28 and .29) must be cut. The HMI's flows are labelled `NORMAL`, so the plan must keep them working; the scorer checks that they are not cut, whatever route the plan gives them.
- **Hosts:** 11 hosts appear in the traffic; 5 are not in the asset list (the two RTUs drawn without addresses, and the three attack machines).
- **Not scored:** peak bandwidth and the hardware kit, because the dataset gives no reference for them.
