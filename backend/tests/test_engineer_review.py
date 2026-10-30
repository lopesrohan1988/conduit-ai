"""Engineer review: overrides re-checked by the verifier, sign-off, evidence manifest and site questions."""

from __future__ import annotations

import io
import json
import zipfile

import httpx
import pytest

from app.main import app

SITE = "scenario_4_water_treatment"
BASE = f"/api/v1/assessments/{SITE}"


@pytest.mark.asyncio
async def test_review_overrides_signoff_and_evidence() -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        # Any export runs the pipeline once and keeps the run for review
        assert (await client.get(f"{BASE}/export/drawio")).status_code == 200
        body = (await client.get(f"{BASE}/review")).json()

        # The water plant's voice note disagrees with SAM 3.1 and with the switch dump
        topics = {c["topic"] for c in body["evidence_conflicts"]}
        assert {"Free DIN rail", "Switch port Gi1/24"} <= topics
        port = next(c for c in body["evidence_conflicts"] if c["topic"] == "Switch port Gi1/24")
        assert "Fa1/24" in port["sources"][1]["value"]

        manifest = body["evidence_manifest"]
        assert {"Packet capture", "Switch CLI dump", "Cabinet photo"} <= {i["role"] for i in manifest["inputs"]}
        assert all(len(i["sha256"]) == 64 for i in manifest["inputs"])
        assert any(f["id"] == "FLOW-01" and "packets" in f["evidence"] for f in manifest["findings"])
        first_print = body["review"]["plan_fingerprint"]

        # Reopening the rogue modem's Modbus write is refused, and the plan is untouched
        r = await client.post(
            f"{BASE}/review/override",
            json={"flow_id": "FLOW-01", "action": "DROP_IN_PROXY_MAPPING", "reason": "vendor needs it", "reviewer": "A. Engineer"},
        )
        refused = r.json()
        assert refused["override"]["accepted"] is False
        assert any("bypass" in v for v in refused["override"]["violations"])
        assert "architecture_plan" not in refused
        assert refused["review"]["plan_fingerprint"] == first_print

        # Sign off, then cut a kept feed: accepted, applied everywhere, and the sign-off is voided
        signed = (await client.post(f"{BASE}/review/signoff", json={"reviewer": "A. Engineer", "note": "ok"})).json()
        assert signed["review"]["signoff"]["plan_fingerprint"] == first_print
        r = await client.post(
            f"{BASE}/review/override",
            json={"flow_id": "FLOW-03", "action": "SEVER_CRITICAL_VIOLATION_AT_L1", "reason": "EPA batch upload moves to USB", "reviewer": "A. Engineer"},
        )
        accepted = r.json()
        assert accepted["override"]["accepted"] is True
        row = next(x for x in accepted["architecture_plan"]["protocol_cutover_matrix"] if x["flow_id"] == "FLOW-03")
        assert row["cutover_action_type"] == "SEVER_CRITICAL_VIOLATION_AT_L1"
        assert "Engineer override by A. Engineer" in row["engineering_prescription"]
        assert accepted["topology"]["summary"]["connections_cut"] >= 3
        assert accepted["review"]["signoff"] is None
        assert accepted["review"]["plan_fingerprint"] != first_print

        await client.post(f"{BASE}/review/signoff", json={"reviewer": "B. Lead", "note": "approved"})
        with zipfile.ZipFile(io.BytesIO((await client.get(f"{BASE}/export/zip")).content)) as zf:
            assert "07_evidence_manifest.json" in zf.namelist()
            review = json.loads(zf.read("08_engineer_review.json"))
            assert review["review"]["signoff"]["reviewer"] == "B. Lead"
            assert len(review["review"]["overrides"]) == 2
            assert review["questions_for_site"]
            plan = json.loads(zf.read("04_architecture_plan.json"))
            assert any(
                x["flow_id"] == "FLOW-03" and x["cutover_action_type"] == "SEVER_CRITICAL_VIOLATION_AT_L1"
                for x in plan["protocol_cutover_matrix"]
            )
        assert (await client.get(f"{BASE}/export/pdf")).status_code == 200


@pytest.mark.asyncio
async def test_review_rejects_bad_requests() -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        never_run = "/api/v1/assessments/capture__dnp3_master_operate_iti/review"
        assert (await client.get(never_run)).status_code == 409
        assert (await client.get(f"{BASE}/export/drawio")).status_code == 200
        ok = {"flow_id": "FLOW-03", "action": "SEVER_CRITICAL_VIOLATION_AT_L1", "reason": "a real reason", "reviewer": "A. Engineer"}
        assert (await client.post(f"{BASE}/review/override", json={**ok, "reason": "no"})).status_code == 422
        assert (await client.post(f"{BASE}/review/override", json={**ok, "flow_id": "FLOW-99"})).status_code == 404
        assert (await client.post(f"{BASE}/review/override", json={**ok, "action": "ALLOW_ALL"})).status_code == 422


@pytest.mark.asyncio
async def test_streamed_run_carries_review_and_every_model() -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver", timeout=300) as client:
        url = "/api/v1/assessments/scenario_5_uowm_iec104/stream?step_delay_ms=0&live_llm=false"
        complete = None
        async with client.stream("GET", url) as r:
            async for line in r.aiter_lines():
                if line.startswith("data:") and '"stage": "complete"' in line:
                    complete = json.loads(line[5:])
        assert complete is not None
        # Every pipeline stage is in the manifest, not just the last one streamed
        assert len(complete["evidence_manifest"]["models"]) == 7
        assert complete["review"] == {"overrides": [], "signoff": None, "plan_fingerprint": complete["review"]["plan_fingerprint"]}


@pytest.mark.asyncio
async def test_sessions_never_see_each_others_runs() -> None:
    a, b = "?session=alice-1234abcd", "?session=bob-5678efgh"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        assert (await client.get(f"{BASE}/export/drawio{a}")).status_code == 200
        # Bob has not run this site, so there is nothing of Alice's for him to review
        assert (await client.get(f"{BASE}/review{b}")).status_code == 409
        r = await client.post(
            f"{BASE}/review/override{a}",
            json={"flow_id": "FLOW-03", "action": "SEVER_CRITICAL_VIOLATION_AT_L1", "reason": "Alice cuts it", "reviewer": "Alice"},
        )
        assert r.json()["override"]["accepted"] is True
        await client.post(f"{BASE}/review/signoff{a}", json={"reviewer": "Alice"})

        # Bob's own export runs his own plan: none of Alice's change or sign-off is in it
        with zipfile.ZipFile(io.BytesIO((await client.get(f"{BASE}/export/zip{b}")).content)) as zf:
            plan = json.loads(zf.read("04_architecture_plan.json"))
            review = json.loads(zf.read("08_engineer_review.json"))["review"]
        row = next(x for x in plan["protocol_cutover_matrix"] if x["flow_id"] == "FLOW-03")
        assert row["cutover_action_type"] != "SEVER_CRITICAL_VIOLATION_AT_L1"
        assert review["overrides"] == [] and review["signoff"] is None
        alice = (await client.get(f"{BASE}/review{a}")).json()["review"]
        assert alice["signoff"]["reviewer"] == "Alice"


def test_run_store_is_bounded_and_expires() -> None:
    from app.run_store import RunStore

    store = RunStore(max_runs=2, ttl_seconds=3600)
    for i in range(3):
        store.put("s", f"site{i}", {"i": i})
    assert len(store) == 2 and store.get("s", "site0") is None and store.get("s", "site2") == {"i": 2}
    expired = RunStore(max_runs=10, ttl_seconds=0)
    expired.put("s", "site", {})
    assert expired.get("s", "site") is None
